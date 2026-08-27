// Kiểm thử phần nguy hiểm nhất của việc đồng bộ từ 3 file Google Sheet: gộp
// nhiều nguồn và quyết định học sinh nào bị đánh dấu nghỉ học. Một lỗi ở đây
// có thể vô hiệu hóa nhầm cả một cấp học.
import test from "node:test";
import assert from "node:assert/strict";
import { checkSnapshotSanity, mergeDirectorySnapshots } from "../directory-merge.mjs";
import { planDirectoryWrites } from "../directory-plan.mjs";

const TIMESTAMP = "2026-08-27T01:00:00.000Z";

function idFactory(prefix) {
  idFactory.counter = (idFactory.counter || 0) + 1;
  return `${prefix}_${idFactory.counter}`;
}
const codeFactory = () => "ABCD2345";

function student(code, name, grade, className, level) {
  return { code, name, dateOfBirth: "2015-01-01", grade, className, educationLevel: level };
}

function guardian(account, displayName, students) {
  return { account, displayName, initialPassword: account, mustChangePassword: true, students };
}

function sourceOk(key, label, students, guardians) {
  return { key, label, ok: true, snapshot: { students, guardians }, analysis: { scannedRows: students.length, issues: [] } };
}

/* ---------- Gộp nhiều nguồn ---------- */

test("gộp ba file thành một ảnh chụp duy nhất", () => {
  const merged = mergeDirectorySnapshots([
    sourceOk("tih", "Tiểu học", [student("HS01", "Nguyễn Minh An", 3, "3A2", "Tiểu học")], [guardian("0901234567", "Mai Lan", [{ studentCode: "HS01", relationship: "Mẹ" }])]),
    sourceOk("thcs", "THCS", [student("HS02", "Nguyễn Gia Hân", 6, "6A1", "THCS")], [guardian("0901234567", "Mai Lan", [{ studentCode: "HS02", relationship: "Mẹ" }])]),
    sourceOk("thpt", "THPT", [student("HS03", "Trần Bảo Ngọc", 10, "10A1", "THPT")], [guardian("0975662437", "Trần Văn Bình", [{ studentCode: "HS03", relationship: "Bố" }])]),
  ]);

  assert.equal(merged.allSourcesLoaded, true);
  assert.equal(merged.snapshot.students.length, 3);
  assert.equal(merged.sources.length, 3);
  assert.deepEqual(merged.duplicates, []);

  // Phụ huynh có con ở hai cấp phải được gộp thành MỘT tài khoản với hai con.
  assert.equal(merged.snapshot.guardians.length, 2);
  const maiLan = merged.snapshot.guardians.find((item) => item.account === "0901234567");
  assert.deepEqual(maiLan.students.map((item) => item.studentCode).sort(), ["HS01", "HS02"]);
});

test("một số điện thoại khai ở hai cấp với quan hệ khác nhau thành Bố/Mẹ", () => {
  const merged = mergeDirectorySnapshots([
    sourceOk("tih", "Tiểu học", [student("HS01", "An", 3, "3A2", "Tiểu học")], [guardian("0901234567", "Mai Lan", [{ studentCode: "HS01", relationship: "Mẹ" }])]),
    sourceOk("thcs", "THCS", [student("HS01x", "Hân", 6, "6A1", "THCS")], [guardian("0901234567", "Mai Lan", [{ studentCode: "HS01", relationship: "Bố" }])]),
  ]);
  const parent = merged.snapshot.guardians[0];
  assert.equal(parent.students.find((item) => item.studentCode === "HS01").relationship, "Bố/Mẹ");
});

test("mã học sinh trùng giữa hai file được báo rõ, không ghi đè im lặng", () => {
  const merged = mergeDirectorySnapshots([
    sourceOk("tih", "Tiểu học", [student("HS01", "Bản ở Tiểu học", 5, "5A1", "Tiểu học")], []),
    sourceOk("thcs", "THCS", [student("HS01", "Bản ở THCS", 6, "6A1", "THCS")], []),
  ]);
  assert.equal(merged.snapshot.students.length, 1);
  assert.equal(merged.snapshot.students[0].name, "Bản ở Tiểu học", "giữ bản gặp trước để kết quả ổn định giữa các lần chạy");
  assert.deepEqual(merged.duplicates, [{ code: "HS01", keptFrom: "tih", alsoIn: "thcs" }]);
});

