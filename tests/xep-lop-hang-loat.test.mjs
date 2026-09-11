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
