// Biểu mẫu Excel trống của bốn màn nhập.
//
// Người vận hành điền mẫu bằng tay rồi nhập lại. Mẫu chỉ có giá trị nếu CHÍNH bộ đọc
// của màn nhập nhận ra mọi cột của nó — bộ đọc so khớp tiêu đề tuyệt đối, và một cột
// không được nhận thường không báo lỗi mà lặng lẽ về giá trị mặc định (học phí thành 0).
// Nên mọi bài ở đây đọc lại file .xlsx thật bằng public/sheet-reader.js, chọn sheet
// bằng đúng mã của public/app.js, rồi đưa qua bộ đọc thật của từng màn — không mô
// phỏng lại quy tắc nào.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { BIEU_MAU, dinhNghiaBieuMau, taoBieuMau } from "../bieu-mau.mjs";
import { detectCatalogMapping } from "../catalog-schema.mjs";
import { detectColumnMapping } from "../sheets-directory.mjs";
import { readExcelSource } from "../directory-excel.mjs";
import { detectXepLopMapping, docFileXepLop } from "../xep-lop-import.mjs";
import { detectSchoolAccountMapping } from "../school-account-import.mjs";
import { startTestServer } from "./helpers/test-server.mjs";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const readerSource = await readFile(new URL("../public/sheet-reader.js", import.meta.url), "utf8");

function catHam(ten) {
  const dau = app.indexOf(`function ${ten}(`);
  assert.ok(dau >= 0, `app.js không còn hàm ${ten}`);
  const cuoi = app.indexOf("\n}", dau);
  return app.slice(dau, cuoi + 2);
}
function catDong(mo) {
  const dau = app.indexOf(mo);
  assert.ok(dau >= 0, `app.js không còn "${mo}"`);
  const lf = app.indexOf(";\n", dau);
  const crlf = app.indexOf(";\r\n", dau);
  const cuoi = [lf, crlf].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  return app.slice(dau, cuoi + 1);
}

/** Bộ đọc xlsx của trình duyệt, chạy nguyên văn trong Node. */
const window = {};
vm.runInNewContext(readerSource, { window, TextDecoder, Blob, Response, DecompressionStream, Uint8Array, DataView });
const docWorkbook = (buffer) => window.NSHMSheet.parseWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));

/** Cách app.js chọn sheet: màn một sheet và màn nhiều sheet. */
const chonSheet = new Function("window",
  `${catDong("const boDau = ")}\n${catHam("laSheetHuongDan")}\n${catHam("sheetDuLieuDauTien")}\nasync ${catHam("docFileExcel")}
   return { sheetDuLieuDauTien, docFileExcel };`,
)({ NSHMSheet: { readFile: async (file) => docWorkbook(file.buffer) } });

async function docMau(buffer) {
  const workbook = await docWorkbook(buffer);
  const motSheet = chonSheet.sheetDuLieuDauTien(workbook);
  const nhieuSheet = await chonSheet.docFileExcel([{ name: "mau.xlsx", buffer }]);
  // Mảng tạo trong vm khác prototype với mảng thường; chép ra để so sánh được.
  return { workbook, motSheet, nhieuSheet: JSON.parse(JSON.stringify(nhieuSheet)), headers: [...motSheet.rows[0]] };
}

/* ---------- Từng mẫu qua đúng bộ đọc của màn nhập ---------- */

test("mọi mẫu: sheet dữ liệu đứng đầu, sheet hướng dẫn bị cả hai kiểu màn nhập bỏ qua", async () => {
  for (const khoa of Object.keys(BIEU_MAU)) {
    const { buffer } = taoBieuMau(khoa, khoa === "xep-lop-clb" ? { caHoc: [{ nhan: "Bơi · Ca 1" }] } : {});
    const { workbook, motSheet, nhieuSheet } = await docMau(buffer);
    assert.ok(workbook.sheets.length >= 2, `${khoa}: phải có sheet hướng dẫn`);
    assert.equal(motSheet.name, workbook.sheets[0].name, `${khoa}: màn một sheet phải lấy sheet dữ liệu`);
    // Màn nhiều sheet coi mỗi sheet có chữ là một nguồn; sheet hướng dẫn lọt vào là
    // một nguồn thiếu cột, và cả lượt nhập bị chặn.
    assert.equal(nhieuSheet.length, 1, `${khoa}: chỉ được một nguồn dữ liệu, đang có ${nhieuSheet.map((nguon) => nguon.label)}`);
    assert.equal(nhieuSheet[0].key, `mau.xlsx::${workbook.sheets[0].name}`);
  }
});

