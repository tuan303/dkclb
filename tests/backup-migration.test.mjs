// Kiểm thử vòng tròn của việc chuyển nền lưu trữ: xuất dữ liệu từ một nền, nạp
// vào MySQL, rồi xuất lại từ MySQL và đối chiếu. Đây là phép thử duy nhất trả lời
// được câu hỏi "chuyển sang máy chủ riêng có mất dữ liệu không".
//
// Cần một MySQL thật nên chỉ chạy khi có TEST_MYSQL_URL; không có thì bỏ qua.
import test, { after, before, skip } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { startTestServer } from "./helpers/test-server.mjs";
import { importBackup, readBackupFile, validateBackup } from "../backup-import.mjs";
import { encryptBackup } from "../public/backup-crypto.mjs";

const MYSQL_BASE_URL = process.env.TEST_MYSQL_URL || "";
const COLLECTIONS = [
  "users", "students", "parentStudents", "registrationPeriods", "clubs",
  "clubClasses", "registrations", "supportRequests", "auditLogs", "classCounters",
];

let source;
let targetName;
let targetUrl;

async function exportEverything(server, cookie) {
  const data = {};
  for (const collection of COLLECTIONS) {
    const rows = [];
    let after = null;
    do {
      const response = await server.request("/api/admin/export/backup", cookie, {
        method: "POST",
        body: JSON.stringify({ confirmation: "EXPORT_FULL_BACKUP", collection, after }),
      });
      assert.equal(response.status, 200);
      const { page } = await response.json();
      rows.push(...page.rows);
      after = page.nextAfter;
    } while (after);
    data[collection] = rows;
  }
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    source: { dataBackend: server.backend, projectId: null },
    counts: Object.fromEntries(Object.entries(data).map(([name, rows]) => [name, rows.length])),
    data,
  };
}

before(async (context) => {
  if (!MYSQL_BASE_URL) {
    skip("Bỏ qua: chưa đặt TEST_MYSQL_URL nên không có MySQL để nạp vào.");
    return;
  }
  const { createConnection } = await import("mysql2/promise");
  targetName = `dkclb_migrate_${randomBytes(6).toString("hex")}`;
  const admin = await createConnection(MYSQL_BASE_URL);
  await admin.query(`CREATE DATABASE \`${targetName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.end();
  const url = new URL(MYSQL_BASE_URL);
  url.pathname = `/${targetName}`;
  targetUrl = url.toString();

  source = await startTestServer({ prefix: "nshm-migrate-src-" });
});

after(async () => {
  if (source) await source.stop();
  if (targetName) {
    const { createConnection } = await import("mysql2/promise");
    const admin = await createConnection(MYSQL_BASE_URL);
    await admin.query(`DROP DATABASE IF EXISTS \`${targetName}\``);
    await admin.end();
  }
});

test("tệp sao lưu sai định dạng bị từ chối ngay", { skip: !MYSQL_BASE_URL }, () => {
  assert.throws(() => validateBackup(null), (error) => error.code === "BACKUP_IMPORT_ERROR");
  assert.throws(() => validateBackup({ schemaVersion: 99, data: {} }), (error) => /chưa được hỗ trợ/.test(error.message));
  assert.throws(() => validateBackup({ schemaVersion: 1, data: { users: [] } }), (error) => /thiếu nhóm dữ liệu/.test(error.message));
});

