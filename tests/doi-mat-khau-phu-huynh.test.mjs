// Phụ huynh tự đổi mật khẩu khi đang dùng hệ thống — khác với lần đổi BẮT BUỘC ở
// lượt đăng nhập đầu tiên (kiểm ở mat-khau-khoi-tao.test.mjs).
//
// Điều quan trọng nhất ở lối này là phải nhập mật khẩu hiện tại. Nếu không, ai
// mượn được một phiên đang mở — máy tính chung, điện thoại quên đăng xuất — là đổi
// khoá và chiếm luôn tài khoản, mà tài khoản này còn nhìn thấy thông tin của con.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { startTestServer } from "./helpers/test-server.mjs";

const PHU_HUYNH = "0901234567";
let server;
let cookie;
// Mỗi ca thành công đổi mật khẩu thật, nên giữ lại giá trị hiện hành thay vì gõ
// cứng ở từng chỗ: bỏ sót một chỗ là những ca sau đỏ vì lý do không liên quan.
let matKhauHienTai = "123456";

const doiMatKhau = (body, phien = cookie) =>
  server.request("/api/auth/change-password", phien, { method: "POST", body: JSON.stringify(body) });

before(async () => {
  server = await startTestServer({ prefix: "nshm-doimk-" });
  cookie = await server.loginCookie(PHU_HUYNH, matKhauHienTai);
});

after(async () => server.stop());

test("chưa đăng nhập thì không đổi được mật khẩu của ai cả", async () => {
  const response = await doiMatKhau({ currentPassword: matKhauHienTai, newPassword: "Nshm@2026a" }, null);
  assert.equal(response.status, 401);
});

test("nhân sự nhà trường không đi lối này", async () => {
  // Họ đăng nhập bằng Microsoft 365; mật khẩu nằm ở hệ thống tài khoản của trường,
  // ứng dụng này không có gì để đổi.
  const nhaTruong = await server.loginCookie("admin@nshm.edu.vn", "Admin@123");
  const response = await doiMatKhau({ currentPassword: "Admin@123", newPassword: "Nshm@2026a" }, nhaTruong);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "FORBIDDEN");
});

test("sai mật khẩu hiện tại thì bị từ chối, và mật khẩu cũ vẫn nguyên", async () => {
  const response = await doiMatKhau({ currentPassword: "sai-hoan-toan", newPassword: "Nshm@2026a" });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "INVALID_CURRENT_PASSWORD");

  // Điều dễ hỏng nhất: từ chối rồi nhưng vẫn kịp ghi mật khẩu mới.
  const van_vao_duoc = await server.login(PHU_HUYNH, matKhauHienTai);
  assert.equal(van_vao_duoc.status, 200, "mật khẩu cũ phải còn hiệu lực sau một lần đổi hỏng");
  const bangMatKhauMoi = await server.login(PHU_HUYNH, "Nshm@2026a");
  assert.equal(bangMatKhauMoi.status, 401, "mật khẩu mới không được có hiệu lực khi đổi bị từ chối");
});

test("mật khẩu mới yếu bị chặn bằng đúng chính sách của lần đổi bắt buộc", async () => {
  const response = await doiMatKhau({ currentPassword: matKhauHienTai, newPassword: "abc12345" });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "PASSWORD_COMPLEXITY_REQUIRED");
});

test("mật khẩu mới không được chứa chính số điện thoại đăng nhập", async () => {
  const response = await doiMatKhau({ currentPassword: matKhauHienTai, newPassword: `Nshm@${PHU_HUYNH}` });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "PASSWORD_CONTAINS_ACCOUNT");
});

