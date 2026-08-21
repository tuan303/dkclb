import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers/test-server.mjs";

let server;
let adminCookie;
let parentCookie;

const request = (path, cookie, options = {}) => server.request(path, cookie, options);

async function exportCollection(collection) {
  const rows = [];
  let after = null;
  let pages = 0;
  do {
    const response = await request("/api/admin/export/backup", adminCookie, {
      method: "POST",
      body: JSON.stringify({ confirmation: "EXPORT_FULL_BACKUP", collection, after }),
    });
    assert.equal(response.status, 200, `xuất ${collection} phải thành công`);
    const { page } = await response.json();
    rows.push(...page.rows);
    after = page.nextAfter;
    pages += 1;
  } while (after);
  return { rows, pages };
}

before(async () => {
  server = await startTestServer({ prefix: "nshm-backup-" });
  adminCookie = await server.loginCookie("admin@nshm.edu.vn", "Admin@123");
  parentCookie = await server.loginCookie("0901234567", "123456");
});

after(async () => server.stop());

test("chỉ quản trị mới xuất được dữ liệu", async () => {
  const anonymous = await fetch(`${server.baseUrl}/api/admin/export/collections`);
  assert.equal(anonymous.status, 401);

  const asParent = await request("/api/admin/export/backup", parentCookie, {
    method: "POST",
    body: JSON.stringify({ confirmation: "EXPORT_FULL_BACKUP", collection: "users" }),
  });
  assert.equal(asParent.status, 403);
});

test("thiếu xác nhận thì không xuất", async () => {
  const response = await request("/api/admin/export/backup", adminCookie, {
    method: "POST",
    body: JSON.stringify({ collection: "students" }),
  });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "EXPORT_CONFIRMATION_REQUIRED");
});

test("nhóm dữ liệu không tồn tại bị từ chối", async () => {
  const response = await request("/api/admin/export/backup", adminCookie, {
    method: "POST",
    body: JSON.stringify({ confirmation: "EXPORT_FULL_BACKUP", collection: "khong_co_that" }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "UNKNOWN_COLLECTION");
});

test("xuất đủ mười nhóm dữ liệu của hệ thống", async () => {
  const response = await request("/api/admin/export/collections", adminCookie);
  assert.equal(response.status, 200);
  const { collections, schemaVersion } = await response.json();
  assert.equal(schemaVersion, 1);
  assert.deepEqual(collections, [
    "users", "students", "parentStudents", "registrationPeriods", "clubs",
    "clubClasses", "registrations", "supportRequests", "auditLogs", "classCounters",
  ]);
});

test("dữ liệu xuất ra đúng hình dạng dùng chung cho mọi nền lưu trữ", async () => {
  const students = await exportCollection("students");
  assert.equal(students.rows.length, 8);
  const student = students.rows.find((row) => row.code === "NSHM260301");
  assert.deepEqual(Object.keys(student).sort(), ["code", "dateOfBirth", "grade", "homeroom", "id", "level", "name", "status"]);
  assert.equal(student.grade, 3, "khối phải là số, không phải chuỗi");

  const users = await exportCollection("users");
  const parent = users.rows.find((row) => row.account === "0901234567");
  assert.equal(parent.role, "parent");
  assert.equal(parent.accountLower, "0901234567");
  assert.equal(typeof parent.mustChangePassword, "boolean");
  assert.equal(typeof parent.active, "boolean");

  const links = await exportCollection("parentStudents");
  assert.ok(links.rows.every((row) => row.id === `${row.parentUserId}_${row.studentId}`), "mã liên kết phải ghép từ hai đầu");

  const clubs = await exportCollection("clubs");
  assert.ok(Array.isArray(clubs.rows[0].grades), "khối áp dụng phải là mảng số");

  const classes = await exportCollection("clubClasses");
  const piano = classes.rows.find((row) => row.id === "piano");
  assert.equal(piano.clubId, "piano");
  assert.equal(typeof piano.capacity, "number");
  assert.equal(typeof piano.waitlistEnabled, "boolean");

  const registrations = await exportCollection("registrations");
  assert.ok(registrations.rows.length >= 7);
  const registration = registrations.rows.find((row) => row.id === "DK-260812-0142");
  assert.equal(registration.classId, "piano");
  assert.equal(registration.clubId, "piano", "mã CLB được tra qua lớp để nạp sang nền khác không mất liên kết");
  assert.equal(typeof registration.feeSnapshot, "number");

  const counters = await exportCollection("classCounters");
  const pianoCounter = counters.rows.find((row) => row.classId === "piano");
  assert.equal(typeof pianoCounter.enrolledCount, "number");
});

test("phân trang trả về đủ dữ liệu và không lặp bản ghi", async () => {
  const response = await request("/api/admin/export/backup", adminCookie, {
    method: "POST",
    body: JSON.stringify({ confirmation: "EXPORT_FULL_BACKUP", collection: "students", after: null }),
  });
  const { page } = await response.json();
  assert.equal(page.collection, "students");
  assert.equal(page.count, page.rows.length);

  // Lấy tiếp từ sau bản ghi đầu tiên: phải không còn bản ghi đó nữa.
  const firstId = page.rows[0].id;
  const next = await request("/api/admin/export/backup", adminCookie, {
    method: "POST",
    body: JSON.stringify({ confirmation: "EXPORT_FULL_BACKUP", collection: "students", after: firstId }),
  });
  const rest = (await next.json()).page.rows;
  assert.equal(rest.length, page.rows.length - 1);
  assert.ok(!rest.some((row) => row.id === firstId), "không được lặp lại bản ghi đã lấy");
});

test("mọi bản ghi xuất ra đều có mã định danh", async () => {
  for (const collection of ["users", "students", "parentStudents", "registrationPeriods", "clubs", "clubClasses", "registrations", "classCounters"]) {
    const { rows } = await exportCollection(collection);
    assert.ok(rows.every((row) => row.id), `mọi bản ghi trong ${collection} phải có id để nạp lại được`);
    assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, `mã trong ${collection} không được trùng`);
  }
});

test("lần xuất được ghi vào nhật ký thao tác", async () => {
  await exportCollection("users");
  const { rows } = await exportCollection("auditLogs");
  const entry = rows.find((row) => row.action === "EXPORT_FULL_BACKUP");
  assert.ok(entry, "phải có bản ghi nhật ký cho lần xuất dữ liệu");
  assert.equal(entry.entityType, "backup");
  assert.equal(entry.reason, "Xuất toàn bộ dữ liệu");
});
