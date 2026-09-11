// Nhập lại danh mục CLB từ file Excel KHÔNG được xoá số "ghi danh sẵn ngoài hệ thống".
//
// File danh mục không có cột đó — nó chỉ mô tả CLB, ca học, lịch, phòng, giáo viên,
// sĩ số, học phí. Nhưng enrolled_base là con số nhà trường gõ tay để đếm những em
// đã ghi danh ngoài cổng đăng ký, và nó tham gia thẳng vào sĩ số:
//
//     sĩ số = enrolled_base + số đơn đang giữ chỗ
//
// Bản kế hoạch nhập trước đây chuẩn hoá dữ liệu TRƯỚC khi tìm ca đang có, nên
// normalizeClassInput không thấy giá trị cũ và trả về enrolledBase = 0. Trên SQLite
// lỗi này không lộ ra vì câu UPDATE của nhánh đó không có cột enrolled_base — còn
// trên MySQL, nền máy chủ thật đang chạy, câu ghi là:
//
//     ON DUPLICATE KEY UPDATE ... enrolled_base = VALUES(enrolled_base)
//
// tức mỗi lần nhập lại danh mục là xoá sạch số ghi danh sẵn của MỌI ca, làm sĩ số
// cả trường tụt xuống trong im lặng và mở lại hàng trăm chỗ đã có chủ.
//
// Bài kiểm đặt ở tầng chuẩn hoá, là tầng dùng chung cho cả ba nền lưu trữ.
import test from "node:test";
import assert from "node:assert/strict";
import { DAY_LABELS, normalizeClassInput } from "../catalog-schema.mjs";

const DONG_FILE = {
  clubId: "club_guitar",
  periodId: "period_2026_hk1",
  name: "Ca 1",
  dayOfWeek: 2,
  startTime: "16:15",
  endTime: "17:30",
  scheduleLabel: "Thứ 2 · 16:15–17:30",
  grades: [3, 4, 5],
  room: "Phòng Nhạc 2",
  teacher: "Thầy Sơn",
  capacity: 14,
  minCapacity: 0,
  fee: 1_500_000,
  active: true,
};

const CA_DANG_CO = { ...DONG_FILE, id: "guitar-ca-1", enrolledBase: 12 };
const tuyChon = { knownPeriodIds: ["period_2026_hk1"] };

test("file danh mục không mang cột ghi danh sẵn thì GIỮ NGUYÊN giá trị cũ", () => {
  const data = normalizeClassInput(DONG_FILE, { ...tuyChon, existing: CA_DANG_CO });
  assert.equal(data.enrolledBase, 12,
    "nhập lại danh mục đã xoá mất số em ghi danh sẵn — sĩ số cả trường tụt trong im lặng");
});

test("ca mới hoàn toàn thì ghi danh sẵn bằng 0", () => {
  const data = normalizeClassInput(DONG_FILE, tuyChon);
  assert.equal(data.enrolledBase, 0);
});

test("file CÓ khai số ghi danh sẵn thì file thắng", () => {
  // Nhà trường gõ thẳng con số mới thì phải nhận con số mới, không thì không sửa
  // xuống được nữa.
  const data = normalizeClassInput({ ...DONG_FILE, enrolledBase: 3 }, { ...tuyChon, existing: CA_DANG_CO });
  assert.equal(data.enrolledBase, 3);
});

/* ---------- Chạy thật qua HTTP ---------- */

// Bài kiểm ở tầng chuẩn hoá phía trên chứng minh normalizeClassInput làm đúng KHI
// được đưa giá trị cũ. Nó KHÔNG chứng minh máy chủ có đưa hay không — tôi đã thử
// tái tạo lỗi và bộ kiểm vẫn xanh. Nên phải đi hết đường: nhập một file danh mục
// thật qua HTTP rồi đọc lại sĩ số.
//
// Để bài này nói được gì về MySQL, nhánh SQLite nay ghi enrolled_base y như nhánh
// MySQL. Trước đây nó bỏ cột ra khỏi câu UPDATE nên vô tình "đúng", và chính chỗ
// hai nền khác nhau là chỗ kiểm thử mù.
import { startTestServer } from "./helpers/test-server.mjs";
import { after, before } from "node:test";

let server;
let quanTri;

before(async () => {
  server = await startTestServer({ prefix: "nshm-danhmuc-" });
  quanTri = await server.loginCookie("admin@nshm.edu.vn", "Admin@123");
});

after(async () => server.stop());

const doc = async (classId) => (await (await server.request("/api/admin/catalog", quanTri)).json())
  .classes.find((row) => row.id === classId);

test("nhập lại danh mục qua HTTP không xoá số ghi danh sẵn của ca đang có", async () => {
  const truoc = await doc("basketball");
  assert.ok(truoc.enrolledBase > 0, `dữ liệu mẫu phải có ca ghi danh sẵn, đang là ${truoc.enrolledBase}`);

  // Đúng hình dạng file danh mục thật: không có cột nào cho "ghi danh sẵn".
  const headers = ["Mã CLB", "Tên CLB", "Nhóm môn", "Khối", "Tên lớp", "Thứ", "Khung giờ", "Phòng", "Giáo viên", "Sĩ số", "Học phí"];
  const rows = [[
    "SPORT-BB", "Bóng rổ nền tảng", "Thể thao", "1, 2, 3, 4, 5", truoc.name || "",
    DAY_LABELS[truoc.dayOfWeek], `${truoc.startTime}-${truoc.endTime}`,
    truoc.room, truoc.teacher, String(truoc.capacity), String(truoc.fee),
  ]];

  const response = await server.request("/api/admin/catalog/import/commit", quanTri, {
    method: "POST",
    body: JSON.stringify({ confirmation: "IMPORT_CLUB_CATALOG", periodId: truoc.periodId, headers, rows }),
  });
  const than = await response.text();
  assert.equal(response.status, 200, `nhập danh mục thất bại: ${than}`);
  const { counters } = JSON.parse(than).result;
  assert.equal(counters.classesUpdated, 1,
    `lượt nhập phải CẬP NHẬT ca đang có; đang tạo mới ${counters.classesCreated} ca, bài kiểm không chạm đường update`);
  assert.equal(counters.classesCreated, 0);

  const sau = await doc("basketball");
  assert.equal(sau.enrolledBase, truoc.enrolledBase,
    "nhập lại danh mục đã xoá số em ghi danh sẵn — sĩ số lớp tụt xuống trong im lặng");
  assert.equal(sau.enrolled, truoc.enrolled, "sĩ số hiển thị phải không đổi");
});
