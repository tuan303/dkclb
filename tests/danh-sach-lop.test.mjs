// Trang "Danh sách lớp CLB": mỗi ca học một danh sách để giáo viên điểm danh và
// giáo vụ xếp lớp, thay cho trang "Đối soát phí" vốn chỉ là số liệu gõ cứng.
//
// Hai ranh giới được khoá ở đây:
//
// 1. PHẠM VI DỮ LIỆU. Trang này mở cho giáo vụ bằng quyền danh-sach-van-hanh, mà
//    roles.mjs ghi rõ phạm vi đó "không ngày sinh, không mã học sinh". Tôi đã một
//    lần vô tình mở hai trường này cho giáo vụ qua Dashboard; tệp này tồn tại để
//    lần thứ hai không xảy ra.
// 2. DANH SÁCH CHÍNH THỨC. Từ khi chỗ chỉ được giữ lúc đóng phí, "danh sách lớp"
//    mặc định phải là các em ĐÃ ĐÓNG PHÍ. In nhầm cả đơn còn treo rồi mang đi
//    điểm danh là gọi tên những em chưa chắc đã học.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { startTestServer } from "./helpers/test-server.mjs";
import { ACTIVE_REGISTRATION_STATUSES, SEAT_HOLDING_STATUSES, STATUS, statusLabel } from "../registration-status.mjs";

let server;
let adminCookie;
let giaovuCookie;

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

/** Cắt nguồn có khẳng định mốc — xem lý do ở tests/cot-don-dang-ky.test.mjs. */
function catDoan(tu, den) {
  const dau = app.indexOf(tu);
  const cuoi = app.indexOf(den, dau + 1);
  assert.ok(dau >= 0, `app.js không còn mốc "${tu}"`);
  assert.ok(cuoi > dau, `app.js không còn mốc "${den}" sau "${tu}"`);
  return app.slice(dau, cuoi);
}

const csv = async (query, cookie) => {
  const response = await server.request(`/api/admin/reports/registrations.csv${query}`, cookie);
  assert.equal(response.status, 200, `tải CSV thất bại: ${query}`);
  return (await response.text()).replace(/^﻿/, "").split("\r\n").filter(Boolean);
};

before(async () => {
  server = await startTestServer({ prefix: "nshm-dslop-" });
  adminCookie = await server.loginCookie("admin@nshm.edu.vn", "Admin@123");
  giaovuCookie = await server.loginCookie("giaovu@nshm.edu.vn", "Admin@123");
});

after(async () => server.stop());

/* ---------- Trang cũ đã gỡ ---------- */

test("trang Đối soát phí không còn trong cổng quản trị", () => {
  // Trang đó chưa từng nối vào một đồng nào trong cơ sở dữ liệu: bốn ô số và một
  // sơ đồ đều gõ cứng. Nhà trường yêu cầu ẩn đi, nên gỡ cả mục menu lẫn hàm dựng
  // — để lại hàm là để dành một trang giả cho người sau bật lại và tưởng nó thật.
  const nav = catDoan("const adminNav = [", "const pageMeta");
  assert.ok(!nav.includes('id: "finance"'), "adminNav vẫn còn mục Đối soát phí");
  assert.ok(!app.includes("function renderFinance"), "app.js vẫn còn hàm dựng trang Đối soát phí");
  assert.ok(!app.includes("Đối soát phí"), "app.js vẫn còn nhãn Đối soát phí");
});

/* ---------- Menu mới và quyền ---------- */

test("mục Danh sách lớp CLB gắn đúng quyền danh sách vận hành", () => {
  const nav = catDoan("const adminNav = [", "const pageMeta");
  const dong = nav.split("\n").find((row) => row.includes('id: "rosters"'));
  assert.ok(dong, "adminNav thiếu mục Danh sách lớp CLB");
  assert.match(dong, /cap: "danh-sach-van-hanh"/);
});

test("giáo vụ có quyền vào trang này, đúng như menu hứa", async () => {
  // Menu hiện theo quyền máy chủ trả về; nếu máy chủ không cho thì mục menu là
  // một lời hứa suông dẫn tới 403.
  const me = await (await server.request("/api/me", giaovuCookie)).json();
  assert.ok(me.user.capabilities.includes("danh-sach-van-hanh"),
    `giáo vụ phải có quyền danh-sach-van-hanh, đang có: ${me.user.capabilities.join(", ")}`);
});

