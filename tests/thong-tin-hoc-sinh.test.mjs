// Màn Thông tin học sinh: sửa SĐT, email phụ huynh ngay trên phần mềm (15/09/2026).
//
// Điều cần canh không phải là "lưu được", mà là SĐT phụ huynh CHÍNH LÀ SỐ ĐĂNG NHẬP:
//   - đổi số thì số mới vào được, số cũ không, mà con và đơn cũ vẫn còn nguyên;
//   - số mới đã là tài khoản khác thì phải chặn, không để hai tài khoản giành một số;
//   - "số cũ sai người" phải đá được người đang ở trong ra;
//   - nhập lại file cũ không được làm số cũ sống lại;
//   - chỉ quản trị làm được, và nhật ký không rải số điện thoại ra ngoài lớp mã hoá.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers/test-server.mjs";
import {
  cheEmail, cheSdt, chuanHoaEmail, chuanHoaSdt, docBoLoc, ghepDanhBa, lapKeHoachSua, lapKeHoachThem, locDanhBa, taoHangDoiGhi,
} from "../lien-he-phu-huynh.mjs";

/* ---------- Phần thuần ---------- */

test("SĐT nhận mọi cách gõ quen thuộc và đưa về một dạng", () => {
  for (const cachGo of ["0912345678", "0912 345 678", "+84 912 345 678", "84912345678", "912345678"]) {
    assert.equal(chuanHoaSdt(cachGo), "0912345678", cachGo);
  }
  for (const sai of ["", "12345", "admin@nshm.edu.vn", "0212345678"]) {
    assert.throws(() => chuanHoaSdt(sai), (error) => error.code === "SDT_KHONG_HOP_LE" && error.status === 422, sai);
  }
});

test("email: ô trống là xoá, chữ hoa đưa về thường, rác bị từ chối", () => {
  assert.equal(chuanHoaEmail(""), null);
  assert.equal(chuanHoaEmail("  Mai.Lan@Gmail.COM "), "mai.lan@gmail.com");
  for (const sai of ["không có", "0912345678", "a@b", "a b@c.vn"]) {
    assert.throws(() => chuanHoaEmail(sai), (error) => error.code === "EMAIL_KHONG_HOP_LE", sai);
  }
});

test("nhật ký chỉ giữ đủ để đối soát, không giữ nguyên số và email", () => {
  assert.equal(cheSdt("0912345678"), "091****678");
  assert.equal(cheEmail("mai.lan@gmail.com"), "ma***@gmail.com");
  const keHoach = lapKeHoachSua({
    hienTai: { id: "u1", role: "parent", account: "0912345678", email: "mai.lan@gmail.com", displayName: "Mai Lan" },
    thayDoi: { account: "0987654321", email: "moi@vd.vn", displayName: "Lan Mai" },
  });
  const json = JSON.stringify(keHoach.nhatKy);
  for (const bi of ["0912345678", "0987654321", "mai.lan@gmail.com", "moi@vd.vn", "Mai Lan", "Lan Mai"]) {
    assert.ok(!json.includes(bi), `nhật ký lộ ${bi}: ${json}`);
  }
});

