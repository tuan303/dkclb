// Bảng "Đơn đăng ký" của nhà trường phải có đủ tám cột theo đúng thứ tự đã yêu cầu,
// và hai cột mới (mã học sinh, ngày sinh) phải lấy được dữ liệu thật.
//
// Nhưng hai cột đó là dữ liệu cá nhân của học sinh, và roles.mjs ghi rõ phạm vi
// "danh sách vận hành" của giáo vụ là "không ngày sinh, không mã học sinh". Bảng
// này lại dùng chung với ô "Đơn đăng ký gần đây" trên Dashboard — nơi giáo vụ vào
// được — nên thêm cột cho một trang là vô tình mở cho trang kia. Phần lớn tệp này
// tồn tại để chốt đúng ranh giới đó.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { startTestServer } from "./helpers/test-server.mjs";

let server;
let donCuaQuanTri;

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

/**
 * Cắt đúng đoạn nguồn của bảng đơn. Phải KHẲNG ĐỊNH cả hai mốc còn tồn tại: mốc
 * biến mất thì indexOf trả -1, slice âm lặng lẽ nuốt trọn phần còn lại của tệp và
 * mọi bài trong tệp này quay ra soi nhầm đoạn mã. Đã xảy ra thật khi trang "Đối
 * soát phí" bị gỡ — mốc cuối chính là tên hàm của trang đó.
 */
function catDoan(tu, den) {
  const dau = app.indexOf(tu);
  const cuoi = app.indexOf(den);
  assert.ok(dau >= 0, `app.js không còn mốc "${tu}" — hãy sửa lại mốc cắt trong bài kiểm này`);
  assert.ok(cuoi > dau, `app.js không còn mốc "${den}" sau "${tu}" — hãy sửa lại mốc cắt trong bài kiểm này`);
  return app.slice(dau, cuoi);
}

