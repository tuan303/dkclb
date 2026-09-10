// Trùng lịch: học sinh đăng ký hai CLB rơi vào cùng một thứ và giẫm giờ lên nhau.
//
// Nhà trường yêu cầu báo cho phụ huynh NGAY LÚC ĐĂNG KÝ, và nói rõ đã đăng ký CLB
// nào cùng khoảng giờ nào — chỉ nói "trùng lịch" thì phụ huynh phải tự đi dò lại
// lịch của con.
//
// Quy tắc này từng nằm ở BỐN chỗ với bốn câu chữ khác nhau (giỏ hàng ở trình duyệt,
// kiểm tra trước khi gửi ở máy chủ, và hai lần kiểm lại lúc ghi trong mỗi kho dữ
// liệu). Bản MySQL còn so `toInt(day_of_week) === club.dayOfWeek` — số với thứ có
// thể là chuỗi — nên chỉ cần một nguồn trả kiểu khác là lá chắn im lặng ngừng chạy.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { startTestServer } from "./helpers/test-server.mjs";
import { conflictBadge, conflictMessage, intervalsOverlap } from "../schedule-conflict.mjs";
import { STATUS } from "../registration-status.mjs";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const server_mjs = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const mysql = await readFile(new URL("../mysql-store.mjs", import.meta.url), "utf8");
const firestore = await readFile(new URL("../firestore-store.mjs", import.meta.url), "utf8");

const ca = (thu, batDau, ketThuc, name = "CLB") =>
  ({ name, dayOfWeek: thu, startTime: batDau, endTime: ketThuc, schedule: `Thứ ${thu} · ${batDau}–${ketThuc}` });

let server;
let phuHuynh;

before(async () => {
  server = await startTestServer({ prefix: "nshm-trunglich-" });
  phuHuynh = await server.loginCookie("0901234567", "123456");
});

after(async () => server.stop());

test("giẫm giờ cùng một thứ thì tính là trùng", () => {
  assert.equal(intervalsOverlap(ca(2, "16:15", "17:30"), ca(2, "17:00", "18:00")), true);
  assert.equal(intervalsOverlap(ca(2, "16:15", "17:30"), ca(2, "16:15", "17:30")), true, "trùng khít");
  assert.equal(intervalsOverlap(ca(2, "16:00", "18:00"), ca(2, "16:30", "17:00")), true, "lồng bên trong");
});

test("nối đuôi nhau thì KHÔNG phải trùng", () => {
  // 16:15–17:30 rồi 17:30–18:30: con kịp sang lớp sau, chặn là chặn oan.
  assert.equal(intervalsOverlap(ca(2, "16:15", "17:30"), ca(2, "17:30", "18:30")), false);
});

test("khác thứ thì không bao giờ trùng", () => {
  assert.equal(intervalsOverlap(ca(2, "16:15", "17:30"), ca(3, "16:15", "17:30")), false);
});

test("thứ dạng chuỗi và dạng số vẫn nhận ra nhau", () => {
  // Đây là lỗi thật của bản MySQL cũ: một bên ép sang số, một bên không, nên 2 và
  // "2" không khớp và cả lá chắn lặng lẽ ngừng hoạt động.
  assert.equal(intervalsOverlap({ ...ca(2, "16:15", "17:30"), dayOfWeek: "2" }, ca(2, "17:00", "18:00")), true);
  assert.equal(intervalsOverlap({ ...ca(2, "16:15", "17:30"), dayOfWeek: 2 }, { ...ca(2, "17:00", "18:00"), dayOfWeek: "2" }), true);
});

test("thiếu thứ hoặc thiếu giờ thì không kết luận bừa là trùng", () => {
  // Chặn oan còn tệ hơn bỏ sót ở đây: máy chủ vẫn kiểm lại lần nữa lúc ghi.
  assert.equal(intervalsOverlap({ dayOfWeek: null, startTime: "16:15", endTime: "17:30" }, ca(2, "16:15", "17:30")), false);
  assert.equal(intervalsOverlap({ dayOfWeek: 2, startTime: "", endTime: "" }, ca(2, "16:15", "17:30")), false);
  assert.equal(intervalsOverlap(null, ca(2, "16:15", "17:30")), false);
});

test("câu báo nói rõ CLB nào và KHOẢNG GIỜ nào", () => {
  // Đúng yêu cầu nhà trường: "thông báo luôn cho PH khi đăng ký là con đã đăng ký
  // CLB ... trùng với khoảng giờ này".
  const cau = conflictMessage(ca(2, "16:15", "17:30", "Robotics"), ca(2, "16:15", "17:30", "Bóng rổ"), { daDangKy: true });
  assert.match(cau, /Bóng rổ/, "phải nêu tên CLB đã đăng ký");
  assert.match(cau, /Robotics/, "phải nêu tên CLB vừa chọn");
  assert.match(cau, /Thứ 2 · 16:15–17:30/, "phải nêu khoảng giờ");
  assert.match(cau, /đã đăng ký/);

  const trongGio = conflictMessage(ca(2, "16:15", "17:30", "Robotics"), ca(2, "16:15", "17:30", "Bóng rổ"), { daDangKy: false });
  assert.match(trongGio, /giỏ đăng ký/, "vướng trong giỏ thì phải nói là trong giỏ, không nói là đã đăng ký");

  assert.match(conflictBadge(ca(2, "16:15", "17:30", "Bóng rổ")), /Bóng rổ.*Thứ 2 · 16:15–17:30/);
});

