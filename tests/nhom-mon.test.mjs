// Luật của danh mục khai báo "Nhóm môn".
//
// Phần nguy hiểm nhất ở đây là ĐỔI TÊN: club.category là chữ chứ không phải khoá
// ngoại, nên đổi tên nhóm là sửa dữ liệu hàng loạt trên bảng clubs. Sai một nhịp là
// cổng phụ huynh mọc ra hai nút lọc gần giống nhau, hoặc CLB mang một nhóm không còn
// trong danh mục. Vì vậy mọi nhánh của lapKeHoachDoiTen đều có test riêng.
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  MAX_SO_NHOM, chuanHoaTenNhom, clbLechChinhTa, clbTheoNhom, docYeuCauNhom, ghepDanhMucNhom,
  khoaNhom, kiemTrungKhiTao, lapKeHoachDoiTen, lapKeHoachXoa, nhomTuClubs, timNhomTrung,
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

test("tên y hệt nhưng có CLB ghi lệch dấu thì bấm Lưu vẫn phải chuẩn hoá", () => {
  // Nếu nhánh này trả clubIds rỗng thì người dùng KHÔNG có cách nào sửa: màn Khai báo
  // hiện một nhóm duy nhất, mà cổng phụ huynh lại hiện hai nút lọc gần giống nhau.
  const clubs = [clb("c1", "Bóng đá", "Thể thao"), clb("c2", "Bóng rổ", "THỂ THAO")];
  const keHoach = lapKeHoachDoiTen({ nhom: BON_NHOM[0], tenMoi: "Thể thao", clubs, danhSach: BON_NHOM });
  assert.equal(keHoach.kieu, "chuan-hoa");
  assert.deepEqual(keHoach.clubIds, ["c2"], "chỉ ghi lại CLB đang lệch, không ghi lại CLB đã đúng");
});

test("tên y hệt và mọi CLB đã ghi đúng thì không đụng gì", () => {
  const clubs = [clb("c1", "Bóng đá", "Thể thao")];
  const keHoach = lapKeHoachDoiTen({ nhom: BON_NHOM[0], tenMoi: "Thể thao", clubs, danhSach: BON_NHOM });
  assert.equal(keHoach.kieu, "khong-doi");
  assert.deepEqual(keHoach.clubIds, []);
});

test("đổi tên sang tên của nhóm CHƯA KHAI BÁO cũng là gộp, phải xác nhận", () => {
  // Nhóm chưa khai báo không có dòng trong danh mục nhưng vẫn là một nhóm thật đang
  // có CLB. Bỏ qua nó là hút CLB của người khác vào mà không ai được hỏi.
  const clubs = [clb("c1", "Bóng đá", "Thể thao"), clb("c9", "Võ cổ truyền", "Võ thuật")];
  const daGhep = ghepDanhMucNhom(BON_NHOM, clubs);
  assert.throws(
    () => lapKeHoachDoiTen({ nhom: BON_NHOM[0], tenMoi: "Võ thuật", clubs, danhSach: daGhep }),
    (error) => error.code === "NHOM_CAN_XAC_NHAN_GOP" && error.message.includes("chưa khai báo"),
  );
  const keHoach = lapKeHoachDoiTen({ nhom: BON_NHOM[0], tenMoi: "Võ thuật", clubs, danhSach: daGhep, choPhepGop: true });
  assert.equal(keHoach.kieu, "gop");
  assert.equal(keHoach.gopVaoId, null, "nhóm đích chưa khai báo thì không có dòng nào để xoá");
  assert.deepEqual(keHoach.clubIds, ["c1"], "CLB của nhóm đích đã ghi đúng chữ, không cần ghi lại");
});

test("gộp cũng chuẩn hoá luôn CLB của nhóm đích đang ghi lệch dấu", () => {
  const clubs = [clb("c1", "Bóng đá", "Thể thao"), clb("c5", "Cờ vua", "HỌC THUẬT")];
  const keHoach = lapKeHoachDoiTen({ nhom: BON_NHOM[0], tenMoi: "Học thuật", clubs, danhSach: BON_NHOM, choPhepGop: true });
  assert.deepEqual(keHoach.clubIds.sort(), ["c1", "c5"]);
  assert.equal(keHoach.soClbChuyen, 1, "câu báo cho người dùng chỉ đếm CLB thật sự CHUYỂN nhóm");
});

