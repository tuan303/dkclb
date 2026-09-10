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

test("mã học sinh và ngày sinh chỉ hiện cho người có quyền duyệt đơn", () => {
  // Nhà trường muốn bảng học sinh có mã học sinh và ngày sinh như màn danh sách lớp
  // bên hệ thống quản lý học sinh. Nhưng roles.mjs ghi rõ phạm vi danh-sach-van-hanh
  // của giáo vụ KHÔNG gồm hai trường đó, mà chính giáo vụ là người mở trang này
  // nhiều nhất. Nên hai cột phải nằm sau đúng cái quyền đang chắn trang Đơn đăng ký.
  const bang = catDoan("function renderRosterStudents(", "function renderReports()");
  assert.ok(bang.includes('const xemDinhDanh = hasCap("duyet-don")'),
    "bảng học sinh phải lấy quyền duyet-don làm cổng cho hai cột định danh");
  for (const truong of ["studentCode", "dateOfBirth"]) {
    const dong = bang.split("\n").filter((row) => row.includes(truong));
    assert.ok(dong.length > 0, `bảng học sinh phải có cột ${truong}`);
    for (const row of dong) {
      assert.ok(row.includes("xemDinhDanh ?"),
        `cột ${truong} phải nằm sau cổng quyền xemDinhDanh, dòng: ${row.trim()}`);
    }
  }
  // Số điện thoại và email phụ huynh thì KHÔNG có cửa nào cả — ngoài phạm vi của
  // cả hai vai trò trên trang này.
  for (const truong of ["parentPhone", '"phone"', '"email"']) {
    assert.ok(!bang.includes(truong), `bảng học sinh không được nhắc tới ${truong}`);
  }
});

