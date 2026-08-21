import test from "node:test";
import assert from "node:assert/strict";
import { createFieldCrypto, generateMasterKey, normalizeMasterKey } from "../field-crypto.mjs";
import {
  BACKUP_FORMAT, checkPassphrase, decryptBackup, encryptBackup, isEncryptedBackup,
} from "../public/backup-crypto.mjs";

const KEY = generateMasterKey();
const crypto = createFieldCrypto(KEY);

/* ---------- Mã hóa từng trường ---------- */

test("dữ liệu mã hóa không còn dấu vết của bản rõ", () => {
  const cipher = crypto.encrypt("Nguyễn Minh An");
  assert.ok(cipher.startsWith("v1."));
  assert.ok(!cipher.includes("Nguyễn"));
  assert.ok(!cipher.includes("Minh"));
  assert.ok(!cipher.toLowerCase().includes("an"));
  assert.equal(crypto.decrypt(cipher), "Nguyễn Minh An");
});

test("cùng một giá trị mã hóa hai lần cho ra hai chuỗi khác nhau", () => {
  // Nếu giống nhau thì nhìn cơ sở dữ liệu là biết ngay hai học sinh trùng tên.
  const first = crypto.encrypt("0975662437");
  const second = crypto.encrypt("0975662437");
  assert.notEqual(first, second);
  assert.equal(crypto.decrypt(first), "0975662437");
  assert.equal(crypto.decrypt(second), "0975662437");
});

test("giữ nguyên tiếng Việt có dấu và chuỗi rỗng", () => {
  for (const value of ["Đỗ Gia Linh", "Phạm Anh Tú", "3A2", "", "2018-05-02", "Bố/Mẹ"]) {
    assert.equal(crypto.decrypt(crypto.encrypt(value)), value);
  }
});

test("không mã hóa giá trị rỗng thành chuỗi vô nghĩa", () => {
  assert.equal(crypto.encrypt(null), null);
  assert.equal(crypto.encrypt(undefined), null);
  assert.equal(crypto.decrypt(null), null);
});

test("khóa khác thì không giải mã được", () => {
  const other = createFieldCrypto(generateMasterKey());
  const cipher = crypto.encrypt("Nguyễn Gia Hân");
  assert.throws(() => other.decrypt(cipher), (error) => error.code === "FIELD_DECRYPT_FAILED");
});

test("dữ liệu bị sửa một ký tự là phát hiện được ngay", () => {
  const cipher = crypto.encrypt("Trần Bảo Ngọc");
  const body = cipher.slice(3);
  const tampered = `v1.${body[0] === "A" ? "B" : "A"}${body.slice(1)}`;
  assert.throws(() => crypto.decrypt(tampered), (error) => error.code === "FIELD_DECRYPT_FAILED");
});

test("dữ liệu chưa mã hóa vẫn đọc được, để chuyển đổi dần từng bảng", () => {
  assert.equal(crypto.decrypt("Nguyễn Minh An"), "Nguyễn Minh An");
  assert.equal(crypto.isEncrypted("Nguyễn Minh An"), false);
  assert.equal(crypto.isEncrypted(crypto.encrypt("Nguyễn Minh An")), true);
});

test("chỉ mục mù cho phép tra cứu mà không lộ bản rõ", () => {
  const index = crypto.blindIndex("0975662437");
  assert.ok(index.startsWith("i1."));
  assert.ok(!index.includes("0975662437"));
  // Cố định: tra cứu theo số điện thoại vẫn chạy được.
  assert.equal(crypto.blindIndex("0975662437"), index);
  // Chuẩn hóa: khác hoa thường và khoảng trắng thừa vẫn ra cùng một chỉ mục.
  assert.equal(crypto.blindIndex("  ADMIN@NSHM.EDU.VN "), crypto.blindIndex("admin@nshm.edu.vn"));
  assert.notEqual(crypto.blindIndex("0975662438"), index);
  assert.equal(crypto.blindIndex(""), null);
});

test("chỉ mục mù của khóa khác thì khác hẳn", () => {
  const other = createFieldCrypto(generateMasterKey());
  assert.notEqual(other.blindIndex("0975662437"), crypto.blindIndex("0975662437"));
});

