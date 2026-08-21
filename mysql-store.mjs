// Nền lưu trữ MySQL cho NSHM Clubs.
//
// Hiện thực đúng bộ phương thức mà server.mjs yêu cầu ở một backend, nên toàn bộ
// nghiệp vụ dùng lại không sửa gì. Khác biệt đáng kể so với Firestore:
//   - Giữ chỗ khi đăng ký dùng giao dịch với SELECT ... FOR UPDATE trên dòng lớp,
//     nên số chỗ luôn tính từ dữ liệu thật, không cần bảng đếm riêng.
//   - Không có hạn ngạch đọc/ghi theo ngày.
import { createPool } from "mysql2/promise";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { planDirectoryWrites } from "./directory-plan.mjs";
import { createFieldCrypto } from "./field-crypto.mjs";

const ACTIVE_STATUSES = ["submitted", "payment", "confirmed"];

function createHttpError(status, code, message, details) {
  const error = new Error(message);
  Object.assign(error, { status, code, details, expose: true });
  return error;
}

function storeError(message, cause) {
  const error = new Error(message, { cause });
  error.code = "MYSQL_CONFIGURATION_ERROR";
  return error;
}

const toBool = (value) => value === 1 || value === true;
const toInt = (value) => Number(value || 0);
const jsonArray = (value) => (Array.isArray(value) ? value : typeof value === "string" ? JSON.parse(value || "[]") : []);
const jsonOrNull = (value) => (value === null || value === undefined ? null : typeof value === "string" ? JSON.parse(value) : value);

// server.mjs đọc tài khoản theo tên cột snake_case, giống hệt hàng trả về của MySQL,
// nên chỉ cần chuẩn hóa vài trường có thể null và giải mã phần thông tin cá nhân.
function asServerUser(row, crypto) {
  if (!row) return null;
  return {
    ...row,
    account: crypto.decrypt(row.account),
    display_name: crypto.decrypt(row.display_name),
    password_salt: row.password_salt || null,
    password_hash: row.password_hash || null,
    microsoft_object_id: row.microsoft_object_id || null,
    locked_until: row.locked_until || null,
  };
}

function normalizeCatalogRow(row) {
  return {
    id: row.id,
    clubId: row.club_id,
    code: row.code,
    name: row.name,
    className: row.class_name || "",
    category: row.category,
    description: row.description || "",
    emoji: row.emoji || "🎯",
    visual: row.visual || "life",
    grades: jsonArray(row.club_grades),
    classGrades: jsonArray(row.class_grades),
    clubSortOrder: toInt(row.club_sort_order),
    sortOrder: toInt(row.sort_order),
    periodId: row.period_id,
    dayOfWeek: toInt(row.day_of_week),
    startTime: row.start_time,
    endTime: row.end_time,
    scheduleLabel: row.schedule_label,
    room: row.room,
    teacher: row.teacher,
    capacity: toInt(row.capacity),
    minCapacity: toInt(row.min_capacity),
    enrolledBase: toInt(row.enrolled_base),
    fee: toInt(row.fee),
    waitlistEnabled: toBool(row.waitlist_enabled),
    active: toBool(row.active),
  };
}

const CATALOG_SELECT = `SELECT cc.id, cc.club_id, c.code, c.name, cc.name AS class_name, c.category, c.description,
    c.emoji, c.visual, c.grades AS club_grades, cc.grades AS class_grades, c.sort_order AS club_sort_order,
    cc.sort_order, cc.period_id, cc.day_of_week, cc.start_time, cc.end_time, cc.schedule_label, cc.room,
    cc.teacher, cc.capacity, cc.min_capacity, cc.enrolled_base, cc.fee, cc.waitlist_enabled, cc.active
  FROM club_classes cc JOIN clubs c ON c.id = cc.club_id`;

