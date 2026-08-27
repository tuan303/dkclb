import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVATION_ALPHABET, ACTIVATION_CODE_LENGTH, formatActivationCode,
  generateActivationCode, isValidActivationCode, normalizeActivationCode,
} from "../activation-code.mjs";

test("mã sinh ra đúng độ dài và chỉ dùng ký tự cho phép", () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const code = generateActivationCode();
    assert.equal(code.length, ACTIVATION_CODE_LENGTH);
    assert.ok([...code].every((character) => ACTIVATION_ALPHABET.includes(character)), `mã ${code} có ký tự lạ`);
  }
});

test("bảng chữ cái không chứa ký tự dễ đọc nhầm", () => {
  // Phụ huynh nhìn mã in trên giấy: 0 với O, 1 với I và L rất hay nhầm.
  for (const character of ["0", "O", "1", "I", "L"]) {
    assert.ok(!ACTIVATION_ALPHABET.includes(character), `bảng chữ cái không được chứa "${character}"`);
  }
});

test("mã không lặp lại trong số lượng lớn", () => {
  const codes = new Set(Array.from({ length: 2000 }, () => generateActivationCode()));
  // 31^8 khả năng nên trùng trong 2000 lần là gần như không thể; trùng nghĩa là
  // nguồn ngẫu nhiên có vấn đề.
  assert.equal(codes.size, 2000);
});

test("gõ kiểu nào cũng khớp", () => {
  assert.equal(normalizeActivationCode("abcd-efgh"), "ABCDEFGH");
  assert.equal(normalizeActivationCode("  ABCD EFGH  "), "ABCDEFGH");
  assert.equal(normalizeActivationCode("ABCD.EFGH"), "ABCDEFGH");
  assert.equal(normalizeActivationCode(null), "");
});

test("in ra dạng dễ chép tay", () => {
  assert.equal(formatActivationCode("ABCDEFGH"), "ABCD-EFGH");
  assert.equal(formatActivationCode("abcdefgh"), "ABCD-EFGH");
  assert.equal(formatActivationCode("ABC"), "ABC");
});

test("nhận diện mã hợp lệ", () => {
  assert.equal(isValidActivationCode(generateActivationCode()), true);
  assert.equal(isValidActivationCode("ABCD-EFGH"), true);
  assert.equal(isValidActivationCode("ABCDEFG"), false, "thiếu ký tự");
  assert.equal(isValidActivationCode("ABCDEFGHI"), false, "thừa ký tự");
  assert.equal(isValidActivationCode("ABCDEFG0"), false, "chứa ký tự ngoài bảng");
  assert.equal(isValidActivationCode(""), false);
});
