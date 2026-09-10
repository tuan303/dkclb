// Màn hình đồng bộ phải phân biệt được hai chuyện hoàn toàn khác nhau:
//
//   "TIẾN TRÌNH chưa chạy lần đồng bộ nào kể từ lúc bật máy chủ"  — trạng thái tạm
//   "HỆ THỐNG chưa có dữ liệu học sinh nào"                        — chuyện nghiêm trọng
//
// Trạng thái đồng bộ chỉ sống trong bộ nhớ tiến trình (sync-scheduler.mjs giữ nó
// trong biến `state`), nên mỗi lần khởi động lại máy chủ là màn hình lại báo "Chưa
// chạy lần nào". Nhà trường đọc dòng đó rồi tưởng mất sạch danh bạ vừa đồng bộ.
//
// Cách chữa: hiện thêm số liệu ĐỌC TỪ CƠ SỞ DỮ LIỆU ngay cạnh trạng thái tiến trình.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { startTestServer } from "./helpers/test-server.mjs";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

let server;
let quanTri;

before(async () => {
  server = await startTestServer({ prefix: "nshm-solieu-" });
  quanTri = await server.loginCookie("admin@nshm.edu.vn", "Admin@123");
});

after(async () => server.stop());

const layTichHop = async () =>
  (await (await server.request("/api/admin/integrations/google-sheets", quanTri)).json()).integration;

test("trạng thái tích hợp kèm số liệu đọc từ cơ sở dữ liệu", async () => {
  const tichHop = await layTichHop();
  assert.ok(tichHop.stored, "thiếu số liệu lưu trữ; màn hình sẽ không phân biệt được tiến trình với dữ liệu");
  assert.ok(tichHop.stored.students > 0, "phải đếm được học sinh đang học");
  assert.ok(tichHop.stored.parents > 0, "phải đếm được tài khoản phụ huynh");
  assert.ok("lastSyncAt" in tichHop.stored, "phải có mốc đồng bộ gần nhất, kể cả khi null");
});

test("số học sinh trong trạng thái khớp với số thật trong cơ sở dữ liệu", async () => {
  // Nếu hai con số này lệch nhau thì màn hình đang trấn an bằng một con số sai —
  // còn tệ hơn không hiện gì.
  const tichHop = await layTichHop();
  const xemTruoc = await server.request("/api/admin/directory/excel/preview", quanTri, {
    method: "POST",
    body: JSON.stringify({
      mode: "bo-sung",
      files: [{ key: "k", label: "x.xlsx", rows: [
        ["Mã học sinh", "Họ và tên học sinh", "Ngày sinh", "Lớp", "Cấp học", "SDT bố"],
        ["HS777", "Nguyễn Văn A", "10/10/2018", "3A4", "Tiểu học", "0900777777"],
      ] }],
    }),
  });
  const { preview } = await xemTruoc.json();
  assert.equal(tichHop.stored.students, preview.activeStudentsNow);
});

test("số liệu lưu trữ KHÔNG phụ thuộc việc tiến trình đã chạy đồng bộ hay chưa", async () => {
  // Máy chủ thử nghiệm vừa khởi động và chưa chạy lần đồng bộ nào — đúng tình huống
  // nhà trường gặp sau mỗi lần triển khai.
  const tichHop = await layTichHop();
  assert.equal(tichHop.schedule.lastRun, null, "bối cảnh: tiến trình chưa chạy lần nào");
  assert.ok(tichHop.stored.students > 0, "nhưng dữ liệu vẫn phải đếm được");
});

test("lịch tự động mặc định TẮT, không còn tự gọi ra Google", async () => {
  // Đây là phụ thuộc mạng duy nhất còn lại của việc đồng bộ danh bạ, và máy chủ của
  // trường từng mất phân giải tên miền cả buổi.
  const tichHop = await layTichHop();
  assert.equal(tichHop.schedule.enabled, false);
});

test("giao diện nói rõ “chưa chạy” là chuyện của tiến trình, không phải của dữ liệu", () => {
  assert.match(app, /trạng thái của TIẾN TRÌNH, không phải của dữ liệu/);
  assert.match(app, /Học sinh đang học · trong CSDL/);
  assert.match(app, /renderSyncSchedule\(integration\.schedule, integration\.stored\)/);
});
