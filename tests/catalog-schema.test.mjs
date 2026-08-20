import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeCatalogImport,
  detectCatalogMapping,
  normalizeClassInput,
  normalizeClubInput,
  normalizePeriodInput,
  parseDayOfWeek,
  parseGradeList,
  parseMoney,
  parseTimeOfDay,
  parseTimeRange,
  scheduleLabelOf,
} from "../catalog-schema.mjs";

test("đọc được thứ trong tuần theo cách viết tiếng Việt và tiếng Anh", () => {
  assert.equal(parseDayOfWeek("Thứ 2"), 1);
  assert.equal(parseDayOfWeek("T7"), 6);
  assert.equal(parseDayOfWeek("CN"), 0);
  assert.equal(parseDayOfWeek("Chủ nhật"), 0);
  assert.equal(parseDayOfWeek("3"), 2, "số 3 trong file nghĩa là Thứ 3");
  assert.equal(parseDayOfWeek("Tuesday"), 2);
  assert.equal(parseDayOfWeek("thứ tám"), null);
});

test("đọc được giờ ở nhiều định dạng, kể cả số thực của Excel", () => {
  assert.equal(parseTimeOfDay("16:15"), "16:15");
  assert.equal(parseTimeOfDay("16h15"), "16:15");
  assert.equal(parseTimeOfDay("8:05"), "08:05");
  assert.equal(parseTimeOfDay(0.5), "12:00");
  assert.equal(parseTimeOfDay("0.6770833333333334"), "16:15", "chuỗi phân số do trình đọc .xlsx trả về");
  assert.equal(parseTimeOfDay("16.15"), "16:15", "dấu chấm vẫn được hiểu là dấu ngăn giờ-phút");
  assert.equal(parseTimeOfDay("25:00"), null);
  assert.deepEqual(parseTimeRange("16:15 – 17:30"), { startTime: "16:15", endTime: "17:30" });
  assert.equal(parseTimeRange("16:15"), null);
});

test("đọc được khối áp dụng dạng liệt kê và dạng khoảng", () => {
  assert.deepEqual(parseGradeList("1,2,3"), [1, 2, 3]);
  assert.deepEqual(parseGradeList("Khối 1-5"), [1, 2, 3, 4, 5]);
  assert.deepEqual(parseGradeList("6; 7; 8; 9"), [6, 7, 8, 9]);
  assert.deepEqual(parseGradeList([3, 3, 2]), [2, 3]);
  assert.deepEqual(parseGradeList("không rõ"), []);
});

test("đọc được học phí có dấu phân cách và đơn vị tiền", () => {
  assert.equal(parseMoney("1.200.000 đ"), 1200000);
  assert.equal(parseMoney("1,450,000"), 1450000);
  assert.equal(parseMoney(900000), 900000);
  assert.equal(parseMoney(""), null);
});

test("nhãn lịch học được sinh thống nhất", () => {
  assert.equal(scheduleLabelOf({ dayOfWeek: 2, startTime: "16:15", endTime: "17:30" }), "Thứ 3 · 16:15–17:30");
});

test("đợt đăng ký phải có thời điểm đóng sau thời điểm mở", () => {
  const period = normalizePeriodInput({
    name: "Đăng ký CLB · Học kỳ I",
    schoolYear: "2026–2027",
    term: "Học kỳ I",
    openAt: "2026-09-01T01:00:00.000Z",
    closeAt: "2026-09-15T16:59:59.000Z",
    status: "open",
    maxClubsPerStudent: 2,
  });
  assert.equal(period.status, "open");
  assert.equal(period.maxClubsPerStudent, 2);
  assert.throws(
    () => normalizePeriodInput({ ...period, closeAt: "2026-08-01T00:00:00.000Z" }),
    (error) => error.code === "PERIOD_RANGE_INVALID",
  );
});

test("CLB bắt buộc có khối áp dụng và tự sinh mã khi thiếu", () => {
  const club = normalizeClubInput({ name: "Bóng rổ nền tảng", category: "Thể thao", grades: "1-5" });
  assert.equal(club.code, "CLB-BONRONENTAN");
  assert.equal(club.visual, "sport");
  assert.deepEqual(club.grades, [1, 2, 3, 4, 5]);
  assert.throws(
    () => normalizeClubInput({ name: "CLB mới", category: "Khác", grades: "" }),
    (error) => error.code === "CLUB_GRADES_REQUIRED",
  );
});

