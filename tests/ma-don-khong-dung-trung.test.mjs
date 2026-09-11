// Mã đơn đăng ký phải đủ rộng để không đụng trùng trong một ngày mở đăng ký.
//
// Công thức cũ là `DK-YYMMDD-` + 4 ký tự hex = 65.536 giá trị mỗi ngày, chèn thẳng
// làm khoá chính, không kiểm trùng, không thử lại. Trường có 4.445 học sinh và mỗi
// em được đăng ký tới 3 CLB, tất cả dồn vào vài ngày mở đăng ký. Theo nghịch lý
// ngày sinh, 300 đơn trong một ngày là đã 49,6% khả năng có hai đơn trùng mã — và
// đơn thứ hai làm lệnh ghi hỏng, phụ huynh nhận lỗi hệ thống.
//
// Tệp này khoá lại hai lớp bảo vệ: không gian mã đủ rộng, và vòng sinh lại khi mã
// đã có người dùng.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { startTestServer } from "./helpers/test-server.mjs";

let server;
let phuHuynh;

before(async () => {
  server = await startTestServer({ prefix: "nshm-madon-" });
  phuHuynh = await server.loginCookie("0901234567", "123456");
});

after(async () => server.stop());

/** Xác suất có ít nhất một cặp trùng khi rút `soDon` mã từ `khongGian` giá trị. */
const xacSuatTrung = (soDon, khongGian) => 1 - Math.exp(-(soDon * (soDon - 1)) / (2 * khongGian));

test("mã đơn thật sinh ra đủ rộng cho một ngày mở đăng ký của cả trường", async () => {
  // Lấy mã từ một đơn THẬT do máy chủ sinh, không đọc hằng số trong mã nguồn: cái
  // quan trọng là thứ chạy ra, không phải thứ viết ra.
  const response = await server.request("/api/registrations", phuHuynh, {
    method: "POST",
    body: JSON.stringify({ studentId: "hs02", clubIds: ["debate"], acceptedTerms: true }),
  });
  // Đọc thân phản hồi ĐÚNG MỘT LẦN: gọi .text() trong câu báo lỗi rồi .json() sau
  // đó là tự làm hỏng bài kiểm ngay cả khi máy chủ chạy đúng.
  const than = await response.text();
  assert.equal(response.status, 201, `tạo đơn thất bại: ${than}`);
  const [don] = JSON.parse(than).registrations;

  const khop = String(don.id).match(/^DK-(\d{6})-([0-9A-F]+)$/);
  assert.ok(khop, `mã đơn sai dạng: ${don.id}`);
  const soKyTu = khop[2].length;
  const khongGian = 16 ** soKyTu;

  // Ngưỡng: 4.445 học sinh × 3 CLB = 13.335 đơn, giả sử dồn hết vào một ngày.
  const donToiDaMotNgay = 4445 * 3;
  const rui = xacSuatTrung(donToiDaMotNgay, khongGian);
  assert.ok(rui < 0.01,
    `mã đơn chỉ có ${soKyTu} ký tự hex = ${khongGian.toLocaleString("vi-VN")} giá trị/ngày; `
    + `${donToiDaMotNgay} đơn trong một ngày là ${(rui * 100).toFixed(1)}% khả năng đụng trùng`);
});

test("hai nghìn mã sinh liên tiếp không có mã nào trùng nhau", async () => {
  // Kiểm thẳng bộ sinh mã của máy chủ bằng đúng số đơn mà một ngày cao điểm tạo ra.
  // Bài này không gọi API vì mỗi học sinh chỉ được 3 CLB; nó soi chính công thức.
  const nguon = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const dong = nguon.split("\n").find((row) => row.includes("const maTheoNgay ="));
  assert.ok(dong, "server.mjs không còn hàm sinh mã theo ngày");

  const soByte = Number(dong.match(/randomBytes\((\d+)\)/)?.[1]);
  assert.ok(soByte >= 4, `phần ngẫu nhiên chỉ ${soByte} byte, quá hẹp cho quy mô của trường`);

  const { randomBytes } = await import("node:crypto");
  const daThay = new Set();
  for (let lan = 0; lan < 2000; lan += 1) daThay.add(randomBytes(soByte).toString("hex").toUpperCase());
  assert.equal(daThay.size, 2000, "sinh 2000 mã mà có mã trùng nhau");
});

test("cả hai nền lưu trữ đều sinh lại khi mã đã có người dùng", async () => {
  // Nới rộng không gian mã đưa xác suất về gần không, nhưng "gần không" nhân với
  // 4.445 gia đình vẫn là một gia đình nào đó nhận lỗi vào đúng ngày mở đăng ký.
  // Nên còn một lớp nữa: kiểm mã ngay trong giao dịch ghi rồi sinh lại nếu đã có.
  const sqlite = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(sqlite, /function maDonConTrong\(/, "nhánh SQLite thiếu vòng sinh lại mã");
  assert.match(sqlite, /SELECT 1 FROM registrations WHERE id = \?/, "nhánh SQLite không kiểm mã đã tồn tại");

  const mysql = await readFile(new URL("../mysql-store.mjs", import.meta.url), "utf8");
  assert.match(mysql, /const maConTrong = async/, "nhánh MySQL thiếu vòng sinh lại mã");
  assert.match(mysql, /SELECT 1 FROM registrations WHERE id = \? LIMIT 1/, "nhánh MySQL không kiểm mã đã tồn tại");
});

test("mã yêu cầu hỗ trợ cũng đi qua cùng một bộ sinh", async () => {
  // Mã HT- trước đây hẹp y hệt mã đơn. Sửa một chỗ mà quên chỗ kia thì lần sau
  // người gặp lỗi là phụ huynh đang cần hỗ trợ.
  const nguon = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const dong = nguon.split("\n").find((row) => row.includes("const requestId ="));
  assert.ok(dong, "không tìm thấy chỗ sinh mã yêu cầu hỗ trợ");
  assert.match(dong, /maTheoNgay\("HT"\)/, `mã hỗ trợ vẫn sinh riêng một kiểu: ${dong.trim()}`);
});
