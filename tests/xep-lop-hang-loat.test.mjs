// Đọc file kết quả Google Form để xếp học sinh vào ca học.
//
// Nhà trường đã mở một đợt đăng ký qua Google Form trước khi có cổng này: vài trăm
// em đã đóng phí và đang học thật, nhưng hệ thống chưa có đơn nào của các em đó.
//
// Rủi ro lớn nhất của tính năng này KHÔNG phải đọc sai file, mà là ĐOÁN LIỀU: một
// CLB có hai ca mà máy tự chọn hộ thì cả trăm em vào sai buổi, và không ai phát hiện
// cho tới lúc giáo viên điểm danh. Phần lớn tệp này canh đúng ranh giới đó.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DONG_XEP_LOP, chuanHoaSdt, detectXepLopMapping, doanCaHoc, docFileXepLop, gomOChonClb,
} from "../xep-lop-import.mjs";

// Đúng hình dạng file Google Form xuất ra: cột dấu thời gian ở đầu, tiêu đề hàng 1.
const TIEU_DE = ["Dấu thời gian", "Mã học sinh", "Họ và tên học sinh", "Số điện thoại", "Email", "CLB đăng ký"];
const dong = (ma, ten, clb, sdt = "0901234567") => ["01/09/2026 10:12", ma, ten, sdt, "me@vd.vn", clb];
const fileMau = () => [
  TIEU_DE,
  dong("NSHM260301", "Nguyễn Minh An", "Piano nhập môn"),
  dong("NSHM260601", "Nguyễn Gia Hân", "Guitar · Ca 1"),
];

const CA_HOC = [
  { id: "piano", clubName: "Piano nhập môn", className: "" },
  { id: "guitar1", clubName: "Guitar", className: "Ca 1" },
  { id: "guitar2", clubName: "Guitar", className: "Ca 2" },
];

/* ---------- Nhận diện cột ---------- */

test("nhận đúng cột của file Google Form, bỏ qua cột dấu thời gian", () => {
  const { mapping, missing } = detectXepLopMapping(TIEU_DE);
  assert.deepEqual(missing, []);
  assert.equal(mapping.studentCode.header, "Mã học sinh");
  assert.equal(mapping.clubText.header, "CLB đăng ký");
  assert.equal(mapping.phone.header, "Số điện thoại");
});

test("chỉ mã học sinh và ô chọn CLB là bắt buộc", () => {
  // Tên, điện thoại, email chỉ để đối chiếu cho người đọc yên tâm. Thiếu chúng vẫn
  // xếp lớp được, vì mã học sinh mới là thứ dò ra đúng em.
  const { missing } = detectXepLopMapping(["Mã HS", "CLB"]);
  assert.deepEqual(missing, []);
});

test("thiếu mã học sinh thì từ chối cả file, nói rõ thiếu gì", () => {
  // Tên học sinh trong cơ sở dữ liệu được mã hoá nên KHÔNG tra ngược được; không có
  // mã thì không có cách nào dò ra em nào. Thà từ chối còn hơn xếp nhầm.
  const ketQua = docFileXepLop({ rows: [["Họ và tên học sinh", "CLB đăng ký"], ["Nguyễn Minh An", "Piano nhập môn"]] });
  assert.equal(ketQua.ok, false);
  assert.match(ketQua.error, /Thiếu cột bắt buộc.*Mã học sinh/);
});

test("file có một hàng thừa phía trên tiêu đề vẫn đọc được", () => {
  const ketQua = docFileXepLop({ rows: [["KẾT QUẢ ĐĂNG KÝ CLB HỌC KỲ I", "", "", "", "", ""], ...fileMau()] });
  assert.equal(ketQua.ok, true);
  assert.equal(ketQua.headerRow, 2, "phải nói đã lấy hàng nào làm tiêu đề");
  assert.equal(ketQua.rows.length, 2);
});

/* ---------- Đọc dòng ---------- */

