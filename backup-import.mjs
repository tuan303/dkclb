// Nạp bản sao lưu JSON vào MySQL.
//
// Dùng để chuyển hệ thống từ Firestore sang máy chủ riêng, và cũng để khôi phục
// khi cần. Chạy trực tiếp:
//
//   node backup-import.mjs duong-dan-ban-sao-luu.json
//   node backup-import.mjs ban-sao-luu.json --url mysql://user:pass@127.0.0.1:3306/dkclb
//   node backup-import.mjs ban-sao-luu.json --replace     (xóa sạch dữ liệu cũ trước khi nạp)
//
// Thứ tự nạp bám theo ràng buộc khóa ngoại. Bản ghi tham chiếu tới thứ không tồn
// tại sẽ bị bỏ qua và báo rõ ở cuối, thay vì làm hỏng cả lần nạp — bản sao lưu từ
// nền cũ có thể còn đơn trỏ tới lớp đã xóa.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createConnection } from "mysql2/promise";
import { createMysqlStore } from "./mysql-store.mjs";
import { decryptBackup, isEncryptedBackup } from "./public/backup-crypto.mjs";

const SUPPORTED_SCHEMA_VERSIONS = [1];

// Thứ tự này phải tôn trọng khóa ngoại: cha trước, con sau.
const IMPORT_ORDER = [
  "users", "students", "registrationPeriods", "clubs", "clubClasses",
  "parentStudents", "registrations", "supportRequests", "auditLogs",
];

// Bảng đếm chỗ không được nạp: ở MySQL số chỗ luôn tính từ dữ liệu thật.
const DERIVED_COLLECTIONS = new Set(["classCounters"]);

const TRUNCATE_ORDER = [
  "audit_logs", "support_requests", "registrations", "parent_students",
  "sessions", "oauth_states", "club_classes", "clubs", "students", "users", "registration_periods",
];

const text = (value, max) => {
  if (value === null || value === undefined) return null;
  const string = String(value);
  return string.length > max ? string.slice(0, max) : string;
};
const int = (value) => Number(value || 0);
const bit = (value) => (value === true || value === 1 ? 1 : 0);
const jsonText = (value) => JSON.stringify(Array.isArray(value) ? value : []);

function reportError(message) {
  const error = new Error(message);
  error.code = "BACKUP_IMPORT_ERROR";
  return error;
}

/**
 * Đọc tệp sao lưu, tự nhận biết tệp đã mã hóa và giải mã bằng mật khẩu người dùng đặt.
 * Mật khẩu nên truyền qua biến môi trường BACKUP_PASSPHRASE: tham số dòng lệnh hiện
 * ra trong danh sách tiến trình của máy chủ.
 */
export async function readBackupFile(raw, passphrase = "") {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!isEncryptedBackup(parsed)) return parsed;
  if (!passphrase) {
    throw reportError("Tệp sao lưu đã mã hóa. Đặt biến BACKUP_PASSPHRASE hoặc truyền --passphrase để mở.");
  }
  return decryptBackup(parsed, passphrase);
}

export function validateBackup(backup) {
  if (!backup || typeof backup !== "object") throw reportError("Tệp sao lưu không đọc được.");
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(backup.schemaVersion)) {
    throw reportError(`Phiên bản định dạng sao lưu ${backup.schemaVersion} chưa được hỗ trợ.`);
  }
  if (!backup.data || typeof backup.data !== "object") throw reportError("Tệp sao lưu không có phần dữ liệu.");
  const missing = IMPORT_ORDER.filter((name) => !Array.isArray(backup.data[name]));
  if (missing.length) throw reportError(`Tệp sao lưu thiếu nhóm dữ liệu: ${missing.join(", ")}.`);
  return backup;
}