/* ---------- Phạm vi dữ liệu ---------- */

test("trang danh sách lớp KHÔNG đụng tới mã học sinh và ngày sinh", () => {
  // Cắt đúng hai hàm dựng trang, không hơn: nới rộng mốc là bài kiểm quét trúng
  // mã của trang khác rồi báo động nhầm — hoặc tệ hơn, báo yên nhầm.
  const trang = catDoan("function renderRosters()", "function renderReports()");
  for (const truong of ["studentCode", "dateOfBirth", "parentPhone", "phone", "email"]) {
    assert.ok(!trang.includes(truong),
      `trang danh sách lớp không được nhắc tới ${truong} — ngoài phạm vi quyền danh-sach-van-hanh`);
  }
});

test("tệp CSV của một ca học cũng không mang thông tin cá nhân ngoài phạm vi", async () => {
  const [tieuDe] = await csv("?classId=piano", giaovuCookie);
  for (const cot of ["Ngày sinh", "Mã học sinh", "Số điện thoại", "Email", "Mã kích hoạt"]) {
    assert.ok(!tieuDe.includes(cot), `tệp xếp lớp không được chứa cột ${cot}`);
  }
  assert.match(tieuDe, /Học sinh/);
});

/* ---------- Lọc theo ca và theo phí ---------- */

test("xuất một ca chỉ ra đúng đơn của ca đó", async () => {
  const tatCa = await csv("", adminCookie);
  const rieng = await csv("?classId=piano", adminCookie);
  assert.ok(rieng.length > 1, "ca piano phải có ít nhất một đơn trong dữ liệu mẫu");
  assert.ok(rieng.length < tatCa.length, "lọc theo ca phải ra ít dòng hơn cả đợt");

  const donPiano = (await (await server.request("/api/registrations", adminCookie)).json())
    .registrations.filter((row) => row.classId === "piano");
  assert.equal(rieng.length - 1, donPiano.length, "số dòng phải khớp số đơn thật của ca đó");
});

test("ca học không tồn tại ra tệp rỗng, KHÔNG ra cả trường", async () => {
  // Gõ sai mã ca mà nhận về danh sách toàn trường là kiểu sai im lặng tệ nhất:
  // người ta in ra rồi mang đi điểm danh.
  const dong = await csv("?classId=khong-co-that", adminCookie);
  assert.equal(dong.length, 1, "chỉ được còn đúng dòng tiêu đề");
});

test("danh sách chính thức chỉ gồm các em ĐÃ ĐÓNG PHÍ", async () => {
  const nhanGiuCho = new Set(SEAT_HOLDING_STATUSES.map(statusLabel));
  const chinhThuc = await csv("?phamVi=giu-cho", adminCookie);
  const tieuDe = chinhThuc[0].split('","').map((o) => o.replaceAll('"', ""));
  const cotTrangThai = tieuDe.indexOf("Trạng thái");
  assert.ok(cotTrangThai >= 0, "tệp phải có cột Trạng thái");

  assert.ok(chinhThuc.length > 1, "dữ liệu mẫu phải có ít nhất một em đã đóng phí");
  for (const dong of chinhThuc.slice(1)) {
    const nhan = dong.split('","').map((o) => o.replaceAll('"', ""))[cotTrangThai];
    assert.ok(nhanGiuCho.has(nhan), `danh sách chính thức lọt trạng thái "${nhan}"`);
  }
  assert.ok(chinhThuc.length < (await csv("", adminCookie)).length,
    "dữ liệu mẫu phải có đơn chưa đóng phí để phép lọc này có ý nghĩa");
});

test("nút tải trên màn hình xuất đúng cái đang hiện", () => {
  // Màn hình đang lọc "chính thức" mà tệp tải về lại là mọi đơn thì giáo vụ điểm
  // danh theo một danh sách khác với cái vừa nhìn.
  const ham = catDoan("function exportRosterCsv(", "function exportCsv()");
  assert.match(ham, /state\.rosterOnlyPaid !== false/);
  assert.match(ham, /params\.set\("phamVi", .*"giu-cho" : "hieu-luc"\)/);
  assert.match(ham, /params\.set\("classId", classId\)/);
});