test("dòng hỏng KHÔNG bị vứt đi im lặng, mà kèm lý do", () => {
  // Nuốt mất dòng hỏng là cách chắc chắn nhất để vài em không bao giờ vào lớp mà
  // không ai biết. Màn xem trước phải nói được "312 dòng, xếp được 305, 7 dòng này".
  const ketQua = docFileXepLop({ rows: [
    TIEU_DE,
    dong("NSHM260301", "Nguyễn Minh An", "Piano nhập môn"),
    dong("", "Không có mã", "Piano nhập môn"),
    dong("NSHM260999", "Thiếu ô chọn", ""),
  ] });
  assert.equal(ketQua.rows.length, 3, "cả ba dòng phải còn trong kết quả");
  assert.equal(ketQua.rows[0].loi, null);
  assert.equal(ketQua.rows[1].loi, "Thiếu mã học sinh");
  assert.equal(ketQua.rows[2].loi, "Thiếu ô chọn CLB");
});

test("số hàng báo ra khớp số hàng người dùng thấy trong Excel", () => {
  // Báo "dòng 3" mà trong Excel là dòng 5 thì người sửa file đi tìm nhầm chỗ.
  const ketQua = docFileXepLop({ rows: fileMau() });
  assert.equal(ketQua.rows[0].dong, 2, "dòng dữ liệu đầu tiên nằm ngay dưới tiêu đề hàng 1");
  assert.equal(ketQua.rows[1].dong, 3);
});

test("hàng trống hoàn toàn thì bỏ qua, không tính là dòng hỏng", () => {
  const ketQua = docFileXepLop({ rows: [TIEU_DE, dong("NSHM260301", "A", "Piano nhập môn"), ["", "", "", "", "", ""]] });
  assert.equal(ketQua.rows.length, 1);
});

test("file rỗng không bị hiểu thành không có em nào đăng ký", () => {
  const ketQua = docFileXepLop({ rows: [] });
  assert.equal(ketQua.ok, false);
  assert.match(ketQua.error, /rỗng/);
});

test("chặn file quá lớn", () => {
  const nhieu = [TIEU_DE, ...Array.from({ length: MAX_DONG_XEP_LOP + 1 }, () => dong("NSHM1", "A", "Piano nhập môn"))];
  const ketQua = docFileXepLop({ rows: nhieu });
  assert.equal(ketQua.ok, false);
  assert.match(ketQua.error, /vượt giới hạn/);
});

/* ---------- Số điện thoại ---------- */

test("số điện thoại chuẩn hoá được về dạng so khớp với tài khoản phụ huynh", () => {
  // Tài khoản phụ huynh chính là số điện thoại. Form thì nhận đủ kiểu người ta gõ.
  assert.equal(chuanHoaSdt("0901234567"), "0901234567");
  assert.equal(chuanHoaSdt("090 123 4567"), "0901234567");
  assert.equal(chuanHoaSdt("+84901234567"), "0901234567");
  assert.equal(chuanHoaSdt("84901234567"), "0901234567");
  assert.equal(chuanHoaSdt("901234567"), "0901234567");
  assert.equal(chuanHoaSdt(""), "");
});

/* ---------- Ghép ô chọn của Form với ca học ---------- */

test("gom các ô chọn khác nhau lại, mỗi giá trị một lần, nhiều dòng nhất lên đầu", () => {
  // Vài trăm dòng nhưng chỉ vài chục giá trị: ghép là việc con người làm MỘT lần,
  // không phải máy đoán 312 lần.
  const ketQua = docFileXepLop({ rows: [
    TIEU_DE,
    dong("A", "a", "Piano nhập môn"), dong("B", "b", "Piano nhập môn"), dong("C", "c", "Guitar · Ca 1"),
  ] });
  const gom = gomOChonClb(ketQua.rows);
  assert.equal(gom.length, 2);
  assert.equal(gom[0].mau, "Piano nhập môn");
  assert.equal(gom[0].soDong, 2);
});

test("CLB chỉ có MỘT ca thì đoán được, kể cả khi người ta gõ không dấu", () => {
  assert.equal(doanCaHoc("Piano nhập môn", CA_HOC).classId, "piano");
  assert.equal(doanCaHoc("piano nhap mon", CA_HOC).classId, "piano");
});

