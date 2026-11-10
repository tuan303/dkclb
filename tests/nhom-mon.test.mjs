// Luật của danh mục khai báo "Nhóm môn".
//
// Phần nguy hiểm nhất ở đây là ĐỔI TÊN: club.category là chữ chứ không phải khoá
// ngoại, nên đổi tên nhóm là sửa dữ liệu hàng loạt trên bảng clubs. Sai một nhịp là
// cổng phụ huynh mọc ra hai nút lọc gần giống nhau, hoặc CLB mang một nhóm không còn
// trong danh mục. Vì vậy mọi nhánh của lapKeHoachDoiTen đều có test riêng.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
  MAX_SO_NHOM, chuanHoaTenNhom, clbTheoNhom, docYeuCauNhom, ghepDanhMucNhom, khoaNhom,
  kiemTrungKhiTao, lapKeHoachDoiTen, lapKeHoachXoa, nhomTuClubs, timNhomTrung,
} from "../nhom-mon.mjs";

const nhom = (id, name, extra = {}) => ({ id, name, sortOrder: 0, active: true, ...extra });
const clb = (id, name, category, active = true) => ({ id, name, category, active });

const BON_NHOM = [
  nhom("n1", "Thể thao", { sortOrder: 0 }),
  nhom("n2", "Nghệ Thuật", { sortOrder: 1 }),
  nhom("n3", "Kỹ năng & Công nghệ", { sortOrder: 2 }),
  nhom("n4", "Học thuật", { sortOrder: 3 }),
];

test("tên nhóm: gộp khoảng trắng thừa, từ chối ô trống và tên chỉ có ký tự lạ", () => {
  assert.equal(chuanHoaTenNhom("  Thể   thao  "), "Thể thao");
  assert.throws(() => chuanHoaTenNhom("   "), { code: "NHOM_TEN_REQUIRED" });
  assert.throws(() => chuanHoaTenNhom("***"), { code: "NHOM_TEN_REQUIRED" });
  assert.throws(() => chuanHoaTenNhom("x".repeat(61)), { code: "NHOM_TEN_TOO_LONG" });
});

test("khoá so trùng bỏ dấu, bỏ hoa thường và bỏ cả dấu &", () => {
  assert.equal(khoaNhom("Nghệ Thuật"), khoaNhom("nghe thuat"));
  assert.equal(khoaNhom("Kỹ năng & Công nghệ"), "ky nang cong nghe");
  // "và" viết ra chữ thì KHÁC "&" — cố ý, gộp nhầm hai nhóm tệ hơn để người dùng tự gộp.
  assert.notEqual(khoaNhom("Kỹ năng & Công nghệ"), khoaNhom("Kỹ năng và Công nghệ"));
});

test("tạo mới trùng tên bị chặn dù gõ khác dấu hay khác hoa thường", () => {
  assert.throws(() => kiemTrungKhiTao("nghe thuat", BON_NHOM), { code: "NHOM_DA_CO" });
  assert.throws(() => kiemTrungKhiTao("THỂ THAO", BON_NHOM), { code: "NHOM_DA_CO" });
  assert.equal(kiemTrungKhiTao("Ngoại ngữ", BON_NHOM), "Ngoại ngữ");
});

test("danh mục có trần, không cho nhập cả một bảng vào đây", () => {
  const nhieu = Array.from({ length: MAX_SO_NHOM }, (_, i) => nhom(`n${i}`, `Nhóm ${i}`));
  assert.throws(() => kiemTrungKhiTao("Nhóm mới", nhieu), { code: "NHOM_QUA_NHIEU" });
});

test("đổi tên thường: trả đúng danh sách CLB phải đổi theo", () => {
  const clubs = [clb("c1", "Bóng đá", "Thể thao"), clb("c2", "Bóng rổ", "Thể thao"), clb("c3", "Vẽ", "Nghệ Thuật")];
  const keHoach = lapKeHoachDoiTen({ nhom: BON_NHOM[0], tenMoi: "Thể thao & Vận động", clubs, danhSach: BON_NHOM });
  assert.equal(keHoach.kieu, "doi-ten");
  assert.deepEqual(keHoach.clubIds, ["c1", "c2"]);
  assert.equal(keHoach.tenMoi, "Thể thao & Vận động");
});

