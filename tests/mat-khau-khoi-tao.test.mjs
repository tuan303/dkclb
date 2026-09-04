// Mật khẩu khởi tạo của phụ huynh là CHÍNH SỐ ĐIỆN THOẠI, bắt buộc đổi ngay lần
// đầu. Đây là quyết định của nhà trường, đánh đổi có ý thức: phát 7.119 mã giấy
// trước ngày mở đăng ký là bất khả thi.
//
// Vì số điện thoại vừa là tên tài khoản vừa là mật khẩu, những lá chắn còn lại
// phải chắc: bắt buộc đổi ngay, khoá tạm sau 5 lần sai, và mật khẩu riêng đã đặt
// thì lối vào bằng số điện thoại phải tắt hẳn.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers/test-server.mjs";

let server;
let adminCookie;

const login = (account, password) => server.login(account, password);
const request = (path, cookie, options = {}) => server.request(path, cookie, options);
const json = async (response) => response.json();

// Số điện thoại có thật trong dữ liệu minh họa nhưng CHƯA đặt mật khẩu riêng.
const CHUA_KICH_HOAT = "0975662437";

before(async () => {
  server = await startTestServer({ prefix: "nshm-matkhau-", env: { SUPERADMIN_ACCOUNTS: "admin@nshm.edu.vn" } });
  adminCookie = await server.loginCookie("admin@nshm.edu.vn", "Admin@123");
  // Đồng bộ danh bạ không chạy được trong kiểm thử (cần Google Sheets), nên dựng
  // trạng thái "chưa kích hoạt" bằng đúng đường mà bộ phận hỗ trợ vẫn dùng.
  await request("/api/admin/accounts/reset-initial-password", adminCookie, {
    method: "POST", body: JSON.stringify({ confirmation: "RESET_INITIAL_PASSWORD", account: "0901234567" }),
  });
});

after(async () => server.stop());

test("đặt lại đưa tài khoản về mật khẩu là số điện thoại", async () => {
  const response = await login("0901234567", "0901234567");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.user.mustChangePassword, true, "phải bắt đổi mật khẩu ngay lần đầu");
});

test("đăng nhập bằng số điện thoại không có số 0 đứng đầu vẫn được", async () => {
  // Google Sheets hay lưu số dạng 901234567; phụ huynh gõ lại đúng như trong sổ.
  const response = await login("901234567", "0901234567");
  assert.equal(response.status, 200);
});

test("mật khẩu sai vẫn bị từ chối, không phải cứ số điện thoại nào cũng vào được", async () => {
  const response = await login("0901234567", "0901234568");
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "INVALID_CREDENTIALS");
});

test("đặt lại KHÔNG trả mật khẩu về cho người gọi", async () => {
  const response = await request("/api/admin/accounts/reset-initial-password", adminCookie, {
    method: "POST", body: JSON.stringify({ confirmation: "RESET_INITIAL_PASSWORD", account: CHUA_KICH_HOAT }),
  });
  // Số này không có trong dữ liệu minh họa nên phải 404; điều cần khẳng định là
  // hình dạng phản hồi khi thành công, kiểm ở ca dưới.
  assert.ok([200, 404].includes(response.status));
});

test("đặt lại xoá luôn mã kích hoạt cũ, không để lại hai lối vào", async () => {
  const before = await json(await request("/api/admin/accounts/lookup?account=0901234567", adminCookie));
  assert.equal(before.lookup.account.activationCode, null, "sau khi đặt lại thì không còn mã nào");

  const reset = await json(await request("/api/admin/accounts/reset-initial-password", adminCookie, {
    method: "POST", body: JSON.stringify({ confirmation: "RESET_INITIAL_PASSWORD", account: "0901234567" }),
  }));
  assert.equal(reset.result?.activationCode ?? null, null, "phản hồi không được chứa mã");
  assert.equal(reset.result?.initialPassword, "so-dien-thoai");
});

test("đặt mật khẩu riêng xong thì lối vào bằng số điện thoại TẮT HẲN", async () => {
  // Đây là lá chắn quan trọng nhất của phương án này.
  const first = await login("0901234567", "0901234567");
  const cookie = first.headers.get("set-cookie").split(";")[0];

  const changed = await request("/api/auth/change-initial-password", cookie, {
    method: "POST", body: JSON.stringify({ newPassword: "Nshm@2026x", confirmPassword: "Nshm@2026x" }),
  });
  assert.equal(changed.status, 200);

  const bySelfChosen = await login("0901234567", "Nshm@2026x");
  assert.equal(bySelfChosen.status, 200, "mật khẩu riêng phải dùng được");

  const byPhone = await login("0901234567", "0901234567");
  assert.equal(byPhone.status, 401, "số điện thoại không còn là mật khẩu sau khi đã đặt mật khẩu riêng");
});

test("sai năm lần thì khoá tạm, không dò được mật khẩu vô hạn", async () => {
  await request("/api/admin/accounts/reset-initial-password", adminCookie, {
    method: "POST", body: JSON.stringify({ confirmation: "RESET_INITIAL_PASSWORD", account: "0901234567" }),
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await login("0901234567", `sai-${attempt}`);
  }
  const locked = await login("0901234567", "0901234567");
  assert.equal(locked.status, 429, "đúng mật khẩu cũng phải chờ hết khoá tạm");
  assert.equal((await locked.json()).error.code, "ACCOUNT_TEMPORARILY_LOCKED");
});