// Mỗi nhóm dữ liệu xuất ra đúng hình dạng chung của bản sao lưu, không phụ thuộc nền lưu trữ.
const EXPORT_QUERIES = {
  users: {
    sql: `SELECT id, account, display_name, role, password_salt, password_hash, auth_provider,
      microsoft_object_id, must_change_password, login_failures, locked_until, active, created_at FROM users`,
    // Bản sao lưu chứa dữ liệu đã giải mã, để nạp được sang hệ thống dùng khóa khác.
    // Bản thân tệp sao lưu được bảo vệ bằng mật khẩu riêng khi tải về.
    map: (row, crypto) => ({
      id: row.id, account: crypto.decrypt(row.account),
      accountLower: String(crypto.decrypt(row.account) || "").toLowerCase(),
      displayName: crypto.decrypt(row.display_name),
      role: row.role, passwordSalt: row.password_salt || null, passwordHash: row.password_hash || null,
      authProvider: row.auth_provider, microsoftObjectId: row.microsoft_object_id || null,
      mustChangePassword: toBool(row.must_change_password), loginFailures: toInt(row.login_failures),
      lockedUntil: row.locked_until || null, active: toBool(row.active), createdAt: row.created_at,
    }),
  },
  students: {
    sql: "SELECT id, code, name, date_of_birth, grade, homeroom, level, status FROM students",
    map: (row, crypto) => ({
      id: row.id, code: crypto.decrypt(row.code), name: crypto.decrypt(row.name),
      dateOfBirth: crypto.decrypt(row.date_of_birth) || null,
      grade: toInt(row.grade), homeroom: row.homeroom, level: row.level, status: row.status,
    }),
  },
  parentStudents: {
    sql: `SELECT CONCAT(parent_user_id, '_', student_id) AS id, parent_user_id, student_id, relationship
      FROM parent_students`,
    map: (row) => ({ id: row.id, parentUserId: row.parent_user_id, studentId: row.student_id, relationship: row.relationship }),
  },
  registrationPeriods: {
    sql: `SELECT id, name, school_year, term, open_at, close_at, status, max_clubs_per_student, note, updated_at
      FROM registration_periods`,
    map: (row) => ({
      id: row.id, name: row.name, schoolYear: row.school_year, term: row.term, openAt: row.open_at,
      closeAt: row.close_at, status: row.status, maxClubsPerStudent: toInt(row.max_clubs_per_student) || 3,
      note: row.note || "", updatedAt: row.updated_at || null,
    }),
  },
  clubs: {
    sql: "SELECT id, code, name, category, description, emoji, visual, grades, sort_order, active FROM clubs",
    map: (row) => ({
      id: row.id, code: row.code, name: row.name, category: row.category, description: row.description || "",
      emoji: row.emoji || "", visual: row.visual, grades: jsonArray(row.grades),
      sortOrder: toInt(row.sort_order), active: toBool(row.active),
    }),
  },
  clubClasses: {
    sql: `SELECT id, club_id, period_id, name, day_of_week, start_time, end_time, schedule_label, grades, room,
      teacher, capacity, min_capacity, enrolled_base, fee, waitlist_enabled, sort_order, active FROM club_classes`,
    map: (row) => ({
      id: row.id, clubId: row.club_id, periodId: row.period_id, name: row.name || "",
      dayOfWeek: toInt(row.day_of_week), startTime: row.start_time, endTime: row.end_time,
      scheduleLabel: row.schedule_label, grades: jsonArray(row.grades), room: row.room, teacher: row.teacher,
      capacity: toInt(row.capacity), minCapacity: toInt(row.min_capacity), enrolledBase: toInt(row.enrolled_base),
      fee: toInt(row.fee), waitlistEnabled: toBool(row.waitlist_enabled), sortOrder: toInt(row.sort_order),
      active: toBool(row.active),
    }),
  },
  registrations: {
    sql: `SELECT r.id, r.group_id, r.student_id, r.parent_user_id, r.class_id, r.period_id, r.status,
      r.fee_snapshot, r.schedule_snapshot, r.terms_accepted_at, r.created_at, r.updated_at,
      cc.club_id, cc.day_of_week, cc.start_time, cc.end_time
      FROM registrations r LEFT JOIN club_classes cc ON cc.id = r.class_id`,
    map: (row) => ({
      id: row.id, groupId: row.group_id, studentId: row.student_id, parentUserId: row.parent_user_id,
      classId: row.class_id, clubId: row.club_id || null, periodId: row.period_id || null, status: row.status,
      feeSnapshot: toInt(row.fee_snapshot), scheduleSnapshot: row.schedule_snapshot,
      termsAcceptedAt: row.terms_accepted_at || null, createdAt: row.created_at, updatedAt: row.updated_at,
      dayOfWeek: row.day_of_week === null ? null : toInt(row.day_of_week),
      startTime: row.start_time || null, endTime: row.end_time || null,
    }),
  },
  supportRequests: {
    sql: "SELECT id, parent_user_id, registration_id, topic, message, status, created_at FROM support_requests",
    map: (row) => ({
      id: row.id, parentUserId: row.parent_user_id, registrationId: row.registration_id || null,
      topic: row.topic, message: row.message, status: row.status, createdAt: row.created_at,
    }),
  },
  auditLogs: {
    sql: `SELECT id, actor_user_id, action, entity_type, entity_id, before_json, after_json, reason, created_at
      FROM audit_logs`,
    map: (row) => ({
      id: row.id, actorUserId: row.actor_user_id || null, action: row.action, entityType: row.entity_type,
      entityId: row.entity_id, before: jsonOrNull(row.before_json), after: jsonOrNull(row.after_json),
      reason: row.reason || null, createdAt: row.created_at,
    }),
  },
  // Số chỗ ở MySQL luôn tính từ dữ liệu thật nên không có bảng riêng; xuất ra để
  // bản sao lưu giữ đủ hình dạng chung với các nền khác.
  classCounters: {
    sql: `SELECT cc.id, cc.enrolled_base + COALESCE(SUM(CASE WHEN r.status IN ('submitted','payment','confirmed')
      THEN 1 ELSE 0 END), 0) AS enrolled
      FROM club_classes cc LEFT JOIN registrations r ON r.class_id = cc.id
      GROUP BY cc.id, cc.enrolled_base`,
    map: (row) => ({ id: row.id, classId: row.id, enrolledCount: toInt(row.enrolled), updatedAt: new Date().toISOString() }),
  },
};