test("sửa chính tả (chỉ khác dấu) VẪN phải đẩy chữ mới xuống clubs", () => {
  // Không đẩy xuống thì danh mục ghi "Nghệ thuật" còn CLB vẫn ghi "Nghệ Thuật",
  // và phía phụ huynh hiện hai nút lọc gần giống hệt nhau.
  const clubs = [clb("c3", "Vẽ", "Nghệ Thuật")];
  const keHoach = lapKeHoachDoiTen({ nhom: BON_NHOM[1], tenMoi: "Nghệ thuật", clubs, danhSach: BON_NHOM });
  assert.equal(keHoach.kieu, "sua-chinh-ta");
  assert.deepEqual(keHoach.clubIds, ["c3"]);
});

test("tên y hệt thì không đụng gì vào clubs", () => {
  const clubs = [clb("c3", "Vẽ", "Nghệ Thuật")];
  const keHoach = lapKeHoachDoiTen({ nhom: BON_NHOM[1], tenMoi: "Nghệ Thuật", clubs, danhSach: BON_NHOM });
  assert.equal(keHoach.kieu, "khong-doi");
  assert.deepEqual(keHoach.clubIds, []);
});

test("đổi sang tên của nhóm KHÁC là gộp, phải xác nhận mới làm", () => {
  const clubs = [clb("c1", "Bóng đá", "Thể thao")];
  assert.throws(
    () => lapKeHoachDoiTen({ nhom: BON_NHOM[0], tenMoi: "Học thuật", clubs, danhSach: BON_NHOM }),
    { code: "NHOM_CAN_XAC_NHAN_GOP" },
  );
  const keHoach = lapKeHoachDoiTen({ nhom: BON_NHOM[0], tenMoi: "Học thuật", clubs, danhSach: BON_NHOM, choPhepGop: true });
  assert.equal(keHoach.kieu, "gop");
  assert.equal(keHoach.gopVaoId, "n4");
  // Giữ đúng cách viết của nhóm ĐÍCH, không mang cách viết người dùng vừa gõ sang.
  assert.equal(keHoach.tenMoi, "Học thuật");
  assert.deepEqual(keHoach.clubIds, ["c1"]);
});

test("câu báo khi cần xác nhận gộp phải nói rõ bao nhiêu CLB bị chuyển", () => {
  const clubs = [clb("c1", "Bóng đá", "Thể thao"), clb("c2", "Bóng rổ", "Thể thao")];
  assert.throws(
    () => lapKeHoachDoiTen({ nhom: BON_NHOM[0], tenMoi: "Học thuật", clubs, danhSach: BON_NHOM }),
    (error) => error.message.includes("2 CLB") && error.message.includes("không tự hoàn lại"),
  );
});

test("xoá nhóm đang có CLB dùng thì chặn và kể tên CLB", () => {
  const clubs = [clb("c1", "Bóng đá", "Thể thao")];
  assert.throws(() => lapKeHoachXoa({ nhom: BON_NHOM[0], clubs }), (error) =>
    error.code === "NHOM_DANG_DUOC_DUNG" && error.message.includes("Bóng đá"));
  assert.deepEqual(lapKeHoachXoa({ nhom: BON_NHOM[3], clubs }), { id: "n4", name: "Học thuật" });
});

test("xoá đếm cả CLB đang ẩn — ẩn không phải là bỏ", () => {
  const clubs = [clb("c1", "Bóng đá", "Thể thao", false)];
  assert.throws(() => lapKeHoachXoa({ nhom: BON_NHOM[0], clubs }), { code: "NHOM_DANG_DUOC_DUNG" });
});

