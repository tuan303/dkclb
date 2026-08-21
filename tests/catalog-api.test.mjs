import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers/test-server.mjs";

let server;
let adminCookie;
let parentCookie;

const request = (path, cookie, options = {}) => server.request(path, cookie, options);

const IMPORT_HEADERS = ["Mã CLB", "Tên CLB", "Nhóm môn", "Khối", "Tên lớp", "Thứ", "Khung giờ", "Phòng", "Giáo viên", "Sĩ số", "Học phí"];

before(async () => {
  server = await startTestServer({ prefix: "nshm-catalog-" });
  adminCookie = await server.loginCookie("admin@nshm.edu.vn", "Admin@123");
  parentCookie = await server.loginCookie("0901234567", "123456");
});

after(async () => server.stop());

test("phụ huynh không đọc được danh mục quản trị", async () => {
  const response = await request("/api/admin/catalog", parentCookie);
  assert.equal(response.status, 403);
  const created = await request("/api/admin/clubs", parentCookie, {
    method: "POST",
    body: JSON.stringify({ name: "CLB lén", category: "Khác", grades: "1-5" }),
  });
  assert.equal(created.status, 403);
});

test("danh mục quản trị trả về đủ CLB, lớp và đợt đăng ký", async () => {
  const response = await request("/api/admin/catalog", adminCookie);
  assert.equal(response.status, 200);
  const catalog = await response.json();
  assert.equal(catalog.clubs.length, 6);
  assert.equal(catalog.classes.length, 6);
  assert.equal(catalog.activePeriodId, "period_2026_hk1");
  const piano = catalog.classes.find((row) => row.id === "piano");
  assert.equal(piano.enrolled, piano.enrolledBase + piano.activeRegistrations);
});

test("không cho mở hai đợt đăng ký cùng lúc", async () => {
  const response = await request("/api/admin/periods", adminCookie, {
    method: "POST",
    body: JSON.stringify({
      name: "Đăng ký CLB · Học kỳ II",
      schoolYear: "2026–2027",
      term: "Học kỳ II",
      openAt: "2027-01-05T01:00:00.000Z",
      closeAt: "2027-01-20T16:59:59.000Z",
      status: "open",
    }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "PERIOD_ALREADY_OPEN");
});

test("tạo được đợt nháp và sửa số CLB tối đa", async () => {
  const created = await request("/api/admin/periods", adminCookie, {
    method: "POST",
    body: JSON.stringify({
      name: "Đăng ký CLB · Học kỳ II",
      schoolYear: "2026–2027",
      term: "Học kỳ II",
      openAt: "2027-01-05T01:00:00.000Z",
      closeAt: "2027-01-20T16:59:59.000Z",
      status: "draft",
      maxClubsPerStudent: 2,
    }),
  });
  assert.equal(created.status, 201);
  const { period } = await created.json();
  assert.equal(period.maxClubsPerStudent, 2);

  const updated = await request(`/api/admin/periods/${period.id}`, adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ maxClubsPerStudent: 4 }),
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).period.maxClubsPerStudent, 4);

  const invalid = await request(`/api/admin/periods/${period.id}`, adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ closeAt: "2026-01-01T00:00:00.000Z" }),
  });
  assert.equal(invalid.status, 422);
  assert.equal((await invalid.json()).error.code, "PERIOD_RANGE_INVALID");
});

test("tạo CLB mới rồi thêm hai lớp khác ca cho cùng CLB", async () => {
  const createdClub = await request("/api/admin/clubs", adminCookie, {
    method: "POST",
    body: JSON.stringify({ code: "SPORT-CV", name: "Cờ vua", category: "Thể thao", grades: "1-5", emoji: "♟️" }),
  });
  assert.equal(createdClub.status, 201);
  const { club } = await createdClub.json();

  const firstClass = await request("/api/admin/classes", adminCookie, {
    method: "POST",
    body: JSON.stringify({
      clubId: club.id, periodId: "period_2026_hk1", name: "Ca 1", dayOfWeek: 2,
      startTime: "16:15", endTime: "17:30", room: "Phòng Cờ 1", teacher: "Thầy Bình",
      capacity: 16, minCapacity: 6, fee: "800.000",
    }),
  });
  assert.equal(firstClass.status, 201);
  const created = (await firstClass.json()).class;
  assert.equal(created.scheduleLabel, "Thứ 3 · 16:15–17:30");
  assert.equal(created.fee, 800000);
  assert.notEqual(created.id, club.id, "mã lớp phải khác mã CLB");

  const secondClass = await request("/api/admin/classes", adminCookie, {
    method: "POST",
    body: JSON.stringify({
      clubId: club.id, periodId: "period_2026_hk1", name: "Ca 2", dayOfWeek: 4,
      startTime: "16:15", endTime: "17:30", room: "Phòng Cờ 1", teacher: "Thầy Bình",
      capacity: 16, fee: 800000,
    }),
  });
  assert.equal(secondClass.status, 201);

  const catalog = await (await request("/api/admin/catalog", adminCookie)).json();
  assert.equal(catalog.classes.filter((row) => row.clubId === club.id).length, 2);
});