export async function createMysqlStore({ url, seed = null, encryptionKey, schemaPath = new URL("./mysql-schema.sql", import.meta.url) }) {
  // Khóa là bắt buộc: không có trạng thái nửa vời "tưởng là đã mã hóa".
  const crypto = createFieldCrypto(encryptionKey);
  let pool;
  try {
    pool = createPool({
      uri: url,
      connectionLimit: 10,
      waitForConnections: true,
      charset: "utf8mb4",
      timezone: "Z",
      supportBigNumbers: true,
    });
    await pool.query("SELECT 1");
  } catch (error) {
    throw storeError("Không kết nối được MySQL. Hãy kiểm tra MYSQL_URL, dịch vụ MySQL và quyền của tài khoản.", error);
  }

  const query = async (sql, params = []) => (await pool.query(sql, params))[0];
  const first = async (sql, params = []) => (await query(sql, params))[0] || null;

  async function withTransaction(work) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async function applySchema() {
    // Bỏ hết dòng chú thích TRƯỚC khi tách câu lệnh. Chú thích tiếng Việt có thể
    // chứa dấu chấm phẩy, tách trước thì câu lệnh bị cắt đôi và có bảng bị bỏ qua.
    const sql = (await readFile(schemaPath, "utf8")).replace(/^[ \t]*--.*$/gm, "");
    const statements = sql.split(";").map((statement) => statement.trim()).filter(Boolean);
    if (!statements.length) throw storeError("Tệp schema MySQL rỗng hoặc không đọc được.");
    for (const statement of statements) await pool.query(statement);

    // Kiểm lại: thiếu bảng nào thì dừng ngay thay vì để lỗi lộ ra ở một truy vấn ngẫu nhiên sau này.
    const expected = ["users", "students", "parent_students", "registration_periods", "clubs",
      "club_classes", "registrations", "support_requests", "sessions", "oauth_states", "audit_logs"];
    const [tables] = await pool.query("SHOW TABLES");
    const present = new Set(tables.map((row) => String(Object.values(row)[0])));
    const missing = expected.filter((table) => !present.has(table));
    if (missing.length) throw storeError(`Schema MySQL thiếu bảng: ${missing.join(", ")}.`);
  }
  await applySchema();

  const auditId = () => `audit_${randomBytes(10).toString("hex")}`;

  async function insertAudit(connection, entry) {
    await (connection || pool).query(
      `INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, before_json, after_json, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id || auditId(), entry.actorUserId || null, entry.action, entry.entityType, String(entry.entityId),
        entry.before === undefined || entry.before === null ? null : JSON.stringify(entry.before),
        entry.after === undefined || entry.after === null ? null : JSON.stringify(entry.after),
        entry.reason || null, entry.createdAt,
      ],
    );
  }

  async function seedIfEmpty() {
    if (!seed) return;
    const existing = await first("SELECT COUNT(*) AS total FROM registration_periods");
    if (toInt(existing.total) > 0) return;
    await withTransaction(async (connection) => {
      for (const period of seed.periods || []) {
        await connection.query(
          `INSERT INTO registration_periods (id, name, school_year, term, open_at, close_at, status, max_clubs_per_student, note, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [period.id, period.name, period.schoolYear, period.term, period.openAt, period.closeAt,
            period.status, period.maxClubsPerStudent || 3, period.note || "", period.updatedAt || null],
        );
      }
      for (const user of seed.users || []) {
        await connection.query(
          `INSERT INTO users (id, account, account_index, display_name, role, password_salt, password_hash,
            auth_provider, must_change_password, login_failures, active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)`,
          [user.id, crypto.encrypt(user.account), crypto.blindIndex(user.account),
            crypto.encrypt(user.displayName), user.role,
            user.passwordSalt || null, user.passwordHash || null, user.authProvider || "local",
            user.mustChangePassword ? 1 : 0, user.createdAt],
        );
      }
      for (const student of seed.students || []) {
        await connection.query(
          `INSERT INTO students (id, code, code_index, name, date_of_birth, grade, homeroom, level, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
          [student.id, crypto.encrypt(student.code), crypto.blindIndex(student.code),
            crypto.encrypt(student.name), crypto.encrypt(student.dateOfBirth),
            student.grade, student.homeroom, student.level],
        );
      }
      for (const link of seed.parentStudents || []) {
        await connection.query(
          "INSERT INTO parent_students (parent_user_id, student_id, relationship) VALUES (?, ?, ?)",
          [link.parentUserId, link.studentId, link.relationship],
        );
      }
      for (const club of seed.clubs || []) {
        await connection.query(
          "INSERT INTO clubs (id, code, name, category, description, emoji, visual, grades, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
          [club.id, club.code, club.name, club.category, club.description, club.emoji, club.visual,
            JSON.stringify(club.grades || []), toInt(club.sortOrder)],
        );
      }
      for (const clubClass of seed.classes || []) {
        await connection.query(
          `INSERT INTO club_classes (id, club_id, period_id, name, day_of_week, start_time, end_time, schedule_label,
            grades, room, teacher, capacity, min_capacity, enrolled_base, fee, waitlist_enabled, sort_order, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [clubClass.id, clubClass.clubId, clubClass.periodId, clubClass.name || "", clubClass.dayOfWeek,
            clubClass.startTime, clubClass.endTime, clubClass.scheduleLabel, JSON.stringify(clubClass.grades || []),
            clubClass.room, clubClass.teacher, clubClass.capacity, toInt(clubClass.minCapacity),
            toInt(clubClass.enrolledBase), clubClass.fee, clubClass.waitlistEnabled === false ? 0 : 1, toInt(clubClass.sortOrder)],
        );
      }
      for (const registration of seed.registrations || []) {
        await connection.query(
          `INSERT INTO registrations (id, group_id, student_id, parent_user_id, class_id, period_id, status,
            fee_snapshot, schedule_snapshot, terms_accepted_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [registration.id, registration.groupId, registration.studentId, registration.parentUserId,
            registration.classId, registration.periodId || null, registration.status, registration.feeSnapshot,
            registration.scheduleSnapshot, registration.termsAcceptedAt || null, registration.createdAt, registration.updatedAt],
        );
      }
    });
  }
  await seedIfEmpty();

  return {
    kind: "mysql",

    async close() {
      await pool.end();
    },

    /* ---------- Danh tính và phiên làm việc ---------- */

    async getUserByAccount(account) {
      const row = await first("SELECT * FROM users WHERE account_index = ? AND active = 1 LIMIT 1", [crypto.blindIndex(account)]);
      return asServerUser(row, crypto);
    },

    async findAccount(account) {
      const row = await first("SELECT * FROM users WHERE account_index = ? LIMIT 1", [crypto.blindIndex(account)]);
      return asServerUser(row, crypto);
    },

    async recordLoginFailure(userId, failures, lockedUntil) {
      await query("UPDATE users SET login_failures = ?, locked_until = ? WHERE id = ?", [toInt(failures), lockedUntil || null, userId]);
    },

    async resetLoginFailures(userId) {
      await query("UPDATE users SET login_failures = 0, locked_until = NULL WHERE id = ?", [userId]);
    },

    async createSession({ token, userId, expiresAt, createdAt }) {
      await query("DELETE FROM sessions WHERE expires_at <= ?", [createdAt]);
      await query("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)", [token, userId, expiresAt, createdAt]);
    },

    async getSessionUser(token, now) {
      const row = await first(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > ? AND u.active = 1 LIMIT 1`,
        [token, now],
      );
      return asServerUser(row, crypto);
    },

    async deleteSession(token) {
      await query("DELETE FROM sessions WHERE token = ?", [token]);
    },

    async saveOauthState({ state, nonce, codeVerifier, expiresAt, createdAt }) {
      await query("DELETE FROM oauth_states WHERE expires_at <= ?", [createdAt]);
      await query("INSERT INTO oauth_states (state, nonce, code_verifier, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
        [state, nonce, codeVerifier, expiresAt, createdAt]);
    },

    async consumeOauthState(state, now) {
      return withTransaction(async (connection) => {
        const [rows] = await connection.query("SELECT * FROM oauth_states WHERE state = ? FOR UPDATE", [state]);
        const row = rows[0];
        if (!row) return null;
        await connection.query("DELETE FROM oauth_states WHERE state = ?", [state]);
        return String(row.expires_at) > now
          ? { state: row.state, nonce: row.nonce, codeVerifier: row.code_verifier, expiresAt: row.expires_at }
          : null;
      });
    },

    async upsertMicrosoftUser({ identity, userId, password, timestamp }) {
      const existing = await first(
        "SELECT * FROM users WHERE microsoft_object_id = ? OR account_index = ? LIMIT 1",
        [identity.objectId, crypto.blindIndex(identity.email)],
      );
      if (existing) {
        await query(
          `UPDATE users SET account = ?, account_index = ?, display_name = ?, role = 'admin', auth_provider = 'microsoft',
            microsoft_object_id = ?, must_change_password = 0, login_failures = 0, locked_until = NULL, active = 1
           WHERE id = ?`,
          [crypto.encrypt(identity.email), crypto.blindIndex(identity.email), crypto.encrypt(identity.name), identity.objectId, existing.id],
        );
        return asServerUser(await first("SELECT * FROM users WHERE id = ?", [existing.id]), crypto);
      }
      await query(
        `INSERT INTO users (id, account, account_index, display_name, role, password_salt, password_hash,
          auth_provider, microsoft_object_id, must_change_password, login_failures, active, created_at)
         VALUES (?, ?, ?, ?, 'admin', ?, ?, 'microsoft', ?, 0, 0, 1, ?)`,
        [userId, crypto.encrypt(identity.email), crypto.blindIndex(identity.email), crypto.encrypt(identity.name),
          password.salt, password.hash, identity.objectId, timestamp],
      );
      return asServerUser(await first("SELECT * FROM users WHERE id = ?", [userId]), crypto);
    },

    async updatePassword(userId, password) {
      await query(
        `UPDATE users SET password_salt = ?, password_hash = ?, must_change_password = 0,
          login_failures = 0, locked_until = NULL WHERE id = ?`,
        [password.salt, password.hash, userId],
      );
      return asServerUser(await first("SELECT * FROM users WHERE id = ?", [userId]), crypto);
    },

    async resetToInitialPassword(userId) {
      await query(
        `UPDATE users SET password_salt = NULL, password_hash = NULL, must_change_password = 1,
          login_failures = 0, locked_until = NULL, active = 1 WHERE id = ?`,
        [userId],
      );
    },

    async directorySummary() {
      const row = await first(`SELECT
        (SELECT COUNT(*) FROM users WHERE role = 'parent') AS parents,
        (SELECT COUNT(*) FROM students) AS students,
        (SELECT MAX(created_at) FROM audit_logs WHERE action = 'SYNC_STUDENT_DIRECTORY') AS lastSyncAt`);
      return { parents: toInt(row.parents), students: toInt(row.students), lastSyncAt: row.lastSyncAt || null };
    },

    /* ---------- Học sinh ---------- */

    async listStudentsByParent(parentUserId) {
      const rows = await query(
        `SELECT s.id, s.code, s.name, s.date_of_birth, s.grade, s.homeroom, s.level, ps.relationship
         FROM students s JOIN parent_students ps ON ps.student_id = s.id
         WHERE ps.parent_user_id = ? AND s.status = 'active'`,
        [parentUserId],
      );
      // Sắp xếp sau khi giải mã: cột tên trong cơ sở dữ liệu là chuỗi mã hóa nên
      // ORDER BY trên nó không cho ra thứ tự theo tên thật.
      return rows
        .map((row) => ({
          id: row.id, code: crypto.decrypt(row.code), name: crypto.decrypt(row.name),
          dateOfBirth: crypto.decrypt(row.date_of_birth), grade: toInt(row.grade),
          homeroom: row.homeroom, level: row.level, relationship: row.relationship,
        }))
        .sort((left, right) => left.grade - right.grade || String(left.name).localeCompare(String(right.name), "vi"));
    },

    async parentOwnsStudent(parentUserId, studentId) {
      const row = await first(
        `SELECT s.id, s.code, s.name, s.grade, s.homeroom, s.level, s.status FROM students s
         JOIN parent_students ps ON ps.student_id = s.id
         WHERE ps.parent_user_id = ? AND s.id = ? AND s.status = 'active' LIMIT 1`,
        [parentUserId, studentId],
      );
      return row ? { ...row, code: crypto.decrypt(row.code), name: crypto.decrypt(row.name), grade: toInt(row.grade) } : null;
    },

    async getStudent(studentId) {
      const row = await first("SELECT id, code, name, grade, homeroom, level, status FROM students WHERE id = ? LIMIT 1", [studentId]);
      return row ? { ...row, code: crypto.decrypt(row.code), name: crypto.decrypt(row.name), grade: toInt(row.grade) } : null;
    },

    /* ---------- Danh mục ---------- */

    async listClubs() {
      const rows = await query(`${CATALOG_SELECT}
        WHERE c.active = 1 AND cc.active = 1
        ORDER BY c.sort_order, c.category, c.name, cc.sort_order, cc.day_of_week, cc.start_time`);
      return rows.map(normalizeCatalogRow);
    },

    async getEnrollmentCounts() {
      const rows = await query(`SELECT cc.id, cc.enrolled_base + COALESCE(SUM(
        CASE WHEN r.status IN ('submitted','payment','confirmed') THEN 1 ELSE 0 END), 0) AS enrolled
        FROM club_classes cc LEFT JOIN registrations r ON r.class_id = cc.id
        GROUP BY cc.id, cc.enrolled_base`);
      return Object.fromEntries(rows.map((row) => [row.id, toInt(row.enrolled)]));
    },

    async listPeriods() {
      const rows = await query(`SELECT id, name, school_year AS schoolYear, term, open_at AS openAt,
        close_at AS closeAt, status, max_clubs_per_student AS maxClubsPerStudent, note, updated_at AS updatedAt
        FROM registration_periods ORDER BY open_at DESC`);
      return rows.map((row) => ({ ...row, maxClubsPerStudent: toInt(row.maxClubsPerStudent) || 3, note: row.note || "" }));
    },

    async savePeriod(periodId, data) {
      await query(
        `INSERT INTO registration_periods (id, name, school_year, term, open_at, close_at, status,
          max_clubs_per_student, note, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), school_year = VALUES(school_year), term = VALUES(term),
          open_at = VALUES(open_at), close_at = VALUES(close_at), status = VALUES(status),
          max_clubs_per_student = VALUES(max_clubs_per_student), note = VALUES(note), updated_at = VALUES(updated_at)`,
        [periodId, data.name, data.schoolYear, data.term, data.openAt, data.closeAt, data.status,
          toInt(data.maxClubsPerStudent) || 3, data.note || "", data.updatedAt || null],
      );
      return { id: periodId, ...data };
    },

    async adminCatalog() {
      const [clubRows, classRows, countRows] = await Promise.all([
        query("SELECT id, code, name, category, description, emoji, visual, grades, sort_order, active FROM clubs ORDER BY sort_order, category, name"),
        query(`SELECT id, club_id, period_id, name, day_of_week, start_time, end_time, schedule_label, grades, room,
          teacher, capacity, min_capacity, enrolled_base, fee, waitlist_enabled, sort_order, active
          FROM club_classes ORDER BY sort_order, day_of_week, start_time`),
        query(`SELECT class_id, COUNT(*) AS active_count FROM registrations
          WHERE status IN ('submitted','payment','confirmed') GROUP BY class_id`),
      ]);
      const activeRegistrations = Object.fromEntries(countRows.map((row) => [row.class_id, toInt(row.active_count)]));
      const enrolled = Object.fromEntries(classRows.map((row) => [row.id, toInt(row.enrolled_base) + (activeRegistrations[row.id] || 0)]));
      return {
        clubs: clubRows.map((row) => ({
          id: row.id, code: row.code, name: row.name, category: row.category, description: row.description || "",
          emoji: row.emoji || "🎯", visual: row.visual, grades: jsonArray(row.grades),
          sortOrder: toInt(row.sort_order), active: toBool(row.active),
        })),
        classes: classRows.map((row) => ({
          id: row.id, clubId: row.club_id, periodId: row.period_id, name: row.name || "",
          dayOfWeek: toInt(row.day_of_week), startTime: row.start_time, endTime: row.end_time,
          scheduleLabel: row.schedule_label, grades: jsonArray(row.grades), room: row.room, teacher: row.teacher,
          capacity: toInt(row.capacity), minCapacity: toInt(row.min_capacity), enrolledBase: toInt(row.enrolled_base),
          fee: toInt(row.fee), waitlistEnabled: toBool(row.waitlist_enabled), sortOrder: toInt(row.sort_order),
          active: toBool(row.active),
        })),
        enrolled,
        activeRegistrations,
      };
    },

    async saveClub(clubId, data, connection = null) {
      await (connection || pool).query(
        `INSERT INTO clubs (id, code, name, category, description, emoji, visual, grades, sort_order, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE code = VALUES(code), name = VALUES(name), category = VALUES(category),
          description = VALUES(description), emoji = VALUES(emoji), visual = VALUES(visual),
          grades = VALUES(grades), sort_order = VALUES(sort_order), active = VALUES(active)`,
        [clubId, data.code, data.name, data.category, data.description || "", data.emoji || "🎯", data.visual,
          JSON.stringify(data.grades || []), toInt(data.sortOrder), data.active === false ? 0 : 1],
      );
      return { id: clubId, ...data };
    },

    async saveClass(classId, data, connection = null) {
      await (connection || pool).query(
        `INSERT INTO club_classes (id, club_id, period_id, name, day_of_week, start_time, end_time, schedule_label,
          grades, room, teacher, capacity, min_capacity, enrolled_base, fee, waitlist_enabled, sort_order, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE club_id = VALUES(club_id), period_id = VALUES(period_id), name = VALUES(name),
          day_of_week = VALUES(day_of_week), start_time = VALUES(start_time), end_time = VALUES(end_time),
          schedule_label = VALUES(schedule_label), grades = VALUES(grades), room = VALUES(room),
          teacher = VALUES(teacher), capacity = VALUES(capacity), min_capacity = VALUES(min_capacity),
          enrolled_base = VALUES(enrolled_base), fee = VALUES(fee), waitlist_enabled = VALUES(waitlist_enabled),
          sort_order = VALUES(sort_order), active = VALUES(active)`,
        [classId, data.clubId, data.periodId, data.name || "", data.dayOfWeek, data.startTime, data.endTime,
          data.scheduleLabel, JSON.stringify(data.grades || []), data.room, data.teacher, toInt(data.capacity),
          toInt(data.minCapacity), toInt(data.enrolledBase), toInt(data.fee),
          data.waitlistEnabled === false ? 0 : 1, toInt(data.sortOrder), data.active === false ? 0 : 1],
      );
      return { id: classId, ...data };
    },

    async bulkSaveCatalog({ clubs: clubWrites = [], classes: classWrites = [] }) {
      await withTransaction(async (connection) => {
        for (const item of clubWrites) await this.saveClub(item.id, item.data, connection);
        for (const item of classWrites) await this.saveClass(item.id, item.data, connection);
      });
    },

    async appendAudit(entry) {
      await insertAudit(null, entry);
    },

    /* ---------- Đăng ký ---------- */

    async listRegistrations({ parentUserId, status, studentId } = {}) {
      const conditions = ["1 = 1"];
      const params = [];
      if (parentUserId) { conditions.push("r.parent_user_id = ?"); params.push(parentUserId); }
      if (status && status !== "all") { conditions.push("r.status = ?"); params.push(status); }
      if (studentId) { conditions.push("r.student_id = ?"); params.push(studentId); }
      const rows = await query(
        `SELECT r.id, r.group_id AS groupId, r.student_id AS studentId, r.parent_user_id AS parentUserId,
          r.class_id AS classId, r.period_id AS periodId, r.status, r.fee_snapshot AS feeSnapshot,
          r.schedule_snapshot AS scheduleSnapshot, r.terms_accepted_at AS termsAcceptedAt,
          r.created_at AS createdAt, r.updated_at AS updatedAt,
          cc.club_id AS clubId, cc.day_of_week AS dayOfWeek, cc.start_time AS startTime, cc.end_time AS endTime
         FROM registrations r JOIN club_classes cc ON cc.id = r.class_id
         WHERE ${conditions.join(" AND ")} ORDER BY r.created_at DESC`,
        params,
      );
      return rows.map((row) => ({ ...row, feeSnapshot: toInt(row.feeSnapshot), dayOfWeek: toInt(row.dayOfWeek) }));
    },

    async hydrateRegistrations(rows) {
      if (!rows.length) return [];
      const studentIds = [...new Set(rows.map((row) => row.studentId).filter(Boolean))];
      const classIds = [...new Set(rows.map((row) => row.classId).filter(Boolean))];
      const [studentRows, classes] = await Promise.all([
        studentIds.length ? query("SELECT id, name, homeroom FROM students WHERE id IN (?)", [studentIds]) : [],
        classIds.length
          ? query(`SELECT cc.id, cc.room, cc.teacher, cc.name AS className, cc.club_id AS clubId, c.name AS clubName
              FROM club_classes cc JOIN clubs c ON c.id = cc.club_id WHERE cc.id IN (?)`, [classIds])
          : [],
      ]);
      const students = studentRows.map((row) => ({ ...row, name: crypto.decrypt(row.name) }));
      const studentMap = new Map(students.map((row) => [row.id, row]));
      const classMap = new Map(classes.map((row) => [row.id, row]));
      return rows.map((registration) => {
        const clubClass = classMap.get(registration.classId) || {};
        return {
          registration,
          student: studentMap.get(registration.studentId) || {},
          clubClass,
          club: clubClass.clubId ? { id: clubClass.clubId, name: clubClass.clubName } : {},
        };
      });
    },

    async createRegistrations({ actorUserId, studentId, groupId, periodId = null, clubs: selectedClubs, registrationIds, timestamp }) {
      return withTransaction(async (connection) => {
        // Khóa dòng lớp trước khi đếm chỗ: hai phụ huynh cùng giành chỗ cuối thì
        // người sau phải nhìn thấy chỗ người trước vừa giữ.
        const classIds = selectedClubs.map((club) => club.id);
        const [lockedClasses] = await connection.query(
          "SELECT id, capacity, enrolled_base, waitlist_enabled FROM club_classes WHERE id IN (?) FOR UPDATE",
          [classIds],
        );
        const lockedById = new Map(lockedClasses.map((row) => [row.id, row]));

        const [existingRows] = await connection.query(
          `SELECT r.class_id, cc.club_id, cc.day_of_week, cc.start_time, cc.end_time
           FROM registrations r JOIN club_classes cc ON cc.id = r.class_id
           WHERE r.student_id = ? AND r.status IN (?)`,
          [studentId, ACTIVE_STATUSES],
        );
        for (const club of selectedClubs) {
          for (const current of existingRows) {
            if (current.class_id === club.id) {
              throw createHttpError(422, "VALIDATION_FAILED", `${club.name} đã có trong đăng ký hiện tại.`,
                [{ type: "duplicate", clubId: club.id, message: `${club.name} đã có trong đăng ký hiện tại.` }]);
            }
            if (club.clubId && current.club_id === club.clubId) {
              throw createHttpError(422, "VALIDATION_FAILED", `Học sinh đã đăng ký một lớp khác của ${club.name}.`,
                [{ type: "duplicate", clubId: club.id, message: `Học sinh đã đăng ký một lớp khác của ${club.name}.` }]);
            }
            const overlaps = toInt(current.day_of_week) === club.dayOfWeek
              && club.startTime < current.end_time && current.start_time < club.endTime;
            if (overlaps) {
              throw createHttpError(422, "VALIDATION_FAILED", `${club.name} trùng lịch với một CLB đã đăng ký.`,
                [{ type: "conflict", clubId: club.id, message: `${club.name} trùng lịch với một CLB đã đăng ký.` }]);
            }
          }
        }

        const [countRows] = await connection.query(
          `SELECT class_id, COUNT(*) AS active_count FROM registrations
           WHERE class_id IN (?) AND status IN (?) GROUP BY class_id`,
          [classIds, ACTIVE_STATUSES],
        );
        const activeByClass = new Map(countRows.map((row) => [row.class_id, toInt(row.active_count)]));

        const created = [];
        for (const [index, club] of selectedClubs.entries()) {
          const locked = lockedById.get(club.id);
          if (!locked) throw createHttpError(404, "CLUB_NOT_FOUND", "Có lớp không còn tồn tại hoặc đã bị ẩn.");
          const taken = toInt(locked.enrolled_base) + (activeByClass.get(club.id) || 0);
          const status = taken >= toInt(locked.capacity) ? "waitlist" : "payment";
          const registrationId = registrationIds[index];
          await connection.query(
            `INSERT INTO registrations (id, group_id, student_id, parent_user_id, class_id, period_id, status,
              fee_snapshot, schedule_snapshot, terms_accepted_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [registrationId, groupId, studentId, actorUserId, club.id, periodId || club.periodId || null, status,
              toInt(club.fee), club.schedule, timestamp, timestamp, timestamp],
          );
          if (status !== "waitlist") activeByClass.set(club.id, (activeByClass.get(club.id) || 0) + 1);
          await insertAudit(connection, {
            actorUserId, action: "CREATE_REGISTRATION", entityType: "registration", entityId: registrationId,
            after: { status, clubId: club.id, studentId }, createdAt: timestamp,
          });
          created.push({ id: registrationId, status, clubId: club.id });
        }
        return created;
      });
    },

    async createSupportRequest(request) {
      await query(
        `INSERT INTO support_requests (id, parent_user_id, registration_id, topic, message, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [request.id, request.parentUserId, request.registrationId || null, request.topic, request.message,
          request.status || "open", request.createdAt],
      );
    },

    async confirmPayment({ registrationId, actorUserId, timestamp }) {
      return withTransaction(async (connection) => {
        const [rows] = await connection.query("SELECT id, status FROM registrations WHERE id = ? FOR UPDATE", [registrationId]);
        const registration = rows[0];
        if (!registration) throw createHttpError(404, "REGISTRATION_NOT_FOUND", "Không tìm thấy đơn đăng ký.");
        if (!["payment", "submitted"].includes(registration.status)) {
          throw createHttpError(409, "INVALID_TRANSITION", "Trạng thái hiện tại không cho phép xác nhận phí.");
        }
        await connection.query("UPDATE registrations SET status = 'confirmed', updated_at = ? WHERE id = ?", [timestamp, registrationId]);
        await insertAudit(connection, {
          actorUserId, action: "CONFIRM_PAYMENT", entityType: "registration", entityId: registrationId,
          before: { status: registration.status }, after: { status: "confirmed" }, createdAt: timestamp,
        });
        return { id: registrationId, status: "confirmed" };
      });
    },

    /* ---------- Đồng bộ danh bạ và xuất dữ liệu ---------- */

    async syncDirectory({ snapshot, actorUserId, timestamp, idFactory, source, analysis }) {
      const [studentRows, userRows, links] = await Promise.all([
        query("SELECT id, code, name, date_of_birth, grade, homeroom, level, status FROM students"),
        query("SELECT id, account, role, active FROM users"),
        query("SELECT parent_user_id AS parentUserId, student_id AS studentId, relationship FROM parent_students"),
      ]);
      // So sánh phải làm trên bản rõ, nếu không thì mỗi lần mã hóa ra chuỗi khác nhau
      // sẽ khiến mọi bản ghi đều bị coi là đã thay đổi và lần đồng bộ nào cũng ghi lại tất cả.
      const plan = planDirectoryWrites({
        snapshot,
        students: studentRows.map((row) => ({
          id: row.id, code: crypto.decrypt(row.code), name: crypto.decrypt(row.name),
          dateOfBirth: crypto.decrypt(row.date_of_birth), grade: toInt(row.grade),
          homeroom: row.homeroom, level: row.level, status: row.status,
        })),
        users: userRows.map((row) => {
          const account = crypto.decrypt(row.account);
          return { id: row.id, account, accountLower: String(account || "").toLowerCase(), role: row.role, active: toBool(row.active) };
        }),
        links,
        timestamp,
        idFactory,
      });

      await withTransaction(async (connection) => {
        for (const write of plan.writes) {
          if (write.collection === "students") {
            await connection.query(
              `INSERT INTO students (id, code, code_index, name, date_of_birth, grade, homeroom, level, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE code = VALUES(code), code_index = VALUES(code_index), name = VALUES(name),
                date_of_birth = VALUES(date_of_birth), grade = VALUES(grade), homeroom = VALUES(homeroom),
                level = VALUES(level), status = VALUES(status)`,
              [write.id, crypto.encrypt(write.data.code), crypto.blindIndex(write.data.code),
                crypto.encrypt(write.data.name), crypto.encrypt(write.data.dateOfBirth),
                write.data.grade, write.data.homeroom, write.data.level, write.data.status],
            );
          } else if (write.collection === "users") {
            const data = write.data;
            if (data.account) {
              await connection.query(
                `INSERT INTO users (id, account, account_index, display_name, role, password_salt, password_hash,
                  auth_provider, must_change_password, login_failures, locked_until, active, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 1, ?)
                 ON DUPLICATE KEY UPDATE active = 1`,
                [write.id, crypto.encrypt(data.account), crypto.blindIndex(data.account),
                  crypto.encrypt(data.displayName), data.role,
                  data.passwordSalt || null, data.passwordHash || null, data.authProvider || "local",
                  data.mustChangePassword ? 1 : 0, data.createdAt],
              );
            } else {
              await connection.query("UPDATE users SET active = 1 WHERE id = ?", [write.id]);
            }
          } else if (write.collection === "parentStudents") {
            await connection.query(
              `INSERT INTO parent_students (parent_user_id, student_id, relationship) VALUES (?, ?, ?)
               ON DUPLICATE KEY UPDATE relationship = VALUES(relationship)`,
              [write.data.parentUserId, write.data.studentId, write.data.relationship],
            );
          }
        }
        const syncId = idFactory("sync");
        await insertAudit(connection, {
          actorUserId, action: "SYNC_STUDENT_DIRECTORY", entityType: "google_sheet", entityId: syncId,
          after: {
            source: { spreadsheetId: source.spreadsheetId, sheetName: source.sheetName },
            counters: plan.counters, scannedRows: analysis.scannedRows,
          },
          createdAt: timestamp,
        });
        plan.syncId = syncId;
      });

      return { syncId: plan.syncId, counters: plan.counters, scannedRows: analysis.scannedRows };
    },

    async exportCollection(name, { after = null, limit = 500 } = {}) {
      const definition = EXPORT_QUERIES[name];
      if (!definition) return { rows: [], nextAfter: null };
      const rows = (await query(definition.sql)).map((row) => definition.map(row, crypto))
        .sort((left, right) => String(left.id).localeCompare(String(right.id)));
      const start = after ? rows.findIndex((row) => String(row.id) > String(after)) : 0;
      const page = start < 0 ? [] : rows.slice(start, start + limit);
      return { rows: page, nextAfter: page.length === limit ? page[page.length - 1].id : null };
    },
  };
}