test("mẫu danh mục: bộ đọc nhận ra MỌI cột, không cột nào bị bỏ qua", async () => {
  const { headers } = await docMau(taoBieuMau("danh-muc-clb").buffer);
  const { mapping, missing } = detectCatalogMapping(headers);
  assert.deepEqual(missing, []);
  const daNhan = new Set(Object.values(mapping).map((item) => item.header));
  // Cột không được nhận ở mẫu này là lỗi im lặng: Học phí thành 0, Nhóm môn thành "Khác".
  assert.deepEqual(headers.filter((header) => !daNhan.has(header)), []);
  assert.equal(mapping.fee.header, "Học phí");
  assert.equal(mapping.grades.header, "Khối");
});

test("mẫu danh bạ: đủ cột bắt buộc và mọi cột đều được nhận", async () => {
  const { headers, nhieuSheet } = await docMau(taoBieuMau("danh-ba-hoc-sinh").buffer);
  const { mapping, missing } = detectColumnMapping(headers);
  assert.deepEqual(missing, []);
  const daNhan = new Set(Object.values(mapping).map((item) => item.header));
  assert.deepEqual(headers.filter((header) => !daNhan.has(header)), []);
  // Sheet chỉ có tiêu đề vẫn là nguồn đọc được, không "thiếu cột".
  assert.equal(readExcelSource(nhieuSheet[0]).ok, true);
});

test("mẫu xếp lớp: nhận đúng cột CLB, và cột ghi chú không chiếm chỗ cột CLB", async () => {
  const { headers, nhieuSheet } = await docMau(taoBieuMau("xep-lop-clb").buffer);
  const { mapping, missing } = detectXepLopMapping(headers);
  assert.deepEqual(missing, []);
  assert.equal(mapping.clubText.header, "CLB đăng ký");
  assert.equal(mapping.studentCode.header, "Mã học sinh");
  assert.equal(docFileXepLop(nhieuSheet[0]).ok, true);
  // Bộ đọc lấy cột khớp đầu tiên từ trái sang. Một cột "Lớp" (lớp chủ nhiệm) đứng trước
  // cột CLB sẽ thành cột CLB — mẫu không được có cột nào như vậy.
  const truocClb = headers.slice(0, headers.indexOf("CLB đăng ký"));
  assert.equal(detectXepLopMapping(truocClb).mapping.clubText, undefined);
});

test("mẫu tài khoản: đủ ba cột bắt buộc", async () => {
  const { headers } = await docMau(taoBieuMau("tai-khoan-nha-truong").buffer);
  const { missing } = detectSchoolAccountMapping(headers);
  assert.deepEqual(missing, []);
});

test("lời nhắc trong ô không bị Excel cắt cụt", () => {
  // Excel giới hạn tiêu đề lời nhắc 32 ký tự và nội dung 255 ký tự; bộ ghi cắt bớt để
  // file hợp lệ, nên câu nào dài hơn sẽ đến tay người điền mà mất phần cuối.
  for (const khoa of Object.keys(BIEU_MAU)) {
    for (const sheet of dinhNghiaBieuMau(khoa).sheets) {
      for (const cot of sheet.columns || []) {
        if (!cot.prompt) continue;
        assert.ok(cot.prompt.title.length <= 32, `${khoa} · ${cot.header}: tiêu đề nhắc dài ${cot.prompt.title.length}`);
        assert.ok(cot.prompt.text.length <= 255, `${khoa} · ${cot.header}: lời nhắc dài ${cot.prompt.text.length}`);
      }
    }
  }
});

/* ---------- Tải mẫu từ máy chủ, điền theo đúng lời nhắc, rồi nhập lại ---------- */

let server;
let quanTri;
let giaoVu;

