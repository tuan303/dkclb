// Ai được vào cổng Nhà trường. Trước đây bất kỳ ai thuộc miền hoangmaistarschool.edu.vn
// đăng nhập Microsoft là tự có một tài khoản quản trị toàn quyền, và vai trò đặt
// tay bị ép về 'admin' ở mỗi lần người đó đăng nhập lại.
import test from "node:test";
import assert from "node:assert/strict";
import { DENIAL, DENIAL_MESSAGE, decideSchoolLogin } from "../school-login.mjs";
import { ROLE, parseSuperadminAccounts } from "../roles.mjs";

const SUPERS = parseSuperadminAccounts("tuantm@hoangmaistarschool.edu.vn");
const NONE = parseSuperadminAccounts("");

const decide = (user, email, superadminAccounts = SUPERS) =>
  decideSchoolLogin({ user, email, superadminAccounts });

function account(overrides = {}) {
  return { id: "u1", account: "gv@hoangmaistarschool.edu.vn", role: ROLE.giaovu, active: 1, ...overrides };
}

/* ---------- Từ chối là mặc định ---------- */

test("email chưa có trong hệ thống thì bị từ chối, không tạo bản ghi", () => {
  const result = decide(null, "nguoi.moi@hoangmaistarschool.edu.vn");
  assert.equal(result.allow, false);
  assert.equal(result.reason, DENIAL.noAccount);
  assert.equal(result.action, undefined, "không được sinh ra thao tác ghi nào");
  assert.equal(result.role, undefined);
});

test("tài khoản đã vô hiệu hoá thì bị từ chối", () => {
  const result = decide(account({ active: 0 }), "gv@hoangmaistarschool.edu.vn");
  assert.equal(result.allow, false);
  assert.equal(result.reason, DENIAL.disabled);
});

test("thông báo từ chối đúng nguyên văn nhà trường yêu cầu", () => {
  assert.equal(DENIAL_MESSAGE, "Tài khoản của bạn chưa được kích hoạt, liên hệ với bộ phận CNTT.");
});

/* ---------- Vào được thì vai trò KHÔNG bị đụng tới ---------- */

test("giáo vụ đăng nhập vẫn là giáo vụ, không bị ép lên admin", () => {
  const result = decide(account({ role: ROLE.giaovu }), "gv@hoangmaistarschool.edu.vn");
  assert.equal(result.allow, true);
  assert.equal(result.action, "dang-nhap");
  // Không trả về vai trò nghĩa là tầng gọi không có gì để ghi đè.
  assert.equal(result.role, undefined, "đăng nhập là xác minh danh tính, không phải dịp cấp quyền");
  assert.equal(result.reactivate, undefined);
});

test("admin đang hoạt động vào bình thường", () => {
  const result = decide(account({ role: ROLE.admin }), "ad@hoangmaistarschool.edu.vn", NONE);
  assert.equal(result.allow, true);
  assert.equal(result.role, undefined);
});

/* ---------- Đường cứu bằng biến môi trường ---------- */

test("email trong danh sách cứu chưa có bản ghi thì được tạo với quyền cao nhất", () => {
  const result = decide(null, "tuantm@hoangmaistarschool.edu.vn");
  assert.equal(result.allow, true);
  assert.equal(result.action, "tao-moi");
  assert.equal(result.role, ROLE.superadmin);
});

test("email trong danh sách cứu bị vô hiệu hoá nhầm vẫn vào được và được bật lại", () => {
  // Đây chính là tình huống mà nếu không có đường cứu thì phải sửa tay trong
  // MySQL: không còn ai vào được để bật lại tài khoản cho nhau.
  const result = decide(account({ account: "tuantm@hoangmaistarschool.edu.vn", active: 0 }), "tuantm@hoangmaistarschool.edu.vn");
  assert.equal(result.allow, true);
  assert.equal(result.reactivate, true);
  assert.equal(result.role, undefined, "bật lại chứ không nâng vai trò trong cơ sở dữ liệu");
});

test("so khớp danh sách cứu không phân biệt hoa thường", () => {
  assert.equal(decide(null, "TuanTM@HoangMaiStarSchool.edu.vn").allow, true);
});

test("danh sách cứu rỗng thì không ai được tạo tài khoản khi đăng nhập", () => {
  const result = decide(null, "tuantm@hoangmaistarschool.edu.vn", NONE);
  assert.equal(result.allow, false);
  assert.equal(result.reason, DENIAL.noAccount);
});

/* ---------- Ranh giới với tài khoản phụ huynh ---------- */

test("bản ghi phụ huynh không bao giờ vào được cổng Nhà trường", () => {
  const result = decide(account({ role: ROLE.parent }), "gv@hoangmaistarschool.edu.vn");
  assert.equal(result.allow, false);
  assert.equal(result.reason, DENIAL.parentConflict);
});

test("danh sách cứu KHÔNG vượt qua được xung đột với tài khoản phụ huynh", () => {
  // Nếu cho qua thì một bản ghi phụ huynh trùng email sẽ được trao toàn quyền.
  const result = decide(
    account({ account: "tuantm@hoangmaistarschool.edu.vn", role: ROLE.parent, active: 1 }),
    "tuantm@hoangmaistarschool.edu.vn",
  );
  assert.equal(result.allow, false);
  assert.equal(result.reason, DENIAL.parentConflict);
});

test("hàm đọc trạng thái hoạt động thay được, cho nền lưu trữ dùng kiểu khác", () => {
  const result = decideSchoolLogin({
    user: { account: "gv@hoangmaistarschool.edu.vn", role: ROLE.admin, active: true },
    email: "gv@hoangmaistarschool.edu.vn",
    superadminAccounts: NONE,
    isActive: (record) => record.active === true,
  });
  assert.equal(result.allow, true);
});
