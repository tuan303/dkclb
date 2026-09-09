// Quyết định những gì cần ghi khi đồng bộ danh bạ học sinh từ Google Sheets.
//
// Tách khỏi tầng lưu trữ để kiểm thử được tính chất quan trọng nhất: đồng bộ
// lại cùng một dữ liệu thì không phát sinh lượt ghi nào. Mỗi lượt ghi Firestore
// đều tính vào hạn ngạch, mà danh sách hàng nghìn học sinh thường chỉ đổi vài dòng.
import { isUnchanged } from "./record-diff.mjs";
import { generateActivationCode } from "./activation-code.mjs";
import { checkSnapshotSanity } from "./directory-merge.mjs";

function conflictError(message) {
  const error = new Error(message);
  Object.assign(error, { status: 409, code: "ACCOUNT_ROLE_CONFLICT", expose: true });
  return error;
}

export function emptyCounters() {
  return {
    studentsCreated: 0, studentsUpdated: 0, studentsUnchanged: 0,
    studentsDeactivated: 0, studentsDeactivationSkipped: 0,
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
export function planDirectoryWrites({
  snapshot, students = [], users = [], links = [], timestamp, idFactory,
  codeFactory = generateActivationCode,
  // Chỉ được đánh dấu nghỉ học khi TẤT CẢ nguồn đọc thành công. Một file lỗi mà
  // vẫn xử lý thì cả cấp học đó biến mất khỏi ảnh chụp và bị vô hiệu hóa nhầm.
  allSourcesLoaded = false,
  maxShrinkRatio = 0.2,
}) {
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
      // Mật khẩu khởi tạo là CHÍNH SỐ ĐIỆN THOẠI, bắt buộc đổi ngay lần đầu.
      // Không lưu hash: băm 7.119 tài khoản bằng scrypt ở mỗi lần đồng bộ sẽ mất
      // hàng chục phút, mà lịch chạy 15 phút một lần. So khớp trực tiếp bằng
      // timingSafeEqual, và số điện thoại vốn đã là tên tài khoản nên băm nó
      // cũng không bảo vệ thêm được gì.
      writes.push({ collection: "users", id: userId, data: {
        account: guardian.account, accountLower, displayName: guardian.displayName || "Phụ huynh học sinh", role: "parent",
        email: guardian.email || null,
        passwordSalt: null, passwordHash: null, activationCode: null, authProvider: "local",
        mustChangePassword: true, loginFailures: 0, lockedUntil: null, active: true, createdAt: timestamp,
      } });
      counters.parentsCreated += 1;
    } else {
      // CHỈ ghi email khi nguồn thật sự có. Ba file danh bạ do ba giáo vụ quản;
      // nếu một file thiếu cột email thì đưa null vào đây sẽ XOÁ email mà file kia
      // vừa mang lại, và mỗi 15 phút hai file lại ghi đè lẫn nhau.
      const data = { accountLower, active: true };
      if (guardian.email) data.email = guardian.email;
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

  // Học sinh đang hoạt động nhưng không còn trong ảnh chụp: chuyển trường, nghỉ học.
  // Không bao giờ xóa dữ liệu — đơn đăng ký và lịch sử vẫn phải giữ để đối soát.
  const incomingCodes = new Set(snapshot.students.map((student) => student.code));
  const activeExisting = students.filter((student) => student.status !== "inactive");
  const missing = activeExisting.filter((student) => !incomingCodes.has(student.code));

  let deactivated = [];
  if (!allSourcesLoaded) {
    counters.studentsDeactivationSkipped = missing.length;
  } else if (missing.length) {
    checkSnapshotSanity({ incoming: snapshot.students.length, activeExisting: activeExisting.length, maxShrinkRatio });
    for (const student of missing) {
      writes.push({ collection: "students", id: student.id, data: { ...studentRecord(student), status: "inactive" } });
      counters.studentsDeactivated += 1;
    }
    deactivated = missing.map((student) => ({ id: student.id, code: student.code }));
  }

  counters.writes = writes.length;
  return {
    writes,
    counters,
    studentIdsByCode,
    deactivated,
    deactivationSkipped: allSourcesLoaded ? [] : missing.map((student) => ({ id: student.id, code: student.code })),
  };
}

// Giữ nguyên các trường hiện có của học sinh khi chỉ đổi trạng thái sang nghỉ học.
function studentRecord(student) {
  return {
    code: student.code, name: student.name, dateOfBirth: student.dateOfBirth,
    grade: student.grade, homeroom: student.homeroom, level: student.level,
  };
}
