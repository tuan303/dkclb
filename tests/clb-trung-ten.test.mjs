// CLB trùng tên và việc gộp chúng bằng tay.
//
// Trên máy chủ thật, "BÓNG ĐÁ CƠ BẢN" là BA bản ghi CLB, mỗi bản ghi một ca. Luật
// "mỗi em chỉ một lớp của một CLB" so theo mã CLB nên không chặn giữa ba bản ghi đó:
// một em khối 1 đăng ký được cả ca Thứ 2 lẫn ca Thứ 6 và đóng hai lần học phí. Cách
// chữa đã chốt là gộp về một CLB nhiều ca, bằng tay, theo các bước trang "CLB & lịch
// học" hướng dẫn. Tệp này khoá ba điều mà các bước đó dựa vào:
//
// 1. Trang nhận ra đúng các CLB trùng tên, và ô "Thuộc CLB" phân biệt được chúng —
//    không thì người gộp đang chọn giữa ba dòng chữ giống hệt nhau.
// 2. Chuyển ca sang CLB giữ lại thì luật một-CLB chặn ngay, kể cả với đơn đã có.
// 3. Chuyển ca KHÔNG làm đổi khối của ca. Ca không khai khối riêng thì kế thừa khối
//    của CLB, và trước khi sửa thì gộp là đổi lặng lẽ ai học được ca đó.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { startTestServer } from "./helpers/test-server.mjs";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

/** Cắt đúng thân một hàm cấp cao nhất — xem lý do ở tests/danh-sach-lop.test.mjs. */
function catHam(ten) {
  const dau = app.indexOf(`function ${ten}(`);
  assert.ok(dau >= 0, `app.js không còn hàm ${ten}`);
  const cuoi = app.indexOf("\n}", dau);
  assert.ok(cuoi > dau, `không tìm thấy dấu đóng của hàm ${ten}`);
  return app.slice(dau, cuoi + 2);
}

function catDong(mo) {
  const dau = app.indexOf(mo);
  assert.ok(dau >= 0, `app.js không còn "${mo}"`);
  const cuoi = app.indexOf(";\n", dau) >= 0 ? app.indexOf(";\n", dau) : app.indexOf(";\r\n", dau);
  return app.slice(dau, cuoi + 1);
}

/** Nạp chính mã trình duyệt, không mô phỏng lại. */
const TRANG_THAI_HIEU_LUC = ["submitted", "waitlist", "payment", "confirmed", "dang_hoc", "hoc_xong", "lui_khai_giang"];
function napTrungTen(catalog, { adminApplications = [], catalogPeriodId = null } = {}) {
  const nguon = [
    catDong("const escapeHtml = "),
    catDong("const boDau = "),
    ...["khoaTenClb", "soCaDangMo", "clbTrungTen", "nhanClbDayDu", "sapXepClbTheoTen",
      "renderNhanTrungTen", "renderCanhBaoClbTrungTen",
      "currentCatalogPeriod", "classesOfPeriod", "renderClasses"].map(catHam),
  ].join("\n");
  return new Function("state", "adminApplications", "ACTIVE_REGISTRATION_STATUSES", "statusBadge",
    "icon", "loadingPanel", "renderCatalogClubBlock", "renderCatalogImport",
    `${nguon}\nreturn { clbTrungTen, nhanClbDayDu, sapXepClbTheoTen, renderNhanTrungTen,
      renderCanhBaoClbTrungTen, renderClasses };`,
  )({ catalog, catalogPeriodId }, adminApplications, TRANG_THAI_HIEU_LUC, (status) => [`nhãn ${status}`, "blue"],
    () => "", () => "đang tải", () => "", () => "");
}

const clb = (id, code, name, grades = [1, 2], active = true) => ({ id, code, name, grades, active });
const ca = (id, clubId, active = true, periodId = "hk1") => ({ id, clubId, active, periodId });

/* ---------- 1. Nhận ra và phân biệt ---------- */

test("gom CLB trùng tên bất kể hoa thường, dấu cách thừa; CLB tên riêng thì không gom", () => {
  const { clbTrungTen } = napTrungTen({
    clubs: [
      clb("a", "BD2A1", "BÓNG ĐÁ CƠ BẢN"),
      clb("b", "BD4B1", "Bóng đá  cơ bản ", [3, 4, 5]),
      clb("c", "BD6A1", "BÓNG ĐÁ CƠ BẢN"),
      clb("d", "CL2B1", "CẦU LÔNG CHUYÊN SÂU"),
    ],
    classes: [],
  });
  const nhom = [...clbTrungTen().values()];
  assert.equal(nhom.length, 1);
  assert.deepEqual(nhom[0].map((item) => item.code), ["BD2A1", "BD4B1", "BD6A1"]);
});

