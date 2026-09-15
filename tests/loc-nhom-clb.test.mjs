// Cổng phụ huynh: mặc định hiện đủ các lớp CLB em đăng ký được, lọc theo nhóm CLB
// (yêu cầu ngày 15/09/2026). Trước đó màn Tổng quan chỉ gợi ý 3 lớp.
//
// Nạp chính mã trình duyệt trong public/app.js rồi chạy, không mô phỏng lại.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

function catHam(ten) {
  const dau = app.indexOf(`function ${ten}(`);
  assert.ok(dau >= 0, `app.js không còn hàm ${ten}`);
  const cuoi = app.indexOf("\n}", dau);
  return app.slice(dau, cuoi + 2);
}

function catDong(mo) {
  const dau = app.indexOf(mo);
  assert.ok(dau >= 0, `app.js không còn "${mo}"`);
  const cuoi = app.indexOf(";\r\n", dau) >= 0 ? app.indexOf(";\r\n", dau) : app.indexOf(";\n", dau);
  return app.slice(dau, cuoi + 1);
}

const lop = (id, category, grade, ma = "con-nhan", name = id) => ({ id, name, category, grade, trangThaiLop: { ma } });
const DANH_MUC = [
  lop("bd1", "Thể thao", [2, 3], "da-du", "Bóng đá chuyên sâu"),
  lop("bd2", "Thể thao", [1, 2], "con-nhan", "Bóng đá cơ bản"),
  lop("ve", "Nghệ thuật", [2], "sap-du", "Mỹ thuật"),
  lop("piano", "Âm nhạc", [4, 5], "con-nhan", "Piano"),
];

function nap({ khoi = 2, filters = {} } = {}) {
  const nguon = [
    catDong("const escapeHtml = "),
    ...["eligibleClubs", "nhomClbCuaEm", "nhomDangLoc", "clubsTruocLocNhom", "filteredClubs", "renderLocNhomClb"].map(catHam),
    "return { eligibleClubs, nhomClbCuaEm, nhomDangLoc, filteredClubs, renderLocNhomClb, clubsTruocLocNhom };",
  ].join("\n");
  const state = { filters: { search: "", category: "all", availability: "all", ...filters } };
  const ham = new Function("state", "clubs", "gradeNumber", nguon)(state, DANH_MUC, () => khoi);
  const nut = (html) => [...html.matchAll(/data-loc-nhom="([^"]*)"[^>]*>([^<]*)<b>(\d+)<\/b>/g)]
    .map((m) => ({ nhom: m[1], so: Number(m[3]), active: /filter-chip active/.test(html.slice(html.lastIndexOf("<button", m.index), m.index)) }));
  return { state, ...ham, nut };
}

test("Tổng quan hiện ĐỦ các lớp em đăng ký được, không cắt còn 3 gợi ý", () => {
  const home = catHam("renderParentHome");
  assert.doesNotMatch(home, /slice\(0,\s*3\)/, "màn Tổng quan không được cắt danh sách");
  assert.match(home, /renderLocNhomClb\(\)/, "màn Tổng quan phải có hàng lọc theo nhóm");
  const trangKhamPha = catHam("renderClubsPage");
  assert.doesNotMatch(trangKhamPha, /category-filter/, "trang Khám phá CLB dùng chung hàng nút nhóm");
  assert.match(trangKhamPha, /renderLocNhomClb\(clubsTruocLocNhom\(\)\)/,
    "ở Khám phá CLB, số trên nút nhóm phải đếm sau tìm kiếm và lọc trạng thái");
  assert.match(catHam("renderClubCard"), /Khối \$\{escapeHtml\(club\.grade\.join/, "thẻ lớp hiện khối áp dụng");
});

test("nút nhóm chỉ gồm nhóm có lớp cho khối của em, kèm đúng số lớp", () => {
  const { renderLocNhomClb, nut } = nap({ khoi: 2 });
  assert.deepEqual(nut(renderLocNhomClb()), [
    { nhom: "all", so: 3, active: true },
    { nhom: "Nghệ thuật", so: 1, active: false },
    { nhom: "Thể thao", so: 2, active: false },
  ], "Âm nhạc chỉ có lớp khối 4–5 nên không hiện cho em khối 2");
});

test("chọn nhóm thì chỉ còn lớp của nhóm đó", () => {
  const { filteredClubs } = nap({ khoi: 2, filters: { category: "Thể thao" } });
  assert.deepEqual(filteredClubs().map((club) => club.id), ["bd1", "bd2"]);
});

test("đổi sang em khác không có nhóm đang lọc thì về Tất cả, không ra danh sách rỗng", () => {
  const { nhomDangLoc, filteredClubs } = nap({ khoi: 5, filters: { category: "Thể thao" } });
  assert.equal(nhomDangLoc(), "all");
  assert.deepEqual(filteredClubs().map((club) => club.id), ["piano"]);
});

test("ở Khám phá CLB, số trên nút nhóm đếm sau tìm kiếm và lọc trạng thái — bấm nút ra đúng số đó", () => {
  const { renderLocNhomClb, clubsTruocLocNhom, filteredClubs, nut, state } = nap({ khoi: 2, filters: { availability: "open" } });
  const cacNut = nut(renderLocNhomClb(clubsTruocLocNhom()));
  assert.deepEqual(cacNut.map(({ nhom, so }) => [nhom, so]), [["all", 2], ["Nghệ thuật", 1], ["Thể thao", 1]],
    "lớp bd1 đã đủ nên không được tính vào Thể thao khi lọc Còn nhận");
  for (const { nhom, so } of cacNut) {
    state.filters.category = nhom;
    assert.equal(filteredClubs().length, so, `nút ${nhom} ghi ${so} thì bấm vào phải ra ${so} lớp`);
  }
});

test("tên nhóm được thoát HTML trong nút lọc", () => {
  const nguon = [
    catDong("const escapeHtml = "),
    ...["eligibleClubs", "nhomClbCuaEm", "nhomDangLoc", "renderLocNhomClb"].map(catHam),
    "return renderLocNhomClb;",
  ].join("\n");
  const html = new Function("state", "clubs", "gradeNumber", nguon)(
    { filters: { search: "", category: "all", availability: "all" } },
    [lop("x", `"><img src=x onerror=alert(1)>`, [2])], () => 2)();
  assert.doesNotMatch(html, /<img/);
});