const INSERTS = {
  users: {
    sql: `INSERT INTO users (id, account, account_lower, display_name, role, password_salt, password_hash,
      auth_provider, microsoft_object_id, must_change_password, login_failures, locked_until, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values: (row) => [
      row.id, row.account, String(row.accountLower || row.account || "").toLowerCase(),
      text(row.displayName, 190) || "Người dùng", row.role || "parent",
      text(row.passwordSalt, 64), text(row.passwordHash, 191), row.authProvider || "local",
      text(row.microsoftObjectId, 64), bit(row.mustChangePassword), int(row.loginFailures),
      text(row.lockedUntil, 32), row.active === false ? 0 : 1, row.createdAt || new Date().toISOString(),
    ],
  },
  students: {
    sql: "INSERT INTO students (id, code, name, date_of_birth, grade, homeroom, level, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    values: (row) => [row.id, row.code, text(row.name, 190), text(row.dateOfBirth, 32), int(row.grade),
      text(row.homeroom, 64) || "", text(row.level, 64) || "", row.status || "active"],
  },
  registrationPeriods: {
    sql: `INSERT INTO registration_periods (id, name, school_year, term, open_at, close_at, status,
      max_clubs_per_student, note, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values: (row) => [row.id, text(row.name, 190), text(row.schoolYear, 32) || "", text(row.term, 64) || "",
      row.openAt, row.closeAt, row.status || "draft", int(row.maxClubsPerStudent) || 3,
      text(row.note, 500), text(row.updatedAt, 32)],
  },
  clubs: {
    sql: `INSERT INTO clubs (id, code, name, category, description, emoji, visual, grades, sort_order, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values: (row) => [row.id, text(row.code, 64) || row.id, text(row.name, 190), text(row.category, 64) || "Khác",
      row.description || "", text(row.emoji, 16) || "🎯", text(row.visual, 16) || "life",
      jsonText(row.grades), int(row.sortOrder), row.active === false ? 0 : 1],
  },
  clubClasses: {
    sql: `INSERT INTO club_classes (id, club_id, period_id, name, day_of_week, start_time, end_time, schedule_label,
      grades, room, teacher, capacity, min_capacity, enrolled_base, fee, waitlist_enabled, sort_order, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values: (row) => [row.id, row.clubId, row.periodId, text(row.name, 120) || "", int(row.dayOfWeek),
      row.startTime, row.endTime, text(row.scheduleLabel, 120) || "", jsonText(row.grades),
      text(row.room, 120) || "", text(row.teacher, 160) || "", int(row.capacity), int(row.minCapacity),
      int(row.enrolledBase), int(row.fee), row.waitlistEnabled === false ? 0 : 1, int(row.sortOrder),
      row.active === false ? 0 : 1],
    requires: [["clubId", "clubs"], ["periodId", "registrationPeriods"]],
  },
  parentStudents: {
    sql: "INSERT INTO parent_students (parent_user_id, student_id, relationship) VALUES (?, ?, ?)",
    values: (row) => [row.parentUserId, row.studentId, text(row.relationship, 32) || "Phụ huynh"],
    requires: [["parentUserId", "users"], ["studentId", "students"]],
  },
  registrations: {
    sql: `INSERT INTO registrations (id, group_id, student_id, parent_user_id, class_id, period_id, status,
      fee_snapshot, schedule_snapshot, terms_accepted_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values: (row) => [row.id, text(row.groupId, 64) || row.id, row.studentId, row.parentUserId || null,
      row.classId, text(row.periodId, 64), row.status, int(row.feeSnapshot),
      text(row.scheduleSnapshot, 120) || "", text(row.termsAcceptedAt, 32), row.createdAt, row.updatedAt],
    requires: [["studentId", "students"], ["classId", "clubClasses"]],
  },
  supportRequests: {
    sql: `INSERT INTO support_requests (id, parent_user_id, registration_id, topic, message, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    values: (row) => [row.id, row.parentUserId, text(row.registrationId, 64), text(row.topic, 190) || "Hỗ trợ",
      row.message || "", row.status || "open", row.createdAt],
  },
  auditLogs: {
    sql: `INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, before_json, after_json, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values: (row) => [row.id, text(row.actorUserId, 64), text(row.action, 64) || "UNKNOWN",
      text(row.entityType, 64) || "unknown", text(row.entityId, 128) || "",
      row.before === null || row.before === undefined ? null : JSON.stringify(row.before),
      row.after === null || row.after === undefined ? null : JSON.stringify(row.after),
      text(row.reason, 500), row.createdAt],
  },
};

export async function importBackup({ url, backup, replace = false, log = () => {} }) {
  validateBackup(backup);

  // Tạo bảng nếu chưa có, đúng schema mà ứng dụng đang dùng.
  const store = await createMysqlStore({ url, seed: null });
  await store.close();

  const connection = await createConnection({ uri: url, multipleStatements: false });
  try {
    const [existing] = await connection.query("SELECT COUNT(*) AS total FROM students");
    const [existingUsers] = await connection.query("SELECT COUNT(*) AS total FROM users");
    const hasData = int(existing[0].total) > 0 || int(existingUsers[0].total) > 0;
    if (hasData && !replace) {
      throw reportError("Cơ sở dữ liệu đích đã có dữ liệu. Dùng --replace nếu muốn xóa sạch rồi nạp lại.");
    }

    await connection.beginTransaction();
    if (replace) {
      await connection.query("SET FOREIGN_KEY_CHECKS = 0");
      for (const table of TRUNCATE_ORDER) await connection.query(`TRUNCATE TABLE \`${table}\``);
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      log("Đã xóa sạch dữ liệu cũ trong cơ sở dữ liệu đích.");
    }

    const known = Object.fromEntries(IMPORT_ORDER.map((name) => [name, new Set()]));
    const counters = {};
    const skipped = [];

    for (const name of IMPORT_ORDER) {
      const definition = INSERTS[name];
      const rows = backup.data[name] || [];
      let inserted = 0;
      for (const row of rows) {
        const missingReference = (definition.requires || []).find(([field, collection]) => !known[collection].has(row[field]));
        if (missingReference) {
          skipped.push(`${name}/${row.id}: thiếu ${missingReference[0]} = ${row[missingReference[0]]}`);
          continue;
        }
        await connection.query(definition.sql, definition.values(row));
        known[name].add(row.id);
        inserted += 1;
      }
      counters[name] = inserted;
      log(`${name}: nạp ${inserted}/${rows.length} bản ghi`);
    }

    await connection.commit();
    for (const name of Object.keys(backup.data)) {
      if (DERIVED_COLLECTIONS.has(name)) log(`${name}: bỏ qua, MySQL tính số chỗ trực tiếp từ dữ liệu`);
    }
    return { counters, skipped };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    await connection.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const file = args.find((argument) => !argument.startsWith("--"));
  const urlIndex = args.indexOf("--url");
  const url = urlIndex >= 0 ? args[urlIndex + 1] : process.env.MYSQL_URL;
  const replace = args.includes("--replace");

  if (!file) {
    console.error("Cách dùng: node backup-import.mjs <tệp-sao-lưu.json> [--url mysql://...] [--replace]");
    process.exit(1);
  }
  if (!url) {
    console.error("Thiếu chuỗi kết nối MySQL. Đặt biến MYSQL_URL hoặc truyền --url.");
    process.exit(1);
  }

  const passIndex = args.indexOf("--passphrase");
  const passphrase = process.env.BACKUP_PASSPHRASE || (passIndex >= 0 ? args[passIndex + 1] : "");
  const raw = await readFile(file, "utf8");
  const backup = await readBackupFile(raw, passphrase);
  console.log(`Nạp bản sao lưu xuất lúc ${backup.exportedAt} (nguồn: ${backup.source?.dataBackend || "không rõ"}).`);
  const { counters, skipped } = await importBackup({ url, backup, replace, log: (line) => console.log(`  ${line}`) });
  const total = Object.values(counters).reduce((sum, count) => sum + count, 0);
  console.log(`Hoàn tất: nạp ${total} bản ghi.`);
  if (skipped.length) {
    console.log(`Bỏ qua ${skipped.length} bản ghi vì tham chiếu tới dữ liệu không tồn tại:`);
    for (const line of skipped.slice(0, 20)) console.log(`  - ${line}`);
    if (skipped.length > 20) console.log(`  ... và ${skipped.length - 20} bản ghi khác.`);
  }
  process.exit(0);
}