test("không đổi gì thì không ghi; số mới thuộc người khác thì chặn", () => {
  const hienTai = { id: "u1", role: "parent", account: "0912345678", email: null, displayName: "Mai Lan" };
  assert.equal(lapKeHoachSua({ hienTai, thayDoi: { account: "0912345678", email: null, displayName: "Mai Lan" } }).khongDoi, true);
  assert.throws(
    () => lapKeHoachSua({ hienTai, thayDoi: { account: "0987654321" }, trung: { id: "u2", role: "parent", soHocSinh: 2 } }),
    (error) => error.status === 409 && error.code === "SDT_DA_CO_TAI_KHOAN" && /2 học sinh/.test(error.message),
  );
  assert.throws(() => lapKeHoachSua({ hienTai: { ...hienTai, role: "admin" }, thayDoi: {} }), (error) => error.status === 404);
  // Đặt lại mật khẩu mà giữ số cũ: mật khẩu khởi tạo chính là số cũ, người cần đuổi ra vào lại ngay.
  assert.throws(() => lapKeHoachSua({ hienTai, thayDoi: {}, saiNguoi: true }), (error) => error.code === "SAI_NGUOI_CAN_SO_MOI");
  assert.throws(() => lapKeHoachSua({ hienTai, thayDoi: { account: "0912345678" }, saiNguoi: true }), (error) => error.code === "SAI_NGUOI_CAN_SO_MOI");
  const taiKhoanKhac = { id: "u7", role: "parent", displayName: "Phạm Thị C", hocSinh: [{ name: "Phạm Minh D", homeroom: "5A1" }] };
  assert.throws(() => lapKeHoachThem({ coHocSinh: true, taiKhoan: taiKhoanKhac }),
    (error) => error.code === "CAN_XAC_NHAN_GAN_TAI_KHOAN" && /Phạm Thị C/.test(error.message) && /Phạm Minh D \(5A1\)/.test(error.message));
  assert.deepEqual(lapKeHoachThem({ coHocSinh: true, taiKhoan: taiKhoanKhac, ganVaoTaiKhoanCo: true }), { taoTaiKhoan: false });
  assert.throws(() => lapKeHoachThem({ coHocSinh: true, taiKhoan: { id: "u9", role: "giaovu" } }),
    (error) => error.code === "SDT_LA_TAI_KHOAN_NHA_TRUONG");
});

test("tìm theo SĐT gõ kiểu nào cũng ra, tìm tên không cần dấu", () => {
  const rows = ghepDanhBa({
    students: [
      { id: "a", code: "HS1", name: "Nguyễn Minh An", grade: 3, homeroom: "3A2", status: "active" },
      { id: "b", code: "HS2", name: "Trần Bảo Ngọc", grade: 2, homeroom: "2A3", status: "active" },
    ],
    links: [{ parentUserId: "u1", studentId: "a", relationship: "Mẹ" }],
    parents: [{ id: "u1", account: "0912345678", displayName: "Mai Lan", email: null, active: true }],
  });
  const tim = (q, them = {}) => locDanhBa(rows, docBoLoc(new URLSearchParams({ q, ...them }))).rows.map((row) => row.id);
  assert.deepEqual(tim("0912 345 678"), ["a"]);
  assert.deepEqual(tim("+84912345678"), ["a"]);
  assert.deepEqual(tim("345678"), ["a"]);
  assert.deepEqual(tim("minh an"), ["a"]);
  assert.deepEqual(tim("ngoc"), ["b"]);
  assert.deepEqual(tim("", { lienHe: "chua-co-sdt" }), ["b"]);
});

test("hai lượt lưu chồng nhau thì xếp hàng; chỉ lượt nhập danh bạ thật mới làm lượt lưu bị từ chối", async () => {
  // Dựng lại đúng cách khoá danh bạ hành xử: đang có lượt thì TỪ CHỐI, không xếp hàng.
  // Lượt ghi giả chạy chậm như trên MySQL — trên SQLite lượt ghi xong gần như tức thì
  // nên bài kiểm qua HTTP không tạo được cảnh chồng nhau.
  const { createSyncScheduler } = await import("../sync-scheduler.mjs");
  const khoa = createSyncScheduler({ intervalMs: 60_000, run: async () => ({}) });
  let soLanXoa = 0;
  const ghi = taoHangDoiGhi((task) => khoa.runExclusive(task), () => { soLanXoa += 1; });
  const cham = (giaTri) => () => new Promise((resolve) => setTimeout(() => resolve(giaTri), 30));

  assert.deepEqual(await Promise.all([ghi(cham("a")), ghi(cham("b"))]), ["a", "b"]);
  assert.equal(soLanXoa, 2, "mỗi lượt ghi xong đều xoá bộ nhớ đệm danh bạ");

  const dangNhapFile = khoa.runExclusive(cham("nhap-file"));
  await assert.rejects(ghi(cham("c")), (error) => error.code === "DANG_NHAP_DANH_BA" && error.status === 409);
  await dangNhapFile;
  assert.equal(await ghi(cham("d")), "d", "một lượt bị từ chối không làm kẹt hàng đợi");
});

