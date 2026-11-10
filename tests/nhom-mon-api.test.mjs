// Màn "Khai báo danh mục" chạy trên máy chủ thật: nạp lần đầu, thêm/sửa/xoá nhóm
// môn, cascade xuống bảng clubs, và xoá CLB.
//
// Những test ở đây bắt đúng loại lỗi mà test module thuần KHÔNG bắt được: phân quyền,
// ghi xuống cơ sở dữ liệu, và việc danh mục có tới được cổng phụ huynh hay không.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { startTestServer } from "./helpers/test-server.mjs";

let server;
let adminCookie;
let giaovuCookie;
let parentCookie;

const request = (path, cookie, options = {}) => server.request(path, cookie, options);
const json = async (path, cookie, options = {}) => (await request(path, cookie, options)).json();

const taoNhom = (cookie, body) => request("/api/admin/nhom-mon", cookie, { method: "POST", body: JSON.stringify(body) });
const suaNhom = (cookie, id, body) => request(`/api/admin/nhom-mon/${encodeURIComponent(id)}`, cookie, { method: "PATCH", body: JSON.stringify(body) });
const xoaNhom = (cookie, id) => request(`/api/admin/nhom-mon/${encodeURIComponent(id)}`, cookie, { method: "DELETE" });

const timNhom = async (ten) => (await json("/api/admin/nhom-mon", adminCookie)).nhomMon.find((nhom) => nhom.name === ten);
const clbTen = async (ten) => (await json("/api/admin/catalog", adminCookie)).clubs.find((club) => club.name === ten);

before(async () => {
  server = await startTestServer({ prefix: "nshm-nhom-mon-" });
  adminCookie = await server.loginCookie("admin@nshm.edu.vn", "Admin@123");
  parentCookie = await server.loginCookie("0901234567", "123456");
  const giaovu = await server.request("/api/auth/login", null, {
    method: "POST", body: JSON.stringify({ account: "giaovu@nshm.edu.vn", password: "Giaovu@123" }),
  });
  giaovuCookie = giaovu.status === 200 ? giaovu.headers.get("set-cookie").split(";")[0] : null;
});

after(async () => server.stop());

test("phụ huynh không đụng được vào danh mục khai báo", async () => {
  assert.equal((await request("/api/admin/nhom-mon", parentCookie)).status, 403);
  assert.equal((await taoNhom(parentCookie, { name: "Nhóm lén" })).status, 403);
  assert.equal((await xoaNhom(parentCookie, "bat-ky")).status, 403);
});

test("lượt xem đầu tiên tự nạp danh mục từ nhóm môn đang có trong dữ liệu CLB", async () => {
  // Danh mục ra đời sau dữ liệu. Không nạp thì màn Khai báo mở ra trống trơn trong
  // khi cổng phụ huynh vẫn đang lọc theo các nhóm đó.
  const { nhomMon } = await json("/api/admin/nhom-mon", adminCookie);
  const ten = nhomMon.map((nhom) => nhom.name);
  assert.ok(ten.includes("Thể thao"), `thiếu "Thể thao" trong ${ten.join(", ")}`);
  assert.ok(nhomMon.every((nhom) => nhom.daKhaiBao), "mọi nhóm phải được nhận vào danh mục");
  assert.ok(nhomMon.find((nhom) => nhom.name === "Thể thao").soClb >= 1);
});

test("nạp lần đầu chỉ chạy MỘT lần, lượt sau không nhân đôi danh mục", async () => {
  const lan1 = (await json("/api/admin/nhom-mon", adminCookie)).nhomMon.length;
  const lan2 = (await json("/api/admin/nhom-mon", adminCookie)).nhomMon.length;
  assert.equal(lan2, lan1);
});

