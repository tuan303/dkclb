// Yêu cầu điều chỉnh của giáo vụ ngày 11/09/2026 cho phía phụ huynh (file "Luồng app
// CLB.xlsx", sheet "Yêu cầu điều chỉnh"):
//
//  1. Chọn lớp trùng lịch → hỏi phụ huynh có đổi sang lớp này không, đồng ý thì đổi
//     luôn tại màn hình.
//  2–3. Phụ huynh không thấy sĩ số hay số chỗ còn — chỉ thấy trạng thái lớp.
//  4. Một em được học nhiều lớp của cùng một CLB (khác ngày học).
//  8. Mô tả CLB phải hiện cho phụ huynh.
//  9. Học phí tách học phí + học liệu; phụ huynh thấy học phí tổng.
// 10. Thêm số buổi.
//
// Mọi bài đi qua HTTP thật: điều giáo vụ muốn giấu phải không ra khỏi máy chủ, chứ
// không chỉ không hiện trên giao diện.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { trangThaiLop } from "../catalog-schema.mjs";
import { startTestServer } from "./helpers/test-server.mjs";

let server;
let quanTri;
let phuHuynh;
let dotId;

before(async () => {
  server = await startTestServer({ prefix: "nshm-giaovu1-" });
  quanTri = await server.loginCookie("admin@nshm.edu.vn", "Admin@123");
  phuHuynh = await server.loginCookie("0901234567", "123456");
  dotId = (await (await server.request("/api/admin/periods", quanTri)).json()).periods.find((p) => p.status === "open").id;
});

after(async () => server?.stop());

