import test from "node:test";
import assert from "node:assert/strict";
import { isUnchanged } from "../record-diff.mjs";

test("bản ghi giống hệt thì không cần ghi lại", () => {
  const existing = { id: "hs01", code: "NSHM01", name: "Nguyễn Minh An", grade: 3, homeroom: "3A2", status: "active" };
  assert.equal(isUnchanged(existing, { code: "NSHM01", name: "Nguyễn Minh An", grade: 3, homeroom: "3A2", status: "active" }), true);
});

test("chỉ đối chiếu các trường sắp ghi, bản ghi cũ được phép có thêm trường", () => {
  const existing = { code: "NSHM01", name: "An", passwordHash: "abc", createdAt: "2026-01-01T00:00:00.000Z" };
  assert.equal(isUnchanged(existing, { code: "NSHM01", name: "An" }), true);
});

test("đổi bất kỳ trường nào cũng phải ghi lại", () => {
  const existing = { code: "NSHM01", name: "Nguyễn Minh An", homeroom: "3A2" };
  assert.equal(isUnchanged(existing, { code: "NSHM01", name: "Nguyễn Minh An", homeroom: "4A2" }), false);
  assert.equal(isUnchanged(existing, { code: "NSHM01", name: "Nguyễn Minh Ân", homeroom: "3A2" }), false);
});

test("chưa có bản ghi thì luôn phải ghi", () => {
  assert.equal(isUnchanged(null, { code: "NSHM01" }), false);
  assert.equal(isUnchanged(undefined, { code: "NSHM01" }), false);
});

test("trường mới xuất hiện so với bản ghi cũ được coi là thay đổi", () => {
  // Bản ghi tạo từ phiên bản trước chưa có accountLower thì phải được bổ sung.
  assert.equal(isUnchanged({ account: "0901234567" }, { account: "0901234567", accountLower: "0901234567" }), false);
  assert.equal(isUnchanged({ active: undefined }, { active: true }), false);
});

test("số và chuỗi số cùng giá trị được coi là như nhau", () => {
  // Google Sheets trả về chuỗi, Firestore lưu số; không được vì thế mà ghi lại mỗi lần.
  assert.equal(isUnchanged({ grade: 3 }, { grade: "3" }), true);
  assert.equal(isUnchanged({ grade: "3" }, { grade: 3 }), true);
  assert.equal(isUnchanged({ grade: 3 }, { grade: 4 }), false);
});

test("rỗng, null và undefined được coi là như nhau", () => {
  assert.equal(isUnchanged({ dateOfBirth: null }, { dateOfBirth: "" }), true);
  assert.equal(isUnchanged({ lockedUntil: undefined }, { lockedUntil: null }), true);
  assert.equal(isUnchanged({ dateOfBirth: null }, { dateOfBirth: "2018-05-02" }), false);
});

test("giá trị đúng/sai so sánh theo nghĩa đúng/sai", () => {
  assert.equal(isUnchanged({ active: true }, { active: true }), true);
  assert.equal(isUnchanged({ active: false }, { active: true }), false);
  assert.equal(isUnchanged({ mustChangePassword: true }, { mustChangePassword: false }), false);
});

test("mảng so sánh theo từng phần tử và đúng thứ tự", () => {
  assert.equal(isUnchanged({ grades: [1, 2, 3] }, { grades: [1, 2, 3] }), true);
  assert.equal(isUnchanged({ grades: [1, 2, 3] }, { grades: [1, 3, 2] }), false);
  assert.equal(isUnchanged({ grades: [1, 2] }, { grades: [1, 2, 3] }), false);
});