test("CLB đã ẩn VÀ hết ca thì không tính là trùng, và ẩn đến khi còn một thì hết cảnh báo", () => {
  // Bước cuối của việc gộp là ẩn CLB đã hết ca. Làm xong mà cảnh báo vẫn còn thì
  // người ta không biết mình đã xong hay chưa.
  const catalog = {
    clubs: [clb("a", "BD2A1", "BÓNG ĐÁ CƠ BẢN"), clb("c", "BD6A1", "BÓNG ĐÁ CƠ BẢN", [1, 2], false)],
    classes: [ca("a1", "a")],
  };
  const { clbTrungTen, renderNhanTrungTen, renderCanhBaoClbTrungTen } = napTrungTen(catalog);
  assert.equal(clbTrungTen().size, 0);
  assert.equal(renderCanhBaoClbTrungTen(), "");
  assert.equal(renderNhanTrungTen(catalog.clubs[0]), "");
  assert.equal(renderNhanTrungTen(catalog.clubs[1]), "", "CLB đã gộp xong không được bảo gộp tiếp");
});

test("CLB đã ẩn mà CÒN ca đang mở vẫn tính là trùng — ẩn nhầm không được làm tắt cảnh báo", () => {
  // Ẩn CLB không đóng ca của nó: đơn trong ca đó vẫn hiệu lực, và luật một-CLB vẫn so
  // hai mã khác nhau. Đã đo: ẩn thẳng bản trùng mà không chuyển ca thì cảnh báo biến
  // mất trong khi em có đơn ở ca đó vẫn đăng ký được CLB kia.
  const catalog = {
    clubs: [clb("a", "BD2A1", "BÓNG ĐÁ CƠ BẢN"), clb("c", "BD6A1", "BÓNG ĐÁ CƠ BẢN", [1, 2], false)],
    classes: [ca("a1", "a"), ca("c1", "c")],
  };
  const { clbTrungTen, renderNhanTrungTen } = napTrungTen(catalog);
  assert.equal(clbTrungTen().size, 1);
  assert.match(renderNhanTrungTen(catalog.clubs[1]), /Trùng tên với 1 CLB khác: BD2A1/);
});

test("nhãn trong ô Thuộc CLB mang mã, khối và số ca đang mở TRONG ĐỢT của ca đang sửa", () => {
  const { nhanClbDayDu } = napTrungTen({
    clubs: [],
    classes: [ca("x1", "a"), ca("x2", "a"), ca("x3", "a", false), ca("x4", "a", true, "nhap"), ca("y1", "b")],
  });
  assert.equal(nhanClbDayDu(clb("a", "BD2A1", "BÓNG ĐÁ CƠ BẢN"), "hk1"), "BÓNG ĐÁ CƠ BẢN · BD2A1 · khối 1, 2 · 2 ca trong đợt");
  assert.equal(nhanClbDayDu(clb("a", "BD2A1", "BÓNG ĐÁ CƠ BẢN")), "BÓNG ĐÁ CƠ BẢN · BD2A1 · khối 1, 2 · 3 ca");
  assert.equal(nhanClbDayDu(clb("z", "MOI", "CLB mới", []), "hk1"), "CLB mới · MOI · chưa khai khối · 0 ca trong đợt");
});

test("cảnh báo nêu hậu quả, liệt kê mã từng nhóm, và thoát ký tự HTML trong tên", () => {
  const catalog = {
    clubs: [clb("a", "A1", "<b>Cờ vua</b>"), clb("b", "B1", "<b>Cờ vua</b>")],
    classes: [],
  };
  const { renderNhanTrungTen, renderCanhBaoClbTrungTen } = napTrungTen(catalog);
  const canh = renderCanhBaoClbTrungTen();
  assert.match(canh, /1 tên CLB đang bị trùng/);
  assert.match(canh, /một<\/b> bản ghi có nhiều lớp/);
  assert.match(canh, /&lt;b&gt;Cờ vua&lt;\/b&gt;/);
  assert.doesNotMatch(canh, /<b><b>/);
  assert.match(renderNhanTrungTen(catalog.clubs[0]), /Trùng tên với 1 CLB khác: B1/);
});