const goi = async (path, cookie, method = "GET", body) => {
  const response = await server.request(path, cookie, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
};
const lopPhuHuynhThay = async (studentId = "hs01") => (await goi(`/api/clubs?studentId=${studentId}`, phuHuynh)).body.clubs;

async function taoLop(input) {
  const r = await goi("/api/admin/classes", quanTri, "POST", {
    clubId: "painting", periodId: dotId, dayOfWeek: 6, startTime: "18:00", endTime: "19:00", room: `Phòng ${input.name}`,
    teacher: "Cô Trang", capacity: 20, minCapacity: 0, enrolledBase: 0, fee: 1000000, grades: [3], ...input,
  });
  assert.equal(r.status, 201, r.text);
  return (await goi("/api/admin/catalog", quanTri)).body.classes.find((row) => row.name === input.name);
}

/* ---------- 2–3. Trạng thái lớp thay cho sĩ số ---------- */

test("trạng thái lớp: Còn nhận / Sắp đủ / Đã đủ – nhận DS chờ / Dừng tuyển", () => {
  const lop = { capacity: 20, waitlistEnabled: true, dangTuyen: true, nguongSapDu: 3 };
  assert.equal(trangThaiLop({ ...lop, enrolled: 5 }).nhan, "Còn nhận");
  assert.equal(trangThaiLop({ ...lop, enrolled: 17 }).nhan, "Sắp đủ", "còn 3 chỗ = chạm ngưỡng");
  assert.equal(trangThaiLop({ ...lop, enrolled: 5, pending: 15 }).nhan, "Sắp đủ",
    "đơn chưa đóng phí lấp đủ chỗ thì không được nói Còn nhận");
  assert.equal(trangThaiLop({ ...lop, enrolled: 20 }).nhan, "Đã đủ – nhận DS chờ");
  assert.equal(trangThaiLop({ ...lop, enrolled: 20, waitlistEnabled: false }).nhan, "Đã đủ");
  assert.equal(trangThaiLop({ ...lop, enrolled: 0, dangTuyen: false }).nhan, "Dừng tuyển");
});

test("máy chủ KHÔNG gửi sĩ số, số chỗ, số đơn chờ hay phần tách học liệu cho phụ huynh", async () => {
  const lop = await lopPhuHuynhThay();
  assert.ok(lop.length > 0);
  for (const item of lop) {
    for (const truong of ["capacity", "enrolled", "pending", "minCapacity", "hocLieu", "phiTong", "nguongSapDu"]) {
      assert.equal(item[truong], undefined, `phụ huynh nhận được ${truong} của ${item.name}`);
    }
    assert.ok(item.trangThaiLop?.nhan, `thiếu trạng thái lớp của ${item.name}`);
  }
  // Nhà trường vẫn thấy đủ số liệu.
  const quanTriThay = (await goi("/api/clubs", quanTri)).body.clubs;
  assert.ok(quanTriThay.every((item) => Number.isInteger(item.capacity) && Number.isInteger(item.enrolled)));
});

test("giao diện phụ huynh không còn hiện sĩ số trên thẻ và trong chi tiết lớp, có hiện mô tả CLB", async () => {
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const the = app.slice(app.indexOf("function renderClubCard("), app.indexOf("\n}", app.indexOf("function renderClubCard(")));
  const chiTiet = app.slice(app.indexOf("function showDetail("), app.indexOf("\n}", app.indexOf("function showDetail(")));
  for (const [ten, doan] of [["thẻ lớp", the], ["chi tiết lớp", chiTiet]]) {
    assert.doesNotMatch(doan, /club\.capacity|club\.enrolled|club\.pending|Sĩ số/, `${ten} còn dùng sĩ số`);
    assert.match(doan, /trangThai/, `${ten} phải hiện trạng thái lớp`);
  }
  assert.match(the, /club-desc/, "thẻ lớp phải hiện mô tả CLB (yêu cầu 8)");
  assert.match(chiTiet, /escapeHtml\(club\.description\)/, "mô tả trong chi tiết phải được thoát ký tự");
});

test("lớp dừng tuyển: phụ huynh vẫn thấy lớp với nhãn Dừng tuyển nhưng không đăng ký được", async () => {
  const lop = await taoLop({ name: "Lớp dừng tuyển", dangTuyen: false });
  const thay = (await lopPhuHuynhThay()).find((item) => item.id === lop.id);
  assert.ok(thay, "lớp dừng tuyển vẫn phải hiện cho phụ huynh");
  assert.equal(thay.trangThaiLop.ma, "dung-tuyen");

  const kiem = await goi("/api/registrations/validate", phuHuynh, "POST", { studentId: "hs01", clubIds: [lop.id] });
  assert.ok(kiem.body.issues.some((issue) => issue.type === "dung-tuyen"), JSON.stringify(kiem.body.issues));
  const dangKy = await goi("/api/registrations", phuHuynh, "POST", { studentId: "hs01", clubIds: [lop.id], acceptedTerms: true });
  assert.equal(dangKy.status, 422);

  // Nhà trường thấy đúng nhãn phụ huynh đang thấy.
  const catalog = (await goi("/api/admin/catalog", quanTri)).body;
  assert.equal(catalog.classes.find((row) => row.id === lop.id).trangThaiLop.ma, "dung-tuyen");
  assert.equal((await goi(`/api/admin/classes/${lop.id}`, quanTri, "PATCH", { active: false })).status, 200);
});

/* ---------- 9–10. Học liệu, số buổi ---------- */

test("học phí tổng = học phí + học liệu: phụ huynh thấy tổng, đơn ghi tổng; số buổi được lưu", async () => {
  const lop = await taoLop({ name: "Lớp có học liệu", hocLieu: "250.000", soBuoi: 16, dayOfWeek: 0, startTime: "08:00", endTime: "09:00" });
  assert.equal(lop.hocLieu, 250000);
  assert.equal(lop.soBuoi, 16);

  const thay = (await lopPhuHuynhThay()).find((item) => item.id === lop.id);
  assert.equal(thay.fee, 1250000, "phụ huynh thấy học phí tổng");
  assert.equal(thay.soBuoi, 16);

  const dangKy = await goi("/api/registrations", phuHuynh, "POST", { studentId: "hs01", clubIds: [lop.id], acceptedTerms: true });
  assert.equal(dangKy.status, 201, dangKy.text);
  const don = (await goi("/api/registrations", quanTri)).body.registrations.find((row) => row.classId === lop.id);
  assert.equal(don.amount, 1250000, "số tiền phải thu của đơn là học phí tổng");
});

/* ---------- 4. Nhiều lớp của cùng CLB ---------- */

test("một em đăng ký được hai lớp khác giờ của cùng một CLB", async () => {
  // hs02 học khối 6.
  const a = await taoLop({ name: "Vẽ Thứ 2 tối", dayOfWeek: 1, startTime: "19:00", endTime: "20:00", grades: [6] });
  const b = await taoLop({ name: "Vẽ Thứ 5 tối", dayOfWeek: 4, startTime: "19:00", endTime: "20:00", grades: [6] });
  const dangKy = await goi("/api/registrations", phuHuynh, "POST", { studentId: "hs02", clubIds: [a.id, b.id], acceptedTerms: true });
  assert.equal(dangKy.status, 201, dangKy.text);
  assert.equal(dangKy.body.registrations.length, 2);
});

/* ---------- 1. Đổi lớp khi trùng lịch ---------- */

test("trùng lịch với lớp CHƯA đóng phí: phụ huynh đổi được ngay, đơn cũ thành Đã đổi lớp", async () => {
  // hs01 có sẵn đơn Piano (Thứ 3 16:15–17:30, chờ thanh toán). Bóng rổ trùng đúng giờ đó.
  const truoc = (await goi("/api/registrations", phuHuynh)).body.registrations;
  const piano = truoc.find((row) => row.studentId === "hs01" && row.classId === "piano" && row.status === "payment");
  assert.ok(piano, "dữ liệu mẫu phải có đơn Piano chưa đóng phí của hs01");

  const kiem = await goi("/api/registrations/validate", phuHuynh, "POST", { studentId: "hs01", clubIds: ["basketball"] });
  assert.ok(kiem.body.issues.some((issue) => issue.type === "conflict"), "phải thấy trùng lịch trước khi đổi");

  const doi = await goi(`/api/registrations/${encodeURIComponent(piano.id)}/doi-lop`, phuHuynh, "POST",
    { classId: "basketball", acceptedTerms: true });
  assert.equal(doi.status, 201, doi.text);
  assert.equal(doi.body.doiTu, piano.id);

  const sau = (await goi("/api/registrations", phuHuynh)).body.registrations;
  assert.equal(sau.find((row) => row.id === piano.id).status, "doi_lop");
  const moi = sau.find((row) => row.id === doi.body.registrations[0].id);
  assert.equal(moi.classId, "basketball");
  assert.ok(["payment", "waitlist"].includes(moi.status));
});

test("trùng lịch với lớp ĐÃ đóng phí: không tự đổi được, báo liên hệ nhà trường", async () => {
  const don = (await goi("/api/registrations", phuHuynh)).body.registrations
    .find((row) => row.studentId === "hs01" && row.classId === "basketball" && ["payment", "waitlist"].includes(row.status));
  assert.ok(don);
  const xacNhan = await goi(`/api/admin/registrations/${encodeURIComponent(don.id)}/confirm-payment`, quanTri, "PATCH", {});
  assert.equal(xacNhan.status, 200, xacNhan.text);

  const doi = await goi(`/api/registrations/${encodeURIComponent(don.id)}/doi-lop`, phuHuynh, "POST",
    { classId: "piano", acceptedTerms: true });
  assert.equal(doi.status, 409, doi.text);
  assert.equal(doi.body.error.code, "DOI_LOP_DA_DONG_PHI");
  assert.match(doi.body.error.message, /liên hệ nhà trường/);
  const vanCon = (await goi("/api/registrations", phuHuynh)).body.registrations.find((row) => row.id === don.id);
  assert.equal(vanCon.status, "confirmed", "đơn đã đóng phí phải giữ nguyên");
});

test("không đổi được đơn của người khác, và phải đồng ý điều khoản", async () => {
  const donNguoiKhac = (await goi("/api/registrations", quanTri)).body.registrations.find((row) => row.studentId === "hs03");
  assert.ok(donNguoiKhac);
  const doi = await goi(`/api/registrations/${encodeURIComponent(donNguoiKhac.id)}/doi-lop`, phuHuynh, "POST",
    { classId: "painting", acceptedTerms: true });
  assert.equal(doi.status, 404);
  const khongDongY = await goi(`/api/registrations/${encodeURIComponent(donNguoiKhac.id)}/doi-lop`, phuHuynh, "POST",
    { classId: "painting" });
  assert.equal(khongDongY.status, 422);
});

/* ---------- Lỗi lượt rà soát đợt 1 tìm ra ---------- */

test("một yêu cầu gửi hàng nghìn mã lớp trùng nhau bị từ chối ngay, không làm treo máy chủ", async () => {
  // Đã tái hiện trước khi vá: 3.000 mã "dance" làm máy chủ treo ~30 giây rồi sập.
  const batDau = Date.now();
  const nhieu = await goi("/api/registrations/validate", phuHuynh, "POST", { studentId: "hs01", clubIds: Array(3000).fill("dance") });
  assert.equal(nhieu.status, 422);
  assert.ok(Date.now() - batDau < 2000, "phải trả lời ngay");
  const trung = await goi("/api/registrations", phuHuynh, "POST", { studentId: "hs01", clubIds: ["dance", "dance"], acceptedTerms: true });
  assert.equal(trung.status, 422);
  assert.equal(trung.body.error.code, "DUPLICATE_CLASS");
});

test("đổi lớp: không đổi sang chính lớp đang có, và chỉ đổi sang lớp trùng lịch", async () => {
  const don = (await goi("/api/registrations", phuHuynh)).body.registrations
    .find((row) => row.studentId === "hs01" && row.status === "payment" && row.schedule?.startsWith("Chủ nhật"));
  assert.ok(don, "cần đơn chưa đóng phí của lớp Chủ nhật tạo ở bài học liệu");
  const cungLop = await goi(`/api/registrations/${encodeURIComponent(don.id)}/doi-lop`, phuHuynh, "POST", { classId: don.classId, acceptedTerms: true });
  assert.equal(cungLop.status, 422);
  assert.equal(cungLop.body.error.code, "DOI_LOP_CUNG_LOP");
  // Nhảy hiện đại (Thứ 7 sáng) không trùng lịch lớp Chủ nhật: đường đổi lớp không phải nút tự huỷ đơn.
  const khongTrung = await goi(`/api/registrations/${encodeURIComponent(don.id)}/doi-lop`, phuHuynh, "POST", { classId: "dance", acceptedTerms: true });
  assert.equal(khongTrung.status, 422, khongTrung.text);
  assert.equal(khongTrung.body.error.code, "DOI_LOP_KHONG_TRUNG_LICH");
  const vanCon = (await goi("/api/registrations", phuHuynh)).body.registrations.find((row) => row.id === don.id);
  assert.equal(vanCon.status, "payment", "đơn không được đổi trạng thái khi bị từ chối");
});

test("đơn Đã đổi lớp không bị bật lại bằng tay, và nhật ký ghi vào đúng đơn cũ", async () => {
  const piano = (await goi("/api/registrations", quanTri)).body.registrations
    .find((row) => row.studentId === "hs01" && row.classId === "piano" && row.status === "doi_lop");
  assert.ok(piano);
  const batLai = await goi(`/api/admin/registrations/${encodeURIComponent(piano.id)}/status`, quanTri, "PATCH", { status: "submitted" });
  assert.equal(batLai.status, 409, "bấm Lưu trên đơn đã đổi lớp từng bật nó lại thành Đăng ký");
  assert.equal(batLai.body.error.code, "DON_DA_DOI_LOP");

  const chiTiet = await goi(`/api/admin/registrations/${encodeURIComponent(piano.id)}`, quanTri);
  assert.equal(chiTiet.status, 200, chiTiet.text);
  assert.match(JSON.stringify(chiTiet.body), /PARENT_SWITCH_CLASS/, "đơn cũ phải có dòng nhật ký đổi lớp");

  // Ô trạng thái trong popup có mục cho trạng thái hệ thống, đang chọn và bị khoá.
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const tab = app.slice(app.indexOf("function renderDetailStudentTab("), app.indexOf("\n}", app.indexOf("function renderDetailStudentTab(")));
  assert.match(tab, /registration\.status === "doi_lop" \? "disabled"/);
  assert.match(tab, /selected disabled/);
});

test("form lớp: ngưỡng để trống là 3, số âm bị từ chối, không lột dấu trừ", async () => {
  const lop = await taoLop({ name: "Lớp kiểm số", dayOfWeek: 2, startTime: "19:00", endTime: "20:00", nguongSapDu: "" });
  assert.equal(lop.nguongSapDu, 3);
  const am = await goi(`/api/admin/classes/${lop.id}`, quanTri, "PATCH", { hocLieu: "-250000" });
  assert.equal(am.status, 422, "học liệu âm không được thành 250.000");
  const thapPhan = await goi(`/api/admin/classes/${lop.id}`, quanTri, "PATCH", { soBuoi: "1.5" });
  assert.equal(thapPhan.status, 422, "1,5 buổi không được thành 15 buổi");
  assert.equal((await goi(`/api/admin/classes/${lop.id}`, quanTri, "PATCH", { active: false })).status, 200);
});