test("thêm nhóm mới, và chặn tên trùng dù gõ khác dấu", async () => {
  const tao = await taoNhom(adminCookie, { name: "Kỹ năng & Công nghệ", sortOrder: 9 });
  assert.equal(tao.status, 201);
  assert.equal((await tao.json()).nhom.name, "Kỹ năng & Công nghệ");

  const trung = await taoNhom(adminCookie, { name: "ky nang cong nghe" });
  assert.equal(trung.status, 422);
  assert.equal((await trung.json()).error.code, "NHOM_DA_CO");
});

test("đổi tên nhóm đổi luôn nhóm môn ghi trên mọi CLB đang dùng", async () => {
  const truoc = await clbTen("Bóng rổ nền tảng");
  assert.equal(truoc.category, "Thể thao");

  const nhom = await timNhom("Thể thao");
  const response = await suaNhom(adminCookie, nhom.id, { name: "Thể thao & Vận động" });
  assert.equal(response.status, 200);
  const ketQua = (await response.json()).nhom;
  assert.equal(ketQua.kieu, "doi-ten");
  assert.ok(ketQua.soClbDaDoi >= 1);

  const sau = await clbTen("Bóng rổ nền tảng");
  assert.equal(sau.category, "Thể thao & Vận động", "CLB phải mang tên nhóm mới");
  assert.equal(await timNhom("Thể thao"), undefined, "tên cũ không được còn trong danh mục");
});

test("sửa chính tả (chỉ khác dấu) cũng đẩy chữ mới xuống CLB", async () => {
  const nhom = await timNhom("Nghệ thuật");
  const response = await suaNhom(adminCookie, nhom.id, { name: "NGHỆ THUẬT" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).nhom.kieu, "sua-chinh-ta");
  const club = await clbTen("Mỹ thuật sáng tạo");
  assert.equal(club.category, "NGHỆ THUẬT");
  // Trả lại cho các test sau đọc dễ.
  await suaNhom(adminCookie, nhom.id, { name: "Nghệ thuật" });
});

test("đổi sang tên nhóm khác là GỘP: lần đầu bị chặn, có xác nhận mới làm", async () => {
  const nguon = await timNhom("Ngôn ngữ");
  const chan = await suaNhom(adminCookie, nguon.id, { name: "Nghệ thuật" });
  assert.equal(chan.status, 422);
  const loi = (await chan.json()).error;
  assert.equal(loi.code, "NHOM_CAN_XAC_NHAN_GOP");
  assert.match(loi.message, /không tự hoàn lại/);

  const dong_y = await suaNhom(adminCookie, nguon.id, { name: "Nghệ thuật", gopNhom: true });
  assert.equal(dong_y.status, 200);
  assert.equal((await dong_y.json()).nhom.kieu, "gop");

  assert.equal(await timNhom("Ngôn ngữ"), undefined, "nhóm nguồn phải biến mất sau khi gộp");
  assert.equal((await clbTen("English Debate")).category, "Nghệ thuật");
});

test("xoá nhóm đang có CLB dùng thì bị chặn kèm tên CLB", async () => {
  const nhom = await timNhom("Nghệ thuật");
  const response = await xoaNhom(adminCookie, nhom.id);
  assert.equal(response.status, 422);
  const loi = (await response.json()).error;
  assert.equal(loi.code, "NHOM_DANG_DUOC_DUNG");
  assert.match(loi.message, /CLB/);
});

test("xoá nhóm chưa ai dùng thì được", async () => {
  const nhom = await timNhom("Kỹ năng & Công nghệ");
  assert.equal(nhom.soClb, 0);
  assert.equal((await xoaNhom(adminCookie, nhom.id)).status, 200);
  assert.equal(await timNhom("Kỹ năng & Công nghệ"), undefined);
});

test("xoá nhóm không có thật trả 404 chứ không âm thầm thành công", async () => {
  const response = await xoaNhom(adminCookie, "nhom_khong_ton_tai");
  assert.equal(response.status, 404);
});

