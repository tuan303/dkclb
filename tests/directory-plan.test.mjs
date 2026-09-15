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

test("nhập lại đúng dữ liệu đó thì không ghi gì thêm", () => {
  idFactory.counter = 0;
  const first = planDirectoryWrites({ snapshot: snapshotOf(), timestamp: TIMESTAMP, idFactory });
  const state = applyPlan(first);

  const second = planDirectoryWrites({ snapshot: snapshotOf(), ...state, timestamp: TIMESTAMP, idFactory });
  assert.equal(second.counters.writes, 0);
  assert.deepEqual(second.writes, []);
  assert.equal(second.counters.studentsExisting, 2, "em đã có được đếm để báo lại, không lặng lẽ bỏ");
  assert.deepEqual(second.daCo.map((item) => item.code), ["NSHM01", "NSHM02"]);
});

test("CHỈ TẠO MỚI: file ghi lớp khác cho em đã có thì bỏ qua, không cập nhật", () => {
  // Quyết định của nhà trường ngày 15/09/2026: nhập file chỉ thêm em mới.
  idFactory.counter = 0;
  const state = applyPlan(planDirectoryWrites({ snapshot: snapshotOf(), timestamp: TIMESTAMP, idFactory }));

  const changed = snapshotOf();
  changed.students[0].className = "4A2";
  changed.students[0].grade = 4;

  const plan = planDirectoryWrites({ snapshot: changed, ...state, timestamp: TIMESTAMP, idFactory });
  assert.equal(plan.counters.writes, 0);
  assert.equal(plan.counters.studentsUpdated, 0);
  assert.equal(plan.counters.studentsExisting, 2);
});

test("đối chiếu toàn trường (capNhatHocSinhDaCo) chỉ ghi đúng những em thực sự đổi lớp", () => {
  idFactory.counter = 0;
  const state = applyPlan(planDirectoryWrites({ snapshot: snapshotOf(), timestamp: TIMESTAMP, idFactory }));

  const changed = snapshotOf();
  changed.students[0].className = "4A2";
  changed.students[0].grade = 4;

  const plan = planDirectoryWrites({ snapshot: changed, ...state, timestamp: TIMESTAMP, idFactory, capNhatHocSinhDaCo: true });
  assert.equal(plan.counters.writes, 1);
  assert.equal(plan.counters.studentsUpdated, 1);
  assert.equal(plan.counters.studentsUnchanged, 1);
  assert.equal(plan.writes[0].collection, "students");
  assert.equal(plan.writes[0].data.homeroom, "4A2");
});

test("học sinh mới bổ sung vào file được tạo cùng liên kết, phần cũ giữ nguyên", () => {
  idFactory.counter = 0;
  const state = applyPlan(planDirectoryWrites({ snapshot: snapshotOf(), timestamp: TIMESTAMP, idFactory }));

  const grown = snapshotOf();
  grown.students.push({ code: "NSHM03", name: "Lê Minh Khang", dateOfBirth: "2019-02-20", grade: 2, className: "2A1", educationLevel: "Tiểu học" });
  grown.guardians[1].students.push({ studentCode: "NSHM03", relationship: "Bố" });

  const plan = planDirectoryWrites({ snapshot: grown, ...state, timestamp: TIMESTAMP, idFactory });
  assert.equal(plan.counters.studentsCreated, 1);
  assert.equal(plan.counters.linksCreated, 1);
  assert.equal(plan.counters.writes, 2, "một em mới và một liên kết — không ghi gì vào tài khoản đã có");
  assert.equal(plan.counters.studentsExisting, 2);
  assert.equal(plan.counters.parentsUnchanged, 1, "số bố đã có tài khoản: gắn em mới vào đó");
  assert.equal(plan.counters.parentsCreated, 0);
});

test("SĐT đã đổi ở màn Thông tin học sinh KHÔNG sống lại khi nhập lại file cũ", () => {
  // Đây là lý do có quy tắc chỉ tạo mới. Trước đây nhập lại file cũ là tạo lại tài
  // khoản cho số cũ rồi gắn lại vào em: người cầm số cũ vào xem được con người khác.
  idFactory.counter = 0;
  const state = applyPlan(planDirectoryWrites({ snapshot: snapshotOf(), timestamp: TIMESTAMP, idFactory }));
  const bo = state.users.find((user) => user.account === "0975662437");
  Object.assign(bo, { account: "0912000111", accountLower: "0912000111" });

  const plan = planDirectoryWrites({ snapshot: snapshotOf(), ...state, timestamp: TIMESTAMP, idFactory });
  assert.equal(plan.counters.writes, 0);
  assert.equal(plan.writes.filter((write) => write.collection === "users").length, 0, "không tạo lại tài khoản cho số cũ");
  assert.equal(plan.writes.filter((write) => write.collection === "parentStudents").length, 0);
});