test("khóa mã hóa sai định dạng bị từ chối kèm hướng dẫn", () => {
  assert.throws(() => normalizeMasterKey(""), (error) => error.code === "ENCRYPTION_KEY_MISSING");
  assert.throws(() => normalizeMasterKey("qua-ngan"), (error) => error.code === "ENCRYPTION_KEY_INVALID");
  assert.throws(() => normalizeMasterKey(Buffer.alloc(16)), (error) => error.code === "ENCRYPTION_KEY_INVALID");
  assert.equal(normalizeMasterKey(generateMasterKey()).length, 32);
  assert.equal(normalizeMasterKey(Buffer.alloc(32).toString("hex")).length, 32);
});

/* ---------- Mã hóa file sao lưu ---------- */

const SAMPLE_BACKUP = {
  schemaVersion: 1,
  exportedAt: "2026-08-21T08:00:00.000Z",
  counts: { students: 2 },
  source: { dataBackend: "mysql", projectId: null },
  data: {
    students: [
      { id: "hs01", code: "NSHM260301", name: "Nguyễn Minh An", homeroom: "3A2" },
      { id: "hs02", code: "NSHM260601", name: "Nguyễn Gia Hân", homeroom: "6A1" },
    ],
  },
};

test("file sao lưu đã mã hóa không lộ tên học sinh", async () => {
  const envelope = await encryptBackup(SAMPLE_BACKUP, "mat-khau-rat-dai-2026");
  const serialized = JSON.stringify(envelope);
  assert.equal(envelope.format, BACKUP_FORMAT);
  assert.ok(!serialized.includes("Nguyễn Minh An"));
  assert.ok(!serialized.includes("NSHM260301"));
  assert.ok(!serialized.includes("3A2"));
  // Phần mô tả để bản rõ cho dễ nhận ra file, nhưng không chứa thông tin cá nhân.
  assert.equal(envelope.exportedAt, "2026-08-21T08:00:00.000Z");
  assert.deepEqual(envelope.counts, { students: 2 });
});

test("mở lại file sao lưu bằng đúng mật khẩu ra nguyên dữ liệu", async () => {
  const envelope = await encryptBackup(SAMPLE_BACKUP, "mat-khau-rat-dai-2026");
  assert.deepEqual(await decryptBackup(envelope, "mat-khau-rat-dai-2026"), SAMPLE_BACKUP);
});

test("sai mật khẩu thì không mở được", async () => {
  const envelope = await encryptBackup(SAMPLE_BACKUP, "mat-khau-rat-dai-2026");
  await assert.rejects(
    () => decryptBackup(envelope, "mat-khau-rat-dai-2027"),
    (error) => error.code === "BACKUP_CRYPTO_ERROR" && /sai mật khẩu/.test(error.message),
  );
});

test("file bị sửa nội dung thì bị từ chối", async () => {
  const envelope = await encryptBackup(SAMPLE_BACKUP, "mat-khau-rat-dai-2026");
  const tampered = { ...envelope, ciphertext: `A${envelope.ciphertext.slice(1)}` };
  await assert.rejects(
    () => decryptBackup(tampered, "mat-khau-rat-dai-2026"),
    (error) => error.code === "BACKUP_CRYPTO_ERROR",
  );
});

test("mật khẩu quá ngắn bị chặn ngay khi tạo file", async () => {
  assert.throws(() => checkPassphrase("ngan"), (error) => /ít nhất 12 ký tự/.test(error.message));
  await assert.rejects(() => encryptBackup(SAMPLE_BACKUP, "ngan"), (error) => error.code === "BACKUP_CRYPTO_ERROR");
});

test("nhận diện đúng tệp nào là tệp đã mã hóa", async () => {
  assert.equal(isEncryptedBackup(SAMPLE_BACKUP), false);
  assert.equal(isEncryptedBackup(null), false);
  assert.equal(isEncryptedBackup(await encryptBackup(SAMPLE_BACKUP, "mat-khau-rat-dai-2026")), true);
});

test("mỗi lần mã hóa dùng muối và IV mới", async () => {
  const first = await encryptBackup(SAMPLE_BACKUP, "mat-khau-rat-dai-2026");
  const second = await encryptBackup(SAMPLE_BACKUP, "mat-khau-rat-dai-2026");
  assert.notEqual(first.kdf.salt, second.kdf.salt);
  assert.notEqual(first.cipher.iv, second.cipher.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
});
