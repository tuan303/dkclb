// Nhập danh bạ học sinh từ file Excel, thay cho việc gọi ra Google Sheets.
//
// Rủi ro lớn nhất của tính năng này KHÔNG phải đọc sai file, mà là CHỌN NHẦM CHẾ ĐỘ:
// nạp một file tuyển ngang 30 dòng ở chế độ "đối chiếu toàn trường" nghĩa là 4.415
// em còn lại bị đánh dấu nghỉ học. Phần lớn tệp này canh đúng ranh giới đó.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers/test-server.mjs";
import { IMPORT_MODES, buildExcelDirectory, detectHeaderRow, readExcelSource } from "../directory-excel.mjs";

// Đúng hình dạng file thật của trường: một hàng gộp nhóm nằm TRÊN hàng tên cột.
const HANG_GOP = ["", "", "THÔNG TIN CHUNG", "", "", "", "THÔNG TIN LIÊN HỆ", "", "", ""];
const TIEU_DE = [
  "Mã học sinh", "Họ và tên học sinh", "Ngày sinh", "Lớp", "Cấp học",
  "Họ tên bố", "Email bố", "SDT bố", "Họ tên mẹ", "SDT mẹ",
];
const em = (ma, ten, lop, cap, sdtBo) =>
  [ma, ten, "10/10/2018", lop, cap, "TRẦN HOÀI NAM", "nam@vd.vn", sdtBo, "PHẠM KHÁNH LY", "0924148843"];

const fileTieuHoc = () => [HANG_GOP, TIEU_DE, em("HS001", "Trần Tuệ An", "3A4", "Tiểu học", "0902116163")];
const fileTHCS = () => [HANG_GOP, TIEU_DE, em("HS002", "Lê Minh Khang", "6A1", "THCS", "0903116163")];

let server;        // máy chủ CÓ bật đối chiếu, để kiểm các van an toàn của nó
let quanTri;
let mayChuThat;    // máy chủ đúng cấu hình đang chạy: đối chiếu TẮT
let quanTriThat;

before(async () => {
  // Đối chiếu toàn trường mặc định đã TẮT (xem CHO_PHEP_DOI_CHIEU trong server.mjs).
  // Các van an toàn của nó vẫn phải còn nguyên và vẫn phải hoạt động cho ngày nhà
  // trường bật lại để làm sạch danh bạ đầu năm — nên kiểm chúng trên một máy chủ
  // có bật, và kiểm riêng việc "mặc định là tắt" trên một máy chủ đúng cấu hình thật.
  server = await startTestServer({ prefix: "nshm-excel-", env: { CHO_PHEP_DOI_CHIEU: "1" } });
  quanTri = await server.loginCookie("admin@nshm.edu.vn", "Admin@123");

  mayChuThat = await startTestServer({ prefix: "nshm-excel-tat-" });
  quanTriThat = await mayChuThat.loginCookie("admin@nshm.edu.vn", "Admin@123");
});

after(async () => {
  await server.stop();
  await mayChuThat.stop();
});

const goi = (duong, cookie, body) => server.request(duong, cookie, { method: "POST", body: JSON.stringify(body) });

test("tìm đúng hàng tiêu đề dù phía trên còn một hàng gộp nhóm", () => {
  // File của trường có hai hàng đầu. Bắt người dùng tự khai số hàng là thêm một chỗ
  // để gõ sai; dò lấy hàng khớp được nhiều trường nhất thì tự đúng cho cả hai kiểu.
  const tim = detectHeaderRow(fileTieuHoc());
  assert.equal(tim.index, 1, "hàng tiêu đề thật là hàng thứ hai (chỉ số 1)");
  assert.deepEqual(tim.missing, []);
  assert.equal(tim.mapping.studentCode.header, "Mã học sinh");
  assert.equal(tim.mapping.fatherEmail.header, "Email bố");
});

test("file chỉ có một hàng tiêu đề cũng đọc được", () => {
  const tim = detectHeaderRow([TIEU_DE, em("HS009", "A", "1A1", "Tiểu học", "0900000001")]);
  assert.equal(tim.index, 0);
});

test("thiếu cột bắt buộc thì nói rõ thiếu cột nào, không nuốt lỗi", () => {
  const thieu = TIEU_DE.map((ten) => (ten === "Ngày sinh" ? "Cột lạ" : ten));
  const nguon = readExcelSource({ key: "k", label: "Tiểu học.xlsx", rows: [HANG_GOP, thieu, em("HS001", "A", "3A4", "Tiểu học", "0902116163")] });
  assert.equal(nguon.ok, false);
  assert.match(nguon.error, /Thiếu cột bắt buộc.*dateOfBirth/);
});

