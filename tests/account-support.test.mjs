import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers/test-server.mjs";

let server;
let baseUrl;
let adminCookie;

const login = (account, password) => server.login(account, password);
const request = (path, cookie, options = {}) => server.request(path, cookie, options);

before(async () => {
  server = await startTestServer({ prefix: "nshm-support-" });
  baseUrl = server.baseUrl;
  adminCookie = await server.loginCookie("admin@nshm.edu.vn", "Admin@123");
});

after(async () => server.stop());

test("chỉ quản trị mới tra cứu được tài khoản", async () => {
  const anonymous = await fetch(`${baseUrl}/api/admin/accounts/lookup?account=0901234567`);
  assert.equal(anonymous.status, 401);

  const parentCookie = (await login("0901234567", "123456")).headers.get("set-cookie").split(";")[0];
  const asParent = await request("/api/admin/accounts/lookup?account=0901234567", parentCookie);
  assert.equal(asParent.status, 403);
});

test("tra cứu số chưa có tài khoản nói rõ nguyên nhân, không lộ dữ liệu", async () => {
  const response = await request("/api/admin/accounts/lookup?account=0975662437", adminCookie);
  assert.equal(response.status, 200);
  const { lookup } = await response.json();
  assert.equal(lookup.found, false);
  assert.equal(lookup.normalized, "0975662437");
  assert.match(lookup.diagnosis, /Không tìm thấy tài khoản|chưa có tài khoản phụ huynh nào/);
  assert.ok(lookup.directory.parents >= 1);
  assert.equal(lookup.account, undefined);
});

test("tra cứu chuẩn hóa số thiếu số 0 ở đầu và không trả về salt hay hash", async () => {
  const response = await request("/api/admin/accounts/lookup?account=901234567", adminCookie);
  assert.equal(response.status, 200);
  const { lookup } = await response.json();
  assert.equal(lookup.normalized, "0901234567");
  assert.equal(lookup.found, true);
  assert.equal(lookup.account.linkedStudents, 2);
  assert.equal(lookup.account.authProvider, "local");
  const serialized = JSON.stringify(lookup);
  assert.ok(!/passwordHash|password_hash|passwordSalt|password_salt/.test(serialized), "không được trả về salt hay hash");
});

test("tài khoản bị khóa do sai nhiều lần được nêu rõ trong kết quả tra cứu", async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) await login("0901234567", "sai-mat-khau");
  const locked = await login("0901234567", "123456");
  assert.equal(locked.status, 429, "sai 5 lần thì tài khoản bị tạm khóa");

  const { lookup } = await (await request("/api/admin/accounts/lookup?account=0901234567", adminCookie)).json();
  assert.equal(lookup.account.loginFailures, 5);
  assert.ok(lookup.account.lockedUntil);
  assert.match(lookup.diagnosis, /tạm khóa/);
});

test("đặt lại mật khẩu khởi tạo mở khóa tài khoản và bắt đổi mật khẩu", async () => {
  const withoutConfirmation = await request("/api/admin/accounts/reset-initial-password", adminCookie, {
    method: "POST",
    body: JSON.stringify({ account: "0901234567" }),
  });
  assert.equal(withoutConfirmation.status, 422);

  const reset = await request("/api/admin/accounts/reset-initial-password", adminCookie, {
    method: "POST",
    body: JSON.stringify({ account: "0901234567", confirmation: "RESET_INITIAL_PASSWORD" }),
  });
  assert.equal(reset.status, 200);

  // Mật khẩu cũ hết hiệu lực, mật khẩu mới chính là số điện thoại.
  const oldPassword = await login("0901234567", "123456");
  assert.equal(oldPassword.status, 401);
  const newPassword = await login("0901234567", "0901234567");
  assert.equal(newPassword.status, 200, "khóa 15 phút phải được gỡ sau khi đặt lại");

  const cookie = newPassword.headers.get("set-cookie").split(";")[0];
  const me = await (await request("/api/me", cookie)).json();
  assert.equal(me.user.mustChangePassword, true);

  // Chưa đổi mật khẩu thì chưa dùng được dữ liệu nghiệp vụ.
  const blocked = await request("/api/students", cookie);
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error.code, "PASSWORD_CHANGE_REQUIRED");

  const { lookup } = await (await request("/api/admin/accounts/lookup?account=0901234567", adminCookie)).json();
  assert.equal(lookup.account.mustChangePassword, true);
  assert.equal(lookup.account.loginFailures, 0);
  assert.equal(lookup.account.lockedUntil, null);
});

test("đặt mật khẩu riêng là số điện thoại hết hiệu lực làm mật khẩu", async () => {
  // Đưa tài khoản về đúng trạng thái sau đồng bộ: không lưu mật khẩu, đăng nhập bằng chính SĐT.
  await request("/api/admin/accounts/reset-initial-password", adminCookie, {
    method: "POST",
    body: JSON.stringify({ account: "0901234567", confirmation: "RESET_INITIAL_PASSWORD" }),
  });
  const initial = await login("0901234567", "0901234567");
  assert.equal(initial.status, 200);
  const cookie = initial.headers.get("set-cookie").split(";")[0];

  const changed = await request("/api/auth/change-initial-password", cookie, {
    method: "POST",
    body: JSON.stringify({ newPassword: "Nshm@2026clb" }),
  });
  assert.equal(changed.status, 200);

  // Đây là điểm bảo mật quan trọng nhất: nhánh mật khẩu khởi tạo phải tắt hẳn
  // ngay khi tài khoản đã có mật khẩu riêng.
  const phoneAsPassword = await login("0901234567", "0901234567");
  assert.equal(phoneAsPassword.status, 401, "số điện thoại không còn dùng làm mật khẩu được nữa");

  const withNewPassword = await login("0901234567", "Nshm@2026clb");
  assert.equal(withNewPassword.status, 200);
  const meCookie = withNewPassword.headers.get("set-cookie").split(";")[0];
  const me = await (await request("/api/me", meCookie)).json();
  assert.equal(me.user.mustChangePassword, false);

  const { lookup } = await (await request("/api/admin/accounts/lookup?account=0901234567", adminCookie)).json();
  assert.equal(lookup.account.mustChangePassword, false);
  assert.match(lookup.diagnosis, /đã đổi sang mật khẩu riêng/);
});

test("không đặt lại được mật khẩu của tài khoản nhà trường", async () => {
  const response = await request("/api/admin/accounts/reset-initial-password", adminCookie, {
    method: "POST",
    body: JSON.stringify({ account: "admin@nshm.edu.vn", confirmation: "RESET_INITIAL_PASSWORD" }),
  });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "ACCOUNT_NOT_PHONE");
});
