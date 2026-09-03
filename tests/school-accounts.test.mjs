// Quản lý tài khoản nhà trường, kiểm thử qua HTTP thật trên nền lưu trữ thật.
// Trọng tâm: ranh giới quyền giữa quản trị cao nhất, admin và giáo vụ.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers/test-server.mjs";

let server;
let superCookie;   // admin@nshm.edu.vn, được nâng lên quyền cao nhất qua biến môi trường
let adminCookie;   // cùng tài khoản đó nhưng ở máy chủ KHÔNG có biến môi trường
let giaovuCookie;

const request = (path, cookie, options = {}) => server.request(path, cookie, options);
const json = async (response) => response.json();

// Máy chủ thứ hai: không đặt SUPERADMIN_ACCOUNTS, để kiểm chứng rằng chính
// tài khoản đó chỉ còn quyền admin chứ không quản lý được tài khoản.
let plainServer;

before(async () => {
  server = await startTestServer({
    prefix: "nshm-taikhoan-",
    env: { SUPERADMIN_ACCOUNTS: "admin@nshm.edu.vn" },
  });
  superCookie = await server.loginCookie("admin@nshm.edu.vn", "Admin@123");
  giaovuCookie = await server.loginCookie("giaovu@nshm.edu.vn", "Admin@123");

  plainServer = await startTestServer({ prefix: "nshm-khong-super-" });
  adminCookie = await plainServer.loginCookie("admin@nshm.edu.vn", "Admin@123");
});

after(async () => {
  await server.stop();
  await plainServer.stop();
});

/* ---------- Ranh giới quyền ---------- */

test("giáo vụ không sao lưu được toàn bộ cơ sở dữ liệu", async () => {
  // Bản sao lưu gồm cả tài khoản phụ huynh và mã kích hoạt của họ.
  assert.equal((await request("/api/admin/export/collections", giaovuCookie)).status, 403);
  const backup = await request("/api/admin/export/backup", giaovuCookie, { method: "POST", body: "{}" });
  assert.equal(backup.status, 403);
});

test("giáo vụ tải được danh sách đăng ký để xếp lớp", async () => {
  // Đây là việc hằng ngày của giáo vụ, không phải trích xuất dữ liệu: tệp chỉ có
  // mã đơn, tên học sinh, lớp, CLB, lịch, trạng thái, học phí.
  const response = await request("/api/admin/reports/registrations.csv", giaovuCookie);
  assert.equal(response.status, 200);
  const csv = await response.text();
  const header = csv.split("\r\n")[0];
  assert.match(header, /Học sinh/);
  // Khoá lại đúng những gì KHÔNG được có trong tệp này.
  for (const field of ["Số điện thoại", "Ngày sinh", "Mã kích hoạt", "Email"]) {
    assert.ok(!header.includes(field), `tệp xếp lớp không được chứa cột ${field}`);
  }
});

test("giáo vụ vẫn nhập được danh mục, xem được báo cáo và cấp được mã kích hoạt", async () => {
  assert.equal((await request("/api/admin/catalog", giaovuCookie)).status, 200);
  assert.equal((await request("/api/admin/dashboard", giaovuCookie)).status, 200);
  assert.equal((await request("/api/admin/accounts/lookup?account=0901234567", giaovuCookie)).status, 200);
});

test("giáo vụ không quản lý được tài khoản nhà trường", async () => {
  assert.equal((await request("/api/admin/school-accounts", giaovuCookie)).status, 403);
  const created = await request("/api/admin/school-accounts", giaovuCookie, {
    method: "POST",
    body: JSON.stringify({ email: "x@hoangmaistarschool.edu.vn", displayName: "X", role: "giaovu" }),
  });
  assert.equal(created.status, 403);
});

test("admin vận hành được nhưng không quản lý tài khoản", async () => {
  // Đây là ranh giới chính giữa 'admin' và quản trị cao nhất.
  assert.equal((await plainServer.request("/api/admin/school-accounts", adminCookie)).status, 403);
  assert.equal((await plainServer.request("/api/admin/export/collections", adminCookie)).status, 200);
  assert.equal((await plainServer.request("/api/admin/catalog", adminCookie)).status, 200);
});

test("phụ huynh không chạm được vào phần quản lý tài khoản", async () => {
  const parentCookie = await server.loginCookie("0901234567", "123456");
  assert.equal((await request("/api/admin/school-accounts", parentCookie)).status, 403);
});

test("chưa đăng nhập thì bị chặn ở tầng xác thực, không phải tầng phân quyền", async () => {
  const response = await fetch(`${server.baseUrl}/api/admin/school-accounts`);
  assert.equal(response.status, 401);
});

/* ---------- Biến môi trường quyết định quyền cao nhất ---------- */

