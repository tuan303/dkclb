// Nhà trường tự thêm học sinh vào lớp CLB.
//
// Màn này trước đây CỐ Ý không có nút thêm tay, vì thêm tay đi vòng qua kiểm tra sĩ
// số và bước thu phí. Nhà trường yêu cầu mở lại, nên những bài dưới đây tồn tại để
// khẳng định đường mới KHÔNG phải một ngõ tắt: nó tạo đơn thật và đi qua cùng bộ luật
// của cổng phụ huynh, cộng thêm chặn sĩ số.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
  TOI_THIEU_TU_KHOA, chonPhuHuynh, docKhoaTuBang, khoiCuaLop, khopKhoaVoiDanhBa, lapKeHoachThemNhieu,
  timHocSinh, tinhHaGhiDanhSan, xetThemVaoLop,
} from "../them-hoc-sinh-vao-lop.mjs";

const em = (id, name, grade, extra = {}) => ({ id, name, grade, code: `MA${id}`, status: "active", ...extra });
const LOP = {
  id: "l1", clubId: "c1", capacity: 20, periodId: "p1",
  dayOfWeek: 2, startTime: "16:15", endTime: "17:30", grades: [1, 2, 3],
};
const don = (classId, clubId, status, extra = {}) => ({ classId, clubId, status, periodId: "p1", ...extra });

test("tìm theo mã, họ tên và lớp hành chính, bỏ dấu được", () => {
  const ds = [em("1", "Nguyễn Minh An", 3, { code: "NSHM260301", homeroom: "3A2" })];
  for (const tuKhoa of ["minh an", "MINH AN", "nshm2603", "3a2", "Nguyễn"]) {
    assert.equal(timHocSinh(ds, tuKhoa).length, 1, `không tìm được với "${tuKhoa}"`);
  }
  assert.deepEqual(timHocSinh(ds, "không có"), []);
});

test("từ khoá quá ngắn thì không trả gì — tránh đổ cả danh bạ xuống trình duyệt", () => {
  const ds = [em("1", "An", 3)];
  assert.deepEqual(timHocSinh(ds, "a"), []);
  assert.equal(TOI_THIEU_TU_KHOA, 2);
});

test("tìm kiếm bỏ qua em đã nghỉ học, trừ khi hỏi riêng", () => {
  const ds = [em("1", "Nguyễn Minh An", 3, { status: "inactive" })];
  assert.deepEqual(timHocSinh(ds, "minh an"), []);
  assert.equal(timHocSinh(ds, "minh an", { keCaDaNghi: true }).length, 1);
});

test("tìm kiếm có trần số kết quả", () => {
  const ds = Array.from({ length: 50 }, (_, i) => em(String(i), `Nguyễn Văn ${i}`, 3));
  assert.equal(timHocSinh(ds, "nguyen van").length, 20);
});

test("em hợp lệ thì thêm được", () => {
  const xet = xetThemVaoLop({ hocSinh: em("1", "An", 3), lop: LOP, clb: {}, donCuaEm: [], siSoDangDung: 0 });
  assert.equal(xet.ketCuc, "themDuoc");
});

test("em đã nghỉ học thì không thêm được", () => {
  const xet = xetThemVaoLop({ hocSinh: em("1", "An", 3, { status: "inactive" }), lop: LOP, clb: {}, donCuaEm: [] });
  assert.equal(xet.ketCuc, "hocSinhNghiHoc");
});

test("đã có đơn ở đúng lớp này thì chặn — hai đơn là hai lần thu phí", () => {
  const xet = xetThemVaoLop({
    hocSinh: em("1", "An", 3), lop: LOP, clb: {},
    donCuaEm: [don("l1", "c1", "confirmed")],
  });
  assert.equal(xet.ketCuc, "daCoDon");
});

test("đơn đã huỷ thì KHÔNG tính là trùng, em đăng ký lại được", () => {
  const xet = xetThemVaoLop({
    hocSinh: em("1", "An", 3), lop: LOP, clb: {},
    donCuaEm: [don("l1", "c1", "cancelled")],
  });
  assert.equal(xet.ketCuc, "themDuoc");
});

test("trùng khung giờ với lớp khác thì chặn, và nói rõ lớp nào", () => {
  const xet = xetThemVaoLop({
    hocSinh: em("1", "An", 3), lop: LOP, clb: {},
    donCuaEm: [don("l9", "c9", "confirmed", {
      dayOfWeek: 2, startTime: "16:00", endTime: "17:00", clubName: "Piano", scheduleLabel: "Thứ 3 · 16:00–17:00",
    })],
  });
  assert.equal(xet.ketCuc, "trungGio");
  assert.match(xet.thongBao, /Piano/);
});

test("lớp khác giờ thì không coi là trùng", () => {
  const xet = xetThemVaoLop({
    hocSinh: em("1", "An", 3), lop: LOP, clb: {},
    donCuaEm: [don("l9", "c9", "confirmed", { dayOfWeek: 2, startTime: "18:00", endTime: "19:00" })],
  });
  assert.equal(xet.ketCuc, "themDuoc");
});