test("chặn trùng phòng cùng thứ và cùng khung giờ trong một đợt", async () => {
  const catalog = await (await request("/api/admin/catalog", adminCookie)).json();
  const chess = catalog.clubs.find((item) => item.code === "SPORT-CV");
  const response = await request("/api/admin/classes", adminCookie, {
    method: "POST",
    body: JSON.stringify({
      clubId: chess.id, periodId: "period_2026_hk1", name: "Ca chồng lịch", dayOfWeek: 2,
      startTime: "17:00", endTime: "18:00", room: "Phòng Cờ 1", teacher: "Cô Mai",
      capacity: 10, fee: 500000,
    }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "ROOM_CONFLICT");
});

test("không cho hạ sĩ số xuống dưới số đơn đang giữ chỗ", async () => {
  const submitted = await request("/api/registrations", parentCookie, {
    method: "POST",
    body: JSON.stringify({ studentId: "hs02", clubIds: ["debate"], acceptedTerms: true }),
  });
  assert.equal(submitted.status, 201);

  const catalog = await (await request("/api/admin/catalog", adminCookie)).json();
  const debate = catalog.classes.find((row) => row.id === "debate");
  assert.ok(debate.activeRegistrations >= 2, "lớp phải có ít nhất hai đơn giữ chỗ để kiểm tra ngưỡng sĩ số");
  assert.equal(debate.enrolled, debate.enrolledBase + debate.activeRegistrations);

  const response = await request("/api/admin/classes/debate", adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ capacity: debate.enrolled - 1 }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "CAPACITY_BELOW_ENROLLED");
});

test("không cho ngừng mở lớp đang có đơn hiệu lực", async () => {
  const response = await request("/api/admin/classes/piano", adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ active: false }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "CLASS_HAS_REGISTRATIONS");
});

test("nhập danh mục từ file báo trước rồi mới ghi, và gộp CLB nhiều ca", async () => {
  const rows = [
    ["ART-GT", "Guitar", "Âm nhạc", "3-5", "Ca 1", "Thứ 2", "16:15-17:30", "Phòng Nhạc 2", "Thầy Sơn", "14", "1.500.000"],
    ["ART-GT", "Guitar", "Âm nhạc", "6-9", "Ca 2", "Thứ 6", "16:15-17:30", "Phòng Nhạc 2", "Thầy Sơn", "14", "1.500.000"],
    ["STEM-LG", "Lego STEM", "STEM", "1-3", "Ca 1", "Thứ 4", "16:15-17:15", "Phòng Lab 1.1", "Cô Vân", "18", "1.700.000"],
  ];
  const preview = await request("/api/admin/catalog/import/preview", adminCookie, {
    method: "POST",
    body: JSON.stringify({ periodId: "period_2026_hk1", headers: IMPORT_HEADERS, rows }),
  });
  assert.equal(preview.status, 200);
  const body = (await preview.json()).preview;
  assert.deepEqual(body.missing, []);
  assert.equal(body.counters.clubs, 2);
  assert.equal(body.counters.classes, 3);
  assert.equal(body.readyToImport, true);

  const rejected = await request("/api/admin/catalog/import/commit", adminCookie, {
    method: "POST",
    body: JSON.stringify({ periodId: "period_2026_hk1", headers: IMPORT_HEADERS, rows }),
  });
  assert.equal(rejected.status, 422, "thiếu chuỗi xác nhận thì không được ghi");

  const committed = await request("/api/admin/catalog/import/commit", adminCookie, {
    method: "POST",
    body: JSON.stringify({ periodId: "period_2026_hk1", headers: IMPORT_HEADERS, rows, confirmation: "IMPORT_CLUB_CATALOG" }),
  });
  assert.equal(committed.status, 200);
  const { result } = await committed.json();
  assert.deepEqual(result.counters, { clubsCreated: 2, clubsUpdated: 0, classesCreated: 3, classesUpdated: 0 });

  // Nhập lại đúng file đó phải cập nhật, không nhân đôi dữ liệu.
  const again = await request("/api/admin/catalog/import/commit", adminCookie, {
    method: "POST",
    body: JSON.stringify({ periodId: "period_2026_hk1", headers: IMPORT_HEADERS, rows, confirmation: "IMPORT_CLUB_CATALOG" }),
  });
  assert.equal(again.status, 200);
  assert.deepEqual((await again.json()).result.counters, { clubsCreated: 0, clubsUpdated: 2, classesCreated: 0, classesUpdated: 3 });
});

test("file thiếu cột bắt buộc thì không được phép ghi", async () => {
  const headers = ["Tên CLB", "Phòng", "Giáo viên", "Sĩ số"];
  const rows = [["Cầu lông", "Sân B", "Thầy Tú", "20"]];
  const preview = await (await request("/api/admin/catalog/import/preview", adminCookie, {
    method: "POST",
    body: JSON.stringify({ periodId: "period_2026_hk1", headers, rows }),
  })).json();
  assert.equal(preview.preview.readyToImport, false);
  assert.ok(preview.preview.missing.length > 0);

  const commit = await request("/api/admin/catalog/import/commit", adminCookie, {
    method: "POST",
    body: JSON.stringify({ periodId: "period_2026_hk1", headers, rows, confirmation: "IMPORT_CLUB_CATALOG" }),
  });
  assert.equal(commit.status, 422);
  assert.equal((await commit.json()).error.code, "IMPORT_MAPPING_INCOMPLETE");
});

