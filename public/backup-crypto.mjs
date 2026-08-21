// Mã hóa file sao lưu bằng mật khẩu do người dùng đặt.
//
// Module này chạy được ở CẢ trình duyệt lẫn Node: chỉ dùng WebCrypto và các hàm
// có sẵn ở hai nơi. Nhờ vậy chỉ có một bản hiện thực duy nhất — phần mã hóa khi
// tải file về và phần giải mã khi nạp vào máy chủ không thể lệch nhau, và kiểm
// thử chạy trong Node là kiểm thử đúng đoạn mã mà trình duyệt chạy.
//
// Dữ liệu được mã hóa NGAY TRONG TRÌNH DUYỆT trước khi ghi ra đĩa, nên bản rõ
// của danh sách học sinh không bao giờ nằm trên máy người dùng dưới dạng file.

export const BACKUP_FORMAT = "nshm-backup-encrypted";
export const BACKUP_FORMAT_VERSION = 1;
const KDF_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const MIN_PASSPHRASE_LENGTH = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(String(value));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function cryptoError(message) {
  const error = new Error(message);
  error.code = "BACKUP_CRYPTO_ERROR";
  return error;
}

export function checkPassphrase(passphrase) {
  const value = String(passphrase ?? "");
  if (value.length < MIN_PASSPHRASE_LENGTH) {
    throw cryptoError(`Mật khẩu mở file sao lưu phải dài ít nhất ${MIN_PASSPHRASE_LENGTH} ký tự.`);
  }
  return value;
}

async function deriveKey(passphrase, salt, iterations) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw cryptoError("Trình duyệt hoặc môi trường chạy không hỗ trợ WebCrypto.");
  const material = await subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Bọc dữ liệu sao lưu thành một phong bì đã mã hóa.
 * Phần mô tả (thời điểm xuất, số lượng bản ghi) để nguyên bản rõ để còn nhận ra
 * file nào là file nào mà không phải mở khóa; phần này không chứa thông tin cá nhân.
 */
export async function encryptBackup(payload, passphrase) {
  checkPassphrase(passphrase);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, KDF_ITERATIONS);
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(payload)),
  );
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    exportedAt: payload?.exportedAt || new Date().toISOString(),
    counts: payload?.counts || {},
    source: payload?.source || null,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: KDF_ITERATIONS, salt: toBase64(salt) },
    cipher: { name: "AES-256-GCM", iv: toBase64(iv) },
    ciphertext: toBase64(ciphertext),
  };
}

export function isEncryptedBackup(value) {
  return Boolean(value) && typeof value === "object" && value.format === BACKUP_FORMAT;
}

export async function decryptBackup(envelope, passphrase) {
  if (!isEncryptedBackup(envelope)) throw cryptoError("Tệp này không phải bản sao lưu đã mã hóa.");
  if (envelope.version !== BACKUP_FORMAT_VERSION) {
    throw cryptoError(`Phiên bản định dạng mã hóa ${envelope.version} chưa được hỗ trợ.`);
  }
  if (envelope.kdf?.name !== "PBKDF2" || envelope.cipher?.name !== "AES-256-GCM") {
    throw cryptoError("Tệp sao lưu dùng thuật toán không được hỗ trợ.");
  }
  const key = await deriveKey(
    String(passphrase ?? ""),
    fromBase64(envelope.kdf.salt),
    Number(envelope.kdf.iterations) || KDF_ITERATIONS,
  );
  let plaintext;
  try {
    plaintext = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(envelope.cipher.iv) },
      key,
      fromBase64(envelope.ciphertext),
    );
  } catch {
    // AES-GCM báo lỗi giống nhau cho sai mật khẩu và cho file bị sửa đổi;
    // cả hai đều là lý do chính đáng để không nạp tệp này.
    throw cryptoError("Không mở được tệp sao lưu: sai mật khẩu hoặc tệp đã bị thay đổi.");
  }
  return JSON.parse(decoder.decode(plaintext));
}