test("sai khối thì chặn", () => {
  const xet = xetThemVaoLop({ hocSinh: em("1", "An", 9), lop: LOP, clb: {}, donCuaEm: [] });
  assert.equal(xet.ketCuc, "saiKhoi");
  assert.match(xet.thongBao, /khối 1, 2, 3/);
});

test("lớp chưa khai khối nào thì mở cho mọi khối", () => {
  const xet = xetThemVaoLop({ hocSinh: em("1", "An", 9), lop: { ...LOP, grades: [] }, clb: { grades: [] }, donCuaEm: [] });
  assert.equal(xet.ketCuc, "themDuoc");
});

test("khối riêng của lớp thắng khối của CLB", () => {
  assert.deepEqual(khoiCuaLop({ grades: [4, 5] }, { grades: [1, 2] }), [4, 5]);
  assert.deepEqual(khoiCuaLop({ grades: [] }, { grades: [1, 2] }), [1, 2]);
});

test("vượt hạn mức số CLB mỗi đợt thì chặn", () => {
  const donCuaEm = [
    don("x1", "cA", "confirmed", { dayOfWeek: 3, startTime: "16:15", endTime: "17:30" }),
    don("x2", "cB", "confirmed", { dayOfWeek: 4, startTime: "16:15", endTime: "17:30" }),
    don("x3", "cC", "confirmed", { dayOfWeek: 5, startTime: "16:15", endTime: "17:30" }),
  ];
  assert.equal(xetThemVaoLop({ hocSinh: em("1", "An", 3), lop: LOP, clb: {}, donCuaEm, maxClubsPerStudent: 3 }).ketCuc, "vuotHanMuc");
  // Thêm một lớp NỮA của CLB em đã học thì không tính là CLB mới (quyết định 11/09/2026).
  const cungClb = [...donCuaEm, don("x4", "c1", "confirmed", { dayOfWeek: 6, startTime: "16:15", endTime: "17:30" })];
  assert.equal(xetThemVaoLop({ hocSinh: em("1", "An", 3), lop: LOP, clb: {}, donCuaEm: cungClb, maxClubsPerStudent: 3 }).ketCuc, "themDuoc");
});

test("hạn mức chỉ đếm đơn trong CÙNG đợt", () => {
  const donCuaEm = [
    don("x1", "cA", "confirmed", { periodId: "p0", dayOfWeek: 3, startTime: "16:15", endTime: "17:30" }),
    don("x2", "cB", "confirmed", { periodId: "p0", dayOfWeek: 4, startTime: "16:15", endTime: "17:30" }),
    don("x3", "cC", "confirmed", { periodId: "p0", dayOfWeek: 5, startTime: "16:15", endTime: "17:30" }),
  ];
  assert.equal(xetThemVaoLop({ hocSinh: em("1", "An", 3), lop: LOP, clb: {}, donCuaEm, maxClubsPerStudent: 3 }).ketCuc, "themDuoc");
});

test("lớp đã đủ sĩ số thì CHẶN (quyết định 10/11/2026), không đẩy sang danh sách chờ", () => {
  const xet = xetThemVaoLop({ hocSinh: em("1", "An", 3), lop: { ...LOP, capacity: 2 }, clb: {}, donCuaEm: [], siSoDangDung: 2 });
  assert.equal(xet.ketCuc, "lopDaDay");
  assert.match(xet.thongBao, /nâng sĩ số tối đa/);
});

test("sĩ số cộng dồn TRONG một lượt: còn 2 chỗ thì em thứ ba bị chặn", () => {
  const danhBa = new Map([["a", em("a", "A", 3)], ["b", em("b", "B", 3)], ["c", em("c", "C", 3)]]);
  const keHoach = lapKeHoachThemNhieu({
    hocSinhIds: ["a", "b", "c"], danhBa, lop: { ...LOP, capacity: 2 }, clb: {}, siSoDangDung: 0,
  });
  assert.deepEqual(keHoach.ketQua.map((item) => item.ketCuc), ["themDuoc", "themDuoc", "lopDaDay"]);
  assert.equal(keHoach.themDuoc.length, 2);
  assert.equal(keHoach.siSoSau, 2);
});

test("chọn trùng em trong cùng một lượt chỉ tính một lần", () => {
  const danhBa = new Map([["a", em("a", "A", 3)]]);
  const keHoach = lapKeHoachThemNhieu({ hocSinhIds: ["a", "a"], danhBa, lop: LOP, clb: {} });
  assert.deepEqual(keHoach.ketQua.map((item) => item.ketCuc), ["themDuoc", "trungTrongLuot"]);
});