test("hướng dẫn gộp KHÔNG bảo mở rộng khối của CLB giữ lại, và dặn làm ở mọi đợt", () => {
  // Bước "sửa khối của CLB giữ lại cho đủ" từng nằm trong hướng dẫn. Đã đo: ca gốc của
  // CLB giữ lại không khai khối riêng thì kế thừa khối CLB, nên ca khối 1, 2 mở luôn
  // cho khối 3, 4, 5 — em khối 3 đăng ký được, và công cụ nhập xếp nhầm vào đó.
  const { renderCanhBaoClbTrungTen } = napTrungTen({
    clubs: [clb("a", "A1", "Bơi"), clb("b", "B1", "Bơi")], classes: [],
  });
  const canh = renderCanhBaoClbTrungTen();
  assert.doesNotMatch(canh, /Sửa khối của CLB giữ lại cho gồm đủ/);
  assert.match(canh, /Không sửa khối của CLB giữ lại/);
  assert.match(canh, /mọi đợt/);
});

test("ô Thuộc CLB xếp các CLB cùng tên (theo tên đã bỏ dấu) đứng liền nhau, và dùng nhãn đầy đủ", () => {
  const { sapXepClbTheoTen } = napTrungTen({ clubs: [], classes: [] });
  // Sắp theo tên gốc thì "BÓNG ĐÁ CHUYÊN SÂU" chen vào giữa nhóm "bóng đá cơ bản".
  const thuTu = sapXepClbTheoTen([
    clb("a", "BD4B1", "Bóng đá  cơ bản "), clb("b", "BDCS1", "BÓNG ĐÁ CHUYÊN SÂU"),
    clb("c", "BD6A1", "BÓNG ĐÁ CƠ BẢN"), clb("d", "BD2A1", "BÓNG ĐÁ CƠ BẢN"), clb("e", "AR", "Âm nhạc"),
  ]).map((item) => item.code);
  assert.deepEqual(thuTu, ["AR", "BDCS1", "BD2A1", "BD4B1", "BD6A1"]);

  const dau = app.indexOf("const clubOptions = ");
  assert.ok(dau >= 0, "app.js không còn ô chọn Thuộc CLB");
  const doan = app.slice(dau, app.indexOf(".join(\"\")", dau));
  assert.match(doan, /sapXepClbTheoTen\(/);
  assert.match(doan, /nhanClbDayDu\(item, /, "phải hiện mã/khối/số ca trong đợt, không chỉ tên");
});

test("dòng 'CLB chưa có lớp' không mời ẩn một CLB còn ca ở đợt khác", () => {
  // Danh sách này chỉ tính đợt đang xem. Đã đo: đang xem đợt nháp thì một CLB còn ca
  // nhận đơn ở đợt đang mở hiện nút "Sửa / ẩn", và ẩn nó là giấu các ca đó khỏi phụ huynh.
  const { renderClasses } = napTrungTen({
    periods: [{ id: "hk1", name: "HK1" }, { id: "nhap", name: "Nháp" }], activePeriodId: "hk1",
    clubs: [clb("a", "CON-CA", "Còn ca"), clb("b", "HET-CA", "Hết ca")],
    classes: [ca("a1", "a", true, "hk1")],
  }, { catalogPeriodId: "nhap" });
  const html = renderClasses();
  const conCa = html.slice(html.indexOf("CON-CA"), html.indexOf("</span></span>", html.indexOf("CON-CA")));
  const hetCa = html.slice(html.indexOf("HET-CA"), html.indexOf("</span></span>", html.indexOf("HET-CA")));
  assert.match(conCa, /còn 1 ca ở đợt khác/);
  assert.doesNotMatch(conCa, /data-edit-club/);
  assert.match(hetCa, /data-edit-club="b"/);
});

/* ---------- 2 & 3. Gộp trên máy chủ thật ---------- */

let server;
let quanTri;
let phuHuynh;
let dotId;

before(async () => {
  server = await startTestServer({ prefix: "nshm-trungten-" });
  quanTri = await server.loginCookie("admin@nshm.edu.vn", "Admin@123");
  phuHuynh = await server.loginCookie("0901234567", "123456");
  const periods = await (await server.request("/api/admin/periods", quanTri)).json();
  dotId = periods.periods.find((period) => period.status === "open").id;
});

after(async () => server?.stop());

const goi = async (path, cookie, method, body) => {
  const response = await server.request(path, cookie, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
};

async function taoClb(code, grades) {
  const r = await goi("/api/admin/clubs", quanTri, "POST", {
    code, name: "Bóng đá trùng tên", category: "Thể thao", grades, description: "", emoji: "⚽", active: true,
  });
  assert.equal(r.status, 201, r.text);
  return r.body.club.id;
}

async function taoCa(clubId, name, dayOfWeek, grades) {
  const r = await goi("/api/admin/classes", quanTri, "POST", {
    clubId, periodId: dotId, name, dayOfWeek, startTime: "16:15", endTime: "17:30", room: `Sân ${name}`,
    teacher: "Thầy Nam", capacity: 25, minCapacity: 0, enrolledBase: 0, fee: 0, grades, active: true,
  });
  assert.equal(r.status, 201, r.text);
  const catalog = (await goi("/api/admin/catalog", quanTri, "GET")).body;
  return catalog.classes.find((row) => row.name === name).id;
}

const kiemTra = async (classId) => (await goi("/api/registrations/validate", phuHuynh, "POST", {
  studentId: "hs01", clubIds: [classId],
})).body;

test("sau khi gộp, một em học được nhiều lớp của cùng CLB, vẫn không đăng ký lại được đúng lớp đã có", async () => {
  // hs01 học khối 3.
  const giuLai = await taoClb("TRUNG-A", [3]);
  const seGop = await taoClb("TRUNG-B", [3]);
  const caThu2 = await taoCa(giuLai, "Trùng tên Thứ 2", 1, []);
  const caThu6 = await taoCa(seGop, "Trùng tên Thứ 6", 5, []);

  const dangKy = await goi("/api/registrations", phuHuynh, "POST", {
    studentId: "hs01", clubIds: [caThu2], acceptedTerms: true,
  });
  assert.equal(dangKy.status, 201, dangKy.text);

  const chuyen = await goi(`/api/admin/classes/${caThu6}`, quanTri, "PATCH", { clubId: giuLai });
  assert.equal(chuyen.status, 200, chuyen.text);

  // Yêu cầu giáo vụ 11/09/2026: nhiều lớp của cùng CLB (khác ngày) là hợp lệ.
  const sauGop = await kiemTra(caThu6);
  assert.equal(sauGop.valid, true, JSON.stringify(sauGop.issues));
  const lopThuHai = await goi("/api/registrations", phuHuynh, "POST", {
    studentId: "hs01", clubIds: [caThu6], acceptedTerms: true,
  });
  assert.equal(lopThuHai.status, 201, lopThuHai.text);
  const dangKyLai = await goi("/api/registrations", phuHuynh, "POST", {
    studentId: "hs01", clubIds: [caThu6], acceptedTerms: true,
  });
  assert.equal(dangKyLai.status, 422, "đăng ký lại ĐÚNG lớp đã có vẫn phải bị chặn");

  const seGopDaAn = await goi(`/api/admin/clubs/${seGop}`, quanTri, "PATCH", { active: false });
  assert.equal(seGopDaAn.status, 200, "CLB đã hết ca phải ẩn được — đó là bước cuối của việc gộp");
});

test("chuyển ca sang CLB khác KHÔNG đổi khối của ca, dù ca đang kế thừa khối của CLB", async () => {
  const khoiNho = await taoClb("KE-THUA-X", [1, 2]);
  const khoiLon = await taoClb("KE-THUA-Y", [3, 4, 5]);
  const caKeThua = await taoCa(khoiLon, "Kế thừa Thứ 4", 3, []);
  const khoiHieuLuc = async () => (await kiemTra(caKeThua)).clubs[0].grade;
  assert.deepEqual(await khoiHieuLuc(), [3, 4, 5]);

  // Bước 2 của hướng dẫn: đổi ô Thuộc CLB. Trước khi sửa, ca thành khối 1, 2.
  const chuyen = await goi(`/api/admin/classes/${caKeThua}`, quanTri, "PATCH", { clubId: khoiNho, grades: [] });
  assert.equal(chuyen.status, 200, chuyen.text);
  assert.deepEqual(await khoiHieuLuc(), [3, 4, 5], "em khối 3 phải vẫn học được ca này sau khi gộp");

  // Bước 4: mở CLB giữ lại cho đủ khối. Trước khi sửa, ca thành khối 1–5.
  assert.equal((await goi(`/api/admin/clubs/${khoiNho}`, quanTri, "PATCH", { grades: [1, 2, 3, 4, 5] })).status, 200);
  assert.deepEqual(await khoiHieuLuc(), [3, 4, 5], "em khối 1 không được lọt vào ca của khối 3–5");

  // Lưu lại ca mà không đổi CLB thì không ghim gì thêm: bỏ trống vẫn là theo CLB.
  assert.equal((await goi(`/api/admin/classes/${caKeThua}`, quanTri, "PATCH", { grades: [] })).status, 200);
  // So khối ĐÃ LƯU chứ không chỉ khối hiệu lực: CLB lúc này là khối 1–5, nên một ca bị
  // ghim nhầm [1..5] và một ca đang kế thừa [1..5] cho cùng một khối hiệu lực.
  const daLuu = (await goi("/api/admin/catalog", quanTri, "GET")).body.classes.find((row) => row.id === caKeThua);
  assert.deepEqual(daLuu.grades, [], "lưu lại ca cùng CLB không được ghim khối");
  assert.equal((await goi(`/api/admin/clubs/${khoiNho}`, quanTri, "PATCH", { grades: [1, 2] })).status, 200);
  assert.deepEqual(await khoiHieuLuc(), [1, 2], "ca kế thừa phải đổi theo khi CLB đổi khối");
});

test("ca đã khai khối riêng thì chuyển CLB giữ nguyên khối riêng đó", async () => {
  const dich = await taoClb("RIENG-X", [1, 2]);
  const nguon = await taoClb("RIENG-Y", [3, 4, 5]);
  const caRieng = await taoCa(nguon, "Riêng Thứ 7", 6, [4]);
  assert.equal((await goi(`/api/admin/classes/${caRieng}`, quanTri, "PATCH", { clubId: dich })).status, 200);
  const catalog = (await goi("/api/admin/catalog", quanTri, "GET")).body;
  assert.deepEqual(catalog.classes.find((row) => row.id === caRieng).grades, [4]);
});

test("nhập lại file danh mục cũ sau khi gộp KHÔNG mở lại CLB đã ẩn và không tạo lại ca", async () => {
  // Đã đo trước khi sửa: nhập lại đúng file ban đầu (việc bình thường, vd để đổi tên
  // giáo viên) thì bật lại mọi CLB trùng tên đã ẩn và tạo lại ca của chúng trong cùng
  // phòng, cùng giờ — một em đã có ca Thứ 2 lại đăng ký được ca Thứ 6, hai lần học phí.
  const headers = ["Mã CLB", "Tên CLB", "Nhóm môn", "Khối", "Tên lớp", "Thứ", "Khung giờ", "Phòng", "Giáo viên", "Sĩ số", "Học phí"];
  const rows = [
    ["TK-A", "Bóng đá nhập lại", "Thể thao", "3", "TK Thứ 2", "Thứ 2", "18:00-19:00", "Sân TK A", "Thầy Nam", "25", "0"],
    ["TK-B", "Bóng đá nhập lại", "Thể thao", "3", "TK Thứ 4", "Thứ 4", "18:00-19:00", "Sân TK B", "Thầy Nam", "25", "0"],
    ["TK-C", "Bóng đá nhập lại", "Thể thao", "3", "TK Thứ 6", "Thứ 6", "18:00-19:00", "Sân TK C", "Thầy Nam", "25", "0"],
  ];
  const nhap = () => goi("/api/admin/catalog/import/commit", quanTri, "POST",
    { confirmation: "IMPORT_CLUB_CATALOG", periodId: dotId, headers, rows });
  const lan1 = await nhap();
  assert.equal(lan1.status, 200, lan1.text);

  const truoc = (await goi("/api/admin/catalog", quanTri, "GET")).body;
  const clbTheoMa = Object.fromEntries(truoc.clubs.filter((item) => item.code.startsWith("TK-")).map((item) => [item.code, item]));
  const caTheoTen = Object.fromEntries(truoc.classes.filter((item) => item.name.startsWith("TK ")).map((item) => [item.name, item]));
  assert.equal(Object.keys(caTheoTen).length, 3);

  const dangKy = await goi("/api/registrations", phuHuynh, "POST", {
    studentId: "hs01", clubIds: [caTheoTen["TK Thứ 2"].id], acceptedTerms: true,
  });
  assert.equal(dangKy.status, 201, dangKy.text);

  // Gộp theo đúng các bước trên trang.
  for (const ten of ["TK Thứ 4", "TK Thứ 6"]) {
    assert.equal((await goi(`/api/admin/classes/${caTheoTen[ten].id}`, quanTri, "PATCH", { clubId: clbTheoMa["TK-A"].id })).status, 200);
  }
  for (const ma of ["TK-B", "TK-C"]) {
    assert.equal((await goi(`/api/admin/clubs/${clbTheoMa[ma].id}`, quanTri, "PATCH", { active: false })).status, 200);
  }

  const lan2 = await nhap();
  assert.equal(lan2.status, 200, lan2.text);
  const { counters } = lan2.body.result;
  assert.equal(counters.classesCreated, 0, "không được tạo lại ca của CLB đã gộp");
  assert.equal(counters.classesUpdated, 3, "ba dòng phải cập nhật đúng ba ca đang có");
  assert.equal(counters.clubsGopVao, 2);

  const sau = (await goi("/api/admin/catalog", quanTri, "GET")).body;
  for (const ma of ["TK-B", "TK-C"]) {
    assert.equal(sau.clubs.find((item) => item.code === ma).active, false, `${ma} phải còn ẩn`);
  }
  assert.equal(sau.classes.filter((item) => item.name.startsWith("TK ") && item.active).length, 3);
  assert.ok(sau.classes.filter((item) => item.name.startsWith("TK ")).every((item) => item.clubId === clbTheoMa["TK-A"].id));

  const thuLai = await kiemTra(caTheoTen["TK Thứ 6"].id);
  assert.ok(thuLai.clubs.every((item) => item.id === caTheoTen["TK Thứ 6"].id), "ca vẫn là đúng ca đã chuyển, không phải bản sao");
});

/* ---------- Nhập lại danh mục: chỉ chuyển hướng khi chắc chắn là CLB đã gộp ---------- */

const TIEU_DE_DANH_MUC = ["Mã CLB", "Tên CLB", "Nhóm môn", "Khối", "Tên lớp", "Thứ", "Khung giờ", "Phòng", "Giáo viên", "Sĩ số", "Học phí"];
const dongDanhMuc = (ma, ten, lop, thu, phong) => [ma, ten, "Thể thao", "3", lop, thu, "19:00-20:00", phong, "Thầy Nam", "25", "0"];
const nhapDanhMuc = (rows, duong = "commit") => goi(`/api/admin/catalog/import/${duong}`, quanTri, "POST",
  { confirmation: "IMPORT_CLUB_CATALOG", periodId: dotId, headers: TIEU_DE_DANH_MUC, rows });
const docDanhMuc = async () => (await goi("/api/admin/catalog", quanTri, "GET")).body;

test("ẩn một CLB mà CHƯA chuyển ca rồi nhập lại: không sinh bản sao ca ở CLB cùng tên", async () => {
  // Đã đo trước khi siết: ca của RX-B (vẫn đang giữ đơn) được nhân bản sang RX-A, cùng
  // phòng cùng giờ; bước gộp sau đó vấp ROOM_CONFLICT và không làm tiếp được.
  const rows = [
    dongDanhMuc("RX-A", "Bơi nhập lại RX", "RX Thứ 2", "Thứ 2", "Hồ RX A"),
    dongDanhMuc("RX-B", "Bơi nhập lại RX", "RX Thứ 4", "Thứ 4", "Hồ RX B"),
  ];
  assert.equal((await nhapDanhMuc(rows)).status, 200);
  const truoc = await docDanhMuc();
  const rxB = truoc.clubs.find((item) => item.code === "RX-B");
  assert.equal((await goi(`/api/admin/clubs/${rxB.id}`, quanTri, "PATCH", { active: false })).status, 200);

  const lai = await nhapDanhMuc(rows);
  assert.equal(lai.status, 200, lai.text);
  assert.equal(lai.body.result.counters.classesCreated, 0, "không được tạo bản sao ca");
  const sau = await docDanhMuc();
  assert.equal(sau.classes.filter((item) => item.room === "Hồ RX B" && item.active).length, 1);
});

test("gộp dở dang còn hai CLB đang mở cùng tên: dòng của CLB đã gộp về đúng CLB đang giữ ca đó", async () => {
  // Đã đo trước khi siết: dòng PB-B đi sang PB-C (CLB đang mở cùng tên sau cùng) thay vì
  // PB-A nơi ca của nó đã được chuyển tới, và sinh một bản sao ca ở PB-C.
  const rows = [
    dongDanhMuc("PB-A", "Bơi gộp dở", "PB Thứ 2", "Thứ 2", "Hồ PB A"),
    dongDanhMuc("PB-B", "Bơi gộp dở", "PB Thứ 4", "Thứ 4", "Hồ PB B"),
    dongDanhMuc("PB-C", "Bơi gộp dở", "PB Thứ 6", "Thứ 6", "Hồ PB C"),
  ];
  assert.equal((await nhapDanhMuc(rows)).status, 200);
  const truoc = await docDanhMuc();
  const ma = (code) => truoc.clubs.find((item) => item.code === code);
  const caPbB = truoc.classes.find((item) => item.name === "PB Thứ 4");
  assert.equal((await goi(`/api/admin/classes/${caPbB.id}`, quanTri, "PATCH", { clubId: ma("PB-A").id })).status, 200);
  assert.equal((await goi(`/api/admin/clubs/${ma("PB-B").id}`, quanTri, "PATCH", { active: false })).status, 200);

  const xem = await nhapDanhMuc(rows, "preview");
  assert.deepEqual(xem.body.preview.gopVao, [{ code: "PB-B", name: "Bơi gộp dở", vao: ["PB-A"] }],
    "bản xem trước phải nói trước việc ghi vào CLB khác");

  const lai = await nhapDanhMuc(rows);
  assert.equal(lai.status, 200, lai.text);
  assert.equal(lai.body.result.counters.classesCreated, 0);
  const sau = await docDanhMuc();
  const caSau = sau.classes.filter((item) => item.name === "PB Thứ 4");
  assert.equal(caSau.length, 1);
  assert.equal(caSau[0].clubId, ma("PB-A").id);
  assert.equal(sau.clubs.find((item) => item.code === "PB-B").active, false);
});

test("file dùng lại mã của CLB đã ẩn cho một TÊN KHÁC thì không bị ghi sang CLB đang mở cùng tên cũ", async () => {
  // Mã khớp một CLB đã ẩn, nhưng tên trong file đã khác: đó là mở lại hoặc đổi tên CLB
  // đó, không phải dòng của CLB trùng tên đã gộp.
  const rows = [
    dongDanhMuc("CV-GIU", "Cờ vua tái dùng", "CV giữ", "Thứ 3", "Phòng CV 1"),
    dongDanhMuc("CV-CU", "Cờ vua tái dùng", "CV cũ", "Thứ 5", "Phòng CV 2"),
  ];
  assert.equal((await nhapDanhMuc(rows)).status, 200);
  const truoc = await docDanhMuc();
  const cu = truoc.clubs.find((item) => item.code === "CV-CU");
  const caCu = truoc.classes.find((item) => item.name === "CV cũ");
  assert.equal((await goi(`/api/admin/classes/${caCu.id}`, quanTri, "PATCH", { active: false })).status, 200);
  assert.equal((await goi(`/api/admin/clubs/${cu.id}`, quanTri, "PATCH", { active: false })).status, 200);

  const doiTen = [dongDanhMuc("CV-CU", "Cờ tướng mở mới", "CT mới", "Thứ 7", "Phòng CT")];
  const xem = await nhapDanhMuc(doiTen, "preview");
  assert.deepEqual(xem.body.preview.gopVao, []);
  assert.equal((await nhapDanhMuc(doiTen)).status, 200);
  const sau = await docDanhMuc();
  const caMoi = sau.classes.find((item) => item.name === "CT mới");
  assert.equal(caMoi.clubId, cu.id, "ca phải vào đúng CLB mang mã CV-CU");
  assert.notEqual(caMoi.clubId, truoc.clubs.find((item) => item.code === "CV-GIU").id);
});

test("khung cảnh báo CLB trùng tên xếp dọc, không vỡ thành các cột hẹp", async () => {
  // .inline-alert là flex hàng ngang. Khung có tiêu đề, đoạn văn và danh sách; không
  // ghi đè display thì mỗi phần thành một cột — đã đo: danh sách học sinh rộng 113px.
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.clb-trung-ten-khoi\s*\{[^}]*display:\s*block/);
  assert.match(app, /<div class="inline-alert clb-trung-ten-khoi">/);
});