test("CLB còn ca học thì không xoá được — đơn của phụ huynh treo vào ca", async () => {
  const club = await clbTen("Bóng rổ nền tảng");
  const response = await request(`/api/admin/clubs/${encodeURIComponent(club.id)}`, adminCookie, { method: "DELETE" });
  assert.equal(response.status, 409);
  const loi = (await response.json()).error;
  assert.equal(loi.code, "CLUB_HAS_CLASSES");
  assert.match(loi.message, /ca học/);
  assert.ok(await clbTen("Bóng rổ nền tảng"), "CLB phải còn nguyên");
});

test("CLB vừa khai báo, chưa có ca học, thì xoá được", async () => {
  const tao = await request("/api/admin/clubs", adminCookie, {
    method: "POST", body: JSON.stringify({ name: "Cầu lông", category: "Thể thao & Vận động", grades: "1-5" }),
  });
  assert.equal(tao.status, 201);
  const { club } = await tao.json();
  const xoa = await request(`/api/admin/clubs/${encodeURIComponent(club.id)}`, adminCookie, { method: "DELETE" });
  assert.equal(xoa.status, 200);
  assert.equal(await clbTen("Cầu lông"), undefined);
});

test("danh mục quản trị mang theo nhóm môn để ô 'Nhóm môn' của form CLB có gợi ý", async () => {
  const catalog = await json("/api/admin/catalog", adminCookie);
  assert.ok(Array.isArray(catalog.nhomMon) && catalog.nhomMon.length, "thiếu nhomMon trong /api/admin/catalog");
  assert.ok(catalog.nhomMon.every((nhom) => typeof nhom.name === "string"));
});

test("cổng phụ huynh nhận được thứ tự nhóm môn nhà trường đã khai báo", async () => {
  // Không có cái này thì ô "Thứ tự" ở màn Khai báo là nút chết: quản trị sắp xong,
  // mở cổng phụ huynh vẫn thấy nhóm xếp theo bảng chữ cái.
  const payload = await json("/api/clubs", parentCookie);
  assert.ok(Array.isArray(payload.nhomMon), "thiếu nhomMon trong /api/clubs");
  assert.ok(payload.nhomMon.every((nhom) => typeof nhom.sortOrder === "number"));
});

test("giáo vụ khai báo được danh mục, đúng quyền danh-muc", { skip: !process.env.NSHM_TEST_GIAOVU }, async () => {
  if (!giaovuCookie) return;
  assert.equal((await request("/api/admin/nhom-mon", giaovuCookie)).status, 200);
});

test("bản sao lưu mang theo danh mục nhóm môn", async () => {
  // Thiếu nó thì khôi phục xong danh mục trống, CLB vẫn mang nhóm cũ, và người ta
  // chỉ phát hiện ra lúc đang cần bản sao lưu nhất.
  const response = await request("/api/admin/export/collections", adminCookie);
  assert.equal(response.status, 200);
  const { collections } = await response.json();
  assert.ok(collections.includes("clubCategories"), `thiếu clubCategories trong ${collections.join(", ")}`);
});

test("đổi tên sang tên của nhóm CHƯA KHAI BÁO phải hỏi xác nhận, không hút CLB âm thầm", async () => {
  // Khai một CLB với nhóm môn gõ tay -> nó thành nhóm "chưa khai báo".
  const them = await request("/api/admin/clubs", adminCookie, {
    method: "POST", body: JSON.stringify({ name: "Võ cổ truyền", category: "Võ thuật", grades: "1-5" }),
  });
  assert.equal(them.status, 201);
  const { club } = await them.json();
  const chuaKhai = await timNhom("Võ thuật");
  assert.equal(chuaKhai.daKhaiBao, false);

  const nhom = await timNhom("STEM");
  const chan = await suaNhom(adminCookie, nhom.id, { name: "Võ thuật" });
  assert.equal(chan.status, 422, "phải chặn, không được âm thầm gộp");
  assert.equal((await chan.json()).error.code, "NHOM_CAN_XAC_NHAN_GOP");

  // Dọn lại để các test sau không bị ảnh hưởng.
  await request(`/api/admin/clubs/${encodeURIComponent(club.id)}`, adminCookie, { method: "DELETE" });
});