test("máy chủ KHÔNG gửi mã học sinh và ngày sinh cho giáo vụ, dù giao diện có lỡ hiện", async () => {
  // Che ở giao diện là lớp thứ hai. Lớp thứ nhất là máy chủ không gửi — đúng nguồn
  // dữ liệu mà trang này dùng, chứ không phải một endpoint nào khác.
  const cua = async (cookie) => (await (await server.request("/api/registrations", cookie)).json()).registrations;
  const cuaGiaoVu = await cua(giaovuCookie);
  assert.ok(cuaGiaoVu.length > 0, "dữ liệu mẫu phải có đơn");
  for (const row of cuaGiaoVu) {
    assert.equal(row.studentCode, undefined, `đơn ${row.id} lọt mã học sinh cho giáo vụ`);
    assert.equal(row.dateOfBirth, undefined, `đơn ${row.id} lọt ngày sinh cho giáo vụ`);
  }
  // Người duyệt đơn thì có, không thì cột bật ra cũng rỗng.
  const cuaQuanTri = await cua(adminCookie);
  assert.ok(cuaQuanTri.some((row) => row.studentCode), "quản trị phải nhận được mã học sinh");
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

test("mỗi nút tải nói rõ phạm vi của mình, không đi mượn trạng thái ở chỗ khác", () => {
  // Nút trong popup phải theo đúng chế độ đang chọn trong popup đó. Nút "Xuất toàn
  // bộ" ngoài trang thì KHÔNG được mượn chế độ ấy: trên trang không có dấu hiệu nào
  // cho biết đang ở chế độ gì, mà chế độ đó lại bị đổi lén từ popup của một ca khác.
  const ham = catDoan("function exportRosterCsv(", "function exportCsv()");
  assert.ok(!ham.includes("state.rosterOnlyPaid"),
    "hàm xuất không được tự đọc trạng thái popup — phạm vi phải do nơi gọi truyền vào");
  assert.match(ham, /params\.set\("phamVi", phamVi === "giu-cho" \? "giu-cho" : "hieu-luc"\)/);
  assert.match(ham, /params\.set\("classId", classId\)/);

  const trang = catDoan("function renderRosters()", "function renderRosterResults()");
  assert.match(trang, /data-roster-csv-all/);
  const goiNgoaiTrang = app.slice(app.indexOf('$("[data-roster-csv-all]")'));
  assert.match(goiNgoaiTrang.split("\n")[0], /exportRosterCsv\("", "hieu-luc"\)/,
    "nút ngoài trang phải xuất phạm vi cố định, ghi rõ trên nhãn nút");

  const popup = catDoan("function renderRosterDetail()", "function renderRosterStudents(");
  assert.match(popup, /exportRosterCsv\(el\.dataset\.rosterCsvCa, state\.rosterOnlyPaid !== false \? "giu-cho" : "hieu-luc"\)/);
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

/* ---------- Bảng tra cứu: chạy chính mã của trình duyệt ---------- */

/**
 * Nạp đúng khối hàm dựng bảng từ public/app.js rồi gọi thẳng, với dữ liệu giả lập
 * y như hai lời gọi API thật. Không mô phỏng lại logic ở đây: mô phỏng lại thì bài
 * kiểm chỉ chứng minh bản sao của tôi đúng, chứ không nói gì về mã đang chạy.
 */
function napBangLop({ clubs, adminApplications, state = {} }) {
  const nguon = catDoan("const conSo = ", "function renderRosterDetail()");
  const tao = new Function(
    "SEAT_HOLDING_STATUSES", "ACTIVE_REGISTRATION_STATUSES", "clubs", "adminApplications",
    "state", "escapeHtml", "icon", "renderStat",
    `${nguon}\nreturn { renderRosters, renderRosterResults, danhSachCaHoc, boDau, trangThaiCa };`,
  );
  return tao(
    SEAT_HOLDING_STATUSES, ACTIVE_REGISTRATION_STATUSES, clubs, adminApplications,
    { rosterPage: 1, rosterPageSize: 10, rosterSearch: "", period: null, ...state },
    (value) => String(value ?? ""), () => "", () => "",
  );
}

const CA_MAU = [
  { id: "mythuat", name: "Mỹ thuật sáng tạo", className: "", schedule: "Thứ 4 · 16:15–17:30", room: "Phòng Mỹ thuật 2", teacher: "Cô Minh Trang", category: "Nghệ thuật", capacity: 20, minCapacity: 0, enrolled: 1, pending: 0 },
  { id: "piano", name: "Piano nhập môn", className: "", schedule: "Thứ 3 · 16:15–17:30", room: "Phòng Âm nhạc 1", teacher: "Cô Phương Linh", category: "Âm nhạc", capacity: 12, minCapacity: 0, enrolled: 0, pending: 1 },
];
const DON_MAU = [
  { id: "DK-1", classId: "mythuat", club: "Mỹ thuật sáng tạo", classLabel: "", student: "Đỗ Gia Linh", studentId: "hs1", className: "3A4", status: "confirmed", feePaid: true },
  { id: "DK-2", classId: "piano", club: "Piano nhập môn", classLabel: "", student: "Nguyễn Minh An", studentId: "hs2", className: "3A2", status: "payment", feePaid: false },
];

test("ca học đã tắt / thuộc đợt khác VẪN hiện ra, không nuốt mất học sinh", () => {
  // Đầu mỗi học kỳ nhà trường đóng đợt cũ và mở đợt mới, lúc đó /api/clubs không
  // còn trả về ca nào của đợt trước — nhưng học sinh của các ca đó vẫn đang học.
  // Bỏ im lặng là mất tên một em khỏi danh sách điểm danh mà không ai biết.
  const donCuHoc = { id: "DK-3", classId: "debate-hk1", club: "English Debate", classLabel: "Ca chính",
    student: "Phạm Anh Tú", studentId: "hs3", className: "6A2", status: "dang_hoc", feePaid: true };
  const bang = napBangLop({ clubs: CA_MAU, adminApplications: [...DON_MAU, donCuHoc] });

  const ds = bang.danhSachCaHoc();
  const moCoi = ds.find((ca) => ca.id === "debate-hk1");
  assert.ok(moCoi, "ca ngoài đợt phải có mặt trong danh sách");
  assert.equal(moCoi.moCoi, true);
  assert.equal(moCoi.name, "English Debate", "phải gọi đúng tên CLB, không phải mã ca thô");

  const html = bang.renderRosterResults();
  assert.match(html, /English Debate/, "ca ngoài đợt phải có dòng trên bảng");
  assert.match(html, /không thuộc đợt đang mở/, "phải nói rõ vì sao ca này nằm ở đây");
  assert.deepEqual(bang.trangThaiCa(moCoi), ["Ngoài đợt đang mở", "purple"]);
});

test("tìm kiếm bỏ dấu được và tìm được cả tên học sinh", () => {
  // Gõ đủ dấu trên máy trường phải qua bộ gõ, mà bộ gõ thì hay nuốt chữ. Và câu hỏi
  // giáo vụ hay phải trả lời nhất là "em này đang học ca nào".
  const goTim = (tu) => napBangLop({
    clubs: CA_MAU, adminApplications: DON_MAU, state: { rosterSearch: tu },
  }).renderRosterResults();

  assert.match(goTim("my thuat"), /Kết quả tra cứu: 1 ca học/, "gõ không dấu phải ra đúng ca");
  assert.match(goTim("my thuat"), /Mỹ thuật sáng tạo/);
  assert.match(goTim("nguyen minh an"), /Kết quả tra cứu: 1 ca học/, "tìm theo tên học sinh");
  assert.match(goTim("nguyen minh an"), /Piano nhập môn/, "phải ra đúng ca của em ấy");
  assert.match(goTim("khong-co-gi-khop"), /Kết quả tra cứu: 0 ca học/);
});

test("con số học sinh đi theo bảng đang hiện, không phải con số toàn hệ thống", () => {
  // Nó đứng ngay cạnh "Kết quả tra cứu", nên đứng yên trong khi bảng lọc còn 0 dòng
  // là tự cãi chính mình: bảng trống trơn mà vẫn khẳng định có người.
  const dem = (tu) => {
    const html = napBangLop({ clubs: CA_MAU, adminApplications: DON_MAU, state: { rosterSearch: tu } })
      .renderRosterResults();
    return Number(html.match(/Số lượng học sinh: (\d+) học sinh/)?.[1]);
  };
  assert.equal(dem(""), 1, "cả hai ca: đúng một em đang giữ chỗ");
  assert.equal(dem("piano"), 0, "lọc còn ca Piano: em duy nhất đang giữ chỗ không thuộc ca đó");
  assert.equal(dem("khong-co-gi-khop"), 0, "bảng trống thì con số cũng phải về 0");
});