before(async () => {
  server = await startTestServer({
    prefix: "nshm-bieumau-",
    env: { CHO_PHEP_NHAP_HANG_LOAT: "1", SUPERADMIN_ACCOUNTS: "admin@nshm.edu.vn" },
  });
  quanTri = await server.loginCookie("admin@nshm.edu.vn", "Admin@123");
  giaoVu = await server.loginCookie("giaovu@nshm.edu.vn", "Admin@123");
});

after(async () => server?.stop());

async function taiMau(khoa, cookie = quanTri, query = "") {
  const response = await server.request(`/api/admin/bieu-mau/${khoa}.xlsx${query}`, cookie);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { response, buffer };
}

const post = async (path, body) => {
  const response = await server.request(path, quanTri, { method: "POST", body: JSON.stringify(body) });
  const text = await response.text();
  assert.equal(response.status, 200, `${path}: ${text}`);
  return JSON.parse(text);
};

const theoTieuDe = (headers, giaTri) => headers.map((header) => giaTri[header] ?? "");

test("tải được cả bốn mẫu, đúng kiểu file, mỗi mẫu đòi đúng quyền của màn nhập", async () => {
  for (const khoa of Object.keys(BIEU_MAU)) {
    const { response, buffer } = await taiMau(khoa);
    assert.equal(response.status, 200, khoa);
    assert.match(response.headers.get("content-type"), /spreadsheetml/);
    assert.match(response.headers.get("content-disposition"), /attachment; filename="mau-.*\.xlsx"/);
    assert.ok((await docWorkbook(buffer)).sheets.length >= 2);
  }
  // Giáo vụ nhập danh mục được, nhưng không đồng bộ danh bạ và không quản lý tài khoản.
  assert.equal((await taiMau("danh-muc-clb", giaoVu)).response.status, 200);
  assert.equal((await taiMau("danh-ba-hoc-sinh", giaoVu)).response.status, 403);
  assert.equal((await taiMau("tai-khoan-nha-truong", giaoVu)).response.status, 403);
  assert.equal((await taiMau("khong-co")).response.status, 404);
});

test("mẫu danh mục điền theo lời nhắc thì màn nhập báo sẵn sàng ghi, học phí không mất", async () => {
  const { headers } = await docMau((await taiMau("danh-muc-clb")).buffer);
  const dong = theoTieuDe(headers, {
    "Mã CLB": "BD-MAU", "Tên CLB": "Bóng đá mẫu", "Nhóm môn": "Thể thao", "Khối": "1-5", "Tên lớp": "Ca 1",
    "Thứ": "Thứ 2", "Khung giờ": "16:15-17:30", "Phòng": "Sân mẫu", "Giáo viên": "Thầy Nam",
    "Sĩ số tối đa": "20", "Sĩ số tối thiểu": "8", "Học phí": "1500000", "Mô tả": "Thử mẫu", "Biểu tượng": "⚽",
  });
  const periods = await (await server.request("/api/admin/periods", quanTri)).json();
  const periodId = periods.periods.find((item) => item.status === "open").id;
  const { preview } = await post("/api/admin/catalog/import/preview", { periodId, headers, rows: [dong] });
  assert.equal(preview.readyToImport, true, JSON.stringify(preview.issues));
  assert.equal(preview.classes[0].fee, 1500000);
  assert.deepEqual(preview.classes[0].grades, [1, 2, 3, 4, 5]);
});

test("mẫu danh bạ điền theo lời nhắc thì màn nhập báo sẵn sàng ghi", async () => {
  const { nhieuSheet, headers } = await docMau((await taiMau("danh-ba-hoc-sinh")).buffer);
  const dong = theoTieuDe(headers, {
    "Mã học sinh": "24151884", "Họ và tên học sinh": "Nguyễn Minh Mẫu", "Ngày sinh": "12/04/2017", "Lớp": "3A2",
    "Cấp học": "", "Họ tên bố": "Nguyễn Văn Bình", "SĐT bố": "0912345678", "Email bố": "binh@gmail.com",
    "Họ tên mẹ": "Trần Thị Cúc", "SĐT mẹ": "0987654321", "Email mẹ": "",
  });
  const { preview } = await post("/api/admin/directory/excel/preview", {
    mode: "bo-sung", files: [{ ...nhieuSheet[0], rows: [headers, dong] }],
  });
  assert.equal(preview.readyToSync, true, JSON.stringify(preview.sources));
  assert.equal(preview.studentsInFile, 1);
});