test("đối chiếu cập nhật lớp của em đã có nhưng KHÔNG đụng liên hệ phụ huynh", () => {
  idFactory.counter = 0;
  const state = applyPlan(planDirectoryWrites({ snapshot: snapshotOf(), timestamp: TIMESTAMP, idFactory }));
  Object.assign(state.users.find((user) => user.account === "0975662437"), { account: "0912000111", accountLower: "0912000111" });

  const changed = snapshotOf();
  changed.students[0].className = "4A2";
  changed.students[0].grade = 4;
  changed.guardians[0].email = "moi@vd.vn";

  const plan = planDirectoryWrites({ snapshot: changed, ...state, timestamp: TIMESTAMP, idFactory, capNhatHocSinhDaCo: true });
  assert.deepEqual(plan.writes.map((write) => write.collection), ["students"]);
});

test("một số điện thoại khai ở cả cột bố và cột mẹ của em mới được ghi nhận là Bố/Mẹ", () => {
  idFactory.counter = 0;
  const snapshot = {
    students: [snapshotOf().students[0]],
    guardians: [
      { account: "0901234567", displayName: "Mai Lan", students: [{ studentCode: "NSHM01", relationship: "Mẹ" }] },
      { account: "0901234567", displayName: "Mai Lan", students: [{ studentCode: "NSHM01", relationship: "Bố" }] },
    ],
  };
  const plan = planDirectoryWrites({ snapshot, timestamp: TIMESTAMP, idFactory });
  const lienKet = plan.writes.filter((write) => write.collection === "parentStudents");
  assert.equal(lienKet.length, 2, "cùng một khoá liên kết, lần sau ghi đè lần trước");
  assert.equal(lienKet[1].data.relationship, "Bố/Mẹ");
});

test("tài khoản đã có không bị file ghi gì — kể cả đang tắt; em mới chỉ được gắn thêm", () => {
  idFactory.counter = 0;
  const state = applyPlan(planDirectoryWrites({ snapshot: snapshotOf(), timestamp: TIMESTAMP, idFactory }));
  state.users[0].active = false;

  const lai = planDirectoryWrites({ snapshot: snapshotOf(), ...state, timestamp: TIMESTAMP, idFactory });
  assert.equal(lai.counters.writes, 0);

  const grown = snapshotOf();
  grown.students.push({ code: "NSHM03", name: "Lê Minh Khang", dateOfBirth: "2019-02-20", grade: 2, className: "2A1", educationLevel: "Tiểu học" });
  grown.guardians[0].students.push({ studentCode: "NSHM03", relationship: "Mẹ" });
  const plan = planDirectoryWrites({ snapshot: grown, ...state, timestamp: TIMESTAMP, idFactory });
  assert.deepEqual(plan.writes.map((write) => write.collection).sort(), ["parentStudents", "students"]);
});

test("số điện thoại phụ huynh trùng với tài khoản nhà trường thì dừng và báo rõ", () => {
  idFactory.counter = 0;
  const state = { students: [], users: [{ id: "u_admin", account: "0901234567", accountLower: "0901234567", role: "admin" }], links: [] };
  assert.throws(
    () => planDirectoryWrites({ snapshot: snapshotOf(), ...state, timestamp: TIMESTAMP, idFactory }),
    (error) => error.code === "ACCOUNT_ROLE_CONFLICT" && error.status === 409 && error.expose === true,
  );
});

test("số chỉ đi với em đã có thì không tạo tài khoản, không ghi gì", () => {
  idFactory.counter = 0;
  const state = {
    students: [{ id: "hs1", code: "NSHM01", name: "Nguyễn Minh An", dateOfBirth: "2018-05-02", grade: 3, homeroom: "3A2", level: "Tiểu học", status: "active" }],
    users: [],
    links: [],
  };
  const snapshot = {
    students: [snapshotOf().students[0]],
    guardians: [{ account: "0901234567", displayName: "Mai Lan", students: [{ studentCode: "NSHM01", relationship: "Mẹ" }] }],
  };
  const plan = planDirectoryWrites({ snapshot, ...state, timestamp: TIMESTAMP, idFactory });
  assert.equal(plan.counters.writes, 0, "em chưa có SĐT phụ huynh thì thêm ở màn Thông tin học sinh, không phải nhập lại file");
  assert.equal(plan.counters.parentsCreated, 0);
});
