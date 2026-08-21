import test from "node:test";
import assert from "node:assert/strict";
import { planDirectoryWrites } from "../directory-plan.mjs";

const TIMESTAMP = "2026-08-21T01:00:00.000Z";

function idFactory(prefix) {
  idFactory.counter = (idFactory.counter || 0) + 1;
  return `${prefix}_${idFactory.counter}`;
}

function snapshotOf() {
  return {
    students: [
      { code: "NSHM01", name: "Nguyễn Minh An", dateOfBirth: "2018-05-02", grade: 3, className: "3A2", educationLevel: "Tiểu học" },
      { code: "NSHM02", name: "Nguyễn Gia Hân", dateOfBirth: "2015-09-11", grade: 6, className: "6A1", educationLevel: "THCS" },
    ],
    guardians: [
      { account: "0901234567", displayName: "Mai Lan", students: [{ studentCode: "NSHM01", relationship: "Mẹ" }, { studentCode: "NSHM02", relationship: "Mẹ" }] },
      { account: "0975662437", displayName: "Trần Văn Bình", students: [{ studentCode: "NSHM01", relationship: "Bố" }] },
    ],
  };
}

// Dựng lại trạng thái kho dữ liệu sau khi đã ghi một bản kế hoạch.
function applyPlan(plan, state = { students: [], users: [], links: [] }) {
  const next = { students: [...state.students], users: [...state.users], links: [...state.links] };
  const collections = { students: "students", users: "users", parentStudents: "links" };
  for (const write of plan.writes) {
    const bucket = collections[write.collection];
    const index = next[bucket].findIndex((row) => row.id === write.id);
    const record = { id: write.id, ...(index >= 0 ? next[bucket][index] : {}), ...write.data };
    if (index >= 0) next[bucket][index] = record;
    else next[bucket].push(record);
  }
  return next;
}

test("lần đồng bộ đầu tiên tạo học sinh, tài khoản và liên kết", () => {
  idFactory.counter = 0;
  const plan = planDirectoryWrites({ snapshot: snapshotOf(), timestamp: TIMESTAMP, idFactory });
  assert.equal(plan.counters.studentsCreated, 2);
  assert.equal(plan.counters.parentsCreated, 2);
  assert.equal(plan.counters.linksCreated, 3);
  assert.equal(plan.counters.writes, 7);
  assert.equal(plan.writes.length, 7);

  const account = plan.writes.find((write) => write.collection === "users" && write.data.account === "0975662437");
  assert.equal(account.data.mustChangePassword, true);
  assert.equal(account.data.passwordHash, null, "không lưu hash cho mật khẩu khởi tạo");
  assert.equal(account.data.accountLower, "0975662437");
});

test("đồng bộ lại đúng dữ liệu đó thì không ghi gì thêm", () => {
  idFactory.counter = 0;
  const first = planDirectoryWrites({ snapshot: snapshotOf(), timestamp: TIMESTAMP, idFactory });
  const state = applyPlan(first);

  const second = planDirectoryWrites({ snapshot: snapshotOf(), ...state, timestamp: TIMESTAMP, idFactory });
  assert.equal(second.counters.writes, 0, "đây là tính chất quyết định việc tiết kiệm hạn ngạch");
  assert.deepEqual(second.writes, []);
  assert.equal(second.counters.studentsUnchanged, 2);
  assert.equal(second.counters.parentsUnchanged, 2);
  assert.equal(second.counters.linksUnchanged, 3);
});

test("chỉ ghi đúng những bản ghi thực sự đổi", () => {
  idFactory.counter = 0;
  const state = applyPlan(planDirectoryWrites({ snapshot: snapshotOf(), timestamp: TIMESTAMP, idFactory }));

  const changed = snapshotOf();
  changed.students[0].className = "4A2";
  changed.students[0].grade = 4;

  const plan = planDirectoryWrites({ snapshot: changed, ...state, timestamp: TIMESTAMP, idFactory });
  assert.equal(plan.counters.writes, 1);
  assert.equal(plan.counters.studentsUpdated, 1);
  assert.equal(plan.counters.studentsUnchanged, 1);
  assert.equal(plan.writes[0].collection, "students");
  assert.equal(plan.writes[0].data.homeroom, "4A2");
});