test("tệp tải về khớp ĐÚNG số dòng màn hình đang hiện, ở CẢ HAI chế độ", async () => {
  // Đây là lỗi đã lọt một lần: chế độ "Kèm đơn chưa đóng phí" trên màn hình lọc
  // theo đơn CÒN HIỆU LỰC, còn tệp tải về lại không lọc gì, nên thừa cả đơn Lớp
  // hủy và Hoàn phí. Có ca màn hình ghi "Chưa có đơn nào" mà nút CSV ngay cạnh
  // vẫn tải về một dòng mang tên học sinh — đủ để gọi tên một em đã nghỉ.
  //
  // Nên bài này dựng sẵn HAI đơn ở nhánh nhả chỗ rồi mới so hai con số.
  const LOP = "piano";
  const donLop = (await (await server.request("/api/registrations", adminCookie)).json())
    .registrations.filter((row) => row.classId === LOP);
  assert.ok(donLop.length >= 2, "dữ liệu mẫu phải có ít nhất hai đơn cho ca này");
  const dat = (id, status) => server.request(`/api/admin/registrations/${encodeURIComponent(id)}/status`,
    adminCookie, { method: "PATCH", body: JSON.stringify({ status }) });
  // Một đơn đã HOÀN PHÍ (đã nhả chỗ, màn hình không hiện ở chế độ nào) và một đơn
  // CHỜ THANH TOÁN (màn hình chỉ hiện ở chế độ thứ hai). Đúng bộ dữ liệu làm lộ lỗi.
  assert.equal((await dat(donLop[0].id, STATUS.hoanPhi)).status, 200);
  assert.equal((await dat(donLop[1].id, STATUS.choThanhToan)).status, 200);

  const tatCaDon = (await (await server.request("/api/registrations", adminCookie)).json()).registrations;
  for (const [phamVi, tap] of [["giu-cho", SEAT_HOLDING_STATUSES], ["hieu-luc", ACTIVE_REGISTRATION_STATUSES]]) {
    const manHinh = tatCaDon.filter((row) => row.classId === LOP && tap.includes(row.status)).length;
    const tep = (await csv(`?classId=${LOP}&phamVi=${phamVi}`, adminCookie)).length - 1;
    assert.equal(tep, manHinh, `chế độ ${phamVi}: màn hình ${manHinh} dòng nhưng tệp ${tep} dòng`);
  }
  // Chốt luôn con số tuyệt đối, để bài không tự đúng khi cả hai vế cùng sai.
  assert.equal((await csv(`?classId=${LOP}&phamVi=giu-cho`, adminCookie)).length - 1, 0);
  assert.equal((await csv(`?classId=${LOP}&phamVi=hieu-luc`, adminCookie)).length - 1, 1);

  // Đơn đã hoàn phí KHÔNG được có mặt ở bất kỳ chế độ nào.
  const nhanHoanPhi = statusLabel(STATUS.hoanPhi);
  for (const phamVi of ["giu-cho", "hieu-luc"]) {
    for (const dong of (await csv(`?classId=${LOP}&phamVi=${phamVi}`, adminCookie)).slice(1)) {
      assert.ok(!dong.includes(`"${nhanHoanPhi}"`), `chế độ ${phamVi} lọt đơn "${nhanHoanPhi}": ${dong}`);
    }
  }
});

test("không truyền phạm vi thì vẫn xuất mọi đơn, như trang Báo cáo vẫn làm", async () => {
  // Nút "Xuất danh sách đăng ký (CSV)" ở trang Báo cáo gọi endpoint này KHÔNG kèm
  // tham số nào. Siết mặc định lại là lặng lẽ cắt mất đơn của giáo vụ ở trang khác.
  const tatCaDon = (await (await server.request("/api/registrations", adminCookie)).json()).registrations;
  const tep = (await csv("", adminCookie)).length - 1;
  assert.equal(tep, tatCaDon.length, "không có tham số thì phải xuất đủ mọi đơn");
});