test("file rỗng không bị coi là danh sách trống của cả trường", () => {
  // Đây là chỗ chết người: file rỗng mà hiểu thành "trường không còn học sinh nào".
  const nguon = readExcelSource({ key: "k", label: "rong.xlsx", rows: [] });
  assert.equal(nguon.ok, false);
  assert.match(nguon.error, /rỗng/);
});

test("CHẾ ĐỘ BỔ SUNG không bao giờ cho ai nghỉ học", () => {
  // Lá chắn quan trọng nhất. allSourcesLoaded=false là thứ chặn directory-plan đánh
  // dấu nghỉ học, dù file chỉ có đúng một em.
  const ketQua = buildExcelDirectory([{ key: "a", label: "tuyen-ngang.xlsx", rows: fileTieuHoc() }],
    { mode: IMPORT_MODES.boSung });
  assert.equal(ketQua.allSourcesLoaded, false);
  assert.equal(ketQua.snapshot.students.length, 1);
});

test("CHẾ ĐỘ ĐỐI CHIẾU mới mở quyền cho nghỉ học", () => {
  const ketQua = buildExcelDirectory(
    [{ key: "a", label: "th.xlsx", rows: fileTieuHoc() }, { key: "b", label: "thcs.xlsx", rows: fileTHCS() }],
    { mode: IMPORT_MODES.doiChieu });
  assert.equal(ketQua.allSourcesLoaded, true);
  assert.equal(ketQua.snapshot.students.length, 2, "phải gộp học sinh từ cả hai sheet");
});

test("một sheet hỏng thì chế độ đối chiếu tự khoá lại quyền cho nghỉ học", () => {
  // Nạp đủ ba cấp nhưng một file lỗi: nếu vẫn coi là "toàn bộ danh sách" thì cả một
  // cấp học bị cho nghỉ. Chỉ cần một nguồn không đọc được là chặn.
  const ketQua = buildExcelDirectory(
    [{ key: "a", label: "th.xlsx", rows: fileTieuHoc() }, { key: "b", label: "hong.xlsx", rows: [] }],
    { mode: IMPORT_MODES.doiChieu });
  assert.equal(ketQua.allSourcesLoaded, false, "một nguồn hỏng thì không được cho ai nghỉ học");
  assert.equal(ketQua.readyToSync, false);
});

test("chặn số file và số dòng vượt ngưỡng", () => {
  const nhieuFile = Array.from({ length: 11 }, (_, i) => ({ key: `k${i}`, label: `f${i}`, rows: fileTieuHoc() }));
  assert.throws(() => buildExcelDirectory(nhieuFile, { mode: IMPORT_MODES.boSung }), /tối đa 10 file/);
  const nhieuDong = [{ key: "a", label: "to.xlsx", rows: [HANG_GOP, TIEU_DE, ...Array.from({ length: 20_001 }, () => em("X", "A", "1A1", "Tiểu học", "0900000001"))] }];
  assert.throws(() => buildExcelDirectory(nhieuDong, { mode: IMPORT_MODES.boSung }), /vượt giới hạn/);
});

test("chưa chọn file thì báo rõ, không ghi gì", () => {
  assert.throws(() => buildExcelDirectory([], { mode: IMPORT_MODES.boSung }), /Chưa chọn file/);
});

test("giáo vụ không được nhập danh bạ", async () => {
  const giaoVu = await server.loginCookie("giaovu@nshm.edu.vn", "Admin@123");
  const files = [{ key: "a", label: "th.xlsx", rows: fileTieuHoc() }];
  assert.equal((await goi("/api/admin/directory/excel/preview", giaoVu, { files })).status, 403);
  assert.equal((await goi("/api/admin/directory/excel/commit", giaoVu, { files })).status, 403);
});

test("xem trước nói đủ con số để dám bấm ghi", async () => {
  const response = await goi("/api/admin/directory/excel/preview", quanTri, {
    mode: IMPORT_MODES.doiChieu,
    files: [{ key: "a", label: "th.xlsx", rows: fileTieuHoc() }],
  });
  assert.equal(response.status, 200);
  const { preview } = await response.json();
  assert.ok(preview.activeStudentsNow > 0, "phải nói hệ thống đang có bao nhiêu em");
  assert.equal(preview.studentsInFile, 1);
  assert.ok(preview.willDeactivate > 0, "chế độ đối chiếu phải nói trước bao nhiêu em sẽ bị cho nghỉ");
  assert.equal(preview.sources[0].headerRow, 2, "phải nói đã lấy hàng nào làm tiêu đề");
});