test("câu xác nhận gộp nói rõ khi nhóm đích đang ẩn", () => {
  const danhSach = [BON_NHOM[0], { ...BON_NHOM[3], active: false }];
  assert.throws(
    () => lapKeHoachDoiTen({ nhom: BON_NHOM[0], tenMoi: "Học thuật", clubs: [], danhSach }),
    (error) => error.message.includes("đang ẩn"),
  );
});

test("clbLechChinhTa chỉ nhặt CLB cùng nhóm nhưng khác chuỗi", () => {
  const clubs = [clb("c1", "A", "Thể thao"), clb("c2", "B", "thể thao"), clb("c3", "C", "Nghệ thuật")];
  assert.deepEqual(clbLechChinhTa("Thể thao", clubs).map((club) => club.id), ["c2"]);
});

test("bản sao khoá nhóm môn trong app.js khớp từng ký tự với khoaNhom", async () => {
  // app.js nạp bằng thẻ <script> thường nên không import được nhom-mon.mjs. Hai bản
  // lệch nhau thì máy chủ gom hai cách viết thành một nhóm còn bảng quản trị tách
  // thành hai khối — đếm lệch nhau ngay trên cùng một màn hình.
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const dau = app.indexOf("const khoaNhomMon = ");
  assert.ok(dau > 0, "public/app.js không còn khoaNhomMon");
  const nguon = app.slice(dau, app.indexOf(";", app.indexOf(".trim()", dau)) + 1);
  const banTrinhDuyet = new Function(`${nguon} return khoaNhomMon;`)();
  for (const mau of [
    "Thể thao", "THỂ THAO", "Kỹ năng & Công nghệ", "Kỹ năng - Công nghệ", "Nghệ Thuật",
    "Học thuật", "  nhiều   dấu  cách  ", "Đá cầu", "", null, undefined, "***",
  ]) {
    assert.equal(banTrinhDuyet(mau), khoaNhom(mau), `lệch ở "${mau}"`);
  }
});

test("màn Khai báo hiện đủ ba tầng Nhóm môn → CLB → Lớp", async () => {
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const khoi = app.slice(app.indexOf("function renderKhaiBaoClb("), app.indexOf("async function taiKhaiBao("));
  assert.match(khoi, /lopCuaClb\(club\.id\)/, "dòng CLB phải liệt kê lớp của nó");
  assert.match(khoi, /renderKhaiBaoLop/, "thiếu tầng lớp");
  assert.match(khoi, /data-kb-them-lop/, "thiếu nút thêm lớp");
  assert.match(khoi, /data-kb-sua-lop/, "thiếu nút sửa lớp");
  // Lớp đếm theo MỌI đợt và kể cả lớp đã ẩn — đúng tập mà phép xoá CLB xét, nếu
  // khác đi thì nút Xoá hiện ra rồi máy chủ mới chặn.
  assert.match(khoi, /filter\(\(row\) => row\.clubId === clubId\)/);
  assert.doesNotMatch(khoi, /row\.active !== false/, "không được lọc lớp đã ẩn khi đếm");
});

test("tầng Lớp dùng lại form của màn CLB & lịch học, không dựng form thứ hai", async () => {
  // Form đó mang sẵn các lá chắn: không hạ sĩ số dưới số chỗ đã dùng, không trùng
  // phòng cùng khung giờ, không ngừng mở lớp đang có đơn. Dựng form riêng là mất hết.
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const bind = app.slice(app.indexOf("function bindKhaiBaoNoiDung("), app.indexOf("function moFormNhomMon("));
  assert.match(bind, /data-kb-them-lop[\s\S]*openClassForm\(null, el\.dataset\.kbThemLop\)/);
  assert.match(bind, /data-kb-sua-lop[\s\S]*openClassForm\(el\.dataset\.kbSuaLop\)/);
  assert.equal(app.split("id=\"class-form\"").length - 1, 1, "chỉ được có MỘT form lớp trong toàn bộ app.js");
});
