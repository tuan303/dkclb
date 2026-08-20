import { Firestore } from "@google-cloud/firestore";
import { randomBytes } from "node:crypto";

const ACTIVE_STATUSES = new Set(["submitted", "payment", "confirmed"]);

function snapshotRows(snapshot) {
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}

function chunks(items, size = 450) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function firestoreError(message, cause) {
  const error = new Error(message, { cause });
  error.code = "FIRESTORE_CONFIGURATION_ERROR";
  return error;
}

function asServerUser(document) {
  if (!document?.exists) return null;
  const data = document.data();
  return {
    id: document.id,
    account: data.account,
    display_name: data.displayName,
    role: data.role,
    password_salt: data.passwordSalt,
    password_hash: data.passwordHash,
    auth_provider: data.authProvider || "local",
    microsoft_object_id: data.microsoftObjectId || null,
    must_change_password: data.mustChangePassword ? 1 : 0,
    login_failures: Number(data.loginFailures || 0),
    locked_until: data.lockedUntil || null,
    active: data.active === false ? 0 : 1,
    created_at: data.createdAt,
  };
}

// Một dòng danh mục = một lớp CLB. Tách rõ trường của CLB và của lớp để tên lớp
// không ghi đè tên CLB khi trộn hai document.
function normalizeCatalogRow(club, clubClass) {
  return {
    id: clubClass.id,
    clubId: club.id,
    code: club.code,
    name: club.name,
    className: clubClass.name || "",
    category: club.category,
    description: club.description,
    emoji: club.emoji,
    visual: club.visual,
    grades: Array.isArray(club.grades) ? club.grades : [],
    classGrades: Array.isArray(clubClass.grades) ? clubClass.grades : [],
    clubSortOrder: Number(club.sortOrder || 0),
    sortOrder: Number(clubClass.sortOrder || 0),
    periodId: clubClass.periodId,
    dayOfWeek: clubClass.dayOfWeek,
    startTime: clubClass.startTime,
    endTime: clubClass.endTime,
    scheduleLabel: clubClass.scheduleLabel,
    room: clubClass.room,
    teacher: clubClass.teacher,
    capacity: Number(clubClass.capacity || 0),
    minCapacity: Number(clubClass.minCapacity || 0),
    enrolledBase: Number(clubClass.enrolledBase || 0),
    fee: Number(clubClass.fee || 0),
    waitlistEnabled: clubClass.waitlistEnabled !== false,
    active: clubClass.active !== false,
  };
}

function createHttpError(status, code, message, details) {
  const error = new Error(message);
  Object.assign(error, { status, code, details });
  return error;
}