test("xem trước KHÔNG ghi gì vào cơ sở dữ liệu", async () => {
  // Bấm "Kiểm tra file" mà lỡ ghi thì cả lớp lá chắn xác nhận thành vô nghĩa.
  const truoc = (await (await goi("/api/admin/directory/excel/preview", quanTri, {
    mode: IMPORT_MODES.doiChieu, files: [{ key: "a", label: "th.xlsx", rows: fileTieuHoc() }],
  })).json()).preview.activeStudentsNow;
  const sau = (await (await goi("/api/admin/directory/excel/preview", quanTri, {
    mode: IMPORT_MODES.doiChieu, files: [{ key: "a", label: "th.xlsx", rows: fileTieuHoc() }],
  })).json()).preview.activeStudentsNow;
  assert.equal(sau, truoc);
});

test("chế độ đối chiếu đòi xác nhận riêng, bấm nhầm nút không đủ", async () => {
  const response = await goi("/api/admin/directory/excel/commit", quanTri, {
    mode: IMPORT_MODES.doiChieu,
    files: [{ key: "a", label: "th.xlsx", rows: fileTieuHoc() }],
  });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "SYNC_CONFIRMATION_REQUIRED");
});

test("BỔ SUNG một file nhỏ: thêm em mới, KHÔNG đụng tới ai đang học", async () => {
  // Đây là kịch bản tuyển ngang hàng tháng, và là bài kiểm quan trọng nhất của tệp.
  const truoc = (await (await goi("/api/admin/directory/excel/preview", quanTri, {
    mode: IMPORT_MODES.boSung, files: [{ key: "a", label: "tuyen-ngang.xlsx", rows: fileTieuHoc() }],
  })).json()).preview.activeStudentsNow;

  const response = await goi("/api/admin/directory/excel/commit", quanTri, {
    mode: IMPORT_MODES.boSung,
    files: [{ key: "a", label: "tuyen-ngang.xlsx", rows: fileTieuHoc() }],
  });
  assert.equal(response.status, 200);
  const { result } = await response.json();
  assert.equal(result.counters.studentsDeactivated ?? 0, 0, "chế độ bổ sung TUYỆT ĐỐI không được cho ai nghỉ học");
  assert.equal(result.counters.studentsCreated, 1);

  const sau = (await (await goi("/api/admin/directory/excel/preview", quanTri, {
    mode: IMPORT_MODES.boSung, files: [{ key: "a", label: "tuyen-ngang.xlsx", rows: fileTieuHoc() }],
  })).json()).preview.activeStudentsNow;
  assert.equal(sau, truoc + 1, "chỉ thêm đúng một em, không em nào biến mất");
});

test("đối chiếu bằng danh sách co rút bất thường thì bị chặn", async () => {
  // Nạp nhầm file một cấp rồi chọn đối chiếu toàn trường: lá chắn co rút phải nổ
  // TRƯỚC khi có em nào bị đánh dấu nghỉ học.
  //
  // Lá chắn đòi CẢ HAI điều kiện — giảm quá 20% VÀ thiếu từ 10 em trở lên — nên
  // dữ liệu mẫu 8 em không đủ để kích hoạt. Đó là hành vi cố ý: trên tập nhỏ, tỉ lệ
  // phần trăm nhảy loạn và chặn theo tỉ lệ sẽ toàn báo động giả. Vì vậy phải dựng
  // một trường đủ đông trước đã.
  const dong = Array.from({ length: 20 }, (_, i) =>
    em(`HS9${String(i).padStart(2, "0")}`, `Học sinh ${i}`, "4A1", "Tiểu học", `09011000${String(i).padStart(2, "0")}`));
  const nap = await goi("/api/admin/directory/excel/commit", quanTri, {
    mode: IMPORT_MODES.boSung,
    files: [{ key: "dong", label: "ca-truong.xlsx", rows: [HANG_GOP, TIEU_DE, ...dong] }],
  });
  assert.equal(nap.status, 200);

  const response = await goi("/api/admin/directory/excel/commit", quanTri, {
    mode: IMPORT_MODES.doiChieu,
    confirmation: "DOI_CHIEU_TOAN_TRUONG",
    files: [{ key: "a", label: "th.xlsx", rows: fileTieuHoc() }],
  });
  assert.equal(response.status, 409, "danh sách co rút mạnh phải bị chặn");
  assert.equal((await response.json()).error.code, "DIRECTORY_SNAPSHOT_SHRANK");

  // Và quan trọng nhất: bị chặn nghĩa là KHÔNG em nào bị đụng tới.
  const conLai = (await (await goi("/api/admin/directory/excel/preview", quanTri, {
    mode: IMPORT_MODES.boSung, files: [{ key: "a", label: "th.xlsx", rows: fileTieuHoc() }],
  })).json()).preview.activeStudentsNow;
  assert.ok(conLai >= 20, `phải còn nguyên số học sinh đang học, còn ${conLai}`);
});