test("CLB có HAI ca thì KHÔNG đoán, trả về hai ứng viên để người vận hành chọn", () => {
  // Đây là bài quan trọng nhất tệp này. Đoán liều ở đây là xếp cả trăm em vào sai
  // buổi, mà sai kiểu đó không lộ ra cho tới khi giáo viên gọi tên.
  const ketQua = doanCaHoc("Guitar", CA_HOC);
  assert.equal(ketQua.classId, null, "không được tự chọn hộ khi có hai ca");
  assert.deepEqual(ketQua.ungVien.map((ca) => ca.id), ["guitar1", "guitar2"]);
});

test("ô chọn ghi rõ ca thì ghép đúng ca đó", () => {
  assert.equal(doanCaHoc("Guitar · Ca 2", CA_HOC).classId, "guitar2");
});

test("ô chọn không khớp CLB nào thì nói thẳng là không có ứng viên", () => {
  const ketQua = doanCaHoc("Cờ vua", CA_HOC);
  assert.equal(ketQua.classId, null);
  assert.deepEqual(ketQua.ungVien, []);
});

/* ---------- Chạy thật qua HTTP ---------- */

import { after, before } from "node:test";
import { startTestServer } from "./helpers/test-server.mjs";

let server;
let quanTri;
let phuHuynh;
let dotId;

before(async () => {
  server = await startTestServer({ prefix: "nshm-xeplop-" });
  quanTri = await server.loginCookie("admin@nshm.edu.vn", "Admin@123");
  phuHuynh = await server.loginCookie("0901234567", "123456");
  dotId = (await (await server.request("/api/admin/periods", quanTri)).json())
    .periods.find((item) => item.status === "open").id;
});

after(async () => server.stop());

const fileForm = (...dongs) => ({ label: "form.xlsx", rows: [["Mã học sinh", "CLB đăng ký"], ...dongs] });
const goiNhap = (duong, body, cookie = quanTri) => server.request(`/api/admin/registrations/import/${duong}`, cookie,
  { method: "POST", body: JSON.stringify({ periodId: dotId, ...body }) });
const caPainting = async () => (await (await server.request("/api/admin/catalog", quanTri)).json())
  .classes.find((row) => row.id === "painting");

test("nhập vào KHÔNG làm sĩ số phồng lên gấp đôi", async () => {
  // Đây là bài quan trọng nhất tệp này. Các em trong file ĐANG được đếm ở
  // enrolled_base ("ghi danh sẵn ngoài hệ thống"); nhập thành đơn mà không hạ con
  // số đó xuống là đếm hai lần. Đã đo trên máy chủ thật trước khi vá: ca sức chứa
  // 20, base 15, nhập 5 đơn thì hệ thống báo 20/20 "đã đầy".
  const truoc = await caPainting();
  assert.ok(truoc.enrolledBase >= 2, `ca mẫu phải có ghi danh sẵn, đang là ${truoc.enrolledBase}`);

  const body = { files: [fileForm(["NSHM260301", "Mỹ thuật sáng tạo"], ["NSHM260601", "Mỹ thuật sáng tạo"])] };
  const xem = (await (await goiNhap("preview", body)).json()).preview;
  assert.equal(xem.dem.xepDuoc, 2);
  assert.equal(xem.caAnhHuong[0].enrolledBaseDeXuat, truoc.enrolledBase - 2,
    "màn xem trước phải nói trước con số ghi danh sẵn sẽ hạ xuống bao nhiêu");
  assert.equal(xem.caAnhHuong[0].siSoSauNeuHaBase, xem.caAnhHuong[0].siSoTruoc);
  assert.equal(xem.caAnhHuong[0].siSoSauNeuGiuBase, xem.caAnhHuong[0].siSoTruoc + 2,
    "và nói luôn nếu KHÔNG hạ thì sĩ số phồng lên bao nhiêu");

  const ghi = await goiNhap("commit", { ...body, confirmation: "NHAP_DANG_KY_HANG_LOAT" });
  const than = await ghi.text();
  assert.equal(ghi.status, 200, than);
  assert.equal(JSON.parse(than).result.daTao, 2);

  const sau = await caPainting();
  assert.equal(sau.enrolled, truoc.enrolled, "sĩ số phải KHÔNG đổi: hai em này vốn đã được đếm rồi");
  assert.equal(sau.enrolledBase, truoc.enrolledBase - 2);
  assert.equal(sau.activeRegistrations, truoc.activeRegistrations + 2);
});

