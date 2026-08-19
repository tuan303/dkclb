import test from "node:test";
import assert from "node:assert/strict";
import { validatePasswordPolicy } from "../password-policy.mjs";

test("accepts an eight-character password with all required character groups", () => {
  assert.equal(validatePasswordPolicy("Abcd@123").valid, true);
  assert.equal(validatePasswordPolicy("Đẹp#2026").valid, true);
});

test("rejects short or incomplete passwords", () => {
  assert.equal(validatePasswordPolicy("Ab@123").code, "PASSWORD_LENGTH_INVALID");
  assert.equal(validatePasswordPolicy("abcdefgh").code, "PASSWORD_COMPLEXITY_REQUIRED");
  assert.equal(validatePasswordPolicy("ABCDEFG1").code, "PASSWORD_COMPLEXITY_REQUIRED");
  assert.equal(validatePasswordPolicy("Abcdefg1").code, "PASSWORD_COMPLEXITY_REQUIRED");
});

test("rejects a password containing the parent login phone", () => {
  assert.equal(validatePasswordPolicy("Ab@0912345678", "0912345678").code, "PASSWORD_CONTAINS_ACCOUNT");
});