/* ---------- Qua HTTP ---------- */

let server;
let quanTri;
let giaoVu;

before(async () => {
  server = await startTestServer({ prefix: "nshm-thong-tin-hs-" });
  quanTri = await server.loginCookie("admin@nshm.edu.vn", "Admin@123");
  giaoVu = await server.loginCookie("giaovu@nshm.edu.vn", "Admin@123");
});

after(async () => {
  await server.stop();
});

const doc = async (response) => ({ status: response.status, body: await response.json().catch(() => null) });
const lay = (duong, cookie = quanTri) => server.request(duong, cookie).then(doc);
const gui = (duong, method, body, cookie = quanTri) => server.request(duong, cookie, { method, body: JSON.stringify(body) }).then(doc);
const chiTiet = async (studentId) => (await lay(`/api/admin/hoc-sinh/${studentId}`)).body.hocSinh;

test("giáo vụ và phụ huynh không vào được màn Thông tin học sinh", async () => {
  const phuHuynh = await server.loginCookie("0901234567", "123456");
  for (const cookie of [giaoVu, phuHuynh]) {
    assert.equal((await lay("/api/admin/hoc-sinh", cookie)).status, 403);
    assert.equal((await lay("/api/admin/hoc-sinh/hs01", cookie)).status, 403);
    assert.equal((await gui("/api/admin/phu-huynh/u_parent", "PATCH", { email: "x@vd.vn" }, cookie)).status, 403);
    assert.equal((await gui("/api/admin/hoc-sinh/hs03/phu-huynh", "POST", { account: "0933000999", relationship: "Bố" }, cookie)).status, 403);
  }
  const { body } = await lay("/api/admin/hoc-sinh");
  assert.ok(body.tong >= 8, "quản trị thì vào được");
});

test("danh sách lọc và phân trang ở máy chủ", async () => {
  const theoSo = (await lay("/api/admin/hoc-sinh?q=901234567")).body;
  assert.deepEqual(theoSo.rows.map((row) => row.id).sort(), ["hs01", "hs02"]);
  assert.equal(theoSo.rows[0].phuHuynh[0].account, "0901234567");

  const khoi3 = (await lay("/api/admin/hoc-sinh?khoi=3")).body;
  assert.ok(khoi3.rows.every((row) => row.grade === 3) && khoi3.tong === 3);

  const chuaCo = (await lay("/api/admin/hoc-sinh?lienHe=chua-co-sdt")).body;
  assert.ok(!chuaCo.rows.some((row) => ["hs01", "hs02"].includes(row.id)));

  const trang = (await lay("/api/admin/hoc-sinh?moiTrang=20&trang=99")).body;
  assert.equal(trang.trang, trang.soTrang, "trang vượt quá thì về trang cuối, không trả rỗng");
});

