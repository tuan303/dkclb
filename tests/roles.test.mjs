// Ma trận quyền là thứ quyết định ai xem được dữ liệu cá nhân của 4.445 học sinh,
// nên nó được khoá bằng kiểm thử ở mức từng ô chứ không chỉ vài ca tiêu biểu.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSIGNABLE_SCHOOL_ROLES,
  CAP,
  ROLE,
  SCHOOL_ROLES,
  SUPERADMIN_CONFLICT,
  can,
  effectiveRole,
  isSchoolEmail,
  isSchoolRole,
  isSuperadminAccount,
  normalizeSchoolRole,
  parseSuperadminAccounts,
} from "../roles.mjs";

const DOMAIN = "hoangmaistarschool.edu.vn";

/* ---------- Ma trận quyền ---------- */

test("quản trị cao nhất có mọi quyền", () => {
  for (const capability of Object.values(CAP)) {
    assert.equal(can(ROLE.superadmin, capability), true, `thiếu quyền ${capability}`);
  }
});

test("admin vận hành được hệ thống nhưng không quản lý tài khoản", () => {
  assert.equal(can(ROLE.admin, CAP.quanLyTaiKhoan), false, "đây là ranh giới chính giữa admin và quản trị cao nhất");
  for (const capability of [CAP.xuatDuLieu, CAP.danhSachVanHanh, CAP.dongBoDanhBa, CAP.duyetDon, CAP.danhMuc, CAP.baoCao, CAP.maKichHoat]) {
    assert.equal(can(ROLE.admin, capability), true, `admin phải có quyền ${capability}`);
  }
});

test("giáo vụ làm được việc hằng ngày nhưng không sao lưu và không quản lý tài khoản", () => {
  assert.equal(can(ROLE.giaovu, CAP.danhMuc), true);
  assert.equal(can(ROLE.giaovu, CAP.baoCao), true);
  assert.equal(can(ROLE.giaovu, CAP.maKichHoat), true);
  // Danh sách đăng ký để xếp lớp: chỉ có tên học sinh, lớp, CLB, lịch, trạng
  // thái, học phí — không số điện thoại phụ huynh, không ngày sinh.
  assert.equal(can(ROLE.giaovu, CAP.danhSachVanHanh), true);

  // Sao lưu toàn bộ cơ sở dữ liệu thì khác hẳn: gồm cả tài khoản phụ huynh và
  // mã kích hoạt của họ.
  assert.equal(can(ROLE.giaovu, CAP.xuatDuLieu), false);
  assert.equal(can(ROLE.giaovu, CAP.quanLyTaiKhoan), false);
  assert.equal(can(ROLE.giaovu, CAP.dongBoDanhBa), false);
  assert.equal(can(ROLE.giaovu, CAP.duyetDon), false);
});

test("phụ huynh không có quyền quản trị nào", () => {
  for (const capability of Object.values(CAP)) {
    assert.equal(can(ROLE.parent, capability), false, `phụ huynh không được có quyền ${capability}`);
  }
});

test("vai trò lạ hoặc thiếu thì không có quyền gì", () => {
  for (const role of [undefined, null, "", "root", "ADMIN", "Admin", "superadmin "]) {
    assert.equal(can(role, CAP.baoCao), false, `vai trò ${JSON.stringify(role)} không được có quyền`);
  }
});

test("không cấp được vai trò cao nhất từ màn hình quản lý tài khoản", () => {
  // Quyền cao nhất chỉ đến từ biến môi trường: một tài khoản bị chiếm cũng không
  // thể tự nâng mình lên rồi khoá người khác ra ngoài.
  assert.ok(!ASSIGNABLE_SCHOOL_ROLES.includes(ROLE.superadmin));
  assert.deepEqual(ASSIGNABLE_SCHOOL_ROLES, [ROLE.admin, ROLE.giaovu]);
  assert.equal(normalizeSchoolRole("superadmin"), null);
  assert.equal(normalizeSchoolRole("parent"), null, "không biến tài khoản nhà trường thành phụ huynh");
  assert.equal(normalizeSchoolRole("GIAOVU"), ROLE.giaovu);
  assert.equal(normalizeSchoolRole("  admin "), ROLE.admin);
  assert.equal(normalizeSchoolRole("bừa"), null);
});

test("phân biệt vai trò nhà trường với phụ huynh", () => {
  assert.deepEqual(SCHOOL_ROLES, [ROLE.superadmin, ROLE.admin, ROLE.giaovu]);
  assert.equal(isSchoolRole(ROLE.parent), false);
  assert.equal(isSchoolRole(ROLE.giaovu), true);
});

/* ---------- Đường cứu bằng biến môi trường ---------- */

