import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDirectoryRows, buildDirectorySnapshot, buildGuardianAccounts, detectColumnMapping, normalizeVietnamesePhone, toVietnameseLocalPhone } from "../sheets-directory.mjs";

test("detects Vietnamese directory headers", () => {
  const headers = ["Mã học sinh", "Họ và tên học sinh", "Ngày sinh", "Lớp", "Cấp học", "SĐT bố", "Số điện thoại mẹ"];
  const result = detectColumnMapping(headers);
  assert.deepEqual(result.missing, []);
  assert.equal(result.mapping.studentCode.index, 0);
  assert.equal(result.mapping.motherPhone.index, 6);
});

test("normalizes Vietnamese mobile numbers without exposing formatting differences", () => {
  assert.equal(normalizeVietnamesePhone("0912 345 678"), "+84912345678");
  assert.equal(normalizeVietnamesePhone("912345678"), "+84912345678");
  assert.equal(normalizeVietnamesePhone("+84 912-345-678"), "+84912345678");
  assert.equal(toVietnameseLocalPhone("912345678"), "0912345678");
  assert.equal(toVietnameseLocalPhone(912345678), "0912345678");
  assert.equal(normalizeVietnamesePhone("12345"), null);
});

test("preview analysis flags duplicates and invalid parent phones", () => {
  const headers = ["Mã học sinh", "Họ tên", "Ngày sinh", "Lớp", "Cấp học", "SĐT bố", "SĐT mẹ"];
  const { mapping } = detectColumnMapping(headers);
  const analysis = analyzeDirectoryRows([
    ["HS001", "Nguyễn Minh An", "01/01/2017", "3A2", "Tiểu học", "0912345678", ""],
    ["HS001", "Nguyễn Gia Hân", "02/02/2014", "6A1", "THCS", "không hợp lệ", ""],
  ], mapping, 2);
  assert.equal(analysis.validRows, 1);
  assert.equal(analysis.invalidRows, 1);
  assert.deepEqual(analysis.issues[0].codes, ["INVALID_FATHER_PHONE", "MISSING_VALID_GUARDIAN_PHONE", "DUPLICATE_STUDENT_CODE"]);
});

test("an invalid secondary phone is a non-blocking warning when another guardian phone is valid", () => {
  const headers = ["Mã HS", "Họ và tên học sinh", "Ngày tháng năm sinh", "Lớp 26-27", "Khối", "SĐT bố", "SDT mẹ"];
  const { mapping, missing } = detectColumnMapping(headers);
  assert.deepEqual(missing, []);
  const analysis = analyzeDirectoryRows([
    ["HS010", "Nguyễn Minh Châu", "01/02/2017", "3A1", "3", "0912345678", "không hợp lệ"],
  ], mapping, 2);
  assert.equal(analysis.validRows, 1);
  assert.equal(analysis.invalidRows, 0);
  assert.equal(analysis.warningRows, 1);
  assert.equal(analysis.issues[0].severity, "warning");
});

test("groups multiple children under one normalized guardian account", () => {
  const headers = ["Mã học sinh", "Họ tên", "Ngày sinh", "Lớp", "Cấp học", "SĐT bố", "SĐT mẹ"];
  const { mapping } = detectColumnMapping(headers);
  const accounts = buildGuardianAccounts([
    ["HS001", "Nguyễn Minh An", "01/01/2017", "3A2", "Tiểu học", 912345678, ""],
    ["HS002", "Nguyễn Gia Hân", "02/02/2014", "6A1", "THCS", "912345678", ""],
  ], mapping);
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].account, "0912345678");
  assert.equal(accounts[0].initialPassword, "0912345678");
  assert.equal(accounts[0].mustChangePassword, true);
  assert.deepEqual(accounts[0].students.map((item) => item.studentCode), ["HS001", "HS002"]);
});

test("builds student records and local-format initial credentials for sync", () => {
  const headers = ["Mã học sinh", "Họ tên", "Ngày sinh", "Lớp", "Cấp học", "SĐT bố", "SĐT mẹ"];
  const { mapping } = detectColumnMapping(headers);
  const snapshot = buildDirectorySnapshot([
    ["HS009", "Đỗ Minh Anh", "03/04/2018", "2A3", "Tiểu học", "987654321", ""],
  ], mapping);
  assert.deepEqual(snapshot.students[0], {
    code: "HS009", name: "Đỗ Minh Anh", dateOfBirth: "03/04/2018", className: "2A3", educationLevel: "Tiểu học", grade: 2,
  });
  assert.equal(snapshot.guardians[0].account, "0987654321");
  assert.equal(snapshot.guardians[0].initialPassword, "0987654321");
});