test("CLB ghi lệch dấu vẫn được tính vào đúng nhóm", () => {
  const clubs = [clb("c1", "Bóng đá", "THỂ THAO"), clb("c2", "Bóng rổ", "the thao"), clb("c3", "Vẽ", "Nghệ Thuật")];
  assert.deepEqual(clbTheoNhom("Thể thao", clubs).map((club) => club.id), ["c1", "c2"]);
});

test("danh mục hiển thị gồm cả nhóm chưa khai báo lấy từ dữ liệu CLB", () => {
  const clubs = [clb("c1", "Bóng đá", "Thể thao"), clb("c2", "Cờ vua", "Trí tuệ"), clb("c3", "Vẽ", "Trí tuệ", false)];
  const danhMuc = ghepDanhMucNhom([BON_NHOM[0]], clubs);
  const triTue = danhMuc.find((item) => item.name === "Trí tuệ");
  assert.equal(triTue.daKhaiBao, false);
  assert.equal(triTue.soClb, 2);
  assert.equal(triTue.soClbHien, 1);
  const theThao = danhMuc.find((item) => item.name === "Thể thao");
  assert.equal(theThao.daKhaiBao, true);
  assert.equal(theThao.soClb, 1);
});

test("nhóm chưa khai báo luôn xếp sau nhóm đã khai báo", () => {
  const clubs = [clb("c2", "Cờ vua", "Trí tuệ")];
  const danhMuc = ghepDanhMucNhom(BON_NHOM, clubs);
  assert.equal(danhMuc.at(-1).name, "Trí tuệ");
  assert.deepEqual(danhMuc.slice(0, 4).map((item) => item.name), BON_NHOM.map((item) => item.name));
});

test("nạp lần đầu giữ nguyên cách viết của bản ghi gặp trước, không tự sửa chính tả", () => {
  const clubs = [clb("c1", "A", "Thể thao"), clb("c2", "B", "THỂ THAO"), clb("c3", "C", "Nghệ thuật")];
  assert.deepEqual(nhomTuClubs(clubs), ["Thể thao", "Nghệ thuật"]);
});

test("nạp lần đầu bỏ qua CLB không có nhóm môn", () => {
  assert.deepEqual(nhomTuClubs([clb("c1", "A", ""), clb("c2", "B", "   "), clb("c3", "C", "Thể thao")]), ["Thể thao"]);
});

test("đọc yêu cầu: thứ tự phải là số nguyên trong khoảng, mặc định bật hiển thị", () => {
  assert.deepEqual(docYeuCauNhom({ name: "Thể thao" }), { name: "Thể thao", emoji: "", sortOrder: 0, active: true });
  assert.equal(docYeuCauNhom({ name: "A", sortOrder: "12" }).sortOrder, 12);
  assert.throws(() => docYeuCauNhom({ name: "A", sortOrder: "-3" }), { code: "NHOM_SORT_INVALID" });
  assert.throws(() => docYeuCauNhom({ name: "A", sortOrder: "99999" }), { code: "NHOM_SORT_INVALID" });
});

test("sửa mà không gửi lại tên thì giữ nguyên tên cũ, không xoá trắng", () => {
  const cu = nhom("n1", "Thể thao", { emoji: "⚽", sortOrder: 5 });
  assert.deepEqual(docYeuCauNhom({ sortOrder: 7 }, { existing: cu }), { name: "Thể thao", emoji: "⚽", sortOrder: 7, active: true });
});

test("tìm nhóm trùng bỏ qua chính nó khi đang sửa", () => {
  assert.equal(timNhomTrung("Thể thao", BON_NHOM, { boQuaId: "n1" }), null);
  assert.equal(timNhomTrung("Thể thao", BON_NHOM)?.id, "n1");
});

test("không tìm thấy nhóm thì báo rõ thay vì ném lỗi khó hiểu", () => {
  assert.throws(() => lapKeHoachDoiTen({ nhom: null, tenMoi: "A" }), { code: "NHOM_NOT_FOUND" });
  assert.throws(() => lapKeHoachXoa({ nhom: null }), { code: "NHOM_NOT_FOUND" });
});