test("đọc danh sách quản trị cao nhất từ biến môi trường", () => {
  const parsed = parseSuperadminAccounts(" TuanTM@hoangmaistarschool.edu.vn , b@hoangmaistarschool.edu.vn ");
  assert.equal(parsed.has("tuantm@hoangmaistarschool.edu.vn"), true, "phải so khớp không phân biệt hoa thường");
  assert.equal(parsed.size, 2);
  assert.equal(parseSuperadminAccounts("").size, 0);
  assert.equal(parseSuperadminAccounts(undefined).size, 0);
  // Chấp nhận cả dấu chấm phẩy và xuống dòng để người triển khai khỏi vấp cú pháp.
  assert.equal(parseSuperadminAccounts("a@x.vn;b@x.vn\nc@x.vn").size, 3);
});

test("email trong danh sách luôn được nâng lên quyền cao nhất", () => {
  const supers = parseSuperadminAccounts("tuantm@hoangmaistarschool.edu.vn");
  // Kể cả khi bản ghi trong CSDL bị hạ xuống giáo vụ hoặc bị vô hiệu hoá nhầm.
  assert.equal(effectiveRole({ account: "tuantm@hoangmaistarschool.edu.vn", role: "giaovu" }, supers), ROLE.superadmin);
  assert.equal(effectiveRole({ account: "TuanTM@hoangmaistarschool.edu.vn", role: "admin" }, supers), ROLE.superadmin);
  assert.equal(isSuperadminAccount("tuantm@hoangmaistarschool.edu.vn", supers), true);
});

test("ngoài danh sách thì giữ nguyên vai trò trong cơ sở dữ liệu", () => {
  const supers = parseSuperadminAccounts("tuantm@hoangmaistarschool.edu.vn");
  assert.equal(effectiveRole({ account: "khac@hoangmaistarschool.edu.vn", role: "admin" }, supers), ROLE.admin);
  assert.equal(effectiveRole({ account: "khac@hoangmaistarschool.edu.vn", role: "giaovu" }, supers), ROLE.giaovu);
  assert.equal(effectiveRole(null, supers), null);
});

test("danh sách rỗng thì không ai được nâng quyền", () => {
  const supers = parseSuperadminAccounts("");
  assert.equal(effectiveRole({ account: "tuantm@hoangmaistarschool.edu.vn", role: "admin" }, supers), ROLE.admin);
  assert.equal(isSuperadminAccount("tuantm@hoangmaistarschool.edu.vn", supers), false);
});

test("bản ghi phụ huynh trùng email quản trị là xung đột, không phải nâng quyền", () => {
  // Tài khoản phụ huynh định danh bằng số điện thoại nên không thể trùng email
  // thật. Trùng được nghĩa là dữ liệu đã hỏng — im lặng trao toàn quyền lúc đó là sai.
  const supers = parseSuperadminAccounts("tuantm@hoangmaistarschool.edu.vn");
  assert.equal(effectiveRole({ account: "tuantm@hoangmaistarschool.edu.vn", role: "parent" }, supers), SUPERADMIN_CONFLICT);
  assert.equal(can(SUPERADMIN_CONFLICT, CAP.baoCao), false, "trạng thái xung đột không được có quyền nào");
});

/* ---------- Ràng buộc miền email ---------- */

test("chỉ nhận email thuộc miền của trường", () => {
  assert.equal(isSchoolEmail("ai.do@hoangmaistarschool.edu.vn", DOMAIN), true);
  assert.equal(isSchoolEmail("  AI.DO@HoangMaiStarSchool.edu.vn  ", DOMAIN), true);
  assert.equal(isSchoolEmail("ai.do@gmail.com", DOMAIN), false);
  assert.equal(isSchoolEmail("", DOMAIN), false);
  assert.equal(isSchoolEmail("khong-co-a-cong", DOMAIN), false);
  assert.equal(isSchoolEmail("a b@hoangmaistarschool.edu.vn", DOMAIN), false, "khoảng trắng trong email là không hợp lệ");
  assert.equal(isSchoolEmail("a@b@hoangmaistarschool.edu.vn", DOMAIN), false, "hai dấu @ là không hợp lệ");
});

test("miền giả mạo bằng cách nối đuôi bị chặn", () => {
  // Đây là cách qua mặt kinh điển khi chỉ kiểm tra "kết thúc bằng tên miền".
  assert.equal(isSchoolEmail("ke.gian@evilhoangmaistarschool.edu.vn", DOMAIN), false);
  assert.equal(isSchoolEmail("ke.gian@sub.hoangmaistarschool.edu.vn.attacker.com", DOMAIN), false);
});