test("nạp bản sao lưu vào MySQL giữ nguyên từng bản ghi", { skip: !MYSQL_BASE_URL }, async () => {
  const cookie = await source.loginCookie("admin@nshm.edu.vn", "Admin@123");
  const backup = await exportEverything(source, cookie);
  assert.ok(backup.counts.students > 0, "nguồn phải có dữ liệu để chuyển");

  const { counters, skipped } = await importBackup({ url: targetUrl, backup });
  assert.deepEqual(skipped, [], "không được bỏ sót bản ghi nào");
  assert.equal(counters.students, backup.counts.students);
  assert.equal(counters.users, backup.counts.users);
  assert.equal(counters.parentStudents, backup.counts.parentStudents);
  assert.equal(counters.clubs, backup.counts.clubs);
  assert.equal(counters.clubClasses, backup.counts.clubClasses);
  assert.equal(counters.registrations, backup.counts.registrations);

  // Mở ứng dụng trên chính cơ sở dữ liệu vừa nạp rồi xuất lại để đối chiếu.
  const migrated = await startTestServer({ prefix: "nshm-migrate-dst-", mysqlUrl: targetUrl, seedDemo: false });
  try {
    const migratedCookie = await migrated.loginCookie("admin@nshm.edu.vn", "Admin@123");
    const roundTrip = await exportEverything(migrated, migratedCookie);

    for (const collection of ["users", "students", "clubs", "clubClasses", "registrationPeriods", "parentStudents", "registrations"]) {
      const before = new Map(backup.data[collection].map((row) => [row.id, row]));
      const afterRows = roundTrip.data[collection];
      assert.equal(afterRows.length, before.size, `số bản ghi ${collection} phải giữ nguyên`);
      for (const row of afterRows) {
        const original = before.get(row.id);
        assert.ok(original, `${collection}/${row.id} phải tồn tại ở bản gốc`);
        for (const [field, value] of Object.entries(original)) {
          assert.deepEqual(row[field], value, `${collection}/${row.id}.${field} phải giữ nguyên`);
        }
      }
    }

    // Tài khoản phụ huynh vẫn đăng nhập được sau khi chuyển, mật khẩu không đổi.
    const parent = await migrated.login("0901234567", "123456");
    assert.equal(parent.status, 200, "phụ huynh phải đăng nhập được trên nền mới");

    // Số chỗ ở MySQL tính từ dữ liệu thật, phải khớp với nền cũ.
    const beforeCounters = new Map(backup.data.classCounters.map((row) => [row.classId, row.enrolledCount]));
    for (const row of roundTrip.data.classCounters) {
      assert.equal(row.enrolledCount, beforeCounters.get(row.classId), `số chỗ của lớp ${row.classId} phải khớp`);
    }
  } finally {
    await migrated.stop();
  }
});

test("nạp được đúng tệp sao lưu đã mã hóa mà giao diện tải về", { skip: !MYSQL_BASE_URL }, async () => {
  const cookie = await source.loginCookie("admin@nshm.edu.vn", "Admin@123");
  const backup = await exportEverything(source, cookie);

  // Đúng thứ giao diện ghi ra đĩa: một phong bì đã mã hóa, không phải bản rõ.
  const envelope = await encryptBackup(backup, "mat-khau-sao-luu-2026");
  const fileContent = JSON.stringify(envelope);
  assert.ok(!fileContent.includes("Nguyễn Minh An"), "tệp trên đĩa không được chứa tên học sinh");

  await assert.rejects(
    () => readBackupFile(fileContent, ""),
    (error) => error.code === "BACKUP_IMPORT_ERROR" && /đã mã hóa/.test(error.message),
  );
  await assert.rejects(
    () => readBackupFile(fileContent, "sai-mat-khau-2026"),
    (error) => error.code === "BACKUP_CRYPTO_ERROR",
  );

  const decrypted = await readBackupFile(fileContent, "mat-khau-sao-luu-2026");
  assert.deepEqual(decrypted, backup);
  const { counters } = await importBackup({ url: targetUrl, backup: decrypted, replace: true });
  assert.equal(counters.students, backup.counts.students);
});

test("không nạp đè lên cơ sở dữ liệu đang có dữ liệu nếu không yêu cầu rõ", { skip: !MYSQL_BASE_URL }, async () => {
  const cookie = await source.loginCookie("admin@nshm.edu.vn", "Admin@123");
  const backup = await exportEverything(source, cookie);

  await assert.rejects(
    () => importBackup({ url: targetUrl, backup }),
    (error) => error.code === "BACKUP_IMPORT_ERROR" && /đã có dữ liệu/.test(error.message),
  );

  // Có --replace thì xóa sạch rồi nạp lại, kết quả không nhân đôi bản ghi.
  const { counters } = await importBackup({ url: targetUrl, backup, replace: true });
  assert.equal(counters.students, backup.counts.students);
});