test("học sinh mới bổ sung vào Sheet được tạo cùng liên kết, phần cũ giữ nguyên", () => {
  idFactory.counter = 0;
  const state = applyPlan(planDirectoryWrites({ snapshot: snapshotOf(), timestamp: TIMESTAMP, idFactory }));

  const grown = snapshotOf();
  grown.students.push({ code: "NSHM03", name: "Lê Minh Khang", dateOfBirth: "2019-02-20", grade: 2, className: "2A1", educationLevel: "Tiểu học" });
  grown.guardians[1].students.push({ studentCode: "NSHM03", relationship: "Bố" });

  const plan = planDirectoryWrites({ snapshot: grown, ...state, timestamp: TIMESTAMP, idFactory });
  assert.equal(plan.counters.studentsCreated, 1);
  assert.equal(plan.counters.linksCreated, 1);
  assert.equal(plan.counters.writes, 2);
  assert.equal(plan.counters.studentsUnchanged, 2);
  assert.equal(plan.counters.parentsUnchanged, 2);
});

test("một số điện thoại khai ở cả cột bố và cột mẹ được ghi nhận là Bố/Mẹ", () => {
  idFactory.counter = 0;
  const snapshot = snapshotOf();
  const state = applyPlan(planDirectoryWrites({ snapshot, timestamp: TIMESTAMP, idFactory }));

  const swapped = snapshotOf();
  swapped.guardians[1].students[0].relationship = "Mẹ";
  const plan = planDirectoryWrites({ snapshot: swapped, ...state, timestamp: TIMESTAMP, idFactory });
  assert.equal(plan.counters.linksUpdated, 1);
  assert.equal(plan.writes[0].data.relationship, "Bố/Mẹ");

  // Đã là "Bố/Mẹ" rồi thì lần sau không ghi lại nữa.
  const settled = planDirectoryWrites({ snapshot: swapped, ...applyPlan(plan, state), timestamp: TIMESTAMP, idFactory });
  assert.equal(settled.counters.writes, 0);
});

test("tài khoản đang tắt được bật lại, tài khoản đang bật thì bỏ qua", () => {
  idFactory.counter = 0;
  const state = applyPlan(planDirectoryWrites({ snapshot: snapshotOf(), timestamp: TIMESTAMP, idFactory }));
  state.users[0].active = false;

  const plan = planDirectoryWrites({ snapshot: snapshotOf(), ...state, timestamp: TIMESTAMP, idFactory });
  assert.equal(plan.counters.parentsUpdated, 1);
  assert.equal(plan.counters.parentsUnchanged, 1);
  assert.equal(plan.writes.length, 1);
  assert.equal(plan.writes[0].data.active, true);
});

test("số điện thoại phụ huynh trùng với tài khoản nhà trường thì dừng và báo rõ", () => {
  idFactory.counter = 0;
  const state = { students: [], users: [{ id: "u_admin", account: "0901234567", accountLower: "0901234567", role: "admin" }], links: [] };
  assert.throws(
    () => planDirectoryWrites({ snapshot: snapshotOf(), ...state, timestamp: TIMESTAMP, idFactory }),
    (error) => error.code === "ACCOUNT_ROLE_CONFLICT" && error.status === 409 && error.expose === true,
  );
});

test("bản ghi cũ thiếu accountLower được bổ sung đúng một lần", () => {
  idFactory.counter = 0;
  const state = {
    students: [],
    users: [{ id: "u_old", account: "0901234567", role: "parent", active: true }],
    links: [],
  };
  const snapshot = { students: [], guardians: [{ account: "0901234567", displayName: "Mai Lan", students: [] }] };
  const first = planDirectoryWrites({ snapshot, ...state, timestamp: TIMESTAMP, idFactory });
  assert.equal(first.counters.parentsUpdated, 1);
  assert.equal(first.writes[0].data.accountLower, "0901234567");

  const second = planDirectoryWrites({ snapshot, ...applyPlan(first, state), timestamp: TIMESTAMP, idFactory });
  assert.equal(second.counters.writes, 0);
});