test("email trong SUPERADMIN_ACCOUNTS được nâng quyền dù cơ sở dữ liệu ghi là admin", async () => {
  const me = await json(await request("/api/me", superCookie));
  assert.equal(me.user.role, "superadmin", "vai trò trong CSDL vẫn là 'admin', biến môi trường mới là thứ quyết định");
  assert.ok(me.user.capabilities.includes("quan-ly-tai-khoan"));

  const plainMe = await json(await plainServer.request("/api/me", adminCookie));
  assert.equal(plainMe.user.role, "admin");
  assert.ok(!plainMe.user.capabilities.includes("quan-ly-tai-khoan"));
});

test("giao diện nhận được danh sách quyền để tự ẩn đúng chỗ", async () => {
  const me = await json(await request("/api/me", giaovuCookie));
  assert.equal(me.user.role, "giaovu");
  assert.equal(me.user.roleLabel, "Giáo vụ");
  assert.deepEqual([...me.user.capabilities].sort(), ["bao-cao", "danh-muc", "danh-sach-van-hanh", "ma-kich-hoat"]);
});

/* ---------- Danh sách và tạo tài khoản ---------- */

test("danh sách chỉ gồm tài khoản nhà trường, không lẫn phụ huynh", async () => {
  const payload = await json(await request("/api/admin/school-accounts", superCookie));
  assert.ok(payload.accounts.length >= 2);
  assert.ok(payload.accounts.every((account) => account.role !== "parent"));
  assert.equal(payload.domain, "hoangmaistarschool.edu.vn");
  assert.equal(payload.superadminCount, 1);
  assert.deepEqual(payload.roles.map((role) => role.value), ["admin", "giaovu"]);

  const supers = payload.accounts.filter((account) => account.role === "superadmin");
  assert.equal(supers.length, 1);
  assert.equal(supers[0].lockedByEnv, true, "quyền do cấu hình máy chủ quyết định thì không sửa được từ giao diện");
});

test("tạo tài khoản thủ công ở trạng thái chờ đăng nhập lần đầu", async () => {
  const response = await request("/api/admin/school-accounts", superCookie, {
    method: "POST",
    body: JSON.stringify({ email: "Le.Van.C@hoangmaistarschool.edu.vn", displayName: "Lê Văn C", role: "giaovu" }),
  });
  assert.equal(response.status, 201);
  const { account } = await json(response);
  assert.equal(account.account, "le.van.c@hoangmaistarschool.edu.vn", "email được chuẩn hoá về chữ thường");
  assert.equal(account.role, "giaovu");
  assert.equal(account.status, "cho-dang-nhap-lan-dau");
  assert.equal(account.active, true);
  assert.equal(account.lastLoginAt, null);
});

test("email ngoài miền của trường bị từ chối", async () => {
  const response = await request("/api/admin/school-accounts", superCookie, {
    method: "POST",
    body: JSON.stringify({ email: "ai.do@gmail.com", displayName: "Ai Đó", role: "admin" }),
  });
  assert.equal(response.status, 422);
  assert.equal((await json(response)).error.code, "EMAIL_NGOAI_MIEN");
});

test("không tự cấp được vai trò cao nhất từ giao diện", async () => {
  const response = await request("/api/admin/school-accounts", superCookie, {
    method: "POST",
    body: JSON.stringify({ email: "muon.len.cao@hoangmaistarschool.edu.vn", displayName: "Muốn", role: "superadmin" }),
  });
  assert.equal(response.status, 422);
  assert.equal((await json(response)).error.code, "VAI_TRO_KHONG_HOP_LE");
});

test("email trùng thì báo rõ, không tạo bản ghi thứ hai", async () => {
  const body = JSON.stringify({ email: "trung.lap@hoangmaistarschool.edu.vn", displayName: "Trùng", role: "admin" });
  assert.equal((await request("/api/admin/school-accounts", superCookie, { method: "POST", body })).status, 201);
  const again = await request("/api/admin/school-accounts", superCookie, { method: "POST", body });
  assert.equal(again.status, 409);
  assert.equal((await json(again)).error.code, "TAI_KHOAN_DA_TON_TAI");
});

/* ---------- Đổi vai trò và vô hiệu hoá ---------- */

test("đổi vai trò và vô hiệu hoá, không xoá cứng bao giờ", async () => {
  const created = await json(await request("/api/admin/school-accounts", superCookie, {
    method: "POST",
    body: JSON.stringify({ email: "doi.vai.tro@hoangmaistarschool.edu.vn", displayName: "Đổi", role: "giaovu" }),
  }));

  const promoted = await json(await request(`/api/admin/school-accounts/${created.account.id}`, superCookie, {
    method: "PATCH", body: JSON.stringify({ role: "admin", reason: "Nhận thêm việc vận hành" }),
  }));
  assert.equal(promoted.account.role, "admin");

  const disabled = await json(await request(`/api/admin/school-accounts/${created.account.id}`, superCookie, {
    method: "PATCH", body: JSON.stringify({ active: false }),
  }));
  assert.equal(disabled.account.active, false);
  assert.equal(disabled.account.status, "vo-hieu-hoa");

  // Vẫn còn trong danh sách: giữ lịch sử thao tác chứ không xoá.
  const list = await json(await request("/api/admin/school-accounts", superCookie));
  assert.ok(list.accounts.some((account) => account.id === created.account.id));

  const enabled = await json(await request(`/api/admin/school-accounts/${created.account.id}`, superCookie, {
    method: "PATCH", body: JSON.stringify({ active: true }),
  }));
  assert.equal(enabled.account.active, true);
});