test("phụ huynh thấy CLB vừa nhập và biết hạn của đợt đang mở", async () => {
  const response = await request("/api/clubs?studentId=hs01", parentCookie);
  assert.equal(response.status, 200);
  const { clubs, period } = await response.json();
  assert.equal(period.id, "period_2026_hk1");
  assert.ok(period.closeAt > new Date().toISOString());
  const guitarClasses = clubs.filter((club) => club.name === "Guitar");
  assert.equal(guitarClasses.length, 2, "CLB vừa nhập phải hiện đủ hai ca ở cổng phụ huynh");
  // Khối khai riêng theo từng ca: ca 1 cho khối 3-5, ca 2 cho khối 6-9.
  assert.equal(guitarClasses.find((item) => item.className === "Ca 1").eligible, true);
  assert.equal(guitarClasses.find((item) => item.className === "Ca 2").eligible, false, "học sinh lớp 3 không hợp lệ với ca dành cho khối 6-9");
});

test("chặn đăng ký hai lớp khác ca của cùng một CLB", async () => {
  const { clubs } = await (await request("/api/clubs?studentId=hs01", parentCookie)).json();
  const chess = clubs.filter((club) => club.name === "Cờ vua");
  assert.equal(chess.length, 2, "Cờ vua có hai ca, cả hai đều áp dụng khối 1-5");
  assert.ok(chess.every((item) => item.eligible), "lớp không khai khối riêng thì kế thừa khối của CLB");

  const response = await request("/api/registrations/validate", parentCookie, {
    method: "POST",
    body: JSON.stringify({ studentId: "hs01", clubIds: chess.map((item) => item.id) }),
  });
  assert.equal(response.status, 200);
  const validation = await response.json();
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.type === "duplicate" && /cùng CLB/.test(issue.message)));
});

test("đơn vào lớp có mã riêng vẫn tra đúng tên CLB và tên ca", async () => {
  const { clubs } = await (await request("/api/clubs?studentId=hs01", parentCookie)).json();
  // Ca 2 của Cờ vua là lớp được tạo qua giao diện nên mã lớp khác mã CLB.
  const secondShift = clubs.find((club) => club.name === "Cờ vua" && club.className === "Ca 2");
  assert.ok(secondShift && secondShift.id !== secondShift.clubId);

  const created = await request("/api/registrations", parentCookie, {
    method: "POST",
    body: JSON.stringify({ studentId: "hs01", clubIds: [secondShift.id], acceptedTerms: true }),
  });
  assert.equal(created.status, 201);

  const { registrations } = await (await request("/api/registrations", parentCookie)).json();
  const row = registrations.find((item) => item.classId === secondShift.id);
  assert.equal(row.club, "Cờ vua", "tên CLB phải tra qua club_id của lớp, không phải qua mã lớp");
  assert.equal(row.classLabel, "Ca 2");
  assert.equal(row.status, "payment");

  const csv = await request("/api/admin/reports/registrations.csv", adminCookie);
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /Cờ vua/);
});

test("đóng đợt đăng ký là chặn ngay việc gửi đơn mới", async () => {
  const closed = await request("/api/admin/periods/period_2026_hk1", adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ status: "closed" }),
  });
  assert.equal(closed.status, 200);

  const blocked = await request("/api/registrations/validate", parentCookie, {
    method: "POST",
    body: JSON.stringify({ studentId: "hs01", clubIds: ["basketball"] }),
  });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).error.code, "REGISTRATION_CLOSED");

  const empty = await (await request("/api/clubs?studentId=hs01", parentCookie)).json();
  assert.deepEqual(empty.clubs, [], "đóng đợt thì phụ huynh không còn thấy CLB nào");

  const reopened = await request("/api/admin/periods/period_2026_hk1", adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ status: "open" }),
  });
  assert.equal(reopened.status, 200);
});

test("vượt giới hạn số CLB mỗi học sinh thì báo lỗi rõ ràng", async () => {
  await request("/api/admin/periods/period_2026_hk1", adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ maxClubsPerStudent: 1 }),
  });
  const response = await request("/api/registrations/validate", parentCookie, {
    method: "POST",
    body: JSON.stringify({ studentId: "hs01", clubIds: ["basketball"] }),
  });
  assert.equal(response.status, 200);
  const validation = await response.json();
  assert.equal(validation.valid, false, "học sinh đã có một đơn Piano nên vượt giới hạn 1 CLB");
  assert.ok(validation.issues.some((issue) => issue.type === "limit"));

  await request("/api/admin/periods/period_2026_hk1", adminCookie, {
    method: "PATCH",
    body: JSON.stringify({ maxClubsPerStudent: 3 }),
  });
});
