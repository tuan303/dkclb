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

// Đặt lại đưa tài khoản về mật khẩu là số điện thoại. Muốn có MÃ kích hoạt thì
// phải đi qua đường cấp hàng loạt — nơi duy nhất còn sinh mã.
async function capMaChoTaiKhoan(account) {
  await request("/api/admin/accounts/reset-initial-password", adminCookie, {
    method: "POST",
    body: JSON.stringify({ account, confirmation: "RESET_INITIAL_PASSWORD" }),
  });
  const { result } = await (await request("/api/admin/accounts/activation-codes", adminCookie, {
    method: "POST",
    body: JSON.stringify({ confirmation: "ISSUE_ACTIVATION_CODES" }),
  })).json();
  const row = result.rows.find((item) => item.account === account);
  assert.ok(row?.activationCode, `không cấp được mã cho ${account}`);
  return row.activationCode;
}


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

test("đăng nhập đúng sau vài lần sai vẫn xóa được bộ đếm sai", async () => {
  // Bộ đếm chỉ được ghi lại khi thực sự khác 0, nên phải chắc là nhánh đó không bị bỏ sót.
  await login("0901234567", "sai-mat-khau");
  await login("0901234567", "sai-mat-khau");
  const before = await (await request("/api/admin/accounts/lookup?account=0901234567", adminCookie)).json();
  assert.equal(before.lookup.account.loginFailures, 2);

  const success = await login("0901234567", "123456");
  assert.equal(success.status, 200);

  const after = await (await request("/api/admin/accounts/lookup?account=0901234567", adminCookie)).json();
  assert.equal(after.lookup.account.loginFailures, 0);
  assert.equal(after.lookup.account.lockedUntil, null);
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

test("đặt lại đưa tài khoản về mật khẩu là số điện thoại và bắt đổi ngay", async () => {
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
  const { result } = await reset.json();
  // Không trả mật khẩu về: nó chính là số điện thoại người gọi vừa nhập.
  assert.equal(result.activationCode ?? null, null);
  assert.equal(result.initialPassword, "so-dien-thoai");

  // Mật khẩu riêng cũ hết hiệu lực; số điện thoại trở thành mật khẩu khởi tạo.
  assert.equal((await login("0901234567", "123456")).status, 401);
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

test("đặt mật khẩu riêng là mã kích hoạt hết hiệu lực ngay", async () => {
  const code = await capMaChoTaiKhoan("0901234567");
  const initial = await login("0901234567", code);
  assert.equal(initial.status, 200);
  const cookie = initial.headers.get("set-cookie").split(";")[0];

  const changed = await request("/api/auth/change-initial-password", cookie, {
    method: "POST",
    body: JSON.stringify({ newPassword: "Nshm@2026clb" }),
  });
  assert.equal(changed.status, 200);

  // Đây là điểm bảo mật quan trọng nhất: mã kích hoạt là dùng MỘT LẦN, phải tắt
  // hẳn ngay khi tài khoản đã có mật khẩu riêng.
  assert.equal((await login("0901234567", code)).status, 401, "mã kích hoạt không dùng lại được");
  assert.equal((await login("0901234567", "0901234567")).status, 401, "số điện thoại không phải mật khẩu");

  const withNewPassword = await login("0901234567", "Nshm@2026clb");
  assert.equal(withNewPassword.status, 200);
  const meCookie = withNewPassword.headers.get("set-cookie").split(";")[0];
  const me = await (await request("/api/me", meCookie)).json();
  assert.equal(me.user.mustChangePassword, false);

  const { lookup } = await (await request("/api/admin/accounts/lookup?account=0901234567", adminCookie)).json();
  assert.equal(lookup.account.mustChangePassword, false);
  assert.equal(lookup.account.activationCode, null, "đã đặt mật khẩu riêng thì không còn mã nào để đọc");
  assert.match(lookup.diagnosis, /đã đổi sang mật khẩu riêng/);
});

test("tra cứu cho quản trị thấy mã kích hoạt của tài khoản chưa dùng", async () => {
  const code = await capMaChoTaiKhoan("0901234567");

  const { lookup } = await (await request("/api/admin/accounts/lookup?account=0901234567", adminCookie)).json();
  assert.equal(lookup.account.activationCode, code, "nhà trường phải đọc lại được mã để phát cho phụ huynh");
  assert.match(lookup.diagnosis, /chưa kích hoạt/);

  // Đặt lại xoá mã và đưa về mật khẩu là số điện thoại: một tài khoản chỉ còn
  // đúng một lối vào, không để lại mã cũ còn hiệu lực.
  await request("/api/admin/accounts/reset-initial-password", adminCookie, {
    method: "POST",
    body: JSON.stringify({ account: "0901234567", confirmation: "RESET_INITIAL_PASSWORD" }),
  });
  assert.equal((await login("0901234567", code)).status, 401, "mã cũ phải hết hiệu lực sau khi đặt lại");
  assert.equal((await login("0901234567", "0901234567")).status, 200, "số điện thoại là mật khẩu khởi tạo");
});

test("mã kích hoạt không bao giờ bị ghi vào nhật ký thao tác", async () => {
  const code = await capMaChoTaiKhoan("0901234567");

  // Nhật ký được xuất ra ngoài khi sao lưu, nên không được chứa mã đăng nhập.
  const rows = [];
  let after = null;
  do {
    const page = (await (await request("/api/admin/export/backup", adminCookie, {
      method: "POST",
      body: JSON.stringify({ confirmation: "EXPORT_FULL_BACKUP", collection: "auditLogs", after }),
    })).json()).page;
    rows.push(...page.rows);
    after = page.nextAfter;
  } while (after);

  const serialized = JSON.stringify(rows);
  assert.ok(rows.some((row) => row.action === "RESET_INITIAL_PASSWORD"), "phải có bản ghi nhật ký cho lần đặt lại");
  assert.ok(!serialized.includes(code.replace("-", "")), "nhật ký không được chứa mã kích hoạt");
  assert.ok(!serialized.includes(code), "nhật ký không được chứa mã kích hoạt");
});

test("cấp mã hàng loạt chỉ sinh mã cho tài khoản chưa có, chạy lại không phá mã đã phát", async () => {
  const anonymous = await fetch(`${baseUrl}/api/admin/accounts/activation-codes`, { method: "POST" });
  assert.equal(anonymous.status, 401);

  const withoutConfirmation = await request("/api/admin/accounts/activation-codes", adminCookie, {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert.equal(withoutConfirmation.status, 422);

  const first = await request("/api/admin/accounts/activation-codes", adminCookie, {
    method: "POST",
    body: JSON.stringify({ confirmation: "ISSUE_ACTIVATION_CODES" }),
  });
  assert.equal(first.status, 200);
  const firstResult = (await first.json()).result;
  assert.ok(firstResult.pending >= 1, "phải có tài khoản đang chờ kích hoạt");
  const target = firstResult.rows.find((row) => row.account === "0901234567");
  assert.ok(target, "danh sách in phải có tài khoản chưa kích hoạt");
  assert.match(target.activationCode, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  assert.ok(target.students.includes("Nguyễn Minh An"), "danh sách in phải kèm tên học sinh để phát đúng người");

  // Chạy lại: không cấp thêm mã nào, và mã cũ giữ nguyên để bản đã in vẫn dùng được.
  const second = await request("/api/admin/accounts/activation-codes", adminCookie, {
    method: "POST",
    body: JSON.stringify({ confirmation: "ISSUE_ACTIVATION_CODES" }),
  });
  const secondResult = (await second.json()).result;
  assert.equal(secondResult.issued, 0, "chạy lại không được sinh mã mới");
  assert.equal(secondResult.rows.find((row) => row.account === "0901234567").activationCode, target.activationCode);

  assert.equal((await login("0901234567", target.activationCode)).status, 200, "mã in ra phải đăng nhập được");
});

test("tài khoản đã đặt mật khẩu riêng không nằm trong danh sách cấp mã", async () => {
  const code = await capMaChoTaiKhoan("0901234567");
  const cookie = (await login("0901234567", code)).headers.get("set-cookie").split(";")[0];
  await request("/api/auth/change-initial-password", cookie, {
    method: "POST",
    body: JSON.stringify({ newPassword: "Nshm@2026clb" }),
  });

  const listed = await request("/api/admin/accounts/activation-codes", adminCookie, {
    method: "POST",
    body: JSON.stringify({ confirmation: "ISSUE_ACTIVATION_CODES" }),
  });
  const { result } = await listed.json();
  assert.ok(!result.rows.some((row) => row.account === "0901234567"),
    "đã có mật khẩu riêng thì không được cấp lại mã, và không được lộ trong danh sách in");
});

test("không đặt lại được mật khẩu của tài khoản nhà trường", async () => {
  const response = await request("/api/admin/accounts/reset-initial-password", adminCookie, {
    method: "POST",
    body: JSON.stringify({ account: "admin@nshm.edu.vn", confirmation: "RESET_INITIAL_PASSWORD" }),
  });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "ACCOUNT_NOT_PHONE");
});