test("chỉ còn MỘT bản quy tắc trùng lịch trong toàn bộ mã nguồn", () => {
  // Bốn bản sao là bốn cơ hội để chúng lệch nhau.
  for (const [ten, nguon] of [["server.mjs", server_mjs], ["mysql-store.mjs", mysql], ["firestore-store.mjs", firestore]]) {
    assert.equal(nguon.match(/function intervalsOverlap/), null, `${ten} không được tự khai lại intervalsOverlap`);
    assert.match(nguon, /from "\.\/schedule-conflict\.mjs"/, `${ten} phải dùng chung schedule-conflict.mjs`);
  }
  assert.equal(app.match(/startTime < right\.endTime/), null, "app.js còn bản sao quy tắc viết tay trong addToCart");
});

test("bản sao ở trình duyệt cho KẾT QUẢ y hệt bản ở máy chủ", () => {
  // app.js nạp bằng thẻ <script> thường nên không import được, phải chép tay — và
  // chép tay thì lệch. So HÀNH VI chứ không so từng ký tự: chú thích hai bên khác
  // nhau là chuyện bình thường, còn kết quả khác nhau mới là lỗi.
  const trich = (ten) => {
    const khop = app.match(new RegExp(`function ${ten}\\([\\s\\S]*?\\n\\}`));
    assert.ok(khop, `app.js thiếu ${ten}`);
    return khop[0];
  };
  const banTrinhDuyet = new Function(`${trich("intervalsOverlap")}\n${trich("conflictMessage")}\n${trich("conflictBadge")}
    return { intervalsOverlap, conflictMessage, conflictBadge };`)();

  const CAC_CA = [
    [ca(2, "16:15", "17:30", "A"), ca(2, "17:00", "18:00", "B")],
    [ca(2, "16:15", "17:30", "A"), ca(2, "17:30", "18:30", "B")],
    [ca(2, "16:15", "17:30", "A"), ca(3, "16:15", "17:30", "B")],
    [{ ...ca(2, "16:15", "17:30", "A"), dayOfWeek: "2" }, ca(2, "17:00", "18:00", "B")],
    [{ dayOfWeek: null, startTime: "16:15", endTime: "17:30", name: "A" }, ca(2, "16:15", "17:30", "B")],
  ];
  for (const [trai, phai] of CAC_CA) {
    assert.equal(banTrinhDuyet.intervalsOverlap(trai, phai), intervalsOverlap(trai, phai),
      `intervalsOverlap lệch ở ca ${JSON.stringify(trai)} vs ${JSON.stringify(phai)}`);
    for (const daDangKy of [true, false]) {
      assert.equal(banTrinhDuyet.conflictMessage(trai, phai, { daDangKy }), conflictMessage(trai, phai, { daDangKy }),
        `conflictMessage lệch (daDangKy=${daDangKy})`);
    }
    assert.equal(banTrinhDuyet.conflictBadge(phai), conflictBadge(phai), "conflictBadge lệch");
  }
});

test("phụ huynh được báo trùng giờ ngay khi kiểm tra giỏ đăng ký", async () => {
  const { students } = await (await server.request("/api/students", phuHuynh)).json();
  const studentId = students[0].id;
  const { clubs } = await (await server.request(`/api/clubs?studentId=${encodeURIComponent(studentId)}`, phuHuynh)).json();

  // Tìm đúng hai CLB giẫm giờ nhau thay vì gõ cứng mã, để dữ liệu mẫu đổi vẫn chạy.
  let cap = null;
  for (let i = 0; i < clubs.length && !cap; i += 1) {
    for (let j = i + 1; j < clubs.length; j += 1) {
      if (intervalsOverlap(clubs[i], clubs[j])) { cap = [clubs[i], clubs[j]]; break; }
    }
  }
  assert.ok(cap, "dữ liệu mẫu phải có hai CLB trùng giờ để kiểm");

  const response = await server.request("/api/registrations/validate", phuHuynh, {
    method: "POST", body: JSON.stringify({ studentId, clubIds: cap.map((club) => club.id) }),
  });
  assert.equal(response.status, 200);
  const ketQua = await response.json();
  assert.equal(ketQua.valid, false, "hai CLB trùng giờ thì không được coi là hợp lệ");
  const bao = ketQua.issues.find((issue) => issue.type === "conflict");
  assert.ok(bao, `phải có lỗi trùng lịch; nhận được: ${JSON.stringify(ketQua.issues)}`);
  assert.match(bao.message, new RegExp(cap[0].name.slice(0, 10).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(bao.message, /giỏ đăng ký|đã đăng ký/);
});

test("“Trùng lịch” không còn là trạng thái của đơn", () => {
  // Nó là kết quả kiểm tra tại thời điểm đăng ký — chặn ngay, chứ không để đơn nằm
  // lại ở một trạng thái mà không thao tác nào đưa nó ra khỏi đó.
  assert.equal(server_mjs.match(/"conflict", \d+, "Thứ/), null, "dữ liệu mẫu không được sinh đơn ở trạng thái conflict");
  assert.equal(server_mjs.match(/\["conflict", "waitlist", "submitted"\]/), null,
    "dashboard không được đếm conflict là việc cần xử lý");
  assert.ok(!Object.values(STATUS).includes("conflict"), "conflict không nằm trong vòng đời đơn");
});