export async function createFirestoreStore({ projectId, seed, authClient }) {
  try {
    const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
    const firestore = new Firestore({
      projectId,
      preferRest: true,
      ignoreUndefinedProperties: true,
      ...(emulator || !authClient ? {} : { authClient }),
    });

    const users = firestore.collection("users");
    const students = firestore.collection("students");
    const parentStudents = firestore.collection("parentStudents");
    const clubs = firestore.collection("clubs");
    const clubClasses = firestore.collection("clubClasses");
    const registrations = firestore.collection("registrations");
    const supportRequests = firestore.collection("supportRequests");
    const sessions = firestore.collection("sessions");
    const oauthStates = firestore.collection("oauthStates");
    const auditLogs = firestore.collection("auditLogs");
    const classCounters = firestore.collection("classCounters");
    const registrationPeriods = firestore.collection("registrationPeriods");

    async function commitDocuments(documents) {
      for (const group of chunks(documents)) {
        const batch = firestore.batch();
        for (const item of group) batch.set(firestore.doc(item.path), item.data, item.options || { merge: false });
        await batch.commit();
      }
    }

    // Bộ đếm chỗ = số ghi danh sẵn + số đơn đang giữ chỗ. Phải tính lại mỗi khi
    // quản trị sửa lớp để giao dịch đăng ký không dựa trên số cũ.
    async function recomputeClassCounter(classId, enrolledBase) {
      const snapshot = await registrations.where("classId", "==", classId).get();
      const active = snapshotRows(snapshot).filter((row) => ACTIVE_STATUSES.has(row.status)).length;
      await classCounters.doc(classId).set({
        classId,
        enrolledCount: Number(enrolledBase || 0) + active,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    }

    async function seedIfEmpty() {
      const bootstrapRef = firestore.doc("_system/bootstrap");
      const bootstrap = await bootstrapRef.get();
      if (bootstrap.exists) return;
      const seedDocuments = [
        ...seed.users.map((item) => ({ path: `users/${item.id}`, data: item })),
        ...seed.students.map((item) => ({ path: `students/${item.id}`, data: item })),
        ...seed.parentStudents.map((item) => ({ path: `parentStudents/${item.parentUserId}_${item.studentId}`, data: item })),
        ...seed.periods.map((item) => ({ path: `registrationPeriods/${item.id}`, data: item })),
        ...seed.clubs.map((item) => ({ path: `clubs/${item.id}`, data: item })),
        ...seed.classes.map((item) => ({ path: `clubClasses/${item.id}`, data: item })),
        ...seed.registrations.map((item) => ({ path: `registrations/${item.id}`, data: item })),
        ...seed.supportRequests.map((item) => ({ path: `supportRequests/${item.id}`, data: item })),
        ...seed.auditLogs.map((item) => ({ path: `auditLogs/${item.id}`, data: item })),
        ...seed.classes.map((clubClass) => ({
          path: `classCounters/${clubClass.id}`,
          data: {
            classId: clubClass.id,
            enrolledCount: Number(clubClass.enrolledBase || 0) + seed.registrations.filter((registration) => registration.classId === clubClass.id && ACTIVE_STATUSES.has(registration.status)).length,
            updatedAt: new Date().toISOString(),
          },
        })),
      ];
      await commitDocuments(seedDocuments);
      await bootstrapRef.set({ schemaVersion: 2, projectId, createdAt: new Date().toISOString(), source: "nshm-clubs-server" }, { merge: false });
    }

    await seedIfEmpty();

    return {
      kind: "firestore",

      async getUserByAccount(account) {
        const normalized = String(account || "").trim().toLowerCase();
        const direct = await users.where("accountLower", "==", normalized).limit(1).get();
        if (!direct.empty) {
          const user = asServerUser(direct.docs[0]);
          return user?.active ? user : null;
        }
        const legacy = await users.where("account", "==", account).limit(1).get();
        const user = legacy.empty ? null : asServerUser(legacy.docs[0]);
        return user?.active ? user : null;
      },

      async recordLoginFailure(userId, failures, lockedUntil) {
        await users.doc(userId).update({ loginFailures: Number(failures), lockedUntil: lockedUntil || null });
      },

      async resetLoginFailures(userId) {
        await users.doc(userId).update({ loginFailures: 0, lockedUntil: null });
      },

      async createSession({ token, userId, expiresAt, createdAt }) {
        await sessions.doc(token).set({ userId, expiresAt, createdAt }, { merge: false });
      },

      async getSessionUser(token, now) {
        const session = await sessions.doc(token).get();
        if (!session.exists || String(session.data().expiresAt || "") <= now) {
          if (session.exists) await session.ref.delete().catch(() => {});
          return null;
        }
        const user = await users.doc(session.data().userId).get();
        const normalized = asServerUser(user);
        return normalized?.active ? normalized : null;
      },

      async deleteSession(token) {
        await sessions.doc(token).delete();
      },

      async saveOauthState(state) {
        await oauthStates.doc(state.state).set(state, { merge: false });
      },

      async consumeOauthState(state, now) {
        return firestore.runTransaction(async (transaction) => {
          const reference = oauthStates.doc(state);
          const snapshot = await transaction.get(reference);
          if (!snapshot.exists) return null;
          transaction.delete(reference);
          const data = snapshot.data();
          return String(data.expiresAt || "") > now ? data : null;
        });
      },

      async upsertMicrosoftUser({ identity, userId, password, timestamp }) {
        const byObjectId = await users.where("microsoftObjectId", "==", identity.objectId).limit(1).get();
        const byAccount = byObjectId.empty ? await users.where("accountLower", "==", identity.email.toLowerCase()).limit(1).get() : null;
        const existing = !byObjectId.empty ? byObjectId.docs[0] : !byAccount?.empty ? byAccount.docs[0] : null;
        const reference = existing?.ref || users.doc(userId);
        await reference.set({
          account: identity.email,
          accountLower: identity.email.toLowerCase(),
          displayName: identity.name,
          role: "admin",
          authProvider: "microsoft",
          microsoftObjectId: identity.objectId,
          mustChangePassword: false,
          loginFailures: 0,
          lockedUntil: null,
          active: true,
          createdAt: existing?.data().createdAt || timestamp,
          ...(existing ? {} : { passwordSalt: password.salt, passwordHash: password.hash }),
        }, { merge: true });
        return asServerUser(await reference.get());
      },

      async updatePassword(userId, password) {
        await users.doc(userId).update({ passwordSalt: password.salt, passwordHash: password.hash, mustChangePassword: false, loginFailures: 0, lockedUntil: null });
        return asServerUser(await users.doc(userId).get());
      },

      async getExistingAccountRoles() {
        const snapshot = await users.get();
        return new Map(snapshotRows(snapshot).map((user) => [String(user.accountLower || user.account || "").toLowerCase(), user.role]));
      },

      async listStudentsByParent(parentUserId) {
        const links = snapshotRows(await parentStudents.where("parentUserId", "==", parentUserId).get());
        if (!links.length) return [];
        const studentDocuments = await firestore.getAll(...links.map((link) => students.doc(link.studentId)));
        const relationships = new Map(links.map((link) => [link.studentId, link.relationship]));
        return studentDocuments
          .filter((document) => document.exists && document.data().status === "active")
          .map((document) => ({ id: document.id, ...document.data(), relationship: relationships.get(document.id) }))
          .sort((left, right) => Number(left.grade) - Number(right.grade) || String(left.name).localeCompare(String(right.name), "vi"));
      },

      async parentOwnsStudent(parentUserId, studentId) {
        const [link, student] = await Promise.all([parentStudents.doc(`${parentUserId}_${studentId}`).get(), students.doc(studentId).get()]);
        return link.exists && student.exists && student.data().status === "active" ? { id: student.id, ...student.data() } : null;
      },

      async getStudent(studentId) {
        const document = await students.doc(studentId).get();
        return document.exists ? { id: document.id, ...document.data() } : null;
      },

      async listClubs() {
        const [clubSnapshot, classSnapshot] = await Promise.all([clubs.get(), clubClasses.get()]);
        const clubMap = new Map(snapshotRows(clubSnapshot).filter((club) => club.active !== false).map((club) => [club.id, club]));
        return snapshotRows(classSnapshot)
          .filter((clubClass) => clubClass.active !== false && clubMap.has(clubClass.clubId))
          .map((clubClass) => normalizeCatalogRow(clubMap.get(clubClass.clubId), clubClass))
          .sort((left, right) => Number(left.clubSortOrder || 0) - Number(right.clubSortOrder || 0)
            || String(left.category).localeCompare(String(right.category), "vi")
            || String(left.name).localeCompare(String(right.name), "vi")
            || Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
            || Number(left.dayOfWeek || 0) - Number(right.dayOfWeek || 0)
            || String(left.startTime || "").localeCompare(String(right.startTime || "")));
      },

      async getEnrollmentCounts() {
        const snapshot = await classCounters.get();
        return Object.fromEntries(snapshot.docs.map((document) => [document.id, Number(document.data().enrolledCount || 0)]));
      },

      async listPeriods() {
        return snapshotRows(await registrationPeriods.get())
          .sort((left, right) => String(right.openAt || "").localeCompare(String(left.openAt || "")));
      },

      async savePeriod(periodId, data) {
        await registrationPeriods.doc(periodId).set(data, { merge: true });
        const document = await registrationPeriods.doc(periodId).get();
        return { id: document.id, ...document.data() };
      },

      async adminCatalog() {
        const [clubSnapshot, classSnapshot, counterSnapshot, registrationSnapshot] = await Promise.all([
          clubs.get(), clubClasses.get(), classCounters.get(), registrations.get(),
        ]);
        const activeRegistrations = {};
        for (const row of snapshotRows(registrationSnapshot)) {
          if (!ACTIVE_STATUSES.has(row.status)) continue;
          activeRegistrations[row.classId] = (activeRegistrations[row.classId] || 0) + 1;
        }
        return {
          clubs: snapshotRows(clubSnapshot),
          classes: snapshotRows(classSnapshot),
          enrolled: Object.fromEntries(counterSnapshot.docs.map((document) => [document.id, Number(document.data().enrolledCount || 0)])),
          activeRegistrations,
        };
      },

      async saveClub(clubId, data) {
        await clubs.doc(clubId).set(data, { merge: true });
        const document = await clubs.doc(clubId).get();
        return { id: document.id, ...document.data() };
      },

      async saveClass(classId, data) {
        await clubClasses.doc(classId).set(data, { merge: true });
        const document = await clubClasses.doc(classId).get();
        const saved = { id: document.id, ...document.data() };
        await recomputeClassCounter(classId, saved.enrolledBase);
        return saved;
      },

      async bulkSaveCatalog({ clubs: clubWrites = [], classes: classWrites = [] }) {
        await commitDocuments([
          ...clubWrites.map((item) => ({ path: `clubs/${item.id}`, options: { merge: true }, data: item.data })),
          ...classWrites.map((item) => ({ path: `clubClasses/${item.id}`, options: { merge: true }, data: item.data })),
        ]);
        for (const item of classWrites) await recomputeClassCounter(item.id, item.data.enrolledBase);
      },

      async appendAudit(entry) {
        await auditLogs.doc(`audit_${randomBytes(8).toString("hex")}`).set(entry, { merge: false });
      },

      async listRegistrations({ parentUserId, status, studentId } = {}) {
        let query = registrations;
        if (parentUserId) query = query.where("parentUserId", "==", parentUserId);
        else if (studentId) query = query.where("studentId", "==", studentId);
        const rows = snapshotRows(await query.get());
        return rows
          .filter((row) => !studentId || row.studentId === studentId)
          .filter((row) => !status || status === "all" || row.status === status)
          .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
      },

      async hydrateRegistrations(rows) {
        const studentIds = [...new Set(rows.map((row) => row.studentId).filter(Boolean))];
        const classIds = [...new Set(rows.map((row) => row.classId).filter(Boolean))];
        const [studentDocuments, classDocuments, allClubDocuments] = await Promise.all([
          studentIds.length ? firestore.getAll(...studentIds.map((studentId) => students.doc(studentId))) : [],
          classIds.length ? firestore.getAll(...classIds.map((classId) => clubClasses.doc(classId))) : [],
          clubs.get(),
        ]);
        const studentMap = new Map(studentDocuments.filter((document) => document.exists).map((document) => [document.id, document.data()]));
        const classMap = new Map(classDocuments.filter((document) => document.exists).map((document) => [document.id, document.data()]));
        const clubMap = new Map(snapshotRows(allClubDocuments).map((club) => [club.id, club]));
        return rows.map((registration) => ({
          registration,
          student: studentMap.get(registration.studentId) || {},
          clubClass: classMap.get(registration.classId) || {},
          club: clubMap.get(classMap.get(registration.classId)?.clubId || registration.classId) || {},
        }));
      },

      async createRegistrations({ actorUserId, studentId, groupId, periodId = null, clubs: selectedClubs, registrationIds, timestamp }) {
        return firestore.runTransaction(async (transaction) => {
          const existingSnapshot = await transaction.get(registrations.where("studentId", "==", studentId));
          const existing = snapshotRows(existingSnapshot).filter((item) => ACTIVE_STATUSES.has(item.status));
          const counterRefs = selectedClubs.map((club) => classCounters.doc(club.id));
          const counterSnapshots = await Promise.all(counterRefs.map((reference) => transaction.get(reference)));
          for (const club of selectedClubs) {
            for (const current of existing) {
              if (current.classId === club.id) throw createHttpError(422, "VALIDATION_FAILED", `${club.name} đã có trong đăng ký hiện tại.`, [{ type: "duplicate", clubId: club.id, message: `${club.name} đã có trong đăng ký hiện tại.` }]);
              if (club.clubId && current.clubId === club.clubId) throw createHttpError(422, "VALIDATION_FAILED", `Học sinh đã đăng ký một lớp khác của ${club.name}.`, [{ type: "duplicate", clubId: club.id, message: `Học sinh đã đăng ký một lớp khác của ${club.name}.` }]);
              const overlaps = current.dayOfWeek === club.dayOfWeek && club.startTime < current.endTime && current.startTime < club.endTime;
              if (overlaps) throw createHttpError(422, "VALIDATION_FAILED", `${club.name} trùng lịch với một CLB đã đăng ký.`, [{ type: "conflict", clubId: club.id, message: `${club.name} trùng lịch với một CLB đã đăng ký.` }]);
            }
          }
          return selectedClubs.map((club, index) => {
            const counter = counterSnapshots[index].exists ? Number(counterSnapshots[index].data().enrolledCount || 0) : Number(club.enrolled || 0);
            const status = counter >= Number(club.capacity) ? "waitlist" : "payment";
            const registration = {
              id: registrationIds[index], groupId, studentId, parentUserId: actorUserId, classId: club.id,
              clubId: club.clubId || null, periodId: periodId || club.periodId || null, status,
              feeSnapshot: Number(club.fee), scheduleSnapshot: club.schedule, termsAcceptedAt: timestamp,
              createdAt: timestamp, updatedAt: timestamp, dayOfWeek: club.dayOfWeek, startTime: club.startTime, endTime: club.endTime,
            };
            transaction.create(registrations.doc(registration.id), registration);
            if (status !== "waitlist") transaction.set(counterRefs[index], { classId: club.id, enrolledCount: counter + 1, updatedAt: timestamp }, { merge: true });
            transaction.create(auditLogs.doc(`audit_${registration.id}_${Date.now()}_${index}`), {
              actorUserId, action: "CREATE_REGISTRATION", entityType: "registration", entityId: registration.id,
              after: { status, clubId: club.id, studentId }, createdAt: timestamp,
            });
            return { id: registration.id, status, clubId: club.id };
          });
        });
      },

      async createSupportRequest(request) {
        await supportRequests.doc(request.id).create(request);
      },

      async confirmPayment({ registrationId, actorUserId, timestamp }) {
        return firestore.runTransaction(async (transaction) => {
          const registrationRef = registrations.doc(registrationId);
          const registrationSnapshot = await transaction.get(registrationRef);
          if (!registrationSnapshot.exists) throw createHttpError(404, "REGISTRATION_NOT_FOUND", "Không tìm thấy đơn đăng ký.");
          const registration = registrationSnapshot.data();
          if (!["payment", "submitted"].includes(registration.status)) throw createHttpError(409, "INVALID_TRANSITION", "Trạng thái hiện tại không cho phép xác nhận phí.");
          transaction.update(registrationRef, { status: "confirmed", updatedAt: timestamp });
          transaction.create(auditLogs.doc(`audit_${registrationId}_${Date.now()}`), {
            actorUserId, action: "CONFIRM_PAYMENT", entityType: "registration", entityId: registrationId,
            before: { status: registration.status }, after: { status: "confirmed" }, createdAt: timestamp,
          });
          return { id: registrationId, status: "confirmed" };
        });
      },

      async syncDirectory({ snapshot, preparedHashes, actorUserId, timestamp, idFactory, source, analysis }) {
        const [studentSnapshot, userSnapshot, linkSnapshot] = await Promise.all([students.get(), users.get(), parentStudents.get()]);
        const studentsByCode = new Map(snapshotRows(studentSnapshot).map((student) => [student.code, student]));
        const usersByAccount = new Map(snapshotRows(userSnapshot).map((user) => [String(user.accountLower || user.account || "").toLowerCase(), user]));
        const linksByKey = new Map(snapshotRows(linkSnapshot).map((link) => [`${link.parentUserId}_${link.studentId}`, link]));
        const counters = { studentsCreated: 0, studentsUpdated: 0, parentsCreated: 0, parentsExisting: 0, linksCreated: 0, linksUpdated: 0 };
        const studentIdsByCode = new Map();
        const writes = [];
        for (const student of snapshot.students) {
          const existing = studentsByCode.get(student.code);
          const studentId = existing?.id || idFactory("hs");
          studentIdsByCode.set(student.code, studentId);
          writes.push({ path: `students/${studentId}`, options: { merge: true }, data: {
            code: student.code, name: student.name, dateOfBirth: student.dateOfBirth, grade: student.grade,
            homeroom: student.className, level: student.educationLevel, status: "active",
          } });
          if (existing) counters.studentsUpdated += 1;
          else counters.studentsCreated += 1;
        }
        for (const guardian of snapshot.guardians) {
          const accountLower = guardian.account.toLowerCase();
          let user = usersByAccount.get(accountLower);
          if (user && user.role !== "parent") throw createHttpError(409, "ACCOUNT_ROLE_CONFLICT", "Có SĐT phụ huynh trùng với một tài khoản vai trò khác; cần IT xử lý thủ công.");
          if (!user) {
            const initial = preparedHashes.get(guardian.account);
            const userId = idFactory("u_parent");
            user = { id: userId, account: guardian.account, accountLower, role: "parent" };
            usersByAccount.set(accountLower, user);
            writes.push({ path: `users/${userId}`, options: { merge: true }, data: {
              account: guardian.account, accountLower, displayName: guardian.displayName || "Phụ huynh học sinh", role: "parent",
              passwordSalt: initial.salt, passwordHash: initial.hash, authProvider: "local", mustChangePassword: true,
              loginFailures: 0, lockedUntil: null, active: true, createdAt: timestamp,
            } });
            counters.parentsCreated += 1;
          } else {
            writes.push({ path: `users/${user.id}`, options: { merge: true }, data: { accountLower, active: true } });
            counters.parentsExisting += 1;
          }
          for (const linkedStudent of guardian.students) {
            const studentId = studentIdsByCode.get(linkedStudent.studentCode);
            if (!studentId) continue;
            const key = `${user.id}_${studentId}`;
            const existingLink = linksByKey.get(key);
            const relationship = existingLink && existingLink.relationship !== linkedStudent.relationship ? "Bố/Mẹ" : linkedStudent.relationship;
            writes.push({ path: `parentStudents/${key}`, options: { merge: true }, data: { parentUserId: user.id, studentId, relationship } });
            if (existingLink) counters.linksUpdated += 1;
            else {
              linksByKey.set(key, { parentUserId: user.id, studentId, relationship });
              counters.linksCreated += 1;
            }
          }
        }
        await commitDocuments(writes);
        const syncId = idFactory("sync");
        await auditLogs.doc(`audit_${randomBytes(8).toString("hex")}`).set({
          actorUserId, action: "SYNC_STUDENT_DIRECTORY", entityType: "google_sheet", entityId: syncId,
          after: { source: { spreadsheetId: source.spreadsheetId, sheetName: source.sheetName }, counters, scannedRows: analysis.scannedRows }, createdAt: timestamp,
        });
        return { syncId, counters, scannedRows: analysis.scannedRows };
      },
    };
  } catch (error) {
    throw firestoreError(`Không thể kết nối Cloud Firestore của dự án ${projectId}. Hãy kiểm tra Workload Identity, IAM và trạng thái Firestore.`, error);
  }
}