const bang = catDoan("const formatDateOfBirth", "const AUDIT_ACTION_LABELS");
const tenCot = () => [...bang.matchAll(/\{ title: "([^"]+)"/g)].map((m) => m[1]);

const dong = async (cookie) => (await (await server.request("/api/registrations", cookie)).json()).registrations;

before(async () => {
  server = await startTestServer({ prefix: "nshm-cot-" });
  donCuaQuanTri = await dong(await server.loginCookie("admin@nshm.edu.vn", "Admin@123"));
});

after(async () => server.stop());

test("tám cột đúng thứ tự nhà trường yêu cầu", () => {
  assert.deepEqual(tenCot(), [
    "Mã đơn", "Ngày đăng ký", "Mã học sinh", "Học sinh", "Ngày sinh", "CLB", "Trạng thái", "Thao tác",
  ]);
});

test("cột trống trải đúng số cột, không gõ cứng", () => {
  // colspan gõ cứng là chỗ kinh điển bị quên khi đổi số cột: bảng rỗng vỡ khung.
  assert.match(bang, /colspan="\$\{cot\.length\}"/);
  assert.ok(!/colspan="\d+"/.test(bang), "không được gõ cứng colspan");
});

test("máy chủ trả mã học sinh và ngày sinh cho người duyệt đơn", () => {
  assert.ok(donCuaQuanTri.length > 0, "dữ liệu minh họa phải có đơn đăng ký");
  for (const row of donCuaQuanTri) {
    assert.match(row.studentCode, /^NSHM\d+$/, `mã học sinh của đơn ${row.id} không hợp lệ: ${row.studentCode}`);
    assert.match(row.dateOfBirth || "", /^\d{2}\/\d{2}\/\d{4}$/, `ngày sinh của đơn ${row.id} rỗng hoặc sai dạng`);
  }
});

test("GIÁO VỤ KHÔNG nhận mã học sinh và ngày sinh", async () => {
  // roles.mjs định nghĩa quyền danh-sach-van-hanh bằng nguyên văn: "không ngày
  // sinh, không mã học sinh". Giáo vụ không vào được trang Đơn đăng ký (cần quyền
  // duyet-don) nhưng VÀO ĐƯỢC Dashboard, nơi dùng lại đúng bảng này.
  const rows = await dong(await server.loginCookie("giaovu@nshm.edu.vn", "Admin@123"));
  assert.ok(rows.length > 0, "giáo vụ vẫn phải xem được danh sách đơn để xếp lớp");
  for (const row of rows) {
    assert.ok(!("studentCode" in row), `đơn ${row.id} lộ mã học sinh cho giáo vụ`);
    assert.ok(!("dateOfBirth" in row), `đơn ${row.id} lộ ngày sinh cho giáo vụ`);
    assert.ok(row.student && row.className, "giáo vụ vẫn phải thấy tên và lớp hành chính");
  }
});

test("che ở giao diện là lớp thứ hai, không phải lớp duy nhất", () => {
  // Ẩn cột mà máy chủ vẫn gửi dữ liệu thì mở DevTools là thấy. Hai cột riêng phải
  // được đánh dấu để Dashboard bỏ đi, VÀ máy chủ phải cắt theo quyền.
  for (const ten of ["Mã học sinh", "Ngày sinh"]) {
    assert.match(bang, new RegExp(`\{ title: "${ten}", rieng: true`), `cột ${ten} phải đánh dấu rieng: true`);
  }
  assert.match(bang, /\.filter\(\(item\) => !\(rutGon && item\.rieng\)\)/);
  assert.match(app, /renderApplicationTable\(adminApplications\.slice\(0, ?5\), \{ rutGon: true \}\)/,
    "ô Đơn đăng ký gần đây trên Dashboard phải dùng bản rút gọn");
});

test("phụ huynh vẫn nhận thông tin của chính con mình", async () => {
  // Không phải nới quyền: /api/students vốn đã trả mã và ngày sinh của con họ.
  const rows = await dong(await server.loginCookie("0901234567", "123456"));
  assert.ok(rows.length > 0);
  for (const row of rows) assert.ok("studentCode" in row && "dateOfBirth" in row);
});

test("ngày đăng ký đúng dạng hh:mm - dd/mm/yyyy", () => {
  // Định dạng mặc định của Intl đổi theo phiên bản ICU; đây là cột giáo vụ đọc
  // hằng ngày nên thứ tự phải cố định.
  for (const row of donCuaQuanTri) {
    assert.match(row.date, /^\d{2}:\d{2} - \d{2}\/\d{2}\/\d{4}$/, `đơn ${row.id} có ngày đăng ký "${row.date}"`);
  }
});

test("ngày đăng ký tính theo giờ Việt Nam, không phải giờ UTC", () => {
  // Đơn tạo lúc 08:42 UTC là 15:42 giờ Việt Nam. Sai múi giờ thì mọi đơn buổi
  // chiều bị ghi sang ngày hôm trước.
  const mau = donCuaQuanTri.find((row) => row.createdAt?.startsWith("2026-08-12T08:42"));
  assert.ok(mau, "cần một đơn minh họa có giờ tạo xác định để kiểm múi giờ");
  assert.equal(mau.date, "15:42 - 12/08/2026");
});

test("ô tìm kiếm lọc được cả theo mã học sinh", () => {
  assert.match(bang, /row\.studentCode \|\| ""/);
  assert.match(app, /placeholder="Tìm mã đơn, mã học sinh, tên học sinh, CLB\.\.\."/);
});

test("ngày sinh rỗng hiện dấu gạch chứ không phải chữ null", () => {
  const khop = bang.match(/const formatDateOfBirth[\s\S]*?\n\};/);
  assert.ok(khop, "thiếu hàm định dạng ngày sinh");
  const formatDateOfBirth = new Function(`${khop[0]}\nreturn formatDateOfBirth;`)();
  assert.equal(formatDateOfBirth(null), "—");
  assert.equal(formatDateOfBirth(""), "—");
  assert.equal(formatDateOfBirth("12/04/2017"), "12/04/2017", "giữ nguyên dạng nhà trường đã nhập");
  assert.equal(formatDateOfBirth("2017-04-12"), "12/04/2017", "đổi dạng ISO sang dd/mm/yyyy");
});

test("mọi giá trị từ cơ sở dữ liệu đều đi qua escapeHtml", () => {
  // Tên và mã học sinh đồng bộ từ Google Sheets, tức là văn bản người ngoài gõ
  // được. Nhả thẳng vào HTML là mở đường chèn thẻ.
  for (const truong of ["row.id", "row.student", "row.club", "row.className", "row.date"]) {
    assert.ok(bang.includes(`escapeHtml(${truong})`), `${truong} chưa đi qua escapeHtml`);
  }
});

test("số tiền vẫn hiện ở nơi người ta quyết định thu", () => {
  // Bảng không còn cột Phí theo yêu cầu, và trang "Đối soát phí" — vốn chỉ có số
  // liệu minh họa gõ cứng — đã được gỡ khỏi menu. Nếu nút không mang số tiền thì cả
  // cổng quản trị không còn chỗ nào thấy học phí của một đơn ngay lúc bấm, tức là
  // xác nhận thu tiền trong khi không biết thu bao nhiêu.
  assert.ok(!tenCot().includes("Phí"), "bảng không còn cột Phí");
  assert.match(bang, /data-confirm-payment="\$\{escapeHtml\(row\.id\)\}">Xác nhận \$\{formatMoney\(row\.amount\)\}/);
});