test("sửa email: lưu dạng chuẩn, email rác bị từ chối và không ghi gì", async () => {
  const ok = await gui("/api/admin/phu-huynh/u_parent", "PATCH", { email: "Mai.Lan@Gmail.com" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ketQua.doiEmail, true);
  assert.equal((await chiTiet("hs01")).phuHuynh[0].email, "mai.lan@gmail.com");
  const trongBang = (await lay("/api/admin/hoc-sinh?q=901234567")).body.rows[0].phuHuynh[0];
  assert.equal(trongBang.email, "mai.lan@gmail.com", "bảng danh sách không được giữ bản cũ sau khi lưu");

  const sai = await gui("/api/admin/phu-huynh/u_parent", "PATCH", { email: "không có", account: "0911111111" });
  assert.equal(sai.status, 422);
  const sau = (await chiTiet("hs01")).phuHuynh[0];
  assert.equal(sau.account, "0901234567", "một trường sai thì không trường nào được ghi");
  assert.equal(sau.email, "mai.lan@gmail.com");
});

test("đổi SĐT: số mới vào bằng mật khẩu riêng cũ, số cũ không vào được, con và đơn còn nguyên", async () => {
  const cookieCu = await server.loginCookie("0901234567", "123456");
  const donTruoc = (await lay("/api/registrations", cookieCu)).body.registrations.length;
  assert.ok(donTruoc > 0, "dữ liệu mẫu phải có đơn để bài này có nghĩa");

  const doi = await gui("/api/admin/phu-huynh/u_parent", "PATCH", { account: "0912 000 111" });
  assert.equal(doi.status, 200);
  assert.equal(doi.body.ketQua.doiSo, true);

  assert.equal((await server.login("0901234567", "123456")).status, 401, "số cũ không vào được nữa");
  const cookieMoi = await server.loginCookie("0912000111", "123456");
  assert.equal((await lay("/api/students", cookieMoi)).body.students.length, 2);
  assert.equal((await lay("/api/registrations", cookieMoi)).body.registrations.length, donTruoc,
    "đơn gắn theo tài khoản, không theo số — đổi số tại chỗ nên không mất đơn nào");
  assert.equal((await lay("/api/students", cookieCu)).status, 200, "không đánh dấu sai người thì phiên đang mở vẫn giữ");
});

test("số mới đã là tài khoản khác thì chặn, không đổi gì", async () => {
  const them = await gui("/api/admin/hoc-sinh/hs03/phu-huynh", "POST", {
    account: "0933000222", relationship: "Bố", email: "bo.khang@vd.vn", displayName: "Lê Văn Bố",
  });
  assert.equal(them.status, 201);

  const trung = await gui("/api/admin/phu-huynh/u_parent", "PATCH", { account: "0933000222" });
  assert.equal(trung.status, 409);
  assert.equal(trung.body.error?.code || trung.body.code, "SDT_DA_CO_TAI_KHOAN");
  assert.equal((await server.login("0912000111", "123456")).status, 200, "tài khoản bị chặn đổi vẫn đăng nhập như cũ");
});

test("thêm SĐT: số mới tạo tài khoản với mật khẩu là chính số; số đã có thì gắn thêm, không đè email", async () => {
  const moi = await server.login("0933000222", "0933000222");
  assert.equal(moi.status, 200, "tài khoản vừa thêm đăng nhập bằng chính số điện thoại");
  assert.equal((await moi.json()).user.mustChangePassword, true);

  const chuaXacNhan = await gui("/api/admin/hoc-sinh/hs04/phu-huynh", "POST", {
    account: "0933000222", relationship: "Bố", email: "email-khac@vd.vn", displayName: "Tên khác",
  });
  assert.equal(chuaXacNhan.status, 409, "dán nhầm số của gia đình khác thì phải hỏi trước khi gắn");
  assert.equal(chuaXacNhan.body.error.code, "CAN_XAC_NHAN_GAN_TAI_KHOAN");
  assert.match(chuaXacNhan.body.error.message, /Lê Văn Bố.*Lê Minh Khang \(3A1\)/);
  assert.equal((await chiTiet("hs04")).phuHuynh.length, 0, "chưa xác nhận thì chưa gắn gì");

  const ganThem = await gui("/api/admin/hoc-sinh/hs04/phu-huynh", "POST", {
    account: "0933000222", relationship: "Bố", email: "email-khac@vd.vn", displayName: "Tên khác", ganVaoTaiKhoanCo: true,
  });
  assert.equal(ganThem.status, 201);
  assert.equal(ganThem.body.ketQua.taoTaiKhoan, false);
  const bo = (await chiTiet("hs04")).phuHuynh.find((item) => item.account === "0933000222");
  assert.equal(bo.email, "bo.khang@vd.vn", "gắn vào tài khoản đã có thì giữ email của tài khoản ấy");
  assert.equal(bo.displayName, "Lê Văn Bố");
  assert.deepEqual(bo.hocSinhKhac.map((em) => em.id), ["hs03"], "màn sửa phải cho thấy số này dùng chung với em nào");

  assert.equal((await gui("/api/admin/hoc-sinh/hs04/phu-huynh", "POST", { account: "0933000222", relationship: "Bố", ganVaoTaiKhoanCo: true })).body.error.code, "DA_LIEN_KET");
  assert.equal((await gui("/api/admin/hoc-sinh/hs04/phu-huynh", "POST", { account: "0933000333", relationship: "Ông" })).status, 422);
  assert.equal((await gui("/api/admin/hoc-sinh/khong-co/phu-huynh", "POST", { account: "0933000333", relationship: "Mẹ" })).status, 404);
  assert.equal((await gui("/api/admin/hoc-sinh/hs04/phu-huynh", "POST", { account: "admin@nshm.edu.vn", relationship: "Mẹ" })).status, 422);
});

test("số cũ sai người: xoá mật khẩu riêng, đăng xuất mọi thiết bị, số mới vào bằng chính số", async () => {
  const nguoiDangTrong = await server.loginCookie("0912000111", "123456");
  assert.equal((await lay("/api/students", nguoiDangTrong)).status, 200);

  const giuSoCu = await gui("/api/admin/phu-huynh/u_parent", "PATCH", { saiNguoi: true });
  assert.equal(giuSoCu.status, 422, "không nhập số đúng thì không được đặt lại — người cầm số cũ vào lại ngay");
  assert.equal((await lay("/api/students", nguoiDangTrong)).status, 200, "bị từ chối thì không đụng gì");

  const doi = await gui("/api/admin/phu-huynh/u_parent", "PATCH", { account: "0944000333", saiNguoi: true });
  assert.equal(doi.status, 200);
  assert.equal(doi.body.ketQua.saiNguoi, true);

  assert.equal((await lay("/api/students", nguoiDangTrong)).status, 401, "người đang ở trong phải bị đá ra");
  assert.equal((await server.login("0944000333", "123456")).status, 401, "mật khẩu riêng cũ không còn dùng được");
  const vao = await server.login("0944000333", "0944000333");
  assert.equal(vao.status, 200);
  assert.equal((await vao.json()).user.mustChangePassword, true, "phải đặt mật khẩu riêng ngay lần đầu");
});

test("nhập lại file cũ: em đã có bị bỏ qua, số cũ không sống lại, email sửa tay không bị đè", async () => {
  const TIEU_DE = ["Mã học sinh", "Họ và tên học sinh", "Ngày sinh", "Lớp", "Cấp học", "Họ tên bố", "Email bố", "SDT bố", "Họ tên mẹ", "SDT mẹ"];
  const files = [{
    key: "f1", label: "danh-ba-cu.xlsx",
    rows: [
      TIEU_DE,
      // hs01 với SỐ CŨ đã đổi đi và một email khác — đúng file cũ còn nằm trên máy giáo vụ.
      ["NSHM260301", "Nguyễn Minh An", "12/04/2017", "4A9", "Tiểu học", "", "", "", "Mai Lan", "0901234567"],
      ["NSHM-MOI-01", "Hoàng Thu Trang", "01/02/2019", "1A1", "Tiểu học", "Hoàng Văn Nam", "nam@vd.vn", "0955000444", "", ""],
      // Em ruột MỚI của hs01 trong file cũ, vẫn mang số cũ đã đổi đi: không được tạo lại tài khoản.
      ["NSHM-MOI-02", "Nguyễn Minh Anh", "05/05/2020", "1A2", "Tiểu học", "", "", "", "Mai Lan", "0901234567"],
    ],
  }];

  const xem = await gui("/api/admin/directory/excel/preview", "POST", { mode: "bo-sung", files });
  assert.equal(xem.status, 200);
  assert.equal(xem.body.preview.studentsNew, 2);
  assert.equal(xem.body.preview.soDaDoi, 1);
  assert.deepEqual(xem.body.preview.emMatSoDaDoi, ["NSHM-MOI-02"]);
  assert.equal(xem.body.preview.studentsExisting, 1);
  assert.deepEqual(xem.body.preview.existingSample, ["NSHM260301"]);

  const ghi = await gui("/api/admin/directory/excel/commit", "POST", { mode: "bo-sung", files });
  assert.equal(ghi.status, 200);
  assert.equal(ghi.body.result.counters.studentsCreated, 2);
  assert.equal(ghi.body.result.counters.parentsRetiredSkipped, 1);
  assert.equal(ghi.body.result.counters.studentsExisting, 1);

  assert.equal((await server.login("0901234567", "0901234567")).status, 401, "số cũ không được tạo lại thành tài khoản");
  const an = await chiTiet("hs01");
  assert.equal(an.homeroom, "3A2", "file không sửa lớp của em đã có");
  assert.deepEqual(an.phuHuynh.map((item) => item.account), ["0944000333"]);
  assert.equal(an.phuHuynh[0].email, "mai.lan@gmail.com");

  const emMoi = (await lay("/api/admin/hoc-sinh?q=NSHM-MOI-01")).body.rows[0];
  assert.equal(emMoi.phuHuynh[0].account, "0955000444", "em mới vẫn được thêm kèm phụ huynh");
  assert.equal(emMoi.phuHuynh[0].email, "nam@vd.vn");
  const emRuot = (await lay("/api/admin/hoc-sinh?q=NSHM-MOI-02")).body.rows[0];
  assert.deepEqual(emRuot.phuHuynh, [], "em ruột mới vào hệ thống mà không gắn số cũ");

  // Quản trị chủ động thêm lại một số đã đổi đi thì được — đó là quyết định có chủ ý.
  const themLai = await gui(`/api/admin/hoc-sinh/${emRuot.id}/phu-huynh`, "POST", { account: "0912000111", relationship: "Mẹ" });
  assert.equal(themLai.status, 201);
  assert.equal(themLai.body.ketQua.taoTaiKhoan, true);
});

test("hai quản trị bấm Lưu cùng lúc: cả hai đều được ghi, không ai nhận báo 'đang đồng bộ'", async () => {
  const [a, b] = await Promise.all([
    gui("/api/admin/phu-huynh/u_parent", "PATCH", { displayName: "Mai Lan A" }),
    gui(`/api/admin/phu-huynh/${(await chiTiet("hs03")).phuHuynh[0].userId}`, "PATCH", { displayName: "Lê Văn Bố B" }),
  ]);
  assert.deepEqual([a.status, b.status], [200, 200], JSON.stringify([a.body, b.body]));
});

test("đồng bộ Google Sheets đã khoá", async () => {
  const dongBo = await gui("/api/admin/integrations/google-sheets/sync", "POST", { confirmation: "SYNC_STUDENT_DIRECTORY" });
  assert.equal(dongBo.status, 403);
  assert.match(JSON.stringify(dongBo.body), /DONG_BO_GOOGLE_DA_KHOA/);
});

test("nhật ký thao tác không chứa số điện thoại hay email thật", async () => {
  const { body } = await gui("/api/admin/export/backup", "POST", { confirmation: "EXPORT_FULL_BACKUP", collection: "auditLogs" });
  const cuaManNay = body.page.rows.filter((row) => ["UPDATE_PARENT_CONTACT", "ADD_PARENT_CONTACT"].includes(row.action));
  assert.ok(cuaManNay.length >= 5, `phải ghi nhật ký cho mỗi lần sửa/thêm, có ${cuaManNay.length}`);
  const json = JSON.stringify(cuaManNay);
  for (const bi of ["0901234567", "0912000111", "0944000333", "0933000222", "mai.lan@gmail.com", "bo.khang@vd.vn", "Lê Văn Bố"]) {
    assert.ok(!json.includes(bi), `nhật ký lộ ${bi}`);
  }
  const saiNguoi = cuaManNay.find((row) => row.after?.dangXuatMoiThietBi);
  assert.ok(saiNguoi, "lần đánh dấu sai người phải để lại dấu vết");
});
