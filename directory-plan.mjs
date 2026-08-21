// Quyết định những gì cần ghi khi đồng bộ danh bạ học sinh từ Google Sheets.
//
// Tách khỏi tầng lưu trữ để kiểm thử được tính chất quan trọng nhất: đồng bộ
// lại cùng một dữ liệu thì không phát sinh lượt ghi nào. Mỗi lượt ghi Firestore
// đều tính vào hạn ngạch, mà danh sách hàng nghìn học sinh thường chỉ đổi vài dòng.
import { isUnchanged } from "./record-diff.mjs";

function conflictError(message) {
  const error = new Error(message);
  Object.assign(error, { status: 409, code: "ACCOUNT_ROLE_CONFLICT", expose: true });
  return error;
}

export function emptyCounters() {
  return {
    studentsCreated: 0, studentsUpdated: 0, studentsUnchanged: 0,
    parentsCreated: 0, parentsUpdated: 0, parentsUnchanged: 0,
    linksCreated: 0, linksUpdated: 0, linksUnchanged: 0, writes: 0,
  };
}

/**
 * @param snapshot   dữ liệu đọc từ Sheet: { students, guardians }
 * @param students   các bản ghi học sinh hiện có, mỗi bản ghi có `id` và `code`
 * @param users      các tài khoản hiện có, mỗi bản ghi có `id`, `account`/`accountLower`, `role`
 * @param links      liên kết phụ huynh–học sinh hiện có, có `parentUserId`, `studentId`, `relationship`
 * @param idFactory  hàm sinh mã cho bản ghi mới
 */
export function planDirectoryWrites({ snapshot, students = [], users = [], links = [], timestamp, idFactory }) {
  const studentsByCode = new Map(students.map((student) => [student.code, student]));
  const usersByAccount = new Map(users.map((user) => [String(user.accountLower || user.account || "").toLowerCase(), user]));
  const linksByKey = new Map(links.map((link) => [`${link.parentUserId}_${link.studentId}`, link]));
  const counters = emptyCounters();
  const studentIdsByCode = new Map();
  const writes = [];

  for (const student of snapshot.students) {
    const existing = studentsByCode.get(student.code);
    const studentId = existing?.id || idFactory("hs");
    studentIdsByCode.set(student.code, studentId);
    const data = {
      code: student.code, name: student.name, dateOfBirth: student.dateOfBirth, grade: student.grade,
      homeroom: student.className, level: student.educationLevel, status: "active",
    };
    if (isUnchanged(existing, data)) {
      counters.studentsUnchanged += 1;
      continue;
    }
    writes.push({ collection: "students", id: studentId, data });
    if (existing) counters.studentsUpdated += 1;
    else counters.studentsCreated += 1;
  }

  for (const guardian of snapshot.guardians) {
    const accountLower = guardian.account.toLowerCase();
    let user = usersByAccount.get(accountLower);
    if (user && user.role !== "parent") {
      throw conflictError("Có SĐT phụ huynh trùng với một tài khoản vai trò khác; cần IT xử lý thủ công.");
    }
    if (!user) {
      const userId = idFactory("u_parent");
      user = { id: userId, account: guardian.account, accountLower, role: "parent" };
      usersByAccount.set(accountLower, user);
      // Chưa có mật khẩu riêng: mật khẩu khởi tạo là chính số điện thoại nên không lưu hash.
      writes.push({ collection: "users", id: userId, data: {
        account: guardian.account, accountLower, displayName: guardian.displayName || "Phụ huynh học sinh", role: "parent",
        passwordSalt: null, passwordHash: null, authProvider: "local", mustChangePassword: true,
        loginFailures: 0, lockedUntil: null, active: true, createdAt: timestamp,
      } });
      counters.parentsCreated += 1;
    } else {
      const data = { accountLower, active: true };
      if (isUnchanged(user, data)) counters.parentsUnchanged += 1;
      else {
        writes.push({ collection: "users", id: user.id, data });
        counters.parentsUpdated += 1;
      }
    }

    for (const linkedStudent of guardian.students) {
      const studentId = studentIdsByCode.get(linkedStudent.studentCode);
      if (!studentId) continue;
      const key = `${user.id}_${studentId}`;
      const existingLink = linksByKey.get(key);
      // Cùng một số điện thoại khai ở cả cột bố và cột mẹ thì ghi nhận là "Bố/Mẹ".
      const relationship = existingLink && existingLink.relationship !== linkedStudent.relationship
        ? "Bố/Mẹ"
        : linkedStudent.relationship;
      const data = { parentUserId: user.id, studentId, relationship };
      if (isUnchanged(existingLink, data)) {
        counters.linksUnchanged += 1;
        continue;
      }
      writes.push({ collection: "parentStudents", id: key, data });
      if (existingLink) counters.linksUpdated += 1;
      else counters.linksCreated += 1;
      linksByKey.set(key, data);
    }
  }

  counters.writes = writes.length;
  return { writes, counters, studentIdsByCode };
}