/* ---------- Đối chiếu toàn trường: mặc định TẮT ---------- */

const goiThat = (duong, body) => mayChuThat.request(duong, quanTriThat, { method: "POST", body: JSON.stringify(body) });
/**
 * Số học sinh đang học, đọc thẳng từ con số mà chính màn xem trước dùng để người
 * vận hành dám bấm ghi (activeStudentsNow → countActiveStudents). Không dùng số
 * trên dashboard: số đó đếm em CÓ ĐƠN ĐĂNG KÝ, không phải em có trong danh bạ.
 */
const soDangHoc = async () => (await (await goiThat("/api/admin/directory/excel/preview", {
  files: [{ key: "dem", label: "dem.xlsx", rows: fileTieuHoc() }],
})).json()).preview.activeStudentsNow;

test("máy chủ đúng cấu hình thật TỪ CHỐI chế độ đối chiếu, dù có gửi kèm câu xác nhận", async () => {
  // Nhà trường đã ngừng nuôi file Google Sheet: danh bạ nay do phần mềm làm chủ.
  // Từ lúc đó "vắng mặt trong file = cho nghỉ học" không còn việc gì để làm, mà nó
  // lại là thao tác nguy hiểm nhất hệ thống — đã đo: van co rút chỉ dừng khi tụt
  // QUÁ 20% VÀ thiếu từ 10 em trở lên, nên với 4.445 em một lần bấm nhầm cho tới
  // 889 em nghỉ học mà không gì chặn.
  const response = await goiThat("/api/admin/directory/excel/commit", {
    mode: IMPORT_MODES.doiChieu,
    confirmation: "DOI_CHIEU_TOAN_TRUONG",
    files: [{ key: "a", label: "th.xlsx", rows: fileTieuHoc() }],
  });
  assert.equal(response.status, 403);
  const loi = (await response.json()).error;
  assert.equal(loi.code, "DOI_CHIEU_DA_TAT");
  assert.match(loi.message, /CHO_PHEP_DOI_CHIEU/, "câu báo phải chỉ ra cách bật lại khi thật sự cần");
});

test("nạp một file NHỎ lên máy chủ thật KHÔNG cho em nào nghỉ học", async () => {
  // Đây là kịch bản làm mất dữ liệu thật: lô Google Form 30 dòng nạp nhầm chế độ,
  // hoặc một file thiếu cấp học. Trên cấu hình thật, số em đang học phải KHÔNG giảm.
  const truoc = await soDangHoc();
  assert.ok(truoc > 1, `dữ liệu mẫu phải có nhiều hơn một em, đang có ${truoc}`);

  const response = await goiThat("/api/admin/directory/excel/commit", {
    files: [{ key: "a", label: "mot-em.xlsx", rows: fileTieuHoc() }],
  });
  const than = await response.text();
  assert.equal(response.status, 200, `nhập bổ sung phải chạy được: ${than}`);
  const ketQua = JSON.parse(than).result;
  assert.equal(ketQua.counters.studentsDeactivated, 0, "không lượt nhập nào được cho em nào nghỉ");
  assert.deepEqual(ketQua.deactivated, [], "danh sách em bị cho nghỉ phải rỗng");
  assert.equal(ketQua.allSourcesLoaded, false, "lượt nhập này không được coi là đã nạp đủ toàn trường");

  const sau = await soDangHoc();
  assert.ok(sau >= truoc, `có em bị cho nghỉ học: trước ${truoc}, sau ${sau}`);
  assert.equal(sau, truoc + 1, "file mang một em mới nên tổng phải tăng đúng một");
});

test("màn xem trước trên máy chủ thật nói rõ đối chiếu đang tắt và không ai bị nghỉ", async () => {
  const response = await goiThat("/api/admin/directory/excel/preview", {
    files: [{ key: "a", label: "th.xlsx", rows: fileTieuHoc() }],
  });
  assert.equal(response.status, 200);
  const { preview } = await response.json();
  assert.equal(preview.choPhepDoiChieu, false, "xem trước phải nói thẳng là đối chiếu đang tắt");
  assert.equal(preview.willDeactivate, 0);
});
