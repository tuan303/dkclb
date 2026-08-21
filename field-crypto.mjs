// Mã hóa từng trường dữ liệu cá nhân trước khi ghi xuống cơ sở dữ liệu.
//
// Mục tiêu cụ thể và đo được: một bản sao cơ sở dữ liệu rơi ra ngoài — file
// mysqldump, quyền truy cập MySQL bị lộ, ai đó mở MySQL Workbench — thì tên học
// sinh, ngày sinh và số điện thoại phụ huynh đều là chuỗi vô nghĩa.
//
// Điều này KHÔNG chống được kẻ chiếm toàn quyền máy chủ, vì ứng dụng phải có khóa
// mới chạy được. Đó là rủi ro còn lại, chỉ giảm bằng kỷ luật vận hành.
//
// Hai khóa con được dẫn xuất từ một khóa gốc:
//   - khóa mã hóa: AES-256-GCM, mỗi lần mã hóa dùng IV ngẫu nhiên nên cùng một
//     cái tên ghi hai lần cho ra hai chuỗi khác nhau, không suy ngược được.
//   - khóa chỉ mục mù: HMAC-SHA256, cho ra giá trị cố định để còn TRA CỨU được
//     theo số điện thoại mà không cần giải mã cả bảng.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

const CIPHER_PREFIX = "v1.";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const INDEX_PREFIX = "i1.";

function cryptoError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** Chấp nhận khóa dạng base64, hex hoặc Buffer; luôn trả về đúng 32 byte. */
export function normalizeMasterKey(material) {
  if (Buffer.isBuffer(material)) {
    if (material.length !== KEY_LENGTH) throw cryptoError("ENCRYPTION_KEY_INVALID", `Khóa mã hóa phải dài đúng ${KEY_LENGTH} byte.`);
    return material;
  }
  const value = String(material ?? "").trim();
  if (!value) throw cryptoError("ENCRYPTION_KEY_MISSING", "Chưa cấu hình khóa mã hóa dữ liệu.");
  const candidates = [];
  if (/^[0-9a-fA-F]+$/.test(value) && value.length === KEY_LENGTH * 2) candidates.push(Buffer.from(value, "hex"));
  candidates.push(Buffer.from(value, "base64"));
  const key = candidates.find((buffer) => buffer.length === KEY_LENGTH);
  if (!key) {
    throw cryptoError("ENCRYPTION_KEY_INVALID",
      `Khóa mã hóa không hợp lệ: cần ${KEY_LENGTH} byte ở dạng base64 hoặc hex. Sinh khóa mới bằng: node field-crypto.mjs --generate`);
  }
  return key;
}

export function generateMasterKey() {
  return randomBytes(KEY_LENGTH).toString("base64");
}

export function createFieldCrypto(masterKeyMaterial) {
  const master = normalizeMasterKey(masterKeyMaterial);
  const encryptionKey = Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), "nshm-clubs:field-encryption:v1", KEY_LENGTH));
  const indexKey = Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), "nshm-clubs:blind-index:v1", KEY_LENGTH));

  function encrypt(value) {
    if (value === null || value === undefined) return null;
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
    return CIPHER_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
  }

  function isEncrypted(value) {
    return typeof value === "string" && value.startsWith(CIPHER_PREFIX);
  }

  function decrypt(value) {
    if (value === null || value === undefined) return null;
    // Dữ liệu chưa mã hóa được trả nguyên trạng: trong lúc chuyển đổi, một bảng có
    // thể còn lẫn hàng cũ chưa mã hóa và ứng dụng vẫn phải đọc được.
    if (!isEncrypted(value)) return value;
    const raw = Buffer.from(value.slice(CIPHER_PREFIX.length), "base64");
    // Chuỗi rỗng mã hóa ra đúng IV + thẻ xác thực và không có phần nội dung nào,
    // nên độ dài bằng đúng ngưỡng vẫn là hợp lệ.
    if (raw.length < IV_LENGTH + TAG_LENGTH) throw cryptoError("FIELD_DECRYPT_FAILED", "Dữ liệu mã hóa không hợp lệ.");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, raw.subarray(0, IV_LENGTH));
    decipher.setAuthTag(raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
    try {
      return Buffer.concat([decipher.update(raw.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]).toString("utf8");
    } catch {
      throw cryptoError("FIELD_DECRYPT_FAILED", "Không giải mã được dữ liệu: sai khóa hoặc dữ liệu đã bị thay đổi.");
    }
  }

  /**
   * Chỉ mục mù: giá trị cố định để tra cứu, nhưng không suy ngược ra bản rõ nếu
   * không có khóa. Chuẩn hóa chữ thường và bỏ khoảng trắng thừa để tra cứu ổn định.
   */
  function blindIndex(value) {
    if (value === null || value === undefined || value === "") return null;
    const normalized = String(value).trim().toLowerCase();
    return INDEX_PREFIX + createHmac("sha256", indexKey).update(normalized, "utf8").digest("base64url");
  }

  function matchesIndex(left, right) {
    if (!left || !right) return false;
    const a = Buffer.from(String(left), "utf8");
    const b = Buffer.from(String(right), "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  return { encrypt, decrypt, blindIndex, isEncrypted, matchesIndex };
}

if (process.argv[1]?.endsWith("field-crypto.mjs") && process.argv.includes("--generate")) {
  console.log(generateMasterKey());
}