test("hạ ghi danh sẵn: chỉ khi trạng thái GIỮ CHỖ, và chỉ cho em chưa từng có đơn ở lớp đó", () => {
  // Em đã từng được nhập rồi bị huỷ đơn thì enrolled_base đã trừ cho em ấy một lần;
  // trừ tiếp là mở ra chỗ trống không có thật.
  assert.deepEqual(
    tinhHaGhiDanhSan({ trangThai: "confirmed", enrolledBaseHienTai: 5, studentIds: ["a", "b"], daTungCoDon: new Set(["b"]) }),
    { soHa: 1, enrolledBaseMoi: 4, thieuGhiDanhSan: false },
  );
  assert.deepEqual(
    tinhHaGhiDanhSan({ trangThai: "payment", enrolledBaseHienTai: 5, studentIds: ["a", "b"] }),
    { soHa: 0, enrolledBaseMoi: 5, thieuGhiDanhSan: false },
    "trạng thái chưa giữ chỗ mà vẫn hạ là sĩ số tụt xuống thật",
  );
});

test("ghi danh sẵn không đủ để trừ thì nói ra, không âm thầm", () => {
  const ketQua = tinhHaGhiDanhSan({ trangThai: "confirmed", enrolledBaseHienTai: 1, studentIds: ["a", "b", "c"] });
  assert.equal(ketQua.soHa, 1);
  assert.equal(ketQua.enrolledBaseMoi, 0);
  assert.equal(ketQua.thieuGhiDanhSan, true, "sĩ số sẽ tăng thật, phải báo");
});

test("phụ huynh gắn vào đơn chọn theo thứ tự ỔN ĐỊNH, và đếm em có nhiều phụ huynh", () => {
  const { theoHocSinh, soPhuHuynh } = chonPhuHuynh([
    { parentUserId: "u9", studentId: "hs1" },
    { parentUserId: "u2", studentId: "hs1" },
    { parentUserId: "u5", studentId: "hs2" },
  ]);
  assert.equal(theoHocSinh.get("hs1"), "u2", "chạy lại phải ra cùng một người");
  assert.equal(soPhuHuynh.get("hs1"), 2);
  assert.equal(theoHocSinh.get("hs3"), undefined);
});

test("dò cột từ file có hàng tiêu đề: lấy đúng cột mã, bỏ hàng tiêu đề", () => {
  const ketQua = docKhoaTuBang([
    ["Danh sách lớp Bóng đá cơ bản"],
    ["STT", "Mã học sinh", "Họ và tên", "Lớp"],
    ["1", "NSHM01", "Nguyễn Văn A", "3A1"],
    ["2", "NSHM02", "Trần Thị B", "3A2"],
  ]);
  assert.equal(ketQua.coTieuDe, true);
  assert.equal(ketQua.cot, "ma");
  assert.deepEqual(ketQua.khoa, ["NSHM01", "NSHM02"]);
});

test("file chỉ có cột họ tên cũng dò được", () => {
  const ketQua = docKhoaTuBang([["Họ và tên"], ["Nguyễn Văn A"], ["Trần Thị B"]]);
  assert.equal(ketQua.cot, "ten");
  assert.deepEqual(ketQua.khoa, ["Nguyễn Văn A", "Trần Thị B"]);
});

test("file không có tiêu đề thì lấy ô đầu tiên có chữ của mỗi dòng", () => {
  const ketQua = docKhoaTuBang([["NSHM01"], [""], ["NSHM02"]]);
  assert.equal(ketQua.coTieuDe, false);
  assert.deepEqual(ketQua.khoa, ["NSHM01", "NSHM02"]);
});

test("file rỗng thì ra danh sách rỗng, không nổ", () => {
  assert.deepEqual(docKhoaTuBang([]).khoa, []);
  assert.deepEqual(docKhoaTuBang([[""], [null]]).khoa, []);
});

test("khớp mã chính xác trước, rồi mới tới họ tên bỏ dấu", () => {
  const danhBa = [
    { id: "1", code: "NSHM01", name: "Nguyễn Văn A" },
    { id: "2", code: "NSHM02", name: "Trần Thị B" },
  ];
  const ketQua = khopKhoaVoiDanhBa(["nshm01", "tran thi b", "Không Có Ai"], danhBa);
  assert.deepEqual(ketQua.khop.map((em) => em.id), ["1", "2"]);
  assert.deepEqual(ketQua.khongKhop, ["Không Có Ai"]);
});

test("tên trùng nhiều em thì KHÔNG chọn hộ — xếp nhầm lớp cho một em có thật", () => {
  const danhBa = [
    { id: "1", code: "A1", name: "Trần Thị B" },
    { id: "2", code: "A2", name: "Trần Thị B" },
  ];
  const ketQua = khopKhoaVoiDanhBa(["Trần Thị B"], danhBa);
  assert.deepEqual(ketQua.khop, []);
  assert.deepEqual(ketQua.nhieuNguoi, [{ khoa: "Trần Thị B", so: 2 }]);
});

test("cùng một em xuất hiện hai lần trong file chỉ tính một", () => {
  const danhBa = [{ id: "1", code: "NSHM01", name: "Nguyễn Văn A" }];
  const ketQua = khopKhoaVoiDanhBa(["NSHM01", "Nguyễn Văn A"], danhBa);
  assert.equal(ketQua.khop.length, 1);
});