test("một nguồn lỗi thì cả lần gộp bị đánh dấu là không đầy đủ", () => {
  const merged = mergeDirectorySnapshots([
    sourceOk("tih", "Tiểu học", [student("HS01", "An", 3, "3A2", "Tiểu học")], []),
    { key: "thcs", label: "THCS", ok: false, error: "Không có quyền đọc file." },
    sourceOk("thpt", "THPT", [student("HS03", "Ngọc", 10, "10A1", "THPT")], []),
  ]);
  assert.equal(merged.allSourcesLoaded, false);
  assert.equal(merged.snapshot.students.length, 2, "vẫn đọc được dữ liệu của các nguồn còn lại");
  assert.equal(merged.sources.find((item) => item.key === "thcs").error, "Không có quyền đọc file.");
});

test("liên kết trỏ tới học sinh không có trong ảnh chụp bị bỏ", () => {
  const merged = mergeDirectorySnapshots([
    sourceOk("tih", "Tiểu học", [student("HS01", "An", 3, "3A2", "Tiểu học")],
      [guardian("0901234567", "Mai Lan", [{ studentCode: "HS01", relationship: "Mẹ" }, { studentCode: "KHONG_CO", relationship: "Mẹ" }])]),
  ]);
  assert.deepEqual(merged.snapshot.guardians[0].students.map((item) => item.studentCode), ["HS01"]);
});

/* ---------- Ngưỡng an toàn ---------- */

test("danh sách tụt quá ngưỡng thì dừng đồng bộ", () => {
  assert.deepEqual(checkSnapshotSanity({ incoming: 950, activeExisting: 1000 }), { ok: true, shrinkRatio: 0.05, missing: 50 });
  assert.throws(
    () => checkSnapshotSanity({ incoming: 700, activeExisting: 1000 }),
    (error) => error.code === "DIRECTORY_SNAPSHOT_SHRANK" && /thiếu 300 em, giảm 30%/.test(error.message),
  );
  // Cơ sở dữ liệu đang rỗng thì lần đồng bộ đầu tiên không có gì để so.
  assert.deepEqual(checkSnapshotSanity({ incoming: 0, activeExisting: 0 }), { ok: true, shrinkRatio: 0, missing: 0 });
  // Danh sách nhiều lên thì không phải chuyện đáng lo.
  assert.equal(checkSnapshotSanity({ incoming: 1200, activeExisting: 1000 }).ok, true);
});

test("nhóm nhỏ: vài em chuyển trường không bị coi là sự cố dữ liệu", () => {
  // Chỉ xét tỉ lệ thì 2/30 em nghỉ đã là 7% (qua), nhưng 1/3 em nghỉ là 33% và sẽ
  // bị chặn oan. Phải vượt CẢ tỉ lệ LẪN số lượng tuyệt đối mới dừng.
  assert.equal(checkSnapshotSanity({ incoming: 2, activeExisting: 3 }).ok, true);
  assert.equal(checkSnapshotSanity({ incoming: 22, activeExisting: 30 }).ok, true, "8 em nghỉ trong 30 vẫn là chuyện bình thường");
  assert.throws(
    () => checkSnapshotSanity({ incoming: 20, activeExisting: 30 }),
    (error) => error.code === "DIRECTORY_SNAPSHOT_SHRANK",
    "10 em biến mất cùng lúc thì đáng để dừng lại kiểm tra",
  );
});

/* ---------- Đánh dấu nghỉ học ---------- */

const EXISTING = [
  { id: "hs01", code: "HS01", name: "An", dateOfBirth: "2015-01-01", grade: 3, homeroom: "3A2", level: "Tiểu học", status: "active" },
  { id: "hs02", code: "HS02", name: "Hân", dateOfBirth: "2015-01-01", grade: 6, homeroom: "6A1", level: "THCS", status: "active" },
  { id: "hs03", code: "HS03", name: "Ngọc", dateOfBirth: "2015-01-01", grade: 10, homeroom: "10A1", level: "THPT", status: "active" },
];

test("học sinh biến mất khỏi cả ba file thì đánh dấu nghỉ, không xóa", () => {
  idFactory.counter = 0;
  const snapshot = { students: [student("HS01", "An", 3, "3A2", "Tiểu học"), student("HS02", "Hân", 6, "6A1", "THCS")], guardians: [] };
  const plan = planDirectoryWrites({
    snapshot, students: EXISTING, timestamp: TIMESTAMP, idFactory, codeFactory, allSourcesLoaded: true,
  });
  assert.equal(plan.counters.studentsDeactivated, 1);
  assert.deepEqual(plan.deactivated, [{ id: "hs03", code: "HS03" }]);
  const write = plan.writes.find((item) => item.id === "hs03");
  assert.equal(write.data.status, "inactive");
  assert.equal(write.data.name, "Ngọc", "giữ nguyên thông tin, chỉ đổi trạng thái");
});