test("mẫu xếp lớp tải từ hệ thống có danh sách ca, và chọn từ danh sách đó thì xếp được", async () => {
  const periods = await (await server.request("/api/admin/periods", quanTri)).json();
  const periodId = periods.periods.find((item) => item.status === "open").id;
  const { buffer } = await taiMau("xep-lop-clb", quanTri, `?periodId=${encodeURIComponent(periodId)}`);
  const { workbook, nhieuSheet, headers } = await docMau(buffer);

  const danhSach = workbook.sheets.find((sheet) => sheet.name === "Hướng dẫn - Danh sách ca");
  assert.ok(danhSach, "mẫu tải từ hệ thống phải có sheet danh sách ca");
  const caMyThuat = danhSach.rows.slice(1).find((row) => row[3] === "Phòng Mỹ thuật 2");
  assert.ok(caMyThuat, `không thấy ca Mỹ thuật trong danh sách: ${JSON.stringify(danhSach.rows)}`);

  // Em khối 4 (NSHM260411), chọn đúng nhãn trong danh sách thả xuống.
  const dong = theoTieuDe(headers, { "Mã học sinh": "NSHM260411", "Họ và tên học sinh": "Nguyễn Hà My", "CLB đăng ký": caMyThuat[0] });
  const { preview } = await post("/api/admin/registrations/import/preview", {
    periodId, files: [{ ...nhieuSheet[0], rows: [headers, dong] }],
  });
  assert.equal(preview.rows[0].ketCuc, "xepDuoc", preview.rows[0].lyDo);
  assert.equal(preview.rows[0].classId, "painting");
});

test("mẫu tài khoản điền theo lời nhắc thì màn nhập báo sẵn sàng ghi", async () => {
  const { headers } = await docMau((await taiMau("tai-khoan-nha-truong")).buffer);
  const dong = theoTieuDe(headers, { Email: "gv.mau@hoangmaistarschool.edu.vn", "Họ và tên": "Nguyễn Văn Mẫu", "Vai trò": "Giáo vụ" });
  const { preview } = await post("/api/admin/school-accounts/import/preview", { headers, rows: [dong] });
  assert.equal(preview.readyToCommit, true, JSON.stringify(preview.issues));
  assert.equal(preview.summary.create, 1);
});

test("nhãn ca trùng nhau trong đợt không được đưa vào danh sách như thể chọn được", async () => {
  // "Tên CLB · Tên ca" trùng với một ca khác thì đường nhập không chọn được ca nào. Danh
  // sách phải đổi sang "Tên CLB - Thứ N", hoặc nói thẳng là phải sửa tên ca trước.
  const periods = await (await server.request("/api/admin/periods", quanTri)).json();
  const periodId = periods.periods.find((item) => item.status === "open").id;
  const tao = async (name, dayOfWeek, room) => {
    const response = await server.request("/api/admin/classes", quanTri, {
      method: "POST",
      body: JSON.stringify({
        clubId: "painting", periodId, name, dayOfWeek, startTime: "18:00", endTime: "19:00", room,
        teacher: "Cô Trang", capacity: 20, minCapacity: 0, enrolledBase: 0, fee: 0, grades: [4],
      }),
    });
    assert.equal(response.status, 201, await response.text());
  };
  await tao("Ca chính", 2, "Phòng T3");
  await tao("Ca chính", 5, "Phòng T6");
  const { buffer } = await taiMau("xep-lop-clb", quanTri, `?periodId=${encodeURIComponent(periodId)}`);
  const danhSach = (await docWorkbook(buffer)).sheets.find((sheet) => sheet.name === "Hướng dẫn - Danh sách ca");
  const nhan = danhSach.rows.slice(1).map((row) => row[0]);
  assert.ok(!nhan.includes("Mỹ thuật sáng tạo · Ca chính"), `nhãn trùng không được liệt kê: ${nhan}`);
  assert.ok(nhan.includes("Mỹ thuật sáng tạo - Thứ 3"));
  assert.ok(nhan.includes("Mỹ thuật sáng tạo - Thứ 6"));
});