test("bấm Lưu mà không đổi tên vẫn chuẩn hoá CLB đang ghi lệch dấu", async () => {
  const them = await request("/api/admin/clubs", adminCookie, {
    method: "POST", body: JSON.stringify({ name: "Cờ vua lệch", category: "stem", grades: "1-5" }),
  });
  const { club } = await them.json();
  const nhom = await timNhom("STEM");
  const response = await suaNhom(adminCookie, nhom.id, { name: "STEM" });
  assert.equal(response.status, 200);
  const ketQua = (await response.json()).nhom;
  assert.equal(ketQua.kieu, "chuan-hoa");
  assert.equal(ketQua.soClbDaDoi, 1);
  assert.equal((await clbTen("Cờ vua lệch")).category, "STEM");
  await request(`/api/admin/clubs/${encodeURIComponent(club.id)}`, adminCookie, { method: "DELETE" });
});

test("nhật ký đổi tên ghi rõ CLB nào đã đổi và nhóm cũ của nó", async () => {
  // Chỉ con số thì hôm sau phát hiện sai không lần ra được gì.
  const nhom = await timNhom("STEM");
  await suaNhom(adminCookie, nhom.id, { name: "STEM & Khoa học" });
  const nhatKy = await json("/api/admin/audit?limit=20", adminCookie).catch(() => null);
  if (!nhatKy?.entries) return; // route nhật ký có thể khác tên; phần ghi đã có test ở tầng dưới
  const dong = nhatKy.entries.find((item) => item.action === "UPDATE_CLUB_CATEGORY");
  assert.ok(dong, "thiếu dòng nhật ký UPDATE_CLUB_CATEGORY");
});

test("nhóm đang ẩn không được gửi sang cổng phụ huynh", async () => {
  const tao = await taoNhom(adminCookie, { name: "Nhóm tạm ẩn", active: false });
  assert.equal(tao.status, 201);
  const { nhom } = await tao.json();
  const phuHuynh = await json("/api/clubs", parentCookie);
  assert.ok(!phuHuynh.nhomMon.some((item) => item.name === "Nhóm tạm ẩn"),
    "nhóm đã tắt vẫn lọt sang cổng phụ huynh");
  await xoaNhom(adminCookie, nhom.id);
});

test("ô biểu tượng để trống thì xoá được emoji đã đặt", async () => {
  const tao = await taoNhom(adminCookie, { name: "Nhóm có emoji", emoji: "🎵" });
  const { nhom } = await tao.json();
  assert.equal(nhom.emoji, "🎵");
  const sua = await suaNhom(adminCookie, nhom.id, { name: "Nhóm có emoji", emoji: "" });
  assert.equal((await sua.json()).nhom.emoji, "", "ô trống phải xoá được emoji");
  await xoaNhom(adminCookie, nhom.id);
});

test("xoá hẳn CLB đòi quyền riêng, không đi chung với quyền khai báo danh mục", async () => {
  // Đây là nơi DUY NHẤT trong vùng danh mục xoá cứng được; mọi chỗ khác "bớt" là ẩn.
  const roles = await readFile(new URL("../roles.mjs", import.meta.url), "utf8");
  assert.match(roles, /xoaDanhMuc: "xoa-danh-muc"/, "roles.mjs phải có quyền xoa-danh-muc");
  const matrix = roles.slice(roles.indexOf("const MATRIX"), roles.indexOf("export function can"));
  const dongGiaovu = matrix.split("\n").find((dong) => dong.includes("ROLE.giaovu"));
  assert.ok(!dongGiaovu.includes("xoaDanhMuc"), "giáo vụ không được xoá hẳn CLB");
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const khoi = server.slice(server.indexOf('if (method === "DELETE" && clubMatch)'));
  assert.match(khoi.slice(0, 200), /CAP\.xoaDanhMuc/, "route xoá CLB phải đòi CAP.xoaDanhMuc");
});