test("học sinh lên cấp không bị coi là nghỉ học", () => {
  idFactory.counter = 0;
  // Em HS01 chuyển từ file Tiểu học sang file THCS: vẫn có mặt trong ảnh chụp gộp.
  const merged = mergeDirectorySnapshots([
    sourceOk("tih", "Tiểu học", [], []),
    sourceOk("thcs", "THCS", [student("HS01", "An", 6, "6A3", "THCS"), student("HS02", "Hân", 7, "7A1", "THCS")], []),
    sourceOk("thpt", "THPT", [student("HS03", "Ngọc", 11, "11A1", "THPT")], []),
  ]);
  const plan = planDirectoryWrites({
    snapshot: merged.snapshot, students: EXISTING, timestamp: TIMESTAMP, idFactory, codeFactory,
    allSourcesLoaded: merged.allSourcesLoaded,
  });
  assert.equal(plan.counters.studentsDeactivated, 0, "không được vô hiệu hóa em đã lên cấp");
  assert.equal(plan.counters.studentsUpdated, 3, "chỉ cập nhật khối và lớp hành chính");
  const moved = plan.writes.find((item) => item.id === "hs01");
  assert.equal(moved.data.level, "THCS");
  assert.equal(moved.data.status, "active");
});

test("một file lỗi thì tuyệt đối không vô hiệu hóa ai", () => {
  idFactory.counter = 0;
  // File THCS hỏng nên HS02 vắng mặt; nếu máy móc thì em đó bị đánh dấu nghỉ oan.
  const merged = mergeDirectorySnapshots([
    sourceOk("tih", "Tiểu học", [student("HS01", "An", 3, "3A2", "Tiểu học")], []),
    { key: "thcs", label: "THCS", ok: false, error: "Đổi tên tab nên không đọc được." },
    sourceOk("thpt", "THPT", [student("HS03", "Ngọc", 10, "10A1", "THPT")], []),
  ]);
  const plan = planDirectoryWrites({
    snapshot: merged.snapshot, students: EXISTING, timestamp: TIMESTAMP, idFactory, codeFactory,
    allSourcesLoaded: merged.allSourcesLoaded,
  });
  assert.equal(plan.counters.studentsDeactivated, 0);
  assert.equal(plan.counters.studentsDeactivationSkipped, 1, "phải báo rõ là đã bỏ qua chứ không im lặng");
  assert.ok(!plan.writes.some((item) => item.data.status === "inactive"));
});

test("đọc được cả ba file nhưng danh sách tụt quá nhiều thì dừng, không ghi gì", () => {
  idFactory.counter = 0;
  const big = Array.from({ length: 100 }, (unused, index) => ({
    id: `hs${index}`, code: `HS${index}`, name: `Học sinh ${index}`, dateOfBirth: "2015-01-01",
    grade: 3, homeroom: "3A2", level: "Tiểu học", status: "active",
  }));
  const snapshot = { students: [student("HS0", "Học sinh 0", 3, "3A2", "Tiểu học")], guardians: [] };
  assert.throws(
    () => planDirectoryWrites({ snapshot, students: big, timestamp: TIMESTAMP, idFactory, codeFactory, allSourcesLoaded: true }),
    (error) => error.code === "DIRECTORY_SNAPSHOT_SHRANK",
  );
});

test("học sinh đã nghỉ từ trước không bị đếm lại mỗi lần đồng bộ", () => {
  idFactory.counter = 0;
  const withInactive = [...EXISTING.slice(0, 2), { ...EXISTING[2], status: "inactive" }];
  const snapshot = { students: [student("HS01", "An", 3, "3A2", "Tiểu học"), student("HS02", "Hân", 6, "6A1", "THCS")], guardians: [] };
  const plan = planDirectoryWrites({
    snapshot, students: withInactive, timestamp: TIMESTAMP, idFactory, codeFactory, allSourcesLoaded: true,
  });
  assert.equal(plan.counters.studentsDeactivated, 0);
  assert.equal(plan.counters.writes, 0, "không còn gì thay đổi thì không ghi lượt nào");
});