test("không tự vô hiệu hoá được tài khoản của chính mình", async () => {
  // Cách nhanh nhất để không còn ai quản lý được tài khoản.
  const me = await json(await request("/api/me", superCookie));
  const response = await request(`/api/admin/school-accounts/${me.user.id}`, superCookie, {
    method: "PATCH", body: JSON.stringify({ active: false }),
  });
  assert.equal(response.status, 409);
  assert.equal((await json(response)).error.code, "KHONG_TU_VO_HIEU_HOA",
    "phải báo đúng nguyên nhân, không nấp sau thông báo khoá-bởi-cấu-hình");
});

test("tài khoản khoá bởi cấu hình thì nói rõ phải sửa ở đâu", async () => {
  const list = await json(await request("/api/admin/school-accounts", superCookie));
  const locked = list.accounts.find((account) => account.lockedByEnv);
  const response = await request(`/api/admin/school-accounts/${locked.id}`, superCookie, {
    method: "PATCH", body: JSON.stringify({ role: "giaovu" }),
  });
  assert.equal(response.status, 409);
  assert.match((await json(response)).error.message, /SUPERADMIN_ACCOUNTS/);
});

test("không tìm thấy hoặc trỏ vào tài khoản phụ huynh đều trả 404", async () => {
  assert.equal((await request("/api/admin/school-accounts/khong-co-that", superCookie, {
    method: "PATCH", body: JSON.stringify({ role: "admin" }),
  })).status, 404);
  assert.equal((await request("/api/admin/school-accounts/u_parent", superCookie, {
    method: "PATCH", body: JSON.stringify({ role: "admin" }),
  })).status, 404);
});

/* ---------- Tìm kiếm ---------- */

test("tìm kiếm theo email hoặc theo tên", async () => {
  await request("/api/admin/school-accounts", superCookie, {
    method: "POST",
    body: JSON.stringify({ email: "tim.kiem@hoangmaistarschool.edu.vn", displayName: "Nguyễn Tìm Kiếm", role: "giaovu" }),
  });
  const byEmail = await json(await request("/api/admin/school-accounts?search=tim.kiem", superCookie));
  assert.equal(byEmail.accounts.length, 1);
  const byName = await json(await request("/api/admin/school-accounts?search=Tìm Kiếm", superCookie));
  assert.equal(byName.accounts.length, 1);
  const none = await json(await request("/api/admin/school-accounts?search=khongtontai", superCookie));
  assert.equal(none.accounts.length, 0);
});

/* ---------- Nhập hàng loạt ---------- */

test("xem trước rồi mới ghi, còn dòng lỗi thì không ghi gì", async () => {
  const payload = {
    headers: ["Email", "Họ và tên", "Vai trò"],
    rows: [
      ["nhap1@hoangmaistarschool.edu.vn", "Nhập Một", "Giáo vụ"],
      ["ngoaimien@gmail.com", "Ngoài Miền", "admin"],
    ],
  };
  const preview = await json(await request("/api/admin/school-accounts/import/preview", superCookie, {
    method: "POST", body: JSON.stringify(payload),
  }));
  assert.equal(preview.preview.summary.create, 1);
  assert.equal(preview.preview.summary.invalid, 1);
  assert.equal(preview.preview.readyToCommit, false);

  const blocked = await request("/api/admin/school-accounts/import/commit", superCookie, {
    method: "POST", body: JSON.stringify(payload),
  });
  assert.equal(blocked.status, 422, "còn dòng lỗi thì không được ghi nửa vời");

  // Bỏ dòng lỗi ra thì ghi được.
  const clean = { headers: payload.headers, rows: [payload.rows[0]] };
  const committed = await json(await request("/api/admin/school-accounts/import/commit", superCookie, {
    method: "POST", body: JSON.stringify(clean),
  }));
  assert.equal(committed.result.counters.created, 1);

  // Chạy lại đúng tệp đó thì không ghi thêm lần nào.
  const again = await json(await request("/api/admin/school-accounts/import/commit", superCookie, {
    method: "POST", body: JSON.stringify(clean),
  }));
  assert.equal(again.result.counters.created, 0);
  assert.equal(again.result.summary.unchanged, 1);
});
