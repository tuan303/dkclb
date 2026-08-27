// Mã kích hoạt dùng một lần cho tài khoản phụ huynh mới.
//
// Thay cho cách cũ lấy số điện thoại làm mật khẩu đầu tiên: số điện thoại không
// phải bí mật, ai biết số của một phụ huynh đều đăng nhập được và xem hồ sơ con
// họ cho tới khi phụ huynh đó đổi mật khẩu.
//
// Mã được sinh ngẫu nhiên bằng nguồn ngẫu nhiên mật mã, và ở nền MySQL được LƯU
// MÃ HÓA chứ không băm. Lý do: nhà trường buộc phải đọc lại được mã để in và
// phát cho phụ huynh; băm thì mất luôn khả năng đó, mà băm cũng không bảo vệ
// thêm được gì khi cơ sở dữ liệu đã mã hóa toàn bộ trường nhạy cảm.
import { randomInt } from "node:crypto";

// Bỏ hẳn 0/O, 1/I/L để phụ huynh không đọc nhầm khi nhìn mã in trên giấy.
export const ACTIVATION_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const ACTIVATION_CODE_LENGTH = 8;

export function generateActivationCode(length = ACTIVATION_CODE_LENGTH) {
  let code = "";
  for (let index = 0; index < length; index += 1) {
    code += ACTIVATION_ALPHABET[randomInt(ACTIVATION_ALPHABET.length)];
  }
  return code;
}

/** Bỏ dấu cách, gạch nối và chữ thường: phụ huynh gõ kiểu nào cũng khớp. */
export function normalizeActivationCode(value) {
  return String(value ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** In ra dạng dễ đọc để chép tay: ABCD-EFGH. */
export function formatActivationCode(code) {
  const normalized = normalizeActivationCode(code);
  if (normalized.length <= 4) return normalized;
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

export function isValidActivationCode(value) {
  const normalized = normalizeActivationCode(value);
  return normalized.length === ACTIVATION_CODE_LENGTH
    && [...normalized].every((character) => ACTIVATION_ALPHABET.includes(character));
}
