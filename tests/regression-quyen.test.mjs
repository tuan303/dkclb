// Dựng lại bốn cáo buộc của nhóm phản biện trên hệ thống thật, trước khi sửa.
// Mỗi ca ở đây mô tả HÀNH VI ĐÚNG mong muốn; ca nào đỏ nghĩa là cáo buộc có thật.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers/test-server.mjs";

let server;
let superCookie;
let giaovuCookie;

const request = (path, cookie, options = {}) => server.request(path, cookie, options);
const json = async (response) => response.json();

before(async () => {
  server = await startTestServer({
    prefix: "nshm-regression-",
    env: { SUPERADMIN_ACCOUNTS: "admin@nshm.edu.vn" },
  });
  superCookie = await server.loginCookie("admin@nshm.edu.vn", "Admin@123");
  giaovuCookie = await server.loginCookie("giaovu@nshm.edu.vn", "Admin@123");
});

after(async () => server.stop());

test("giáo vụ KHÔNG tải được tệp mã đăng nhập của toàn bộ phụ huynh", async () => {
  // Tệp này gồm số điện thoại, tên phụ huynh, tên và lớp của con, cùng MÃ ĐĂNG
  // NHẬP. Cầm nó là đăng nhập được vào bất kỳ tài khoản phụ huynh nào.
  const response = await request("/api/admin/accounts/activation-codes", giaovuCookie, { method: "POST", body: "{}" });
  assert.equal(response.status, 403);
});

test("tra cứu hỗ trợ không trả mã kích hoạt cho người chỉ có quyền tra cứu", async () => {
  const response = await request("/api/admin/accounts/lookup?account=0901234567", giaovuCookie);
  assert.equal(response.status, 200);
  const payload = await json(response);
  const body = JSON.stringify(payload);
  assert.equal(payload.account?.activationCode ?? null, null, "không trả mã kích hoạt");
  assert.ok(!/[A-Z2-9]{4}-[A-Z2-9]{4}/.test(body), `mã kích hoạt lọt ra trong phản hồi: ${body.slice(0, 300)}`);
});

test("nhập hàng loạt KHÔNG hạ được vai trò tài khoản khoá bởi cấu hình", async () => {
  // Đường PATCH có lá chắn này; đường nhập tệp phải có y hệt, nếu không thì tài
  // khoản duy nhất của trường tự hạ mình xuống giáo vụ mà không ai thấy.
  const before = await json(await request("/api/admin/school-accounts", superCookie));
  const locked = before.accounts.find((account) => account.lockedByEnv);
  assert.ok(locked, "phải có một tài khoản khoá bởi cấu hình để thử");

  const payload = {
    headers: ["Email", "Họ và tên", "Vai trò"],
    rows: [[locked.account, locked.displayName, "Giáo vụ"]],
  };
  await request("/api/admin/school-accounts/import/commit", superCookie, {
    method: "POST", body: JSON.stringify(payload),
  });

  const me = await json(await request("/api/me", superCookie));
  assert.equal(me.user.role, "superadmin", "vai trò hiệu lực phải giữ nguyên");

  const after = await json(await request("/api/admin/school-accounts", superCookie));
  const still = after.accounts.find((account) => account.id === locked.id);
  assert.equal(still.role, "superadmin", "vai trò lưu trong cơ sở dữ liệu KHÔNG được bị hạ");
});

test("nhập lại đúng tệp cũ thì hội tụ về không đổi, không đếm cập nhật mãi mãi", async () => {
  // Tài khoản demo dùng @nshm.edu.vn nên không qua được kiểm tra miền; tạo một
  // tài khoản đúng miền của trường để thử đường nhập tệp.
  const payload = {
    headers: ["Email", "Họ và tên", "Vai trò"],
    rows: [["hoi.tu@hoangmaistarschool.edu.vn", "Hội Tụ", "Giáo vụ"]],
  };
  const first = await json(await request("/api/admin/school-accounts/import/commit", superCookie, {
    method: "POST", body: JSON.stringify(payload),
  }));
  assert.equal(first.result.counters.created, 1);
  const again = await json(await request("/api/admin/school-accounts/import/commit", superCookie, {
    method: "POST", body: JSON.stringify(payload),
  }));
  assert.equal(again.result.counters.updated, 0, "lần thứ hai không được ghi gì thêm");
  assert.equal(again.result.summary.unchanged, 1);
});

test("nhập hàng loạt KHÔNG âm thầm bật lại tài khoản đã bị vô hiệu hoá", async () => {
  const created = await json(await request("/api/admin/school-accounts", superCookie, {
    method: "POST",
    body: JSON.stringify({ email: "da.nghi.viec@hoangmaistarschool.edu.vn", displayName: "Đã Nghỉ Việc", role: "giaovu" }),
  }));
  await request(`/api/admin/school-accounts/${created.account.id}`, superCookie, {
    method: "PATCH", body: JSON.stringify({ active: false }),
  });

  // Tệp danh sách nhân sự cũ vẫn còn tên người này. Bật lại là cho người đã nghỉ
  // việc vào hệ thống, và không ai chủ ý làm việc đó.
  await request("/api/admin/school-accounts/import/commit", superCookie, {
    method: "POST",
    body: JSON.stringify({ headers: ["Email", "Họ và tên", "Vai trò"], rows: [["da.nghi.viec@hoangmaistarschool.edu.vn", "Đã Nghỉ Việc", "Giáo vụ"]] }),
  });

  const list = await json(await request("/api/admin/school-accounts", superCookie));
  const still = list.accounts.find((account) => account.id === created.account.id);
  assert.equal(still.active, false, "nhập tệp không được bật lại tài khoản đã vô hiệu hoá");
});