test("tệp danh sách học sinh không được nằm lại ở bộ nhớ đệm", async () => {
  // Đường dẫn kết thúc bằng .csv nên rơi vào diện cache-theo-đuôi-tệp mặc định của
  // CDN, mà trang thật chạy sau Cloudflare. Thân tệp là họ tên và lớp của học sinh.
  const response = await server.request("/api/admin/reports/registrations.csv?classId=piano", adminCookie);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("tên tệp tải về luôn là ASCII", async () => {
  // Content-Disposition đi trong header HTTP; ký tự ngoài ASCII ở đó làm hỏng
  // tên tệp trên máy người dùng, còn dấu nháy thì mở đường chèn header.
  const response = await server.request("/api/admin/reports/registrations.csv?classId=piano", adminCookie);
  const header = response.headers.get("content-disposition");
  assert.ok(/^[\x20-\x7E]+$/.test(header), `tên tệp không phải ASCII: ${header}`);
  assert.ok(header.includes("piano"), `tên tệp phải nhắc tới ca học: ${header}`);
});

/* ---------- Bản in ---------- */

test("khối @media print phải nằm CUỐI tệp css, không thì nửa khối là mã chết", async () => {
  // @media KHÔNG cộng thêm độ ưu tiên. `.roster-panel` trong khối print (0,1,0) chỉ
  // thắng `.panel` (0,1,0) nếu nó đứng SAU. Đặt khối ở giữa tệp thì các luật bỏ bóng
  // đổ và kẻ viền im lặng mất tác dụng — đã đo bằng Chrome ở media=print: bóng đổ
  // vẫn nguyên trong khi mã nguồn đọc như thể đã bỏ.
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  const moc = css.indexOf("@media print");
  assert.ok(moc > 0, "styles.css phải có khối @media print");
  const sauKhoi = css.slice(moc).split("\n").slice(1);
  const dongDong = sauKhoi.findIndex((dong) => dong.trimEnd() === "}");
  assert.ok(dongDong >= 0, "không tìm thấy dấu đóng của khối @media print");
  const conLai = sauKhoi.slice(dongDong + 1).join("\n").trim();
  assert.equal(conLai, "", `còn ${conLai.split("\n").length} dòng css sau khối print, chúng sẽ đè lên nó`);
});

test("bản in bỏ khung ứng dụng nhưng GIỮ tiêu đề và bảng", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  const khoi = css.slice(css.indexOf("@media print"));
  // Ẩn khung, giỏ đăng ký và popup — chúng nằm ngoài màn hình nhờ transform chứ
  // không phải display:none, nên khi in sẽ đáp thẳng xuống tờ giấy.
  for (const chon of [".sidebar", ".topbar", "[data-no-print]", ".cart-drawer", ".modal-backdrop"]) {
    assert.ok(khoi.includes(chon), `khối print phải ẩn ${chon}`);
  }
  // .hidden phải được nhắc lại BÊN TRONG khối, và phải đứng SAU luật bung khung ra,
  // không thì in ở màn hình đăng nhập sẽ bung cả khung ứng dụng đang ẩn.
  const viTriBung = khoi.indexOf(".app-shell");
  const viTriAn = khoi.indexOf(".hidden");
  assert.ok(viTriAn > viTriBung && viTriAn > 0, "luật .hidden phải đứng sau luật bung khung");
  // Bảng dài hơn tờ giấy phải ngắt được, và lặp lại hàng tiêu đề.
  assert.match(khoi, /\.roster-table thead \{ display: table-header-group/);
});

test("mọi màu ô thống kê dùng trong app.js đều có thật trong css", async () => {
  // renderStat("spark", "green", ...) từng làm ô thứ tư mất nền: styles.css chỉ khai
  // blue/aqua/gold/red. Sai kiểu này không nổ ở đâu cả, chỉ lặng lẽ xấu.
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  const coThat = new Set([...css.matchAll(/\.stat-icon\.([a-z]+)/g)].map((m) => m[1]));
  assert.ok(coThat.size >= 4, `không đọc được bảng màu .stat-icon: ${[...coThat]}`);
  const dungTrongApp = new Set([...app.matchAll(/renderStat\(\s*"[^"]+"\s*,\s*"([a-z]+)"/g)].map((m) => m[1]));
  const bienThe = [...app.matchAll(/renderStat\(\s*"[^"]+"\s*,\s*[^,]*\?\s*"([a-z]+)"\s*:\s*"([a-z]+)"/g)];
  for (const m of bienThe) { dungTrongApp.add(m[1]); dungTrongApp.add(m[2]); }
  assert.ok(dungTrongApp.size > 0, "không tìm thấy lời gọi renderStat nào trong app.js");
  for (const mau of dungTrongApp) {
    assert.ok(coThat.has(mau), `app.js dùng màu "${mau}" nhưng styles.css không khai .stat-icon.${mau}`);
  }
});