test("chạy lại đúng file đó KHÔNG tạo đơn trùng", async () => {
  // Không có khoá idempotency nào trong hệ thống; chống trùng dựa vào luật "em này
  // đã có đơn còn hiệu lực cho ca đó". Bấm ghi hai lần vì mạng chậm là chuyện sẽ
  // xảy ra với một lần nhập vài trăm dòng.
  const body = { files: [fileForm(["NSHM260301", "Mỹ thuật sáng tạo"], ["NSHM260601", "Mỹ thuật sáng tạo"])] };
  const xem = (await (await goiNhap("preview", body)).json()).preview;
  assert.equal(xem.dem.daCoDon, 2, "cả hai dòng phải bị nhận ra là đã có đơn");
  assert.equal(xem.dem.xepDuoc, undefined);
  assert.equal(xem.sanSang, false, "không còn dòng nào xếp được thì không cho bấm ghi");

  const ghi = await goiNhap("commit", { ...body, confirmation: "NHAP_DANG_KY_HANG_LOAT" });
  assert.equal(ghi.status, 422);
  assert.equal((await ghi.json()).error.code, "IMPORT_NOT_READY");
});

test("đơn nhập vào gắn đúng phụ huynh, không thì cả trăm gia đình không thấy đơn của con", async () => {
  // parent_user_id để trống thì không màn nào vỡ, nhưng nó là BỘ LỌC DUY NHẤT của
  // màn "Đăng ký của tôi" — đã đo: mẹ của một em không thấy đơn của chính con mình.
  const cuaPhuHuynh = (await (await server.request("/api/registrations", phuHuynh)).json()).registrations;
  const don = cuaPhuHuynh.find((row) => row.classId === "painting");
  assert.ok(don, "phụ huynh phải thấy đơn vừa nhập cho con mình trong cổng");
  assert.equal(don.status, "dang_hoc");
  assert.equal(don.feePaid, true, "các em này đã đóng phí, cột đã thu tiền phải ghi nhận");
});

test("trùng giờ với CLB em ấy đã học thì không xếp, nói rõ trùng với ca nào", async () => {
  const trung = (await (await goiNhap("preview", {
    files: [fileForm(["NSHM260301", "Bóng rổ nền tảng"])],
  })).json()).preview;
  const dong = trung.rows[0];
  assert.equal(dong.ketCuc, "trungGio", `mong đợi trùng giờ, nhận được ${dong.ketCuc}: ${dong.lyDo}`);
  assert.match(dong.lyDo, /Trùng giờ với/);
});

test("giáo vụ không nhập đăng ký hàng loạt được", async () => {
  // Tạo đơn thay học sinh là cùng loại việc với xác nhận phí và đổi trạng thái —
  // đều do quyền duyet-don gác, mà giáo vụ không có.
  const giaoVu = await server.loginCookie("giaovu@nshm.edu.vn", "Admin@123");
  const body = { files: [fileForm(["NSHM260301", "Mỹ thuật sáng tạo"])] };
  assert.equal((await goiNhap("preview", body, giaoVu)).status, 403);
  assert.equal((await goiNhap("commit", { ...body, confirmation: "NHAP_DANG_KY_HANG_LOAT" }, giaoVu)).status, 403);
});

test("bấm nhầm nút không đủ để ghi vài trăm đơn", async () => {
  const ghi = await goiNhap("commit", { files: [fileForm(["NSHM260301", "Mỹ thuật sáng tạo"])] });
  assert.equal(ghi.status, 422);
  assert.equal((await ghi.json()).error.code, "IMPORT_CONFIRMATION_REQUIRED");
});