test("đổi thành công thì mật khẩu cũ hết tác dụng ngay", async () => {
  const moi = "Nshm@2026x";
  const response = await doiMatKhau({ currentPassword: matKhauHienTai, newPassword: moi });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.user.mustChangePassword, false);
  assert.ok(!("passwordHash" in payload.user) && !("password_hash" in payload.user), "phản hồi không được lộ hash");

  const cu = await server.login(PHU_HUYNH, matKhauHienTai);
  assert.equal(cu.status, 401, "mật khẩu cũ phải mất hiệu lực");
  matKhauHienTai = moi;
  const bangMoi = await server.login(PHU_HUYNH, matKhauHienTai);
  assert.equal(bangMoi.status, 200, "mật khẩu mới phải dùng được");
});

test("phiên đang mở vẫn dùng được sau khi đổi, không bị đá ra giữa chừng", async () => {
  const response = await server.request("/api/me", cookie);
  assert.equal(response.status, 200);
});

test("không được đặt lại đúng mật khẩu đang dùng", async () => {
  const response = await doiMatKhau({ currentPassword: matKhauHienTai, newPassword: matKhauHienTai });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "PASSWORD_UNCHANGED");
});

test("dò mật khẩu hiện tại qua lối này cũng bị khoá tạm sau năm lần", async () => {
  // Không có bước này thì một phiên mượn được là một máy dò mật khẩu không giới hạn.
  for (let lan = 0; lan < 5; lan += 1) {
    await doiMatKhau({ currentPassword: `sai-${lan}`, newPassword: "Nshm@2026y" });
  }
  const khoa = await doiMatKhau({ currentPassword: matKhauHienTai, newPassword: "Nshm@2026y" });
  assert.equal(khoa.status, 429, "đúng mật khẩu cũng phải chờ hết khoá tạm");
  assert.equal((await khoa.json()).error.code, "ACCOUNT_TEMPORARILY_LOCKED");

  const dangNhap = await server.login(PHU_HUYNH, matKhauHienTai);
  assert.equal(dangNhap.status, 429, "khoá tạm phải chung với lối đăng nhập, không phải hai bộ đếm rời");
});

test("tài khoản còn phải đổi mật khẩu khởi tạo được đẩy về đúng luồng bắt buộc", async () => {
  // Hai luồng phải tách bạch: luồng bắt buộc không hỏi mật khẩu hiện tại, nên nếu
  // tài khoản chưa đổi lần đầu mà lọt vào đây thì lối này trở thành cửa sau.
  const nhaTruong = await server.loginCookie("admin@nshm.edu.vn", "Admin@123");
  const datLai = await server.request("/api/admin/accounts/reset-initial-password", nhaTruong, {
    method: "POST", body: JSON.stringify({ confirmation: "RESET_INITIAL_PASSWORD", account: PHU_HUYNH }),
  });
  assert.equal(datLai.status, 200);

  const phien = await server.loginCookie(PHU_HUYNH, PHU_HUYNH);
  const response = await doiMatKhau({ currentPassword: PHU_HUYNH, newPassword: "Nshm@2026z" }, phien);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "PASSWORD_CHANGE_REQUIRED");
});

test("trang đổi mật khẩu được nối đủ ba chỗ trong giao diện", async () => {
  // Thêm hàm render mà quên bảng định tuyến thì trang lặng lẽ rơi về Tổng quan —
  // không có lỗi nào hiện ra, người dùng chỉ thấy bấm vào không có gì xảy ra.
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /\{ id: "account", label: "Đổi mật khẩu", icon: "settings" \}/);
  assert.match(app, /account: renderAccount/);
  assert.match(app, /function renderAccount\(\)/);
  assert.match(app, /account: \["Tài khoản của tôi"/);
  assert.match(app, /api\("\/auth\/change-password", \{/);
});

test("mục đổi mật khẩu chỉ có ở điều hướng phụ huynh", async () => {
  // Nhân sự nhà trường thấy mục này sẽ bấm vào rồi nhận 403.
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const adminNav = app.slice(app.indexOf("const adminNav = ["), app.indexOf("const pageMeta"));
  assert.ok(!adminNav.includes(`id: "account"`), "adminNav không được chứa mục đổi mật khẩu");
});