test("lớp CLB chặn giờ sai, sĩ số sai và đợt không tồn tại", () => {
  const base = {
    clubId: "basketball",
    periodId: "period_2026_hk1",
    dayOfWeek: 2,
    startTime: "16:15",
    endTime: "17:30",
    room: "Sân A",
    teacher: "Thầy Nam",
    capacity: 24,
    minCapacity: 8,
    fee: "1.200.000",
  };
  const clubClass = normalizeClassInput(base, { knownPeriodIds: ["period_2026_hk1"] });
  assert.equal(clubClass.scheduleLabel, "Thứ 3 · 16:15–17:30");
  assert.equal(clubClass.fee, 1200000);
  assert.equal(clubClass.waitlistEnabled, true);
  assert.throws(() => normalizeClassInput({ ...base, endTime: "15:00" }), (error) => error.code === "CLASS_TIME_INVALID");
  assert.throws(() => normalizeClassInput({ ...base, minCapacity: 40 }), (error) => error.code === "CLASS_CAPACITY_INVALID");
  assert.throws(
    () => normalizeClassInput(base, { knownPeriodIds: ["period_khac"] }),
    (error) => error.code === "PERIOD_NOT_FOUND",
  );
});

test("tự nhận diện cột danh mục CLB từ tiêu đề tiếng Việt", () => {
  const headers = ["Tên CLB", "Nhóm môn", "Khối", "Tên lớp", "Thứ", "Khung giờ", "Phòng", "Giáo viên", "Sĩ số", "Học phí"];
  const { mapping, missing } = detectCatalogMapping(headers);
  assert.deepEqual(missing, []);
  assert.equal(mapping.clubName.index, 0);
  assert.equal(mapping.timeRange.index, 5);
  assert.equal(mapping.capacity.index, 8);
});

test("báo thiếu cột bắt buộc khi file nguồn không có khung giờ", () => {
  const { missing } = detectCatalogMapping(["Tên CLB", "Phòng", "Giáo viên", "Sĩ số"]);
  assert.ok(missing.includes("day"));
  assert.ok(missing.includes("timeRange hoặc startTime+endTime"));
});

test("gộp nhiều ca của cùng một CLB và cảnh báo trùng phòng", () => {
  const headers = ["Tên CLB", "Nhóm môn", "Khối", "Tên lớp", "Thứ", "Khung giờ", "Phòng", "Giáo viên", "Sĩ số", "Học phí"];
  const { mapping } = detectCatalogMapping(headers);
  const rows = [
    ["Bóng rổ", "Thể thao", "1-3", "Ca 1", "Thứ 3", "16:15-17:30", "Sân A", "Thầy Nam", "24", "1.200.000"],
    ["Bóng rổ", "Thể thao", "4-5", "Ca 2", "Thứ 5", "16:15-17:30", "Sân A", "Thầy Nam", "24", "1.200.000"],
    ["Piano", "Âm nhạc", "2-5", "Ca 1", "Thứ 5", "16:30-17:30", "Sân A", "Cô Linh", "12", "1.900.000"],
  ];
  const result = analyzeCatalogImport(rows, mapping, { periodId: "period_2026_hk1" });
  assert.equal(result.counters.clubs, 2);
  assert.equal(result.counters.classes, 3);
  assert.equal(result.readyToImport, true);
  assert.deepEqual(result.clubs.find((club) => club.name === "Bóng rổ").grades, [1, 2, 3, 4, 5]);
  assert.equal(result.issues.filter((issue) => issue.severity === "warning").length, 1);
  assert.match(result.issues[0].codes[0], /Trùng phòng/);
});

test("dòng thiếu dữ liệu bị chặn nhập và nêu rõ lý do", () => {
  const headers = ["Tên CLB", "Khối", "Thứ", "Khung giờ", "Phòng", "Giáo viên", "Sĩ số", "Học phí"];
  const { mapping } = detectCatalogMapping(headers);
  const rows = [
    ["", "1-3", "Thứ 3", "16:15-17:30", "Sân A", "Thầy Nam", "24", "1.200.000"],
    ["Cờ vua", "1-3", "Thứ tám", "16:15-17:30", "Phòng 1", "Cô Hà", "0", "1.000.000"],
  ];
  const result = analyzeCatalogImport(rows, mapping, { periodId: "period_2026_hk1" });
  assert.equal(result.readyToImport, false);
  assert.equal(result.counters.invalidRows, 2);
  assert.deepEqual(result.issues[0].codes, ["Thiếu tên CLB"]);
  assert.deepEqual(result.issues[1].codes, ["Thứ học không đọc được", "Sĩ số tối đa không hợp lệ"]);
});
