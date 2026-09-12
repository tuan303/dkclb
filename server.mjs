import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { toVietnameseLocalPhone } from "./sheets-directory.mjs";
import { createMultiSourceDirectory, parseDirectorySources } from "./directory-sources.mjs";
import { DEFAULT_SYNC_INTERVAL_MS, createSyncScheduler } from "./sync-scheduler.mjs";
import { planDirectoryWrites } from "./directory-plan.mjs";
import { createMicrosoftAuth } from "./microsoft-auth.mjs";
import { createGoogleCloudAuth } from "./google-cloud-auth.mjs";
import { validatePasswordPolicy } from "./password-policy.mjs";
import { toErrorResponse } from "./error-reporting.mjs";
import { loadMasterKey } from "./field-crypto.mjs";
import { formatActivationCode, generateActivationCode, normalizeActivationCode } from "./activation-code.mjs";
import { isUnchanged } from "./record-diff.mjs";
import { ACTIVE_REGISTRATION_STATUSES, ASSIGNABLE_STATUSES, PENDING_SEAT_SQL, SEAT_HOLDING_STATUSES, SEAT_HOLDING_SQL, STATUS, holdsSeat, statusLabel } from "./registration-status.mjs";
import { conflictMessage, intervalsOverlap } from "./schedule-conflict.mjs";
import { IMPORT_MODES, buildExcelDirectory } from "./directory-excel.mjs";
import { doanCaHoc, docFileXepLop, gomOChonClb } from "./xep-lop-import.mjs";
import { MAX_ACCOUNT_IMPORT_ROWS, analyzeSchoolAccountImport } from "./school-account-import.mjs";
import { decideSchoolLogin } from "./school-login.mjs";
import {
  ASSIGNABLE_SCHOOL_ROLES, CAP, ROLE, ROLE_LABELS,
  can, effectiveRole, isSchoolEmail, isSuperadminAccount,
  normalizeAccount, normalizeSchoolRole, parseSuperadminAccounts,
} from "./roles.mjs";
import {
  MAX_IMPORT_ROWS,
  analyzeCatalogImport,
  detectCatalogMapping,
  normalizeClassInput,
  normalizeClubInput,
  normalizePeriodInput,
} from "./catalog-schema.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const LOCAL_ENV_FILE = join(ROOT, ".env");
// Bộ kiểm thử dựng máy chủ ngay trong thư mục repo, nên trên máy chủ của trường
// nó sẽ nạp luôn .env production: credential Microsoft thật, cấu hình Google
// Sheets thật. Kiểm thử phải chạy trên cấu hình của chính nó, không thì kết quả
// đổi theo từng máy và tệ hơn là có thể chạm vào dịch vụ thật.
if (!process.env.NSHM_IGNORE_ENV_FILE && existsSync(LOCAL_ENV_FILE)) loadEnvFile(LOCAL_ENV_FILE);
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const DB_FILE = process.env.DATA_FILE || join(ROOT, "data", "nshm-clubs.sqlite");
const DATA_BACKEND = String(process.env.DATA_BACKEND || "sqlite").toLowerCase();
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "dkclb-2626f";
const SHEETS_SERVICE_ACCOUNT = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT || "nshm-sheet-reader@dkclb-2626f.iam.gserviceaccount.com";
const MICROSOFT_REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI || `http://127.0.0.1:${PORT}/api/auth/microsoft/callback`;
const MICROSOFT_ALLOWED_DOMAIN = process.env.MICROSOFT_ALLOWED_DOMAIN || "hoangmaistarschool.edu.vn";
// Đường cứu độc lập với cơ sở dữ liệu. Khi đã tắt việc tự tạo tài khoản, một bản
// ghi quản trị bị vô hiệu hoá nhầm sẽ khoá tất cả mọi người ra ngoài và chỉ cứu
// được bằng cách sửa tay trong MySQL.
const SUPERADMIN_ACCOUNTS = parseSuperadminAccounts(process.env.SUPERADMIN_ACCOUNTS);
const SESSION_COOKIE = "nshm_session";
const SESSION_MAX_AGE = 8 * 60 * 60;
// Toàn bộ tệp giao diện nằm trong thư mục `public`. Vercel chỉ phục vụ tĩnh thư mục này,
// nhờ đó mã nguồn backend và tài liệu nội bộ ở thư mục gốc không bị lộ ra ngoài.
const PUBLIC_DIR = join(ROOT, "public");
const PUBLIC_FILES = new Set(["index.html", "styles.css", "app.js", "firebase-client.js", "sheet-reader.js", "backup-crypto.mjs", "logo-nshm.png"]);

const MYSQL_URL = process.env.MYSQL_URL || "";
// Dữ liệu mẫu chỉ được tạo khi bật rõ ràng, để môi trường thật không dính CLB minh họa.
const SEED_DEMO_DATA = process.env.NSHM_SEED_DEMO === "1";

if (!SUPERADMIN_ACCOUNTS.size) {
  console.warn("[canh-bao] Chưa đặt SUPERADMIN_ACCOUNTS. Không ai quản lý được tài khoản nhà trường,"
    + " và nếu bản ghi quản trị bị vô hiệu hoá thì phải sửa tay trong cơ sở dữ liệu mới vào lại được.");
}

if (!["sqlite", "firestore", "mysql"].includes(DATA_BACKEND)) {
  throw new Error("DATA_BACKEND chỉ chấp nhận 'sqlite', 'mysql' hoặc 'firestore'.");
}

const googleCloudAuth = createGoogleCloudAuth({
  projectNumber: process.env.GCP_PROJECT_NUMBER,
  poolId: process.env.GCP_WORKLOAD_IDENTITY_POOL_ID,
  providerId: process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID,
  serviceAccountEmail: process.env.GCP_SERVICE_ACCOUNT_EMAIL || SHEETS_SERVICE_ACCOUNT,
});
// Danh sách học sinh nằm ở ba file Google Sheet riêng theo cấp học, mỗi bộ phận
// giáo vụ giữ file của mình. Đọc cả ba rồi gộp lại; xem directory-sources.mjs.
const directorySource = createMultiSourceDirectory({
  configs: parseDirectorySources(process.env),
  credentials: {
    serviceAccountEmail: SHEETS_SERVICE_ACCOUNT,
    accessToken: process.env.GOOGLE_SHEETS_ACCESS_TOKEN,
    authClientFactory: DATA_BACKEND === "firestore" ? googleCloudAuth.getClient : undefined,
  },
});
// Chu kỳ tự đồng bộ. Đặt SHEETS_SYNC_INTERVAL_MINUTES=0 để tắt hẳn.
// Trên Vercel mỗi request là một tiến trình riêng nên hẹn giờ trong tiến trình
// không có tác dụng; lịch chỉ bật khi tự vận hành trên máy chủ của trường.
// MẶC ĐỊNH TẮT kể từ khi danh bạ nhập bằng file Excel. Lịch tự gọi ra Google là
// phụ thuộc mạng duy nhất còn lại của việc đồng bộ danh bạ, mà máy chủ của trường
// từng mất phân giải tên miền cả buổi. Đặt SHEETS_SYNC_INTERVAL_MINUTES=15 để bật
// lại nếu vẫn muốn dùng Google Sheets.
const SYNC_INTERVAL_MS = Math.max(0, Number(process.env.SHEETS_SYNC_INTERVAL_MINUTES) || 0) * 60 * 1000;

/**
 * Chế độ ĐỐI CHIẾU TOÀN TRƯỜNG — "vắng mặt trong file = cho nghỉ học" — mặc định TẮT.
 *
 * Nhà trường đã chốt ngừng nuôi file Google Sheet: học sinh mới nhập bằng tay hoặc
 * bằng file bổ sung, và danh bạ từ nay do phần mềm làm chủ. Từ lúc đó, đối chiếu
 * không còn việc gì để làm, mà nó lại là thao tác nguy hiểm nhất trong cả hệ thống.
 *
 * Đã đo trên máy chủ thật, không phải suy đoán:
 *   - Van co rút chỉ dừng khi tụt QUÁ 20% VÀ thiếu từ 10 em trở lên. Với 4.445 em,
 *     một lần bấm nhầm cho tới 889 em nghỉ học mà không có gì chặn.
 *   - Ô "sẽ cho nghỉ học" ở màn xem trước đếm bằng HIỆU SỐ LƯỢNG chứ không so mã
 *     học sinh: đã dựng được trường hợp màn hình ghi "Không em nào bị cho nghỉ học"
 *     rồi ghi xong thì 3 em vừa nhập biến mất thật.
 *   - Em bị cho nghỉ thì mất khỏi cổng phụ huynh và phụ huynh không đăng ký tiếp
 *     được, NHƯNG đơn đã đóng phí vẫn giữ chỗ trong lớp — sai lệch im lặng hai đầu.
 *
 * Đặt CHO_PHEP_DOI_CHIEU=1 khi nào thật sự cần làm sạch danh bạ đầu năm học, và
 * nhớ sao lưu trước (POST /api/admin/export/backup).
 */
const CHO_PHEP_DOI_CHIEU = process.env.CHO_PHEP_DOI_CHIEU === "1";

/**
 * Nhập đăng ký hàng loạt — mặc định TẮT vì CHƯA XONG.
 *
 * Vòng rà soát đối kháng tìm 18 lỗi, 10 lỗi nặng, tất cả tái hiện được bằng mã chạy
 * thật trên MySQL. Bốn cái đủ để khoá lại:
 *
 *   - Bấm Ghi hai lần (mạng chậm) thì mỗi em thành HAI đơn cho cùng một ca: đã đo
 *     trên MySQL thật, hs01:2 hs02:2, sĩ số vọt 22/20. Không có khoá nào giữa lúc
 *     phân tích và lúc ghi, cũng không có ràng buộc UNIQUE(student_id, class_id).
 *   - Huỷ lô vừa nhập rồi nhập lại — thao tác sửa sai bình thường nhất của giáo vụ
 *     — thì enrolled_base bị hạ LẦN HAI: ca có 100 em thật, hệ thống báo 60/100 và
 *     mở 40 chỗ không có thật cho 4.445 học sinh.
 *   - Một em tick hai CLB TRÙNG GIỜ trong Form thì cả hai thành đơn giữ chỗ: em học
 *     một buổi nhưng chiếm hai chỗ, và nhà trường ghi nhận đã thu phí cả hai.
 *   - Hai ca khác nhau của CÙNG một CLB đều được xếp, trong khi cổng phụ huynh chặn
 *     đúng việc đó: phanTichXepLop so theo mã CA, validateRegistration so theo CLB.
 *
 * Bốn commit sửa lỗi nền đi cùng nhánh này thì AN TOÀN và cần triển khai sớm, nên
 * khoá riêng tính năng chưa xong thay vì giữ lại cả nhánh. Đặt
 * CHO_PHEP_NHAP_HANG_LOAT=1 khi các lỗi trên đã vá xong.
 */
const CHO_PHEP_NHAP_HANG_LOAT = process.env.CHO_PHEP_NHAP_HANG_LOAT === "1";

/**
 * Chỉ lượt nào được phép ĐỐI CHIẾU mới được phép cho học sinh nghỉ học. Trong
 * planDirectoryWrites, allSourcesLoaded chính là công tắc đó — ép nó về false là
 * khoá toàn bộ đường vô hiệu hoá, dù lượt ghi đến từ file Excel hay từ Google Sheets.
 */
const chapNhanCoNghiHoc = (allSourcesLoaded) => Boolean(allSourcesLoaded) && CHO_PHEP_DOI_CHIEU;
const SYNC_SCHEDULE_ENABLED = SYNC_INTERVAL_MS > 0 && !process.env.VERCEL;
const EXCEL_IMPORT_LIMIT = 12_000_000;

const syncScheduler = createSyncScheduler({
  intervalMs: SYNC_INTERVAL_MS || DEFAULT_SYNC_INTERVAL_MS,
  // Lần chạy theo lịch không có người bấm nên nhật ký không gắn actor nào.
  run: ({ actorUserId = null }) => syncGoogleDirectory(actorUserId),
  onEvent(event) {
    if (event.type === "loi") console.error(`[dong-bo] ${event.trigger}: ${event.run.error.message}`);
  },
});

const microsoftAuth = createMicrosoftAuth({
  tenantId: process.env.MICROSOFT_TENANT_ID,
  clientId: process.env.MICROSOFT_CLIENT_ID,
  clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
  clientAssertion: process.env.MICROSOFT_CLIENT_SECRET ? undefined : googleCloudAuth.getRuntimeOidcToken,
  redirectUri: MICROSOFT_REDIRECT_URI,
  allowedDomain: MICROSOFT_ALLOWED_DOMAIN,
});

let db = null;

const nowIso = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${randomBytes(7).toString("hex")}`;

/**
 * Mã người ta đọc cho nhau nghe: DK-260911-A3F92B1C. Giữ phần ngày vì giáo vụ dò
 * theo ngày, nhưng phần ngẫu nhiên phải đủ rộng — xem chú thích ở taoMaDonDuyNhat.
 */
const maTheoNgay = (prefix) => `${prefix}-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${randomBytes(5).toString("hex").toUpperCase()}`;
const sessionStorageKey = (token) => createHash("sha256").update(String(token)).digest("hex");
const asInt = (value) => Number(value || 0);
const publicUser = (user) => {
  const role = effectiveRole(user, SUPERADMIN_ACCOUNTS);
  return {
    id: user.id,
    account: user.account,
    displayName: user.display_name,
    role,
    roleLabel: ROLE_LABELS[role] || role,
    // Giao diện ẩn/hiện theo quyền thật của máy chủ, không tự suy từ tên vai trò.
    capabilities: Object.values(CAP).filter((capability) => can(role, capability)),
    // Tính năng đang khoá vì chưa xong. Giao diện đọc từ đây chứ không tự đoán, để
    // nút và đường API bật/tắt cùng một lúc bằng cùng một biến môi trường.
    tinhNang: { nhapHangLoat: CHO_PHEP_NHAP_HANG_LOAT },
    authProvider: user.auth_provider || "local",
    mustChangePassword: Boolean(user.must_change_password),
  };
};

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: scryptSync(password, salt, 64).toString("hex") };
}


function verifyPassword(password, salt, expectedHex) {
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left), "utf8");
  const b = Buffer.from(String(right), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Tài khoản vừa tạo chưa có mật khẩu riêng thì đăng nhập bằng mã kích hoạt dùng
// một lần. Ngay khi phụ huynh đặt mật khẩu riêng, hệ thống lưu hash scrypt, xóa
// mã kích hoạt, và nhánh này không còn được dùng cho tài khoản đó nữa.
// Tài khoản chưa từng đặt mật khẩu riêng. Theo yêu cầu nhà trường, mật khẩu
// mặc định là CHÍNH SỐ ĐIỆN THOẠI, và phải đổi ngay lần đăng nhập đầu tiên.
//
// Đánh đổi đã biết và được nhà trường chấp nhận: số điện thoại vừa là tên tài
// khoản vừa là mật khẩu, nên ai biết số của một phụ huynh đều đăng nhập được cho
// tới khi người đó đổi. Lý do chọn: phát 7.119 mã giấy trước ngày mở đăng ký là
// bất khả thi. Bù lại bằng bắt buộc đổi ngay lần đầu và khoá tạm sau 5 lần sai.
function usesInitialCredential(user) {
  return Boolean(user?.must_change_password) && !user?.password_hash;
}

// Vẫn chấp nhận mã kích hoạt nếu tài khoản đã được cấp một mã. Trường đã sinh mã
// cho toàn bộ tài khoản trước khi đổi phương án; chuyển hẳn sang số điện thoại mà
// không nhận mã nữa sẽ làm chết mọi mã đã in và phát ra.
function initialCredentialValid(user, password) {
  const raw = String(password || "");
  if (timingSafeEqualText(raw.trim(), String(user.account || "").trim())) return true;
  if (!user.activation_code) return false;
  return timingSafeEqualText(normalizeActivationCode(raw), normalizeActivationCode(user.activation_code));
}

function usesActivationCode(user) {
  return usesInitialCredential(user) && Boolean(user?.activation_code);
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// Bảng users cũ có ràng buộc CHECK (role IN ('parent','admin')), nên thêm vai trò
// 'giaovu' sẽ bị chặn. SQLite không sửa được CHECK, phải dựng lại bảng. Danh sách
// vai trò hợp lệ nay do roles.mjs giữ — để ở hai nơi là chúng sẽ lệch nhau.
function widenUserRoleConstraint() {
  const definition = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (!definition?.sql?.includes("CHECK (role IN ('parent', 'admin'))")) return;
  const columns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
  const rebuilt = definition.sql
    .replace("CREATE TABLE users", "CREATE TABLE users_rebuilt")
    .replace("role TEXT NOT NULL CHECK (role IN ('parent', 'admin'))", "role TEXT NOT NULL");
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(rebuilt);
    db.exec(`INSERT INTO users_rebuilt (${columns.join(", ")}) SELECT ${columns.join(", ")} FROM users`);
    db.exec("DROP TABLE users");
    db.exec("ALTER TABLE users_rebuilt RENAME TO users");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      account TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      auth_provider TEXT NOT NULL DEFAULT 'local',
      microsoft_object_id TEXT,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      login_failures INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      date_of_birth TEXT,
      grade INTEGER NOT NULL,
      homeroom TEXT NOT NULL,
      level TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS parent_students (
      parent_user_id TEXT NOT NULL REFERENCES users(id),
      student_id TEXT NOT NULL REFERENCES students(id),
      relationship TEXT NOT NULL,
      PRIMARY KEY (parent_user_id, student_id)
    );
    CREATE TABLE IF NOT EXISTS registration_periods (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      school_year TEXT NOT NULL,
      term TEXT NOT NULL,
      open_at TEXT NOT NULL,
      close_at TEXT NOT NULL,
      status TEXT NOT NULL,
      max_clubs_per_student INTEGER NOT NULL DEFAULT 3,
      note TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS clubs (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      emoji TEXT NOT NULL,
      visual TEXT NOT NULL,
      grades_json TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS club_classes (
      id TEXT PRIMARY KEY,
      club_id TEXT NOT NULL REFERENCES clubs(id),
      period_id TEXT NOT NULL REFERENCES registration_periods(id),
      name TEXT NOT NULL DEFAULT '',
      min_capacity INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      day_of_week INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      schedule_label TEXT NOT NULL,
      room TEXT NOT NULL,
      teacher TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      enrolled_base INTEGER NOT NULL DEFAULT 0,
      fee INTEGER NOT NULL,
      waitlist_enabled INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS registrations (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      student_id TEXT NOT NULL REFERENCES students(id),
      parent_user_id TEXT REFERENCES users(id),
      class_id TEXT NOT NULL REFERENCES club_classes(id),
      period_id TEXT,
      status TEXT NOT NULL,
      fee_snapshot INTEGER NOT NULL,
      fee_paid INTEGER NOT NULL DEFAULT 0,
      schedule_snapshot TEXT NOT NULL,
      terms_accepted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_registrations_student ON registrations(student_id);
    CREATE INDEX IF NOT EXISTS idx_registrations_class ON registrations(class_id);
    CREATE TABLE IF NOT EXISTS support_requests (
      id TEXT PRIMARY KEY,
      parent_user_id TEXT NOT NULL REFERENCES users(id),
      registration_id TEXT,
      topic TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      nonce TEXT NOT NULL,
      code_verifier TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT REFERENCES users(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      reason TEXT,
      created_at TEXT NOT NULL
    );
  `);

  ensureColumn("users", "auth_provider", "TEXT NOT NULL DEFAULT 'local'");
  ensureColumn("users", "microsoft_object_id", "TEXT");
  ensureColumn("users", "email", "TEXT");
  ensureColumn("users", "must_change_password", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("users", "login_failures", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("users", "locked_until", "TEXT");
  ensureColumn("students", "date_of_birth", "TEXT");
  ensureColumn("registration_periods", "max_clubs_per_student", "INTEGER NOT NULL DEFAULT 3");
  ensureColumn("registration_periods", "note", "TEXT");
  ensureColumn("registration_periods", "updated_at", "TEXT");
  ensureColumn("clubs", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("club_classes", "name", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("club_classes", "min_capacity", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("club_classes", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("registrations", "period_id", "TEXT");
  // "Đã thu tiền" là sự thật về TIỀN, còn trạng thái là sự thật về CHỖ. Từ khi chỗ
  // chỉ được giữ lúc đóng phí, một đơn có thể vừa đã trả tiền vừa đang xếp chờ.
  ensureColumn("registrations", "fee_paid", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("club_classes", "grades_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("users", "activation_code", "TEXT");
  ensureColumn("users", "last_login_at", "TEXT");
  widenUserRoleConstraint();
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_microsoft_object_id ON users(microsoft_object_id) WHERE microsoft_object_id IS NOT NULL;");

  const count = asInt(db.prepare("SELECT COUNT(*) AS count FROM users").get().count);
  if (count === 0) seedDatabase();
}

const CLUB_SEED_ROWS = [
  ["basketball", "SPORT-BB", "Bóng rổ nền tảng", "Thể thao", "Phát triển thể lực, phối hợp vận động và tinh thần đồng đội qua giáo trình bóng rổ cơ bản.", "🏀", "sport", [1,2,3,4,5], 2, "16:15", "17:30", "Thứ 3 · 16:15–17:30", "Sân thể thao A", "Thầy Hoàng Nam", 24, 16, 1200000],
  ["robotics", "STEM-RB", "Robotics & Coding", "STEM", "Lắp ráp robot, tư duy thuật toán và giải quyết vấn đề theo dự án nhỏ mỗi tháng.", "🤖", "stem", [3,4,5,6,7], 4, "16:15", "17:45", "Thứ 5 · 16:15–17:45", "Phòng Lab 3.2", "Cô Thu Hương", 18, 15, 1650000],
  ["painting", "ART-PT", "Mỹ thuật sáng tạo", "Nghệ thuật", "Khám phá màu sắc, chất liệu và kể chuyện bằng hình ảnh trong môi trường khuyến khích sáng tạo.", "🎨", "art", [1,2,3,4,5,6], 3, "16:15", "17:30", "Thứ 4 · 16:15–17:30", "Phòng Mỹ thuật 2", "Cô Minh Trang", 20, 20, 1100000],
  ["piano", "MUSIC-PN", "Piano nhập môn", "Âm nhạc", "Làm quen nhạc lý, tư thế, kỹ thuật ngón và biểu diễn các tác phẩm ngắn phù hợp lứa tuổi.", "🎹", "music", [2,3,4,5], 2, "16:15", "17:30", "Thứ 3 · 16:15–17:30", "Phòng Âm nhạc 1", "Cô Phương Linh", 12, 7, 1900000],
  ["debate", "LANG-DB", "English Debate", "Ngôn ngữ", "Rèn tư duy phản biện, kỹ năng trình bày và sử dụng tiếng Anh trong các chủ đề gần gũi.", "💬", "life", [5,6,7,8,9], 5, "16:15", "17:45", "Thứ 6 · 16:15–17:45", "Phòng 4.1", "Ms. Anna & Cô Hà", 20, 10, 1450000],
  ["dance", "ART-DN", "Nhảy hiện đại", "Nghệ thuật", "Phát triển cảm thụ âm nhạc, sự tự tin và khả năng trình diễn theo nhóm.", "💃", "art", [1,2,3,4,5,6,7], 6, "08:30", "10:00", "Thứ 7 · 08:30–10:00", "Hội trường tầng 5", "Cô Khánh Vy", 24, 18, 1250000],
];

// Đợt mẫu bám theo ngày chạy thật để bản demo và bộ kiểm thử không hết hạn theo thời gian.
function seedPeriodWindow(now = Date.now()) {
  return {
    openAt: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
    closeAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

const STUDENT_SEED_ROWS = [
  ["hs01", "NSHM260301", "Nguyễn Minh An", "12/04/2017", 3, "3A2", "Tiểu học"],
  ["hs02", "NSHM260601", "Nguyễn Gia Hân", "03/09/2014", 6, "6A1", "THCS"],
  ["hs03", "NSHM260311", "Lê Minh Khang", "27/11/2017", 3, "3A1", "Tiểu học"],
  ["hs04", "NSHM260203", "Trần Bảo Ngọc", "08/02/2018", 2, "2A3", "Tiểu học"],
  ["hs05", "NSHM260622", "Phạm Anh Tú", "19/06/2014", 6, "6A2", "THCS"],
  ["hs06", "NSHM260411", "Nguyễn Hà My", "30/01/2016", 4, "4A1", "Tiểu học"],
  ["hs07", "NSHM260344", "Đỗ Gia Linh", "15/08/2017", 3, "3A4", "Tiểu học"],
  ["hs08", "NSHM260522", "Vũ Minh Quân", "22/05/2015", 5, "5A2", "Tiểu học"],
];

const REGISTRATION_SEED_ROWS = [
  ["DK-260812-0142", "GR-260812-01", "hs01", "u_parent", "piano", "payment", 1900000, "Thứ 3 · 16:15–17:30", "2026-08-12T08:42:00.000Z"],
  ["DK-260818-0158", "GR-260818-58", "hs03", "u_seed", "robotics", "payment", 1650000, "Thứ 5 · 16:15–17:45", "2026-08-18T08:42:00.000Z"],
  ["DK-260818-0157", "GR-260818-57", "hs04", "u_seed", "painting", "waitlist", 1100000, "Thứ 4 · 16:15–17:30", "2026-08-18T08:38:00.000Z"],
  ["DK-260818-0156", "GR-260818-56", "hs05", "u_seed", "debate", "confirmed", 1450000, "Thứ 6 · 16:15–17:45", "2026-08-18T08:31:00.000Z"],
  ["DK-260818-0155", "GR-260818-55", "hs06", "u_seed", "basketball", "waitlist", 1200000, "Thứ 3 · 16:15–17:30", "2026-08-18T08:22:00.000Z"],
  ["DK-260818-0154", "GR-260818-54", "hs07", "u_seed", "piano", "submitted", 1900000, "Thứ 3 · 16:15–17:30", "2026-08-18T08:17:00.000Z"],
  ["DK-260818-0153", "GR-260818-53", "hs08", "u_seed", "dance", "confirmed", 1250000, "Thứ 7 · 08:30–10:00", "2026-08-18T08:03:00.000Z"],
];

// Dữ liệu mẫu ở dạng trung tính, dùng chung cho mọi nền lưu trữ.
// `includeAccounts` chỉ bật cho môi trường phát triển và kiểm thử: nền thật nhận
// dữ liệu từ đồng bộ danh bạ hoặc từ bản sao lưu nạp vào, không cần tài khoản minh họa.
function demoSeedData({ includeAccounts = false } = {}) {
  const createdAt = nowIso();
  const seedWindow = seedPeriodWindow();
  const clubs = CLUB_SEED_ROWS.map(([clubId, code, name, category, description, emoji, visual, grades], index) => ({
    id: clubId, code, name, category, description, emoji, visual, grades, sortOrder: index, active: true,
  }));
  const classes = CLUB_SEED_ROWS.map(([clubId, , , , , , , grades, dayOfWeek, startTime, endTime, scheduleLabel, room, teacher, capacity, enrolledBase, fee], index) => ({
    id: clubId, clubId, periodId: "period_2026_hk1", name: "Ca chính", dayOfWeek, startTime, endTime, scheduleLabel,
    grades: [], room, teacher, capacity, minCapacity: 0, enrolledBase, fee, waitlistEnabled: true, sortOrder: index, active: true,
  }));
  const periods = [{
    id: "period_2026_hk1", name: "Đăng ký CLB · Học kỳ I", schoolYear: "2026–2027", term: "Học kỳ I",
    ...seedWindow, status: "open", maxClubsPerStudent: 3, note: "", updatedAt: createdAt,
  }];

  if (!includeAccounts) {
    return { users: [], students: [], parentStudents: [], registrations: [], supportRequests: [], auditLogs: [], clubs, classes, periods };
  }

  const parentPassword = hashPassword("123456");
  const adminPassword = hashPassword("Admin@123");
  const seedPassword = hashPassword(randomBytes(18).toString("hex"));
  return {
    users: [
      { id: "u_parent", account: "0901234567", displayName: "Mai Lan", role: "parent", passwordSalt: parentPassword.salt, passwordHash: parentPassword.hash, authProvider: "local", mustChangePassword: false, createdAt },
      { id: "u_admin", account: "admin@nshm.edu.vn", displayName: "Nguyễn Thu Hà", role: "admin", passwordSalt: adminPassword.salt, passwordHash: adminPassword.hash, authProvider: "local", mustChangePassword: false, createdAt },
      // Tài khoản giáo vụ minh họa: cho thử được ranh giới quyền mà không cần
      // dựng SSO. Chỉ tồn tại khi NSHM_SEED_DEMO=1, nền thật không bao giờ có.
      { id: "u_giaovu", account: "giaovu@nshm.edu.vn", displayName: "Phạm Thu Trang", role: "giaovu", passwordSalt: adminPassword.salt, passwordHash: adminPassword.hash, authProvider: "local", mustChangePassword: false, createdAt },
      { id: "u_seed", account: "seed@nshm.local", displayName: "Dữ liệu hệ thống", role: "parent", passwordSalt: seedPassword.salt, passwordHash: seedPassword.hash, authProvider: "local", mustChangePassword: false, createdAt },
    ],
    students: STUDENT_SEED_ROWS.map(([id, code, name, dateOfBirth, grade, homeroom, level]) => ({
      id, code, name, dateOfBirth, grade, homeroom, level, status: "active",
    })),
    parentStudents: [
      { parentUserId: "u_parent", studentId: "hs01", relationship: "Mẹ" },
      { parentUserId: "u_parent", studentId: "hs02", relationship: "Mẹ" },
    ],
    registrations: REGISTRATION_SEED_ROWS.map(([id, groupId, studentId, parentUserId, classId, status, feeSnapshot, scheduleSnapshot, at]) => ({
      id, groupId, studentId, parentUserId, classId, periodId: "period_2026_hk1", status,
      feeSnapshot, scheduleSnapshot, termsAcceptedAt: at, createdAt: at, updatedAt: at,
    })),
    supportRequests: [],
    auditLogs: [],
    clubs,
    classes,
    periods,
  };
}

function seedDatabase() {
  const createdAt = nowIso();
  const parentPassword = hashPassword("123456");
  const adminPassword = hashPassword("Admin@123");
  const seedPassword = hashPassword(randomBytes(18).toString("hex"));

  const insertUser = db.prepare(`INSERT INTO users
    (id, account, display_name, role, password_salt, password_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insertUser.run("u_parent", "0901234567", "Mai Lan", "parent", parentPassword.salt, parentPassword.hash, createdAt);
  insertUser.run("u_admin", "admin@nshm.edu.vn", "Nguyễn Thu Hà", "admin", adminPassword.salt, adminPassword.hash, createdAt);
  insertUser.run("u_giaovu", "giaovu@nshm.edu.vn", "Phạm Thu Trang", "giaovu", adminPassword.salt, adminPassword.hash, createdAt);
  insertUser.run("u_seed", "seed@nshm.local", "Dữ liệu hệ thống", "parent", seedPassword.salt, seedPassword.hash, createdAt);

  const insertStudent = db.prepare("INSERT INTO students (id, code, name, date_of_birth, grade, homeroom, level) VALUES (?, ?, ?, ?, ?, ?, ?)");
  STUDENT_SEED_ROWS.forEach((row) => insertStudent.run(...row));
  db.prepare("INSERT INTO parent_students VALUES (?, ?, ?)").run("u_parent", "hs01", "Mẹ");
  db.prepare("INSERT INTO parent_students VALUES (?, ?, ?)").run("u_parent", "hs02", "Mẹ");

  const seedWindow = seedPeriodWindow();
  db.prepare(`INSERT INTO registration_periods
    (id, name, school_year, term, open_at, close_at, status, max_clubs_per_student, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("period_2026_hk1", "Đăng ký CLB · Học kỳ I", "2026–2027", "Học kỳ I", seedWindow.openAt, seedWindow.closeAt, "open", 3, createdAt);

  const insertClub = db.prepare("INSERT INTO clubs (id, code, name, category, description, emoji, visual, grades_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const insertClass = db.prepare(`INSERT INTO club_classes
    (id, club_id, period_id, day_of_week, start_time, end_time, schedule_label, room, teacher, capacity, enrolled_base, fee)
    VALUES (?, ?, 'period_2026_hk1', ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const [clubId, code, name, category, description, emoji, visual, grades, day, start, end, label, room, teacher, capacity, base, fee] of CLUB_SEED_ROWS) {
    insertClub.run(clubId, code, name, category, description, emoji, visual, JSON.stringify(grades));
    insertClass.run(clubId, clubId, day, start, end, label, room, teacher, capacity, base, fee);
  }

  const insertReg = db.prepare(`INSERT INTO registrations
    (id, group_id, student_id, parent_user_id, class_id, status, fee_snapshot, schedule_snapshot, terms_accepted_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const row of REGISTRATION_SEED_ROWS) insertReg.run(...row, row[8], row[8]);
}

if (DATA_BACKEND === "sqlite") {
  await mkdir(resolve(DB_FILE, ".."), { recursive: true });
  db = new DatabaseSync(DB_FILE);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  initializeDatabase();
}

let businessStore = null;
let businessStorePromise = null;

async function ensureBusinessStore() {
  if (DATA_BACKEND === "sqlite") return null;
  if (businessStore) return businessStore;
  if (!businessStorePromise) {
    businessStorePromise = (async () => {
      if (DATA_BACKEND === "mysql") {
        if (!MYSQL_URL) throw new Error("Thiếu MYSQL_URL khi DATA_BACKEND=mysql.");
        const { createMysqlStore } = await import("./mysql-store.mjs");
        return createMysqlStore({
          url: MYSQL_URL,
          encryptionKey: await loadMasterKey(),
          seed: SEED_DEMO_DATA ? demoSeedData({ includeAccounts: true }) : null,
        });
      }
      const { createFirestoreStore } = await import("./firestore-store.mjs");
      return createFirestoreStore({
        projectId: FIREBASE_PROJECT_ID,
        seed: demoSeedData(),
        authClient: googleCloudAuth.workloadIdentityConfigured ? await googleCloudAuth.getClient() : undefined,
      });
    })();
  }
  try {
    businessStore = await businessStorePromise;
    return businessStore;
  } catch (error) {
    businessStorePromise = null;
    throw error;
  }
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((part) => {
    const [key, ...rest] = part.trim().split("=");
    return [key, decodeURIComponent(rest.join("="))];
  }));
}

async function getSessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  if (businessStore) return businessStore.getSessionUser(sessionStorageKey(token), nowIso());
  const user = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`).get(token, nowIso());
  return user || null;
}

async function requireUser(req, role, allowInitialPassword = false) {
  const user = await getSessionUser(req);
  if (!user) throw httpError(401, "AUTH_REQUIRED", "Vui lòng đăng nhập để tiếp tục.");
  if (user.must_change_password && !allowInitialPassword) throw httpError(403, "PASSWORD_CHANGE_REQUIRED", "Vui lòng đổi mật khẩu khởi tạo trước khi sử dụng hệ thống.");
  if (role && user.role !== role) throw httpError(403, "FORBIDDEN", "Bạn không có quyền thực hiện thao tác này.");
  return user;
}

/**
 * Endpoint hỏi "thao tác này cần QUYỀN gì", không hỏi "vai trò nào được vào".
 * Nhờ vậy thêm một vai trò mới chỉ phải sửa ma trận trong roles.mjs, thay vì rà
 * lại hai chục điểm kiểm tra rời rạc — kiểu sửa mà bỏ sót một chỗ là mở toang
 * một cánh cửa.
 */
async function requireSchoolUser(req, capability) {
  const user = await requireUser(req);
  const role = effectiveRole(user, SUPERADMIN_ACCOUNTS);
  if (!can(role, capability)) throw httpError(403, "FORBIDDEN", "Bạn không có quyền thực hiện thao tác này.");
  return { ...user, effectiveRole: role };
}

// `expose` đánh dấu đây là lỗi nghiệp vụ do hệ thống này tự tạo, được phép
// hiển thị nguyên văn cho người dùng.
function httpError(status, code, message, details) {
  const error = new Error(message);
  Object.assign(error, { status, code, details, expose: true });
  return error;
}

async function readJson(req, maxBytes = 1_000_000) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxBytes) throw httpError(413, "PAYLOAD_TOO_LARGE", "Dữ liệu gửi lên vượt giới hạn.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw httpError(400, "INVALID_JSON", "Dữ liệu JSON không hợp lệ."); }
}

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), ...headers });
  res.end(body);
}

async function createSession(user) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
  const createdAt = nowIso();
  if (businessStore) await businessStore.createSession({ token: sessionStorageKey(token), userId: user.id, expiresAt, createdAt });
  else {
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(createdAt);
    db.prepare("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(token, user.id, expiresAt, createdAt);
  }
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}${secure}`;
}

async function rawRegistrationRows({ parentUserId, status, studentId } = {}) {
  if (businessStore) return businessStore.listRegistrations({ parentUserId, status, studentId });
  const params = [];
  const conditions = ["1=1"];
  if (parentUserId) { conditions.push("r.parent_user_id = ?"); params.push(parentUserId); }
  if (status && status !== "all") { conditions.push("r.status = ?"); params.push(status); }
  if (studentId) { conditions.push("r.student_id = ?"); params.push(studentId); }
  return db.prepare(`SELECT r.id, r.group_id AS groupId, r.student_id AS studentId,
    r.parent_user_id AS parentUserId, r.class_id AS classId, r.period_id AS periodId, r.status,
    r.fee_snapshot AS feeSnapshot, r.fee_paid AS feePaid, r.schedule_snapshot AS scheduleSnapshot,
    r.terms_accepted_at AS termsAcceptedAt, r.created_at AS createdAt, r.updated_at AS updatedAt,
    cc.day_of_week AS dayOfWeek, cc.start_time AS startTime, cc.end_time AS endTime
    FROM registrations r JOIN club_classes cc ON cc.id = r.class_id
    WHERE ${conditions.join(" AND ")} ORDER BY r.created_at DESC`).all(...params);
}

async function clubRows(studentId, periodId = null) {
  const student = studentId ? (businessStore ? await businessStore.getStudent(studentId) : db.prepare("SELECT * FROM students WHERE id = ?").get(studentId)) : null;
  const rows = businessStore ? await businessStore.listClubs() : db.prepare(`SELECT cc.id AS id, c.id AS club_id, c.code AS club_code, c.name, c.category,
      c.description, c.emoji, c.visual, c.grades_json, cc.grades_json AS class_grades_json, cc.name AS class_name, cc.period_id,
      cc.day_of_week, cc.start_time, cc.end_time, cc.schedule_label, cc.room, cc.teacher,
      cc.capacity, cc.min_capacity, cc.enrolled_base, cc.fee, cc.waitlist_enabled
    FROM clubs c JOIN club_classes cc ON cc.club_id = c.id
    WHERE c.active = 1 AND cc.active = 1
    ORDER BY c.sort_order, c.category, c.name, cc.sort_order, cc.day_of_week, cc.start_time`).all();
  const scopedRows = periodId ? rows.filter((row) => (row.periodId || row.period_id) === periodId) : rows;
  let enrollmentCounts;
  if (businessStore) {
    enrollmentCounts = await businessStore.getEnrollmentCounts();
  } else {
    const counts = db.prepare(`SELECT cc.id, cc.enrolled_base + COALESCE(SUM(
      CASE WHEN r.status IN (${SEAT_HOLDING_SQL}) THEN 1 ELSE 0 END), 0) AS enrolled,
      COALESCE(SUM(CASE WHEN r.status IN (${PENDING_SEAT_SQL}) THEN 1 ELSE 0 END), 0) AS pending
      FROM club_classes cc LEFT JOIN registrations r ON r.class_id = cc.id GROUP BY cc.id`).all();
    enrollmentCounts = Object.fromEntries(counts.map((row) => [row.id, { enrolled: asInt(row.enrolled), pending: asInt(row.pending) }]));
  }
  return scopedRows.map((row) => {
    const clubGrades = businessStore ? row.grades : JSON.parse(row.grades_json);
    const classGrades = businessStore ? (row.classGrades || []) : JSON.parse(row.class_grades_json || "[]");
    // Khối khai riêng cho từng ca được ưu tiên; không khai thì dùng khối chung của CLB.
    const grades = classGrades.length ? classGrades : clubGrades;
    const waitlist = row.waitlistEnabled ?? row.waitlist_enabled;
    return {
      id: row.id,
      clubId: row.clubId || row.club_id,
      code: row.code || row.club_code,
      name: row.name,
      className: row.className || row.class_name || "",
      category: row.category,
      description: row.description,
      emoji: row.emoji,
      visual: row.visual,
      grade: grades,
      periodId: row.periodId || row.period_id,
      schedule: row.scheduleLabel || row.schedule_label,
      room: row.room,
      teacher: row.teacher,
      capacity: asInt(row.capacity),
      minCapacity: asInt(row.minCapacity ?? row.min_capacity),
      enrolled: asInt(enrollmentCounts[row.id]?.enrolled ?? row.enrolledBase ?? row.enrolled_base),
      // Số đơn đã đăng ký nhưng CHƯA đóng phí. Từ khi chỗ chỉ tính lúc đóng phí, giấu
      // con số này đi tức là để phụ huynh chọn một lớp "còn 5 chỗ" trong khi 30 gia
      // đình đang xếp trước — rồi đóng phí xong mới biết mình bị đẩy sang xếp chờ.
      pending: asInt(enrollmentCounts[row.id]?.pending),
      fee: asInt(row.fee),
      waitlistEnabled: waitlist !== 0 && waitlist !== false,
      eligible: student ? grades.includes(student.grade) : true,
      dayOfWeek: row.dayOfWeek ?? row.day_of_week,
      startTime: row.startTime || row.start_time,
      endTime: row.endTime || row.end_time,
    };
  });
}

async function validateRegistration(user, studentId, clubIds) {
  if (!studentId || !Array.isArray(clubIds) || clubIds.length === 0) {
    throw httpError(400, "INVALID_REGISTRATION", "Vui lòng chọn học sinh và ít nhất một CLB.");
  }
  const period = await requireActivePeriod();
  if (clubIds.length > period.maxClubsPerStudent) {
    throw httpError(422, "MAX_CLUBS", `Mỗi học sinh được đăng ký tối đa ${period.maxClubsPerStudent} CLB trong đợt này.`);
  }
  const ownership = businessStore ? await businessStore.parentOwnsStudent(user.id, studentId) : db.prepare(`SELECT s.* FROM students s JOIN parent_students ps ON ps.student_id = s.id
    WHERE ps.parent_user_id = ? AND s.id = ? AND s.status = 'active'`).get(user.id, studentId);
  if (!ownership) throw httpError(403, "STUDENT_SCOPE", "Học sinh không thuộc tài khoản phụ huynh hiện tại.");

  const available = new Map((await clubRows(studentId, period.id)).map((club) => [club.id, club]));
  const selected = clubIds.map((clubId) => available.get(clubId));
  if (selected.some((club) => !club)) throw httpError(404, "CLUB_NOT_FOUND", "Có CLB không còn tồn tại hoặc đã bị ẩn.");

  const issues = [];
  for (const club of selected) {
    if (!club.eligible) issues.push({ type: "ineligible", clubId: club.id, message: `${club.name} không áp dụng cho khối của học sinh.` });
    if (club.enrolled >= club.capacity && !club.waitlistEnabled) {
      issues.push({ type: "full", clubId: club.id, message: `${club.name} đã đủ sĩ số và không nhận danh sách chờ.` });
    }
  }
  for (let i = 0; i < selected.length; i += 1) {
    for (let j = i + 1; j < selected.length; j += 1) {
      if (intervalsOverlap(selected[i], selected[j])) {
        issues.push({ type: "conflict", clubId: selected[j].id, message: conflictMessage(selected[j], selected[i], { daDangKy: false }) });
      }
    }
  }
  const existing = (await rawRegistrationRows({ studentId }))
    .filter((registration) => ACTIVE_REGISTRATION_STATUSES.includes(registration.status))
    .map((registration) => {
      const known = available.get(registration.classId);
      return {
        id: registration.classId,
        clubId: known?.clubId || registration.classId,
        name: known?.name || registration.classId,
        // Đơn cũ chưa gắn mã đợt thì suy ra từ việc lớp có thuộc đợt đang mở hay không.
        inPeriod: registration.periodId ? registration.periodId === period.id : available.has(registration.classId),
        dayOfWeek: registration.dayOfWeek,
        startTime: registration.startTime,
        endTime: registration.endTime,
        schedule: known?.schedule || registration.scheduleSnapshot || "",
      };
    });

  // Hai lớp khác nhau của cùng một CLB vẫn bị coi là đăng ký trùng CLB.
  const chosenClubIds = new Set();
  for (const club of selected) {
    if (chosenClubIds.has(club.clubId)) {
      issues.push({ type: "duplicate", clubId: club.id, message: `Đã chọn hai lớp của cùng CLB ${club.name}. Vui lòng chỉ giữ một lớp.` });
    }
    chosenClubIds.add(club.clubId);
  }
  for (const club of selected) {
    for (const current of existing) {
      if (current.id === club.id) issues.push({ type: "duplicate", clubId: club.id, message: `${club.name} đã có trong đăng ký hiện tại.` });
      else if (current.inPeriod && current.clubId === club.clubId) issues.push({ type: "duplicate", clubId: club.id, message: `Học sinh đã đăng ký một lớp khác của ${club.name}.` });
      else if (intervalsOverlap(club, current)) issues.push({ type: "conflict", clubId: club.id, message: conflictMessage(club, current, { daDangKy: true }) });
    }
  }

  const clubsInPeriod = new Set(existing.filter((current) => current.inPeriod).map((current) => current.clubId));
  for (const club of selected) clubsInPeriod.add(club.clubId);
  if (clubsInPeriod.size > period.maxClubsPerStudent) {
    issues.push({ type: "limit", clubId: selected[0].id, message: `Học sinh chỉ được đăng ký tối đa ${period.maxClubsPerStudent} CLB trong đợt này.` });
  }

  return {
    valid: issues.length === 0,
    issues,
    period: { id: period.id, name: period.name, closeAt: period.closeAt, maxClubsPerStudent: period.maxClubsPerStudent },
    clubs: selected.map((club) => ({ ...club, proposedStatus: club.enrolled >= club.capacity ? "waitlist" : "payment" })),
  };
}

// "16:49 - 07/09/2026". Ghép từ formatToParts chứ không phó mặc cho định dạng mặc
// định của vi-VN: mỗi phiên bản Node/ICU lại xếp ngày giờ một kiểu, mà đây là cột
// giáo vụ đọc hằng ngày nên thứ tự phải cố định.
function formatRegistrationTimestamp(value) {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh", hour12: false,
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).formatToParts(time).map((part) => [part.type, part.value]));
  return `${parts.hour}:${parts.minute} - ${parts.day}/${parts.month}/${parts.year}`;
}

async function listRegistrations(user, status, { includeStudentIdentity = false } = {}) {
  const rows = await rawRegistrationRows({ parentUserId: user.role === "parent" ? user.id : undefined, status });
  const hydrated = businessStore ? await businessStore.hydrateRegistrations(rows) : rows.map((registration) => {
    const clubClass = db.prepare("SELECT cc.room, cc.teacher, cc.name AS className, cc.club_id AS clubId FROM club_classes cc WHERE cc.id = ?").get(registration.classId) || {};
    return {
      registration,
      student: db.prepare("SELECT name, homeroom, code, date_of_birth AS dateOfBirth FROM students WHERE id = ?").get(registration.studentId) || {},
      clubClass,
      club: (clubClass.clubId ? db.prepare("SELECT id, name FROM clubs WHERE id = ?").get(clubClass.clubId) : null) || {},
    };
  });
  return hydrated.map(({ registration, student, clubClass, club }) => {
    // Vắng mặt hẳn chứ không phải chuỗi rỗng: kiểm thử khẳng định được "không có
    // trường này", còn chuỗi rỗng thì không phân biệt được với dữ liệu thiếu.
    const studentIdentity = includeStudentIdentity
      ? { studentCode: student.code || "", dateOfBirth: student.dateOfBirth || null }
      : {};
    return {
      id: registration.id,
      groupId: registration.groupId,
      studentId: registration.studentId,
      student: student.name || registration.studentId,
      ...studentIdentity,
      className: student.homeroom || "—",
      clubId: club.id || registration.classId,
      club: club.name || registration.classId,
      classId: registration.classId,
      classLabel: clubClass.className || clubClass.name || "",
      schedule: registration.scheduleSnapshot,
      dayOfWeek: registration.dayOfWeek ?? null,
      startTime: registration.startTime || "",
      endTime: registration.endTime || "",
      status: registration.status,
      feePaid: Boolean(registration.feePaid),
      amount: Number(registration.feeSnapshot || 0),
      createdAt: registration.createdAt,
      room: clubClass.room || "—",
      teacher: clubClass.teacher || "—",
      date: formatRegistrationTimestamp(registration.createdAt),
    };
  });
}

async function dashboardData() {
  const registrations = await rawRegistrationRows();
  const total = registrations.length;
  const students = new Set(registrations.map((item) => item.studentId)).size;
  const needAction = registrations.filter((item) => [STATUS.xepCho, STATUS.dangKy].includes(item.status)).length;
  const pending = registrations.filter((item) => item.status === "payment");
  const categories = new Map();
  for (const club of await clubRows()) {
    const current = categories.get(club.category) || { category: club.category, capacity: 0, enrolled: 0 };
    current.capacity += Number(club.capacity || 0);
    current.enrolled += Number(club.enrolled || 0);
    categories.set(club.category, current);
  }
  return {
    total,
    students,
    needAction,
    pendingPayment: pending.length,
    pendingAmount: pending.reduce((sum, item) => sum + Number(item.feeSnapshot || 0), 0),
    categories: [...categories.values()].sort((left, right) => left.category.localeCompare(right.category, "vi"))
      .map((row) => ({ ...row, fillRate: Math.min(100, Math.round(row.enrolled / row.capacity * 100)) })),
  };
}

/**
 * Những gì ĐANG NẰM TRONG CƠ SỞ DỮ LIỆU, không phải trạng thái của tiến trình.
 *
 * Trạng thái đồng bộ (lần chạy gần nhất, kết quả) chỉ sống trong bộ nhớ tiến trình
 * nên khởi động lại là về "chưa chạy lần nào" — đúng về mặt kỹ thuật nhưng làm
 * người dùng tưởng mất dữ liệu. Ba con số dưới đây đọc thẳng từ cơ sở dữ liệu, nên
 * chúng nói được sự thật: danh bạ vẫn còn nguyên, và lần đồng bộ gần nhất là lúc nào.
 */
async function directorySummary() {
  if (businessStore) return businessStore.directorySummary();
  return {
    parents: asInt(db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'parent'").get().count),
    students: asInt(db.prepare("SELECT COUNT(*) AS count FROM students WHERE status = 'active'").get().count),
    lastSyncAt: db.prepare("SELECT MAX(created_at) AS at FROM audit_logs WHERE action = 'SYNC_STUDENT_DIRECTORY'").get().at || null,
  };
}

/**
 * Lớp còn chỗ trống không, tính theo đúng luật mới: chỉ đơn ĐÃ ĐÓNG PHÍ trở đi mới
 * chiếm chỗ. Bỏ qua chính đơn đang xét, vì nó sắp đổi trạng thái.
 */
function classHasFreeSeat(classId, exceptRegistrationId) {
  const lop = db.prepare("SELECT capacity, enrolled_base AS enrolledBase FROM club_classes WHERE id = ?").get(classId);
  if (!lop) return { free: true, capacity: 0 };
  const dem = db.prepare(`SELECT COUNT(*) AS n FROM registrations
    WHERE class_id = ? AND status IN (${SEAT_HOLDING_SQL}) AND id <> ?`).get(classId, exceptRegistrationId || "");
  const daDung = asInt(lop.enrolledBase) + asInt(dem?.n);
  return { free: daDung < asInt(lop.capacity), capacity: asInt(lop.capacity), daDung };
}

/**
 * Trả về một mã đơn CHẮC CHẮN chưa có trong bảng. Nới rộng không gian mã là đủ để
 * xác suất đụng trùng về gần không, nhưng "gần không" nhân với 4.445 gia đình vẫn
 * là một gia đình nào đó nhận lỗi hệ thống vào đúng ngày mở đăng ký.
 */
function maDonConTrong(maDeXuat, taoMaMoi, soLanThu = 8) {
  let ma = maDeXuat;
  for (let lan = 0; lan < soLanThu; lan += 1) {
    if (!db.prepare("SELECT 1 FROM registrations WHERE id = ?").get(ma)) return ma;
    ma = taoMaMoi();
  }
  throw httpError(500, "REGISTRATION_ID_EXHAUSTED", "Không sinh được mã đơn mới. Vui lòng thử lại.");
}

async function countActiveStudents() {
  if (businessStore) return businessStore.countActiveStudents();
  return asInt(db.prepare("SELECT COUNT(*) AS n FROM students WHERE status = 'active'").get()?.n);
}

async function syncGoogleDirectory(actorUserId) {
  const loaded = await directorySource.loadForSync();
  const timestamp = nowIso();
  const context = {
    snapshot: loaded.snapshot, actorUserId, timestamp, idFactory: id,
    source: loaded.source, analysis: loaded.analysis,
    allSourcesLoaded: chapNhanCoNghiHoc(loaded.allSourcesLoaded),
  };
  const result = businessStore ? await businessStore.syncDirectory(context) : syncDirectoryLocal(context);
  // Kết quả từng file được trả về nguyên vẹn để màn hình quản trị chỉ đúng file
  // đang hỏng, thay vì chỉ báo chung chung là "đồng bộ lỗi".
  return {
    ...result,
    sources: loaded.sources,
    duplicates: loaded.duplicates,
    allSourcesLoaded: chapNhanCoNghiHoc(loaded.allSourcesLoaded),
  };
}

// Nhánh SQLite dùng chung bộ lập kế hoạch với MySQL và Firestore, để ba nền lưu
// trữ hành xử y hệt nhau — nhất là ở quy tắc đánh dấu nghỉ học.
function syncDirectoryLocal({ snapshot, actorUserId, timestamp, idFactory, source, analysis, allSourcesLoaded }) {
  const plan = planDirectoryWrites({
    snapshot,
    students: db.prepare("SELECT id, code, name, date_of_birth AS dateOfBirth, grade, homeroom, level, status FROM students").all(),
    users: db.prepare("SELECT id, account, lower(account) AS accountLower, role, active, email FROM users").all()
      .map((row) => ({ ...row, active: asInt(row.active) === 1 })),
    links: db.prepare("SELECT parent_user_id AS parentUserId, student_id AS studentId, relationship FROM parent_students").all(),
    timestamp, idFactory, allSourcesLoaded: chapNhanCoNghiHoc(allSourcesLoaded),
  });

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const write of plan.writes) {
      const data = write.data;
      if (write.collection === "students") {
        db.prepare(`INSERT INTO students (id, code, name, date_of_birth, grade, homeroom, level, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET code = excluded.code, name = excluded.name,
            date_of_birth = excluded.date_of_birth, grade = excluded.grade,
            homeroom = excluded.homeroom, level = excluded.level, status = excluded.status`)
          .run(write.id, data.code, data.name, data.dateOfBirth, data.grade, data.homeroom, data.level, data.status);
      } else if (write.collection === "users") {
        // Bản ghi chỉ có accountLower/active là lệnh bật lại tài khoản đang tắt.
        if (!data.account) {
          // Email tới sau khi tài khoản đã tồn tại là chuyện bình thường: cột email
          // vừa được thêm vào file danh bạ. Chỉ ghi khi nguồn có giá trị.
          if (data.email) db.prepare("UPDATE users SET active = 1, email = ? WHERE id = ?").run(data.email, write.id);
          else db.prepare("UPDATE users SET active = 1 WHERE id = ?").run(write.id);
          continue;
        }
        // Chưa có mật khẩu riêng: salt/hash để trống, lần đầu đăng nhập bằng mã kích hoạt.
        db.prepare(`INSERT INTO users
          (id, account, display_name, email, role, password_salt, password_hash, activation_code,
            auth_provider, must_change_password, login_failures, locked_until, active, created_at)
          VALUES (?, ?, ?, ?, ?, '', '', ?, ?, ?, 0, NULL, 1, ?)
          ON CONFLICT(id) DO UPDATE SET active = 1`)
          .run(write.id, data.account, data.displayName, data.email || null, data.role, data.activationCode,
            data.authProvider || "local", data.mustChangePassword ? 1 : 0, data.createdAt);
      } else if (write.collection === "parentStudents") {
        db.prepare(`INSERT INTO parent_students (parent_user_id, student_id, relationship) VALUES (?, ?, ?)
          ON CONFLICT(parent_user_id, student_id) DO UPDATE SET relationship = excluded.relationship`)
          .run(data.parentUserId, data.studentId, data.relationship);
      }
    }

    const syncId = idFactory("sync");
    db.prepare(`INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, after_json, created_at)
      VALUES (?, ?, 'SYNC_STUDENT_DIRECTORY', 'google_sheet', ?, ?, ?)`)
      .run(idFactory("audit"), actorUserId, syncId,
        JSON.stringify({ source, counters: plan.counters, scannedRows: analysis.scannedRows }), timestamp);
    db.exec("COMMIT");
    return { syncId, counters: plan.counters, scannedRows: analysis.scannedRows, deactivated: plan.deactivated };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/* ---------- Tài khoản nhà trường: tra cứu và ghi, chung cho cả ba nền ---------- */

async function findSchoolUserForLogin({ objectId, email }) {
  if (businessStore) return businessStore.findSchoolUserForLogin({ objectId, email });
  return db.prepare("SELECT * FROM users WHERE (microsoft_object_id IS NOT NULL AND microsoft_object_id = ?) OR lower(account) = lower(?)")
    .get(objectId || null, email) || null;
}

// Đăng nhập là xác minh danh tính, KHÔNG phải dịp cấp quyền: không đụng tới
// role và active. Đây chính là lỗi của upsertMicrosoftUser cũ — nó ép role về
// 'admin' ở mỗi lần đăng nhập, xoá sạch phân quyền đặt tay.
async function linkMicrosoftLogin({ userId, identity, timestamp }) {
  if (businessStore) return businessStore.linkMicrosoftLogin({ userId, identity, timestamp });
  db.prepare(`UPDATE users SET display_name = ?, auth_provider = 'microsoft', microsoft_object_id = ?,
    must_change_password = 0, login_failures = 0, locked_until = NULL, last_login_at = ? WHERE id = ?`)
    .run(identity.name, identity.objectId || null, timestamp, userId);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
}

async function createSchoolUser({ id, account, displayName, role, timestamp, objectId = null, active = true }) {
  // Tài khoản nhà trường đăng nhập bằng Microsoft 365 nên không có mật khẩu dùng
  // được; đặt một chuỗi ngẫu nhiên để không tồn tại đường đăng nhập bằng mật khẩu.
  const password = hashPassword(randomBytes(48).toString("base64url"));
  if (businessStore) return businessStore.createSchoolUser({ id, account, displayName, role, password, timestamp, objectId, active });
  db.prepare(`INSERT INTO users
    (id, account, display_name, role, password_salt, password_hash, auth_provider, microsoft_object_id,
      must_change_password, login_failures, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'microsoft', ?, 0, 0, ?, ?)`)
    .run(id, account, displayName, role, password.salt, password.hash, objectId, active ? 1 : 0, timestamp);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

async function listSchoolUsers() {
  if (businessStore) return businessStore.listSchoolUsers();
  return db.prepare("SELECT * FROM users WHERE role <> 'parent' ORDER BY created_at ASC").all();
}

async function getUserById(userId) {
  if (businessStore) return businessStore.getUserById(userId);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId) || null;
}

async function setSchoolUserDisplayName(userId, displayName) {
  if (businessStore) return businessStore.setSchoolUserDisplayName(userId, displayName);
  db.prepare("UPDATE users SET display_name = ? WHERE id = ? AND role <> 'parent'").run(displayName, userId);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
}

async function setSchoolUserRole(userId, role) {
  if (businessStore) return businessStore.setSchoolUserRole(userId, role);
  db.prepare("UPDATE users SET role = ? WHERE id = ? AND role <> 'parent'").run(role, userId);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
}

// Không xoá cứng bao giờ: audit_logs trỏ tới actor_user_id, xoá bản ghi là mất
// dấu vết ai đã làm gì. Vô hiệu hoá thì cắt phiên ngay để người đó không dùng
// tiếp được phiên đang mở.
async function setSchoolUserActive(userId, active) {
  if (businessStore) return businessStore.setSchoolUserActive(userId, active);
  db.prepare("UPDATE users SET active = ? WHERE id = ? AND role <> 'parent'").run(active ? 1 : 0, userId);
  if (!active) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
}


function assertSchoolAccountWritable(target) {
  if (isSuperadminAccount(target.account, SUPERADMIN_ACCOUNTS)) {
    throw httpError(409, "TAI_KHOAN_KHOA_BOI_CAU_HINH",
      "Tài khoản này nằm trong SUPERADMIN_ACCOUNTS nên quyền do cấu hình máy chủ quyết định. Hãy sửa biến môi trường rồi khởi động lại dịch vụ.");
  }
}

function readSchoolAccountImportPayload(payload) {
  const headers = Array.isArray(payload.headers) ? payload.headers.map((value) => String(value ?? "")) : [];
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!headers.length) throw httpError(422, "IMPORT_HEADERS_REQUIRED", "Không đọc được dòng tiêu đề của tệp.");
  if (!rows.length) throw httpError(422, "IMPORT_ROWS_REQUIRED", "Tệp không có dòng dữ liệu nào.");
  if (rows.length > MAX_ACCOUNT_IMPORT_ROWS) throw httpError(413, "IMPORT_TOO_LARGE", `Tệp vượt quá ${MAX_ACCOUNT_IMPORT_ROWS} dòng dữ liệu.`);
  return { headers, rows: rows.map((row) => (Array.isArray(row) ? row : [])) };
}

// Dùng chung cho thêm thủ công và nhập hàng loạt, để hai đường đi không bao giờ
// kiểm tra khác nhau.
async function createSchoolAccount({ email: rawEmail, displayName: rawName, role: rawRole }, actor, { source = "thu-cong" } = {}) {
  const email = normalizeAccount(rawEmail);
  const displayName = String(rawName || "").trim();
  const role = normalizeSchoolRole(rawRole);

  if (!isSchoolEmail(email, MICROSOFT_ALLOWED_DOMAIN)) {
    throw httpError(422, "EMAIL_NGOAI_MIEN", `Email phải thuộc miền @${MICROSOFT_ALLOWED_DOMAIN}.`);
  }
  if (!displayName) throw httpError(422, "THIEU_HO_TEN", "Vui lòng nhập họ và tên.");
  if (!role) throw httpError(422, "VAI_TRO_KHONG_HOP_LE", `Vai trò chỉ nhận: ${ASSIGNABLE_SCHOOL_ROLES.join(", ")}.`);

  // Chặn cả khi email trùng một tài khoản phụ huynh: gộp hai loại tài khoản vào
  // một bản ghi là lối vào cho việc leo thang quyền.
  const existing = await findSchoolUserForLogin({ objectId: null, email });
  if (existing) throw httpError(409, "TAI_KHOAN_DA_TON_TAI", "Email này đã có tài khoản trong hệ thống.");

  const account = await createSchoolUser({
    id: `u_ns_${randomBytes(10).toString("hex")}`,
    account: email, displayName, role, timestamp: nowIso(),
  });
  await writeAudit({
    actorUserId: actor.id, action: "SCHOOL_ACCOUNT_CREATED", entityType: "school_account",
    entityId: account.id, after: { email, displayName, role, source },
  });
  return account;
}

function schoolUserView(user) {
  const role = effectiveRole(user, SUPERADMIN_ACCOUNTS);
  return {
    id: user.id,
    account: user.account,
    displayName: user.display_name,
    role,
    roleLabel: ROLE_LABELS[role] || role,
    // Suy từ BIẾN MÔI TRƯỜNG, đúng bằng điều kiện mà lá chắn ở máy chủ dùng.
    // Suy từ vai trò sẽ lệch: một bản ghi role='superadmin' còn sót lại sẽ được
    // giao diện khoá và khuyên "sửa biến môi trường", trong khi máy chủ vẫn cho sửa.
    lockedByEnv: isSuperadminAccount(user.account, SUPERADMIN_ACCOUNTS),
    active: asInt(user.active) === 1,
    lastLoginAt: user.last_login_at || null,
    createdAt: user.created_at || null,
    status: asInt(user.active) !== 1 ? "vo-hieu-hoa" : user.last_login_at ? "dang-dung" : "cho-dang-nhap-lan-dau",
  };
}

// ---- Danh mục vận hành: đợt đăng ký, CLB và lớp CLB ----

async function writeAudit({ actorUserId, action, entityType, entityId, before = null, after = null, reason = null }) {
  const timestamp = nowIso();
  if (businessStore) {
    await businessStore.appendAudit({ actorUserId, action, entityType, entityId, before, after, reason, createdAt: timestamp });
    return;
  }
  db.prepare(`INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, before_json, after_json, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id("audit"), actorUserId, action, entityType, entityId,
      before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, reason, timestamp);
}

async function listPeriodRows() {
  const rows = businessStore ? await businessStore.listPeriods() : db.prepare(`SELECT id, name, school_year AS schoolYear, term,
    open_at AS openAt, close_at AS closeAt, status, max_clubs_per_student AS maxClubsPerStudent, note, updated_at AS updatedAt
    FROM registration_periods ORDER BY open_at DESC`).all();
  return rows.map((row) => ({ ...row, maxClubsPerStudent: asInt(row.maxClubsPerStudent) || 3 }));
}

// Đợt chỉ nhận đơn khi trạng thái là 'open' VÀ giờ máy chủ nằm trong khoảng mở/đóng.
// Không phụ thuộc đồng hồ thiết bị của phụ huynh.
function periodAcceptsRegistrations(period, now = nowIso()) {
  return Boolean(period) && period.status === "open" && String(period.openAt) <= now && now <= String(period.closeAt);
}

// Chỉ trả ra các trường phụ huynh cần biết về đợt đăng ký.
function publicPeriod(period) {
  if (!period) return null;
  return {
    id: period.id, name: period.name, schoolYear: period.schoolYear, term: period.term,
    openAt: period.openAt, closeAt: period.closeAt, maxClubsPerStudent: period.maxClubsPerStudent, note: period.note || "",
  };
}

async function getActivePeriod() {
  const now = nowIso();
  return (await listPeriodRows()).find((period) => periodAcceptsRegistrations(period, now)) || null;
}

async function requireActivePeriod() {
  const period = await getActivePeriod();
  if (!period) throw httpError(409, "REGISTRATION_CLOSED", "Hiện không có đợt đăng ký nào đang mở. Vui lòng liên hệ nhà trường.");
  return period;
}

async function savePeriodRecord({ actorUserId, periodId, input }) {
  const periods = await listPeriodRows();
  const existing = periodId ? periods.find((period) => period.id === periodId) : null;
  if (periodId && !existing) throw httpError(404, "PERIOD_NOT_FOUND", "Không tìm thấy đợt đăng ký.");
  const data = normalizePeriodInput(input, { existing });
  const targetId = periodId || id("period");
  if (data.status === "open") {
    const clash = periods.find((period) => period.id !== targetId && period.status === "open");
    if (clash) throw httpError(409, "PERIOD_ALREADY_OPEN", `Đợt "${clash.name}" đang mở. Hãy đóng đợt đó trước khi mở đợt khác.`);
  }
  const timestamp = nowIso();
  if (businessStore) {
    await businessStore.savePeriod(targetId, { ...data, updatedAt: timestamp });
  } else if (existing) {
    db.prepare(`UPDATE registration_periods SET name = ?, school_year = ?, term = ?, open_at = ?, close_at = ?,
      status = ?, max_clubs_per_student = ?, note = ?, updated_at = ? WHERE id = ?`)
      .run(data.name, data.schoolYear, data.term, data.openAt, data.closeAt, data.status, data.maxClubsPerStudent, data.note, timestamp, targetId);
  } else {
    db.prepare(`INSERT INTO registration_periods (id, name, school_year, term, open_at, close_at, status, max_clubs_per_student, note, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(targetId, data.name, data.schoolYear, data.term, data.openAt, data.closeAt, data.status, data.maxClubsPerStudent, data.note, timestamp);
  }
  await writeAudit({
    actorUserId, action: existing ? "UPDATE_PERIOD" : "CREATE_PERIOD", entityType: "registration_period",
    entityId: targetId, before: existing || null, after: { id: targetId, ...data },
  });
  return { id: targetId, ...data, updatedAt: timestamp };
}

/**
 * Nhập hàng loạt cố ý chỉ làm cho MySQL và SQLite — xem chú thích ở danh sách nợ
 * trong tests/lech-mysql-sqlite.test.mjs. Nền nào thiếu thì phải nói thẳng ra, chứ
 * không để người dùng nhận "TypeError: ... is not a function" dưới dạng lỗi 500.
 */
function kiemNenHoTroNhapHangLoat() {
  if (!businessStore) return;
  for (const ten of ["listAllStudents", "listAllParentLinks", "nhapDangKyHangLoat"]) {
    if (typeof businessStore[ten] !== "function") {
      throw httpError(501, "NEN_LUU_TRU_CHUA_HO_TRO",
        "Nền lưu trữ đang dùng chưa hỗ trợ nhập đăng ký hàng loạt. Tính năng này làm cho MySQL.");
    }
  }
}

/**
 * Phân tích một lần nhập đăng ký hàng loạt từ file Google Form.
 *
 * Dùng chung cho cả màn XEM TRƯỚC lẫn lúc GHI: lúc ghi phân tích LẠI từ chính dữ
 * liệu thô, không tin vào kết quả trình duyệt gửi lên.
 *
 * Trả về từng dòng kèm KẾT CỤC dự kiến, chứ không lặng lẽ bỏ dòng hỏng: người vận
 * hành phải đọc được "file 312 dòng, xếp được 305, 7 dòng này hỏng vì sao" trước
 * khi bấm ghi vài trăm đơn.
 *
 * Mọi luật chặn ở đây phải KHỚP với luật của cổng phụ huynh (validateRegistration).
 * Lệch nhau là cùng một học sinh được xếp bằng đường này mà bị chặn ở đường kia —
 * và ngược lại, điều nguy hiểm hơn: xếp được bằng đường này thứ mà cổng đã cấm.
 */
async function phanTichXepLop({ files = [], mapping = {}, periodId, trangThai = STATUS.dangHoc }) {
  kiemNenHoTroNhapHangLoat();
  const doc = (files || []).map((file) => docFileXepLop({ rows: file.rows || [], label: file.label || "" }));
  const hong = doc.filter((item) => !item.ok);
  const dongFile = doc.filter((item) => item.ok).flatMap((item) => item.rows);

  const periods = await listPeriodRows();
  const dot = periods.find((item) => item.id === periodId);
  if (!dot) throw httpError(404, "PERIOD_NOT_FOUND", "Đợt đăng ký không tồn tại.");
  const giuCho = SEAT_HOLDING_STATUSES.includes(trangThai);

  const catalog = await adminCatalogData();
  const clubById = new Map(catalog.clubs.map((club) => [club.id, club]));
  // Nhãn tra cứu lấy từ MỌI ca, kể cả ca của đợt khác: câu "trùng giờ với cu_a" thì
  // người vận hành không tra ra được đó là lớp nào.
  const nhanMoiCa = new Map(catalog.classes.map((row) =>
    [row.id, `${clubById.get(row.clubId)?.name || row.clubId}${row.name ? ` · ${row.name}` : ""}`]));
  // CLB đã tắt thì cổng phụ huynh trả 404; đường này cũng phải từ chối, không thì
  // nhập được vào một CLB nhà trường vừa đóng.
  const caTrongDot = catalog.classes
    .filter((row) => row.periodId === periodId && row.active && clubById.get(row.clubId)?.active !== false)
    .map((row) => ({ ...row, clubName: clubById.get(row.clubId)?.name || row.clubId }));
  const caById = new Map(caTrongDot.map((ca) => [ca.id, ca]));

  const hocSinh = businessStore
    ? await businessStore.listAllStudents()
    : db.prepare("SELECT id, code, name, grade, homeroom, level, status FROM students").all();
  const hocSinhTheoMa = new Map(hocSinh.map((em) => [String(em.code || "").trim().toUpperCase(), em]));

  const lienKet = businessStore
    ? await businessStore.listAllParentLinks()
    : db.prepare("SELECT parent_user_id AS parentUserId, student_id AS studentId, relationship FROM parent_students").all();
  // Một em có thể có cả bố lẫn mẹ. Chọn theo thứ tự ỔN ĐỊNH (mã tài khoản) chứ
  // không theo thứ tự cơ sở dữ liệu trả về, để chạy lại cho cùng kết quả. Đơn chỉ
  // gắn được MỘT phụ huynh, giống hệt đơn phụ huynh tự tạo.
  const phuHuynhTheoHocSinh = new Map();
  const soPhuHuynh = new Map();
  for (const link of [...lienKet].sort((a, b) => String(a.parentUserId).localeCompare(String(b.parentUserId)))) {
    soPhuHuynh.set(link.studentId, (soPhuHuynh.get(link.studentId) || 0) + 1);
    if (!phuHuynhTheoHocSinh.has(link.studentId)) phuHuynhTheoHocSinh.set(link.studentId, link.parentUserId);
  }

  const donHienCo = await rawRegistrationRows({});
  const donTheoHocSinh = new Map();
  // Từng có đơn cho ca này chưa, BẤT KỂ trạng thái — kể cả đã huỷ. Dùng để không hạ
  // enrolled_base lần thứ hai cho cùng một em: huỷ đơn không đưa em ấy trở lại
  // nhóm "ghi danh ngoài hệ thống", nên con số đó đã trừ rồi thì thôi.
  const daTungCoDon = new Set();
  for (const don of donHienCo) {
    daTungCoDon.add(`${don.studentId}|${don.classId}`);
    if (!ACTIVE_REGISTRATION_STATUSES.includes(don.status)) continue;
    if (!donTheoHocSinh.has(don.studentId)) donTheoHocSinh.set(don.studentId, []);
    donTheoHocSinh.get(don.studentId).push(don);
  }

  // Ghép ô chọn của Form với ca học. Chuỗi rỗng nghĩa là NGƯỜI VẬN HÀNH ĐÃ CHỌN bỏ
  // qua ô này — khác hẳn "chưa có trong bảng ghép"; nhầm hai cái đó thì máy cứ đoán
  // lại và lựa chọn bỏ qua không bao giờ dính.
  const oChon = gomOChonClb(dongFile).map((item) => {
    const daQuyetDinh = Object.hasOwn(mapping, item.khoa);
    const daChon = daQuyetDinh ? String(mapping[item.khoa] || "") : "";
    const doan = daQuyetDinh ? { classId: daChon, ungVien: [] } : doanCaHoc(item.mau, caTrongDot);
    const classId = caById.has(doan.classId) ? doan.classId : null;
    return {
      ...item, classId,
      tuChon: daQuyetDinh,
      ungVien: (daQuyetDinh ? doanCaHoc(item.mau, caTrongDot).ungVien : doan.ungVien)
        .map((ca) => ({ id: ca.id, nhan: nhanCaHoc(ca) })),
    };
  });
  const caTheoOChon = new Map(oChon.map((item) => [item.khoa, item.classId]));

  const daXepTrongFile = new Map();   // "studentId|classId" -> số dòng
  const clubTrongFile = new Map();    // "studentId|clubId"   -> số dòng
  const gioTrongFile = new Map();     // studentId -> [{ca, dong}]
  const ketQua = [];
  for (const row of dongFile) {
    const ghi = (ketCuc, lyDo, them = {}) => ketQua.push({ ...row, ketCuc, lyDo, ...them });
    if (row.loi) { ghi("hong", row.loi); continue; }

    const em = hocSinhTheoMa.get(row.studentCode.toUpperCase());
    if (!em) { ghi("khongTimThayHocSinh", `Không có mã học sinh ${row.studentCode} trong danh bạ.`); continue; }
    if (em.status !== "active") { ghi("hocSinhNghiHoc", `${em.name} đang ở trạng thái nghỉ học.`, { studentId: em.id }); continue; }

    const classId = caTheoOChon.get(boDauChuoi(row.clubText));
    if (!classId) { ghi("chuaGhepCa", `Chưa ghép "${row.clubText}" với ca học nào.`, { studentId: em.id }); continue; }
    const ca = caById.get(classId);

    const chung = { studentId: em.id, studentTen: em.name, classId, caNhan: nhanCaHoc(ca) };
    const khoaFile = `${em.id}|${classId}`;
    if (daXepTrongFile.has(khoaFile)) { ghi("trungTrongFile", `Dòng ${daXepTrongFile.get(khoaFile)} đã xếp em này vào đúng ca này.`, chung); continue; }

    const donCu = donTheoHocSinh.get(em.id) || [];
    if (donCu.some((don) => don.classId === classId)) { ghi("daCoDon", "Em đã có đơn còn hiệu lực cho ca này — bỏ qua.", chung); continue; }

    // Trùng CLB: hai ca khác nhau của CÙNG một CLB. Cổng phụ huynh chặn việc này,
    // đường nhập cũng phải chặn — không thì em bị tính học hai ca và hai lần học phí.
    const khoaClub = `${em.id}|${ca.clubId}`;
    if (clubTrongFile.has(khoaClub)) {
      ghi("trungClbTrongFile", `Dòng ${clubTrongFile.get(khoaClub)} đã xếp em này vào một ca khác của ${ca.clubName}.`, chung);
      continue;
    }
    const donCungClb = donCu.find((don) => caById.get(don.classId)?.clubId === ca.clubId
      || catalog.classes.find((item) => item.id === don.classId)?.clubId === ca.clubId);
    if (donCungClb) {
      ghi("trungClb", `Em đã có đơn cho một ca khác của ${ca.clubName}.`, chung);
      continue;
    }

    // Trùng giờ: so với đơn cũ VÀ với những dòng vừa nhận trong chính file này. Một
    // em tick hai CLB trùng khung giờ trong Form thì chỉ học được một buổi, nhưng
    // hai đơn đều giữ chỗ — hai lớp cùng mất một suất.
    const trungCu = donCu.find((don) => intervalsOverlap(ca, {
      dayOfWeek: don.dayOfWeek, startTime: don.startTime, endTime: don.endTime,
    }));
    if (trungCu) {
      ghi("trungGio", `Trùng giờ với ${nhanMoiCa.get(trungCu.classId) || trungCu.classId} em ấy đã đăng ký.`, chung);
      continue;
    }
    const trungFile = (gioTrongFile.get(em.id) || []).find((item) => intervalsOverlap(ca, item.ca));
    if (trungFile) {
      ghi("trungGioTrongFile", `Trùng giờ với ${nhanCaHoc(trungFile.ca)} ở dòng ${trungFile.dong} trong chính file này.`, chung);
      continue;
    }

    const khoiApDung = (ca.grades?.length ? ca.grades : clubById.get(ca.clubId)?.grades) || [];
    if (khoiApDung.length && !khoiApDung.includes(asInt(em.grade))) {
      ghi("saiKhoi", `Ca này dành cho khối ${khoiApDung.join(", ")}, em đang học khối ${em.grade}.`, chung);
      continue;
    }

    // Hạn mức đếm theo ĐÚNG ĐỢT và theo CLB, giống hệt validateRegistration. Đếm cả
    // đợt cũ thì em từng học đủ 3 CLB một học kỳ sẽ bị khoá khỏi mọi lần nhập sau.
    const clbTrongDot = new Set(donCu
      .filter((don) => (don.periodId || null) === periodId)
      .map((don) => caById.get(don.classId)?.clubId || catalog.classes.find((item) => item.id === don.classId)?.clubId)
      .filter(Boolean));
    for (const khoa of clubTrongFile.keys()) {
      if (khoa.startsWith(`${em.id}|`)) clbTrongDot.add(khoa.slice(em.id.length + 1));
    }
    const hanMuc = asInt(dot.maxClubsPerStudent) || 3;
    if (clbTrongDot.size >= hanMuc) {
      ghi("vuotHanMuc", `Em đã có ${clbTrongDot.size} CLB trong đợt ${dot.name}, vượt mức tối đa ${hanMuc}.`, chung);
      continue;
    }

    daXepTrongFile.set(khoaFile, row.dong);
    clubTrongFile.set(khoaClub, row.dong);
    if (!gioTrongFile.has(em.id)) gioTrongFile.set(em.id, []);
    gioTrongFile.get(em.id).push({ ca, dong: row.dong });
    ghi("xepDuoc", null, {
      ...chung,
      parentUserId: phuHuynhTheoHocSinh.get(em.id) || null,
      soPhuHuynh: soPhuHuynh.get(em.id) || 0,
      laMoiVoiCa: !daTungCoDon.has(khoaFile),
    });
  }

  // Mỗi ca: nhập vào bao nhiêu em, và con số ghi danh sẵn nên hạ xuống bao nhiêu.
  //
  // CHỈ trừ những em CHƯA TỪNG có đơn cho ca đó. Em đã từng được nhập rồi bị huỷ
  // đơn thì enrolled_base đã trừ cho em ấy một lần; trừ tiếp là mở ra chỗ trống
  // không có thật — đã đo: ca 100 em, nhập 40, huỷ 40, nhập lại thì hệ thống báo
  // 60/100 trong khi vẫn đủ 100 em đang học.
  //
  // Và chỉ hạ khi trạng thái đích THỰC SỰ GIỮ CHỖ. Nhập ở "Chờ thanh toán" mà vẫn
  // hạ là sĩ số tụt xuống thật, mở chỗ cho 4.445 học sinh khác giành.
  const theoCa = new Map();
  for (const row of ketQua) {
    if (row.ketCuc !== "xepDuoc") continue;
    if (!theoCa.has(row.classId)) {
      const ca = caById.get(row.classId);
      theoCa.set(row.classId, {
        classId: row.classId, nhan: nhanCaHoc(ca), capacity: asInt(ca.capacity),
        enrolledBaseHienTai: asInt(ca.enrolledBase), donGiuChoHienTai: asInt(ca.activeRegistrations),
        soEmNhapVao: 0, soEmMoiVoiCa: 0,
      });
    }
    const muc = theoCa.get(row.classId);
    muc.soEmNhapVao += 1;
    if (row.laMoiVoiCa) muc.soEmMoiVoiCa += 1;
  }
  const caAnhHuong = [...theoCa.values()].map((item) => {
    const truGiaDanh = giuCho ? item.soEmMoiVoiCa : 0;
    const baseMoi = Math.max(0, item.enrolledBaseHienTai - truGiaDanh);
    const themGiuCho = giuCho ? item.soEmNhapVao : 0;
    return {
      ...item,
      giuCho,
      soEmTruVaoGhiDanhSan: truGiaDanh,
      enrolledBaseDeXuat: baseMoi,
      siSoTruoc: item.enrolledBaseHienTai + item.donGiuChoHienTai,
      siSoSauNeuHaBase: baseMoi + item.donGiuChoHienTai + themGiuCho,
      siSoSauNeuGiuBase: item.enrolledBaseHienTai + item.donGiuChoHienTai + themGiuCho,
      thieuGhiDanhSan: truGiaDanh > item.enrolledBaseHienTai,
      vuotSucChua: baseMoi + item.donGiuChoHienTai + themGiuCho > asInt(item.capacity),
    };
  }).sort((a, b) => b.soEmNhapVao - a.soEmNhapVao);

  const dem = {};
  for (const row of ketQua) dem[row.ketCuc] = (dem[row.ketCuc] || 0) + 1;
  const xepDuoc = ketQua.filter((row) => row.ketCuc === "xepDuoc");

  return {
    periodId, periodName: dot.name, trangThai, giuCho,
    files: doc.map((item) => ({ label: item.label, ok: item.ok, error: item.error || null, headerRow: item.headerRow || null, mapping: item.mapping || {} })),
    filesHong: hong.length,
    tongDong: dongFile.length,
    dem,
    // Đơn không gắn được phụ huynh thì gia đình KHÔNG thấy đơn của con trong cổng —
    // màn xem trước phải nói ra, không thì vài trăm nhà im lặng không biết gì.
    soDonKhongCoPhuHuynh: xepDuoc.filter((row) => !row.parentUserId).length,
    soEmNhieuPhuHuynh: xepDuoc.filter((row) => asInt(row.soPhuHuynh) > 1).length,
    oChon,
    caAnhHuong,
    rows: ketQua,
    sanSang: hong.length === 0 && xepDuoc.length > 0,
    caTrongDot: caTrongDot.map((ca) => ({ id: ca.id, nhan: nhanCaHoc(ca) })),
  };
}

const chuoiRong = (value) => !String(value ?? "").trim();
const boDauChuoi = (value) => String(value ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replaceAll("đ", "d").replaceAll("Đ", "D")
  .toLowerCase().replace(/\s+/g, " ").trim();
const nhanCaHoc = (ca) => (ca ? `${ca.clubName || ca.clubId}${ca.name ? ` · ${ca.name}` : ""}` : "");

/**
 * Ghi một lần nhập hàng loạt.
 *
 * Hai việc phải nằm trong CÙNG một giao dịch, không thể tách ra hai bước bấm tay:
 *   1. tạo đơn cho từng em
 *   2. hạ enrolled_base ("ghi danh sẵn ngoài hệ thống") xuống đúng số em vừa nhập
 *
 * Vì các em này ĐANG được đếm trong enrolled_base. Nhập mà không hạ là sĩ số phồng
 * lên gấp đôi — đã đo: ca sức chứa 20, base 15, nhập 5 đơn thì hệ thống báo 20/20
 * "đã đầy". Còn hạ trước rồi mới nhập là mở toang hàng chục chỗ trống thật cho
 * 4.445 học sinh trong khoảng giữa hai bước.
 */
async function nhapDangKyHangLoat({ actorUserId, groupId, timestamp, trangThai, daThuPhi, haGhiDanhSan, periodId, rows, caAnhHuong }) {
  // Sinh mã đơn ở đây cho cả hai nền, để chỉ có MỘT bộ sinh mã trong hệ thống.
  const kemMa = rows.map((row) => ({ ...row, maDon: maTheoNgay("DK") }));
  if (businessStore) {
    return businessStore.nhapDangKyHangLoat({
      actorUserId, groupId, timestamp, trangThai, daThuPhi, haGhiDanhSan, periodId, rows: kemMa, caAnhHuong,
    });
  }

  const catalog = await adminCatalogData();
  const caById = new Map(catalog.classes.map((ca) => [ca.id, ca]));
  db.exec("BEGIN IMMEDIATE");
  try {
    const insert = db.prepare(`INSERT INTO registrations
      (id, group_id, student_id, parent_user_id, class_id, period_id, status, fee_snapshot, fee_paid,
       schedule_snapshot, terms_accepted_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let daTao = 0;
    for (const row of kemMa) {
      const ca = caById.get(row.classId);
      if (!ca) continue;
      const registrationId = maDonConTrong(row.maDon, () => maTheoNgay("DK"));
      insert.run(registrationId, groupId, row.studentId, row.parentUserId || null, row.classId, periodId,
        trangThai, asInt(ca.fee), daThuPhi ? 1 : 0, ca.scheduleLabel || "", timestamp, timestamp, timestamp);
      db.prepare(`INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, after_json, reason, created_at)
        VALUES (?, ?, 'IMPORT_REGISTRATION', 'registration', ?, ?, ?, ?)`)
        .run(id("audit"), actorUserId, registrationId,
          JSON.stringify({ status: trangThai, feePaid: daThuPhi, classId: row.classId, studentId: row.studentId, groupId }),
          `Nhập hàng loạt từ file đăng ký, dòng ${row.dong}.`, timestamp);
      daTao += 1;
    }

    let daHaBase = 0;
    if (haGhiDanhSan) {
      for (const ca of caAnhHuong) {
        if (ca.enrolledBaseDeXuat === ca.enrolledBaseHienTai) continue;
        db.prepare("UPDATE club_classes SET enrolled_base = ? WHERE id = ?").run(ca.enrolledBaseDeXuat, ca.classId);
        db.prepare(`INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, before_json, after_json, reason, created_at)
          VALUES (?, ?, 'ADJUST_ENROLLED_BASE', 'club_class', ?, ?, ?, ?, ?)`)
          .run(id("audit"), actorUserId, ca.classId,
            JSON.stringify({ enrolledBase: ca.enrolledBaseHienTai }), JSON.stringify({ enrolledBase: ca.enrolledBaseDeXuat }),
            `Hạ theo ${ca.soEmNhapVao} em vừa nhập thành đơn, để không đếm hai lần.`, timestamp);
        daHaBase += 1;
      }
    }

    db.exec("COMMIT");
    return { daTao, daHaBase };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function adminCatalogData() {
  if (businessStore) {
    const catalog = await businessStore.adminCatalog();
    return {
      clubs: catalog.clubs.map((club) => ({
        id: club.id, code: club.code || "", name: club.name, category: club.category, description: club.description || "",
        emoji: club.emoji || "🎯", visual: club.visual || "life", grades: Array.isArray(club.grades) ? club.grades : [],
        sortOrder: asInt(club.sortOrder), active: club.active !== false,
      })),
      classes: catalog.classes.map((row) => ({
        id: row.id, clubId: row.clubId, periodId: row.periodId, name: row.name || "", dayOfWeek: asInt(row.dayOfWeek),
        startTime: row.startTime, endTime: row.endTime, scheduleLabel: row.scheduleLabel, room: row.room, teacher: row.teacher,
        capacity: asInt(row.capacity), minCapacity: asInt(row.minCapacity), enrolledBase: asInt(row.enrolledBase),
        grades: Array.isArray(row.grades) ? row.grades : [],
        fee: asInt(row.fee), waitlistEnabled: row.waitlistEnabled !== false, sortOrder: asInt(row.sortOrder), active: row.active !== false,
        enrolled: asInt(catalog.enrolled[row.id] ?? row.enrolledBase),
        activeRegistrations: asInt(catalog.activeRegistrations[row.id]),
        pendingRegistrations: asInt(catalog.pendingRegistrations?.[row.id]),
      })),
    };
  }
  const clubs = db.prepare(`SELECT id, code, name, category, description, emoji, visual, grades_json AS gradesJson,
    sort_order AS sortOrder, active FROM clubs ORDER BY sort_order, category, name`).all()
    .map((club) => ({
      id: club.id, code: club.code, name: club.name, category: club.category, description: club.description,
      emoji: club.emoji, visual: club.visual, grades: JSON.parse(club.gradesJson), sortOrder: asInt(club.sortOrder), active: club.active === 1,
    }));
  const counts = Object.fromEntries(db.prepare(`SELECT cc.id,
    COALESCE(SUM(CASE WHEN r.status IN (${SEAT_HOLDING_SQL}) THEN 1 ELSE 0 END), 0) AS activeRegistrations,
    COALESCE(SUM(CASE WHEN r.status IN (${PENDING_SEAT_SQL}) THEN 1 ELSE 0 END), 0) AS pendingRegistrations
    FROM club_classes cc LEFT JOIN registrations r ON r.class_id = cc.id GROUP BY cc.id`).all()
    .map((row) => [row.id, { held: asInt(row.activeRegistrations), pending: asInt(row.pendingRegistrations) }]));
  const classes = db.prepare(`SELECT id, club_id AS clubId, period_id AS periodId, name, day_of_week AS dayOfWeek,
    start_time AS startTime, end_time AS endTime, schedule_label AS scheduleLabel, room, teacher, capacity,
    min_capacity AS minCapacity, enrolled_base AS enrolledBase, fee, waitlist_enabled AS waitlistEnabled,
    grades_json AS gradesJson, sort_order AS sortOrder, active FROM club_classes ORDER BY sort_order, day_of_week, start_time`).all()
    .map(({ gradesJson, ...row }) => ({
      ...row, grades: JSON.parse(gradesJson || "[]"),
      capacity: asInt(row.capacity), minCapacity: asInt(row.minCapacity), enrolledBase: asInt(row.enrolledBase),
      fee: asInt(row.fee), sortOrder: asInt(row.sortOrder), dayOfWeek: asInt(row.dayOfWeek),
      waitlistEnabled: row.waitlistEnabled === 1, active: row.active === 1,
      activeRegistrations: counts[row.id]?.held || 0,
      pendingRegistrations: counts[row.id]?.pending || 0,
      enrolled: asInt(row.enrolledBase) + (counts[row.id]?.held || 0),
    }));
  return { clubs, classes };
}

async function saveClubRecord({ actorUserId, clubId, input }) {
  const catalog = await adminCatalogData();
  const existing = clubId ? catalog.clubs.find((club) => club.id === clubId) : null;
  if (clubId && !existing) throw httpError(404, "CLUB_NOT_FOUND", "Không tìm thấy CLB.");
  const data = normalizeClubInput(input, { existing });
  const targetId = clubId || id("club");
  const duplicate = catalog.clubs.find((club) => club.id !== targetId && String(club.code).toUpperCase() === data.code);
  if (duplicate) throw httpError(409, "CLUB_CODE_TAKEN", `Mã CLB "${data.code}" đã được dùng cho "${duplicate.name}".`);
  if (businessStore) {
    await businessStore.saveClub(targetId, data);
  } else if (existing) {
    db.prepare(`UPDATE clubs SET code = ?, name = ?, category = ?, description = ?, emoji = ?, visual = ?,
      grades_json = ?, sort_order = ?, active = ? WHERE id = ?`)
      .run(data.code, data.name, data.category, data.description, data.emoji, data.visual,
        JSON.stringify(data.grades), data.sortOrder, data.active ? 1 : 0, targetId);
  } else {
    db.prepare(`INSERT INTO clubs (id, code, name, category, description, emoji, visual, grades_json, sort_order, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(targetId, data.code, data.name, data.category, data.description, data.emoji, data.visual,
        JSON.stringify(data.grades), data.sortOrder, data.active ? 1 : 0);
  }
  await writeAudit({
    actorUserId, action: existing ? "UPDATE_CLUB" : "CREATE_CLUB", entityType: "club",
    entityId: targetId, before: existing || null, after: { id: targetId, ...data },
  });
  return { id: targetId, ...data };
}

async function saveClassRecord({ actorUserId, classId, input }) {
  const [catalog, periods] = await Promise.all([adminCatalogData(), listPeriodRows()]);
  const existing = classId ? catalog.classes.find((row) => row.id === classId) : null;
  if (classId && !existing) throw httpError(404, "CLASS_NOT_FOUND", "Không tìm thấy lớp CLB.");
  const data = normalizeClassInput(input, { existing, knownPeriodIds: periods.map((period) => period.id) });
  const club = catalog.clubs.find((item) => item.id === data.clubId);
  if (!club) throw httpError(404, "CLUB_NOT_FOUND", "CLB của lớp này không tồn tại.");
  const targetId = classId || id("class");
  const held = existing ? existing.activeRegistrations : 0;
  const pending = existing ? (existing.pendingRegistrations || 0) : 0;
  const occupied = data.enrolledBase + held;
  const sucChuaCu = existing ? asInt(existing.capacity) : null;
  if (data.capacity < occupied && (sucChuaCu === null || data.capacity < sucChuaCu)) {
    throw httpError(409, "CAPACITY_BELOW_ENROLLED",
      `Lớp đang dùng ${occupied} chỗ (${data.enrolledBase} ghi danh sẵn + ${held} đơn đang giữ chỗ), không thể đặt sĩ số tối đa nhỏ hơn.`);
  }
  if (!data.active && held + pending > 0) {
    throw httpError(409, "CLASS_HAS_REGISTRATIONS",
      `Lớp đang có ${held + pending} đơn hiệu lực (${held} đã đóng phí, ${pending} đang chờ đóng phí).`
      + " Hãy xử lý các đơn này trước khi ngừng mở lớp.");
  }
  // Một phòng không thể có hai lớp giao giờ trong cùng một đợt.
  const clash = catalog.classes.find((row) => row.id !== targetId && row.active && row.periodId === data.periodId
    && row.room === data.room && row.dayOfWeek === data.dayOfWeek
    && row.startTime < data.endTime && data.startTime < row.endTime);
  if (clash && data.active) {
    throw httpError(409, "ROOM_CONFLICT", `Phòng ${data.room} đã có lớp "${clash.scheduleLabel}" trong đợt này.`);
  }
  if (businessStore) {
    await businessStore.saveClass(targetId, data);
  } else if (existing) {
    db.prepare(`UPDATE club_classes SET club_id = ?, period_id = ?, name = ?, day_of_week = ?, start_time = ?, end_time = ?,
      schedule_label = ?, grades_json = ?, room = ?, teacher = ?, capacity = ?, min_capacity = ?, enrolled_base = ?, fee = ?,
      waitlist_enabled = ?, sort_order = ?, active = ? WHERE id = ?`)
      .run(data.clubId, data.periodId, data.name, data.dayOfWeek, data.startTime, data.endTime, data.scheduleLabel,
        JSON.stringify(data.grades), data.room, data.teacher, data.capacity, data.minCapacity, data.enrolledBase, data.fee,
        data.waitlistEnabled ? 1 : 0, data.sortOrder, data.active ? 1 : 0, targetId);
  } else {
    db.prepare(`INSERT INTO club_classes (id, club_id, period_id, name, day_of_week, start_time, end_time, schedule_label,
      grades_json, room, teacher, capacity, min_capacity, enrolled_base, fee, waitlist_enabled, sort_order, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(targetId, data.clubId, data.periodId, data.name, data.dayOfWeek, data.startTime, data.endTime, data.scheduleLabel,
        JSON.stringify(data.grades), data.room, data.teacher, data.capacity, data.minCapacity, data.enrolledBase, data.fee,
        data.waitlistEnabled ? 1 : 0, data.sortOrder, data.active ? 1 : 0);
  }
  await writeAudit({
    actorUserId, action: existing ? "UPDATE_CLUB_CLASS" : "CREATE_CLUB_CLASS", entityType: "club_class",
    entityId: targetId, before: existing || null, after: { id: targetId, ...data },
  });
  return { id: targetId, ...data };
}

function buildCatalogImportPlan(analysis, { catalog, periodId }) {
  const clubsByCode = new Map(catalog.clubs.map((club) => [String(club.code).toUpperCase(), club]));
  const clubsByName = new Map(catalog.clubs.map((club) => [String(club.name).trim().toLowerCase(), club]));
  const classKey = (row) => `${row.clubId}|${row.periodId}|${row.dayOfWeek}|${row.startTime}|${row.room}`;
  const existingClasses = new Map(catalog.classes.map((row) => [classKey(row), row]));
  const clubIdByKey = new Map();
  const clubWrites = [];
  const classWrites = [];
  const counters = { clubsCreated: 0, clubsUpdated: 0, classesCreated: 0, classesUpdated: 0 };

  for (const club of analysis.clubs) {
    const match = clubsByCode.get(String(club.code).toUpperCase()) || clubsByName.get(club.name.trim().toLowerCase());
    const data = normalizeClubInput({
      code: club.code, name: club.name, category: club.category, description: club.description,
      emoji: club.emoji, grades: club.grades, sortOrder: club.sortOrder, active: true,
    }, { existing: match });
    const targetId = match?.id || id("club");
    clubIdByKey.set(club.key, targetId);
    clubWrites.push({ id: targetId, data, existing: match || null });
    if (match) counters.clubsUpdated += 1;
    else counters.clubsCreated += 1;
  }

  for (const row of analysis.classes) {
    const clubId = clubIdByKey.get(row.clubKey);
    // Tìm ca đang có TRƯỚC rồi mới chuẩn hoá, để normalizeClassInput biết giá trị cũ
    // mà giữ lại những trường file danh mục KHÔNG mang theo — quan trọng nhất là
    // enrolled_base ("ghi danh sẵn ngoài hệ thống").
    //
    // Làm ngược thứ tự thì enrolledBase rơi về 0, và trên MySQL — nền máy chủ thật
    // đang chạy — câu ghi là ON DUPLICATE KEY UPDATE enrolled_base = VALUES(...),
    // tức mỗi lần nhập lại danh mục là XOÁ SẠCH số ghi danh sẵn của mọi ca, làm sĩ
    // số cả trường tụt xuống trong im lặng. Nhánh SQLite không lộ ra vì câu UPDATE
    // của nó không có cột đó — đúng kiểu lỗi chỉ sống ở nền mà kiểm thử không chạm.
    const soBo = normalizeClassInput({ ...row, clubId, periodId, active: true }, { knownPeriodIds: [periodId] });
    const match = existingClasses.get(classKey({ ...soBo }));
    const data = match
      ? normalizeClassInput({ ...row, clubId, periodId, active: true }, { knownPeriodIds: [periodId], existing: match })
      : soBo;
    const targetId = match?.id || id("class");
    classWrites.push({ id: targetId, data, existing: match || null });
    if (match) counters.classesUpdated += 1;
    else counters.classesCreated += 1;
  }
  return { clubWrites, classWrites, counters };
}

async function commitCatalogImport({ actorUserId, analysis, periodId }) {
  const periods = await listPeriodRows();
  if (!periods.some((period) => period.id === periodId)) throw httpError(404, "PERIOD_NOT_FOUND", "Đợt đăng ký không tồn tại.");
  const catalog = await adminCatalogData();
  const plan = buildCatalogImportPlan(analysis, { catalog, periodId });
  const timestamp = nowIso();

  if (businessStore) {
    await businessStore.bulkSaveCatalog({
      clubs: plan.clubWrites.map((item) => ({ id: item.id, data: item.data })),
      classes: plan.classWrites.map((item) => ({ id: item.id, data: item.data })),
    });
  } else {
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const item of plan.clubWrites) {
        if (item.existing) {
          db.prepare(`UPDATE clubs SET code = ?, name = ?, category = ?, description = ?, emoji = ?, visual = ?,
            grades_json = ?, sort_order = ?, active = 1 WHERE id = ?`)
            .run(item.data.code, item.data.name, item.data.category, item.data.description, item.data.emoji,
              item.data.visual, JSON.stringify(item.data.grades), item.data.sortOrder, item.id);
        } else {
          db.prepare(`INSERT INTO clubs (id, code, name, category, description, emoji, visual, grades_json, sort_order, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
            .run(item.id, item.data.code, item.data.name, item.data.category, item.data.description,
              item.data.emoji, item.data.visual, JSON.stringify(item.data.grades), item.data.sortOrder);
        }
      }
      for (const item of plan.classWrites) {
        if (item.existing) {
          // Ghi cả enrolled_base y như nhánh MySQL. Bỏ cột ra cho "an toàn" là để
          // hai nền hành xử khác nhau, và khác nhau ở đâu thì kiểm thử mù ở đó.
          db.prepare(`UPDATE club_classes SET club_id = ?, period_id = ?, name = ?, day_of_week = ?, start_time = ?,
            end_time = ?, schedule_label = ?, grades_json = ?, room = ?, teacher = ?, capacity = ?, min_capacity = ?,
            enrolled_base = ?, fee = ?, waitlist_enabled = ?, sort_order = ?, active = 1 WHERE id = ?`)
            .run(item.data.clubId, item.data.periodId, item.data.name, item.data.dayOfWeek, item.data.startTime,
              item.data.endTime, item.data.scheduleLabel, JSON.stringify(item.data.grades), item.data.room, item.data.teacher, item.data.capacity,
              item.data.minCapacity, item.data.enrolledBase, item.data.fee, item.data.waitlistEnabled ? 1 : 0, item.data.sortOrder, item.id);
        } else {
          db.prepare(`INSERT INTO club_classes (id, club_id, period_id, name, day_of_week, start_time, end_time,
            schedule_label, grades_json, room, teacher, capacity, min_capacity, enrolled_base, fee, waitlist_enabled, sort_order, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
            .run(item.id, item.data.clubId, item.data.periodId, item.data.name, item.data.dayOfWeek, item.data.startTime,
              item.data.endTime, item.data.scheduleLabel, JSON.stringify(item.data.grades), item.data.room, item.data.teacher, item.data.capacity,
              item.data.minCapacity, item.data.enrolledBase, item.data.fee, item.data.waitlistEnabled ? 1 : 0, item.data.sortOrder);
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  const importId = id("import");
  await writeAudit({
    actorUserId, action: "IMPORT_CLUB_CATALOG", entityType: "club_catalog", entityId: importId,
    after: { periodId, counters: plan.counters, scannedRows: analysis.counters.scannedRows },
  });
  return { importId, periodId, counters: plan.counters, timestamp };
}

// Chỉ nhận mảng hai chiều đã đọc sẵn từ trình duyệt để backend không phải nhúng thư viện đọc .xlsx.
function readCatalogImportPayload(payload) {
  const headers = Array.isArray(payload.headers) ? payload.headers.map((value) => String(value ?? "")) : [];
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!headers.length) throw httpError(422, "IMPORT_HEADERS_REQUIRED", "Không đọc được dòng tiêu đề của file.");
  if (!rows.length) throw httpError(422, "IMPORT_ROWS_REQUIRED", "File không có dòng dữ liệu nào.");
  if (rows.length > MAX_IMPORT_ROWS) throw httpError(413, "IMPORT_TOO_LARGE", `File vượt quá ${MAX_IMPORT_ROWS} dòng dữ liệu.`);
  return { headers, rows: rows.map((row) => (Array.isArray(row) ? row : [])) };
}

// ---- Hỗ trợ tài khoản phụ huynh: tra cứu và đặt lại mật khẩu khởi tạo ----

// Trả về đúng những gì bộ phận IT cần để trả lời "vì sao phụ huynh không đăng nhập được",
// không trả về salt hay hash.
// canSeeCode: chỉ người có quyền cấp mã mới đọc được mã. Mã kích hoạt CHÍNH LÀ
// mật khẩu của phụ huynh, nên trả nó cho người chỉ có quyền tra cứu là trao luôn
// quyền đăng nhập thay họ.
async function lookupAccount(rawAccount, { canSeeCode = false } = {}) {
  const input = String(rawAccount || "").trim();
  const normalized = toVietnameseLocalPhone(input) || input.toLowerCase();
  const user = businessStore
    ? await businessStore.findAccount(normalized)
    : db.prepare("SELECT * FROM users WHERE lower(account) = lower(?)").get(normalized) || null;

  const directory = await directorySummary();

  if (!user) {
    return {
      input,
      normalized,
      found: false,
      directory,
      diagnosis: directory.parents === 0
        ? "Hệ thống chưa có tài khoản phụ huynh nào. Cần chạy Đồng bộ học sinh & tài khoản PH từ Google Sheets trước."
        : "Không tìm thấy tài khoản cho số này. Thường do số điện thoại chưa có trong Google Sheets, nằm ở cột không được nhận diện, hoặc lần đồng bộ gần nhất chạy trước khi bổ sung số này.",
    };
  }

  const students = businessStore
    ? await businessStore.listStudentsByParent(user.id)
    : db.prepare(`SELECT s.code, s.name, s.homeroom, ps.relationship FROM students s
        JOIN parent_students ps ON ps.student_id = s.id WHERE ps.parent_user_id = ? ORDER BY s.grade, s.name`).all(user.id);

  const locked = Boolean(user.locked_until && user.locked_until > nowIso());
  const account = {
    account: user.account,
    displayName: user.display_name,
    role: user.role,
    authProvider: user.auth_provider,
    active: Boolean(user.active),
    mustChangePassword: Boolean(user.must_change_password),
    // Chỉ trả mã khi tài khoản còn CHƯA kích hoạt: đã đặt mật khẩu riêng rồi thì
    // không còn mã nào để đọc, và cũng không được phép đọc mật khẩu của phụ huynh.
    activationCode: canSeeCode && usesActivationCode(user) ? formatActivationCode(user.activation_code) : null,
    // Người tra cứu vẫn cần biết tài khoản đang ở trạng thái nào, chỉ là không đọc được mã.
    chuaKichHoat: usesActivationCode(user),
    loginFailures: asInt(user.login_failures),
    lockedUntil: locked ? user.locked_until : null,
    createdAt: user.created_at,
    linkedStudents: students.length,
  };

  let diagnosis;
  if (!account.active) diagnosis = "Tài khoản đang bị tắt nên mọi lần đăng nhập đều báo sai.";
  else if (account.role !== "parent") diagnosis = "Số này đang gắn với tài khoản nhà trường, không đăng nhập được ở cổng Phụ huynh.";
  else if (account.authProvider !== "local") diagnosis = "Tài khoản này đăng nhập bằng Microsoft 365, không dùng mật khẩu riêng.";
  else if (locked) diagnosis = `Đang tạm khóa 15 phút do đăng nhập sai ${account.loginFailures} lần. Hết khóa lúc ${account.lockedUntil} (giờ UTC).`;
  else if (account.activationCode) diagnosis = `Tài khoản chưa kích hoạt. Phụ huynh đăng nhập bằng chính số điện thoại, hoặc bằng mã đã cấp: ${account.activationCode}. Sau đó bắt buộc đặt mật khẩu riêng.`;
  else if (account.chuaKichHoat) diagnosis = "Tài khoản chưa kích hoạt. Phụ huynh đăng nhập bằng chính số điện thoại của mình, hoặc bằng mã đã được cấp, rồi đặt mật khẩu riêng.";
  else if (account.mustChangePassword) diagnosis = "Tài khoản chưa kích hoạt. Phụ huynh đăng nhập bằng chính số điện thoại của mình rồi đặt mật khẩu riêng.";
  else diagnosis = "Phụ huynh đã đổi sang mật khẩu riêng. Nếu quên thì bấm đặt lại — mật khẩu trở về chính số điện thoại và phải đổi ngay lần sau.";
  if (!students.length) diagnosis += " Lưu ý: tài khoản chưa liên kết học sinh nào nên sau khi vào sẽ không thấy con.";

  return { input, normalized, found: true, account, students, directory, diagnosis };
}

// Đặt lại đúng về trạng thái mà đồng bộ tạo ra: mật khẩu là số điện thoại và
// bắt buộc đổi ngay lần đăng nhập kế tiếp. Quản trị không tự chọn mật khẩu.
async function resetInitialPassword({ actorUserId, rawAccount }) {
  const input = String(rawAccount || "").trim();
  const normalized = toVietnameseLocalPhone(input);
  if (!normalized) throw httpError(422, "ACCOUNT_NOT_PHONE", "Chỉ đặt lại được cho tài khoản phụ huynh dùng số điện thoại.");
  const user = businessStore
    ? await businessStore.findAccount(normalized)
    : db.prepare("SELECT * FROM users WHERE lower(account) = lower(?)").get(normalized) || null;
  if (!user) throw httpError(404, "ACCOUNT_NOT_FOUND", "Không tìm thấy tài khoản phụ huynh cho số này.");
  if (user.role !== "parent") throw httpError(409, "ACCOUNT_NOT_PARENT", "Chỉ đặt lại được mật khẩu của tài khoản phụ huynh.");
  if (user.auth_provider !== "local") throw httpError(409, "ACCOUNT_NOT_LOCAL", "Tài khoản này đăng nhập bằng Microsoft 365.");

  // Đưa về đúng trạng thái mà đồng bộ tạo ra: mật khẩu khởi tạo là số điện thoại,
  // bắt buộc đổi ngay lần đăng nhập kế tiếp. Xoá luôn mã kích hoạt cũ nếu có —
  // để một tài khoản chỉ có đúng một cách vào, không để lại lối cũ còn hiệu lực.
  if (businessStore) await businessStore.setActivationCode(user.id, null);
  else {
    db.prepare(`UPDATE users SET password_salt = '', password_hash = '', activation_code = NULL,
      must_change_password = 1, login_failures = 0, locked_until = NULL, active = 1 WHERE id = ?`)
      .run(user.id);
  }
  await writeAudit({
    actorUserId,
    action: "RESET_INITIAL_PASSWORD",
    entityType: "user",
    entityId: user.id,
    // Không bao giờ ghi mã vào nhật ký: nhật ký được xuất ra ngoài khi sao lưu.
    before: { mustChangePassword: Boolean(user.must_change_password), loginFailures: asInt(user.login_failures), lockedUntil: user.locked_until || null },
    after: { mustChangePassword: true, loginFailures: 0, lockedUntil: null, initialPasswordRestored: true },
    reason: "Hỗ trợ phụ huynh không đăng nhập được",
  });
  // Không trả mật khẩu về: nó chính là số điện thoại người gọi vừa nhập vào.
  return { account: normalized, mustChangePassword: true, initialPassword: "so-dien-thoai" };
}

// ---- Xuất toàn bộ dữ liệu ----
//
// Một định dạng duy nhất, không phụ thuộc nền lưu trữ, dùng cho ba việc: chuyển
// dữ liệu sang nền khác, sao lưu định kỳ, và phương án xuất dữ liệu khẩn cấp.
// Tên trường theo kiểu camelCase để nạp vào nền nào cũng như nhau.
//
// Xuất theo từng trang vì phản hồi của serverless function có giới hạn kích thước;
// gộp cả nghìn học sinh, đơn đăng ký và audit log vào một phản hồi là chạm trần.
const BACKUP_SCHEMA_VERSION = 1;
const BACKUP_COLLECTIONS = [
  "users", "students", "parentStudents", "registrationPeriods", "clubs",
  "clubClasses", "registrations", "supportRequests", "auditLogs", "classCounters",
];
const BACKUP_PAGE_SIZE = 500;

const asBool = (value) => value === true || value === 1;
const parseJsonField = (value, fallback) => {
  if (value === null || value === undefined || value === "") return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};

function sqliteBackupData() {
  const all = (sql) => db.prepare(sql).all();
  return {
    users: all(`SELECT id, account, display_name, email, role, password_salt, password_hash, auth_provider,
      microsoft_object_id, must_change_password, login_failures, locked_until, active, created_at FROM users`)
      .map((row) => ({
        id: row.id, account: row.account, accountLower: String(row.account || "").toLowerCase(),
        displayName: row.display_name, email: row.email || null, role: row.role,
        passwordSalt: row.password_salt || null, passwordHash: row.password_hash || null,
        authProvider: row.auth_provider, microsoftObjectId: row.microsoft_object_id || null,
        mustChangePassword: asBool(row.must_change_password), loginFailures: asInt(row.login_failures),
        lockedUntil: row.locked_until || null, active: asBool(row.active), createdAt: row.created_at,
      })),
    students: all("SELECT id, code, name, date_of_birth, grade, homeroom, level, status FROM students")
      .map((row) => ({
        id: row.id, code: row.code, name: row.name, dateOfBirth: row.date_of_birth || null,
        grade: asInt(row.grade), homeroom: row.homeroom, level: row.level, status: row.status,
      })),
    parentStudents: all("SELECT parent_user_id, student_id, relationship FROM parent_students")
      .map((row) => ({
        id: `${row.parent_user_id}_${row.student_id}`,
        parentUserId: row.parent_user_id, studentId: row.student_id, relationship: row.relationship,
      })),
    registrationPeriods: all(`SELECT id, name, school_year, term, open_at, close_at, status,
      max_clubs_per_student, note, updated_at FROM registration_periods`)
      .map((row) => ({
        id: row.id, name: row.name, schoolYear: row.school_year, term: row.term,
        openAt: row.open_at, closeAt: row.close_at, status: row.status,
        maxClubsPerStudent: asInt(row.max_clubs_per_student) || 3, note: row.note || "", updatedAt: row.updated_at || null,
      })),
    clubs: all("SELECT id, code, name, category, description, emoji, visual, grades_json, sort_order, active FROM clubs")
      .map((row) => ({
        id: row.id, code: row.code, name: row.name, category: row.category, description: row.description,
        emoji: row.emoji, visual: row.visual, grades: parseJsonField(row.grades_json, []),
        sortOrder: asInt(row.sort_order), active: asBool(row.active),
      })),
    clubClasses: all(`SELECT id, club_id, period_id, name, day_of_week, start_time, end_time, schedule_label,
      grades_json, room, teacher, capacity, min_capacity, enrolled_base, fee, waitlist_enabled, sort_order, active
      FROM club_classes`)
      .map((row) => ({
        id: row.id, clubId: row.club_id, periodId: row.period_id, name: row.name || "",
        dayOfWeek: asInt(row.day_of_week), startTime: row.start_time, endTime: row.end_time,
        scheduleLabel: row.schedule_label, grades: parseJsonField(row.grades_json, []),
        room: row.room, teacher: row.teacher, capacity: asInt(row.capacity), minCapacity: asInt(row.min_capacity),
        enrolledBase: asInt(row.enrolled_base), fee: asInt(row.fee),
        waitlistEnabled: asBool(row.waitlist_enabled), sortOrder: asInt(row.sort_order), active: asBool(row.active),
      })),
    registrations: all(`SELECT r.id, r.group_id, r.student_id, r.parent_user_id, r.class_id, r.period_id, r.status,
      r.fee_snapshot, r.fee_paid, r.schedule_snapshot, r.terms_accepted_at, r.created_at, r.updated_at,
      cc.club_id, cc.day_of_week, cc.start_time, cc.end_time
      FROM registrations r LEFT JOIN club_classes cc ON cc.id = r.class_id`)
      .map((row) => ({
        id: row.id, groupId: row.group_id, studentId: row.student_id, parentUserId: row.parent_user_id,
        classId: row.class_id, clubId: row.club_id || null, periodId: row.period_id || null, status: row.status,
        feeSnapshot: asInt(row.fee_snapshot), feePaid: asInt(row.fee_paid) === 1,
        scheduleSnapshot: row.schedule_snapshot,
        termsAcceptedAt: row.terms_accepted_at || null, createdAt: row.created_at, updatedAt: row.updated_at,
        dayOfWeek: row.day_of_week ?? null, startTime: row.start_time || null, endTime: row.end_time || null,
      })),
    supportRequests: all("SELECT id, parent_user_id, registration_id, topic, message, status, created_at FROM support_requests")
      .map((row) => ({
        id: row.id, parentUserId: row.parent_user_id, registrationId: row.registration_id || null,
        topic: row.topic, message: row.message, status: row.status, createdAt: row.created_at,
      })),
    auditLogs: all(`SELECT id, actor_user_id, action, entity_type, entity_id, before_json, after_json, reason, created_at
      FROM audit_logs`)
      .map((row) => ({
        id: row.id, actorUserId: row.actor_user_id, action: row.action, entityType: row.entity_type,
        entityId: row.entity_id, before: parseJsonField(row.before_json, null), after: parseJsonField(row.after_json, null),
        reason: row.reason || null, createdAt: row.created_at,
      })),
    classCounters: all(`SELECT cc.id, cc.enrolled_base + COALESCE(SUM(
      CASE WHEN r.status IN (${SEAT_HOLDING_SQL}) THEN 1 ELSE 0 END), 0) AS enrolled
      FROM club_classes cc LEFT JOIN registrations r ON r.class_id = cc.id GROUP BY cc.id`)
      .map((row) => ({ id: row.id, classId: row.id, enrolledCount: asInt(row.enrolled), updatedAt: nowIso() })),
  };
}

async function exportCollectionPage({ actorUserId, collection, after = null, limit = BACKUP_PAGE_SIZE }) {
  if (!BACKUP_COLLECTIONS.includes(collection)) {
    throw httpError(400, "UNKNOWN_COLLECTION", `Không có nhóm dữ liệu "${collection}".`);
  }
  let auditLogged = false;
  if (!after && collection === BACKUP_COLLECTIONS[0]) {
    // Xuất dữ liệu là thao tác chỉ đọc và phải chạy được cả khi cơ sở dữ liệu đang
    // không ghi được. Ghi log là việc nên làm, không phải điều kiện để xuất.
    try {
      await writeAudit({
        actorUserId, action: "EXPORT_FULL_BACKUP", entityType: "backup",
        entityId: `backup_${nowIso()}`, after: { dataBackend: DATA_BACKEND }, reason: "Xuất toàn bộ dữ liệu",
      });
      auditLogged = true;
    } catch (error) {
      console.error("Không ghi được audit log cho lần xuất dữ liệu:", error?.message);
    }
  }

  const page = businessStore
    ? await businessStore.exportCollection(collection, { after, limit })
    : (() => {
      const rows = sqliteBackupData()[collection].slice()
        .sort((left, right) => String(left.id).localeCompare(String(right.id)));
      const start = after ? rows.findIndex((row) => String(row.id) > String(after)) : 0;
      const slice = start < 0 ? [] : rows.slice(start, start + limit);
      return { rows: slice, nextAfter: slice.length === limit ? slice[slice.length - 1].id : null };
    })();

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    collection,
    rows: page.rows,
    count: page.rows.length,
    nextAfter: page.nextAfter,
    auditLogged,
    source: { dataBackend: DATA_BACKEND, projectId: DATA_BACKEND === "firestore" ? FIREBASE_PROJECT_ID : null },
  };
}

/**
 * Cấp mã kích hoạt cho mọi tài khoản phụ huynh chưa đặt mật khẩu riêng.
 *
 * Chỉ cấp cho tài khoản CHƯA có mã, nên chạy lại nhiều lần cũng không làm hỏng
 * những mã đã in và phát ra ngoài. Danh sách trả về để nhà trường in và phát;
 * đây là dữ liệu nhạy cảm nên mỗi lần lấy đều ghi vào nhật ký thao tác.
 */
async function issueActivationCodes({ actorUserId }) {
  const pending = businessStore
    ? await businessStore.listPendingActivations()
    : db.prepare(`SELECT u.id, u.account, u.display_name AS displayName, u.activation_code AS activationCode
        FROM users u
        WHERE u.role = 'parent' AND u.must_change_password = 1
          AND (u.password_hash IS NULL OR u.password_hash = '')
        ORDER BY u.account`).all();

  let issued = 0;
  const rows = [];
  for (const account of pending) {
    let code = account.activationCode;
    if (!code) {
      code = generateActivationCode();
      if (businessStore) await businessStore.setActivationCode(account.id, code);
      else {
        db.prepare("UPDATE users SET activation_code = ? WHERE id = ?").run(code, account.id);
      }
      issued += 1;
    }
    const students = businessStore
      ? await businessStore.listStudentsByParent(account.id)
      : db.prepare(`SELECT s.name, s.homeroom FROM students s
          JOIN parent_students ps ON ps.student_id = s.id
          WHERE ps.parent_user_id = ? ORDER BY s.grade, s.name`).all(account.id);
    rows.push({
      account: account.account,
      displayName: account.displayName,
      students: students.map((student) => `${student.name} (${student.homeroom})`).join("; "),
      activationCode: formatActivationCode(code),
    });
  }

  // Ghi log là việc nên làm, không phải điều kiện để lấy danh sách: nếu cơ sở dữ
  // liệu đang không ghi được thì nhà trường vẫn phải phát được mã cho phụ huynh.
  let auditLogged = false;
  try {
    await writeAudit({
      actorUserId,
      action: "ISSUE_ACTIVATION_CODES",
      entityType: "user",
      entityId: `bulk_${nowIso()}`,
      after: { pending: rows.length, issued },
      reason: "Cấp và in mã kích hoạt cho phụ huynh",
    });
    auditLogged = true;
  } catch (error) {
    console.error("Không ghi được nhật ký cho lần cấp mã kích hoạt:", error?.message);
  }

  return { pending: rows.length, issued, auditLogged, rows };
}

async function handleApi(req, res, url) {
  const method = req.method || "GET";

  if (!["GET", "HEAD", "OPTIONS"].includes(method) && req.headers.origin) {
    const origin = new URL(req.headers.origin);
    if (origin.host !== req.headers.host) throw httpError(403, "INVALID_ORIGIN", "Yêu cầu không đến từ miền ứng dụng hợp lệ.");
  }

  if (method === "GET" && url.pathname === "/api/health") {
    await ensureBusinessStore();
    return sendJson(res, 200, {
      ok: true,
      service: "nshm-clubs",
      dataBackend: DATA_BACKEND,
      // Cờ này phải phản ánh việc dữ liệu mẫu có thật sự được tạo hay không, chứ không
      // suy từ tên nền lưu trữ: nền thật không bao giờ bật NSHM_SEED_DEMO.
      demoAccounts: DATA_BACKEND === "sqlite" || SEED_DEMO_DATA,
      firebaseProjectId: DATA_BACKEND === "firestore" ? FIREBASE_PROJECT_ID : undefined,
      time: nowIso(),
    });
  }

  await ensureBusinessStore();

  if (method === "POST" && url.pathname === "/api/auth/login") {
    const { account = "", password = "" } = await readJson(req);
    const rawAccount = String(account).trim();
    const normalizedAccount = toVietnameseLocalPhone(rawAccount) || rawAccount.toLowerCase();
    const user = businessStore ? await businessStore.getUserByAccount(normalizedAccount) : db.prepare("SELECT * FROM users WHERE lower(account) = lower(?) AND active = 1").get(normalizedAccount);
    if (user?.locked_until && user.locked_until > nowIso()) {
      throw httpError(429, "ACCOUNT_TEMPORARILY_LOCKED", "Tài khoản tạm khóa do đăng nhập sai nhiều lần. Vui lòng thử lại sau 15 phút.");
    }
    const passwordValid = user?.auth_provider === "local" && (usesInitialCredential(user)
      ? initialCredentialValid(user, password)
      : verifyPassword(String(password), user.password_salt, user.password_hash));
    if (!user || !passwordValid) {
      if (user) {
        const failures = Number(user.login_failures || 0) + 1;
        const lockedUntil = failures >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
        if (businessStore) await businessStore.recordLoginFailure(user.id, failures, lockedUntil);
        else db.prepare("UPDATE users SET login_failures = ?, locked_until = ? WHERE id = ?").run(failures, lockedUntil, user.id);
      }
      throw httpError(401, "INVALID_CREDENTIALS", "Tài khoản hoặc mật khẩu không đúng.");
    }
    // Chỉ ghi khi thực sự có gì để xóa: đăng nhập đúng ngay lần đầu là trường hợp
    // phổ biến nhất, không nên tốn một lượt ghi cơ sở dữ liệu cho mỗi lần như vậy.
    if (asInt(user.login_failures) > 0 || user.locked_until) {
      if (businessStore) await businessStore.resetLoginFailures(user.id);
      else db.prepare("UPDATE users SET login_failures = 0, locked_until = NULL WHERE id = ?").run(user.id);
    }
    return sendJson(res, 200, { user: publicUser(user) }, { "Set-Cookie": await createSession(user) });
  }

  if (method === "GET" && url.pathname === "/api/auth/microsoft/status") {
    return sendJson(res, 200, { microsoft: microsoftAuth.getStatus() });
  }

  if (method === "GET" && url.pathname === "/api/auth/microsoft/start") {
    const request = await microsoftAuth.createAuthorizationRequest();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    if (businessStore) {
      await businessStore.saveOauthState({ state: request.state, nonce: request.nonce, codeVerifier: request.codeVerifier, expiresAt, createdAt: nowIso() });
    } else {
      db.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").run(nowIso());
      db.prepare("INSERT INTO oauth_states (state, nonce, code_verifier, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(request.state, request.nonce, request.codeVerifier, expiresAt, nowIso());
    }
    res.writeHead(302, { Location: request.url, "Cache-Control": "no-store" });
    return res.end();
  }

  if (method === "GET" && url.pathname === "/api/auth/microsoft/callback") {
    const state = String(url.searchParams.get("state") || "");
    const code = String(url.searchParams.get("code") || "");
    const oauthError = String(url.searchParams.get("error") || "");
    if (oauthError || !state || !code) throw httpError(401, "MICROSOFT_SSO_CANCELLED", "Đăng nhập Microsoft 365 đã bị hủy hoặc không hợp lệ.");
    const saved = businessStore ? await businessStore.consumeOauthState(state, nowIso()) : db.prepare("SELECT * FROM oauth_states WHERE state = ? AND expires_at > ?").get(state, nowIso());
    if (!businessStore) db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
    if (!saved) throw httpError(401, "MICROSOFT_STATE_INVALID", "Phiên đăng nhập Microsoft 365 không hợp lệ hoặc đã hết hạn.");
    const identity = await microsoftAuth.exchangeCode({ code, state, nonce: saved.nonce, codeVerifier: saved.codeVerifier || saved.code_verifier });

    const email = normalizeAccount(identity.email);
    const timestamp = nowIso();
    let user = await findSchoolUserForLogin({ objectId: identity.objectId, email });
    const decision = decideSchoolLogin({
      user, email, superadminAccounts: SUPERADMIN_ACCOUNTS,
      isActive: (record) => asInt(record.active) === 1,
    });

    if (!decision.allow) {
      // Ghi lại kèm email để bộ phận CNTT biết ai đang cần cấp quyền mà chủ động liên hệ.
      await writeAudit({
        actorUserId: null, action: "SSO_LOGIN_DENIED", entityType: "school_account",
        entityId: email, after: { email, reason: decision.reason, name: identity.name || "" },
      });
      console.warn(`[dang-nhap] từ chối ${email}: ${decision.reason}`);
      res.writeHead(302, { Location: `/?sso=${decision.reason}`, "Cache-Control": "no-store" });
      return res.end();
    }

    if (decision.action === "tao-moi") {
      // Chỉ xảy ra với email trong SUPERADMIN_ACCOUNTS chưa có bản ghi.
      const userId = `u_ms_${identity.objectId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || randomBytes(8).toString("hex")}`;
      user = await createSchoolUser({
        id: userId, account: email, displayName: identity.name || email,
        role: decision.role, timestamp, objectId: identity.objectId,
      });
      await writeAudit({
        actorUserId: user.id, action: "SCHOOL_ACCOUNT_BOOTSTRAPPED", entityType: "school_account",
        entityId: user.id, after: { email, role: decision.role },
        reason: "Email nằm trong SUPERADMIN_ACCOUNTS nhưng chưa có bản ghi.",
      });
    } else {
      if (decision.reactivate) {
        await setSchoolUserActive(user.id, true);
        await writeAudit({
          actorUserId: user.id, action: "SCHOOL_ACCOUNT_REACTIVATED", entityType: "school_account",
          entityId: user.id, after: { email, active: true },
          reason: "Đường cứu: email nằm trong SUPERADMIN_ACCOUNTS.",
        });
      }
      user = await linkMicrosoftLogin({ userId: user.id, identity, timestamp });
    }

    res.writeHead(302, { Location: "/?sso=success", "Set-Cookie": await createSession(user), "Cache-Control": "no-store" });
    return res.end();
  }

  if (method === "POST" && url.pathname === "/api/auth/logout") {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) {
      if (businessStore) await businessStore.deleteSession(sessionStorageKey(token));
      else db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    }
    return sendJson(res, 200, { ok: true }, { "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` });
  }

  if (method === "POST" && url.pathname === "/api/auth/change-initial-password") {
    const user = await requireUser(req, "parent", true);
    const { newPassword = "" } = await readJson(req);
    const password = String(newPassword);
    if (!user.must_change_password) throw httpError(409, "PASSWORD_ALREADY_CHANGED", "Mật khẩu khởi tạo đã được thay đổi.");
    const validation = validatePasswordPolicy(password, user.account);
    if (!validation.valid) throw httpError(422, validation.code, validation.message);
    const secured = hashPassword(password);
    const updatedUser = businessStore ? await businessStore.updatePassword(user.id, secured) : (() => {
      // Đặt mật khẩu riêng xong là mã kích hoạt hết hiệu lực ngay.
      db.prepare("UPDATE users SET password_salt = ?, password_hash = ?, activation_code = NULL, must_change_password = 0, login_failures = 0, locked_until = NULL WHERE id = ?")
        .run(secured.salt, secured.hash, user.id);
      return db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    })();
    return sendJson(res, 200, { user: publicUser(updatedUser) });
  }

  // Đổi mật khẩu khi đang dùng hệ thống, khác với lần đổi bắt buộc ở trên. Ở đây
  // BẮT BUỘC nhập mật khẩu hiện tại: nếu không, ai mượn được máy đang mở sẵn phiên
  // là đổi khoá và chiếm luôn tài khoản của phụ huynh.
  //
  // Chỉ mở cho phụ huynh. Nhân sự nhà trường đăng nhập bằng Microsoft 365, mật
  // khẩu do hệ thống của trường giữ, ứng dụng này không có gì để đổi.
  if (method === "POST" && url.pathname === "/api/auth/change-password") {
    const user = await requireUser(req, "parent");
    const { currentPassword = "", newPassword = "" } = await readJson(req);
    if (user.auth_provider !== "local") {
      throw httpError(400, "SSO_ACCOUNT", "Tài khoản này đăng nhập bằng Microsoft 365, đổi mật khẩu tại hệ thống tài khoản của nhà trường.");
    }
    if (user.locked_until && user.locked_until > nowIso()) {
      throw httpError(429, "ACCOUNT_TEMPORARILY_LOCKED", "Tài khoản tạm khóa do nhập sai nhiều lần. Vui lòng thử lại sau 15 phút.");
    }
    // Tài khoản còn must_change_password không tới được đây: requireUser đã đẩy về
    // luồng đổi bắt buộc. Nên tới đây mật khẩu hiện tại luôn là hash scrypt.
    if (!verifyPassword(String(currentPassword), user.password_salt, user.password_hash)) {
      // Đếm chung bộ đếm với đăng nhập, nếu không đây thành lối dò mật khẩu không
      // giới hạn cho bất kỳ ai mượn được một phiên đang mở.
      const failures = asInt(user.login_failures) + 1;
      const lockedUntil = failures >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
      if (businessStore) await businessStore.recordLoginFailure(user.id, failures, lockedUntil);
      else db.prepare("UPDATE users SET login_failures = ?, locked_until = ? WHERE id = ?").run(failures, lockedUntil, user.id);
      throw httpError(401, "INVALID_CURRENT_PASSWORD", "Mật khẩu hiện tại không đúng.");
    }
    const password = String(newPassword);
    const validation = validatePasswordPolicy(password, user.account);
    if (!validation.valid) throw httpError(422, validation.code, validation.message);
    if (verifyPassword(password, user.password_salt, user.password_hash)) {
      throw httpError(422, "PASSWORD_UNCHANGED", "Mật khẩu mới phải khác mật khẩu hiện tại.");
    }
    const secured = hashPassword(password);
    const changedUser = businessStore ? await businessStore.updatePassword(user.id, secured) : (() => {
      db.prepare("UPDATE users SET password_salt = ?, password_hash = ?, activation_code = NULL, must_change_password = 0, login_failures = 0, locked_until = NULL WHERE id = ?")
        .run(secured.salt, secured.hash, user.id);
      return db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    })();
    // Ghi việc đã xảy ra, tuyệt đối không ghi mật khẩu vào nhật ký.
    await writeAudit({ actorUserId: user.id, action: "CHANGE_OWN_PASSWORD", entityType: "user", entityId: user.id });
    return sendJson(res, 200, { user: publicUser(changedUser) });
  }

  if (method === "GET" && url.pathname === "/api/me") return sendJson(res, 200, { user: publicUser(await requireUser(req, undefined, true)) });

  if (method === "GET" && url.pathname === "/api/students") {
    const user = await requireUser(req, "parent");
    const rows = businessStore ? await businessStore.listStudentsByParent(user.id) : db.prepare(`SELECT s.id, s.code, s.name, s.date_of_birth AS dateOfBirth, s.grade, s.homeroom, s.level, ps.relationship
      FROM students s JOIN parent_students ps ON ps.student_id = s.id WHERE ps.parent_user_id = ? AND s.status = 'active' ORDER BY s.grade, s.name`).all(user.id);
    return sendJson(res, 200, { students: rows.map((row, index) => ({ ...row, short: row.name.split(" ").slice(-2).map((part) => part[0]).join(""), color: index % 2 ? "aqua" : "blue", gradeLabel: `Lớp ${row.homeroom}` })) });
  }

  if (method === "GET" && url.pathname === "/api/clubs") {
    const user = await requireUser(req);
    const studentId = url.searchParams.get("studentId");
    if (user.role === "parent" && studentId) {
      const owns = businessStore ? await businessStore.parentOwnsStudent(user.id, studentId) : db.prepare("SELECT 1 FROM parent_students WHERE parent_user_id = ? AND student_id = ?").get(user.id, studentId);
      if (!owns) throw httpError(403, "STUDENT_SCOPE", "Bạn không có quyền xem dữ liệu của học sinh này.");
    }
    const active = await getActivePeriod();
    // Phụ huynh chỉ thấy lớp thuộc đợt đang mở; quản trị có thể xem theo đợt bất kỳ.
    const periodId = user.role !== "parent" ? url.searchParams.get("periodId") || active?.id || null : active?.id || null;
    if (user.role === "parent" && !periodId) return sendJson(res, 200, { clubs: [], period: null });
    return sendJson(res, 200, { clubs: await clubRows(studentId, periodId), period: publicPeriod(active) });
  }

  if (method === "GET" && url.pathname === "/api/period") {
    await requireUser(req);
    return sendJson(res, 200, { period: publicPeriod(await getActivePeriod()), serverTime: nowIso() });
  }

  if (method === "GET" && url.pathname === "/api/registrations") {
    const user = await requireUser(req);
    // Phụ huynh chỉ nhận đơn của chính con mình, và mã học sinh với ngày sinh của
    // con thì họ đã xem được qua /api/students. Người của nhà trường thì phải có
    // quyền duyệt đơn — đúng quyền đang chắn trang "Đơn đăng ký".
    const includeStudentIdentity = user.role === "parent"
      || can(effectiveRole(user, SUPERADMIN_ACCOUNTS), CAP.duyetDon);
    return sendJson(res, 200, {
      registrations: await listRegistrations(user, url.searchParams.get("status"), { includeStudentIdentity }),
    });
  }

  if (method === "POST" && url.pathname === "/api/registrations/validate") {
    const user = await requireUser(req, "parent");
    const { studentId, clubIds } = await readJson(req);
    return sendJson(res, 200, await validateRegistration(user, studentId, clubIds));
  }

  if (method === "POST" && url.pathname === "/api/registrations") {
    const user = await requireUser(req, "parent");
    const { studentId, clubIds, acceptedTerms } = await readJson(req);
    if (!acceptedTerms) throw httpError(422, "TERMS_REQUIRED", "Vui lòng xác nhận lịch, phí và quy định đổi/hủy.");
    const validation = await validateRegistration(user, studentId, clubIds);
    if (!validation.valid) throw httpError(422, "VALIDATION_FAILED", "Đăng ký chưa hợp lệ.", validation.issues);
const groupId = maTheoNgay("GR");
    const taoMaDon = () => maTheoNgay("DK");
    const registrationIds = validation.clubs.map(taoMaDon);
    const timestamp = nowIso();

    if (businessStore) {
      const created = await businessStore.createRegistrations({ actorUserId: user.id, studentId, groupId, periodId: validation.period.id, clubs: validation.clubs, registrationIds, taoMaDon, timestamp });
      return sendJson(res, 201, { groupId, registrations: created });
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      const created = [];
      const insert = db.prepare(`INSERT INTO registrations
        (id, group_id, student_id, parent_user_id, class_id, period_id, status, fee_snapshot, schedule_snapshot, terms_accepted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (let index = 0; index < validation.clubs.length; index += 1) {
        const club = validation.clubs[index];
        const refreshed = (await clubRows(studentId, validation.period.id)).find((item) => item.id === club.id);
        const status = refreshed.enrolled >= refreshed.capacity ? "waitlist" : "payment";
        const registrationId = maDonConTrong(registrationIds[index], taoMaDon);
        insert.run(registrationId, groupId, studentId, user.id, club.id, validation.period.id, status, club.fee, club.schedule, timestamp, timestamp, timestamp);
        db.prepare(`INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, after_json, created_at)
          VALUES (?, ?, 'CREATE_REGISTRATION', 'registration', ?, ?, ?)`)
          .run(id("audit"), user.id, registrationId, JSON.stringify({ status, clubId: club.id, studentId }), timestamp);
        created.push({ id: registrationId, status, clubId: club.id });
      }
      db.exec("COMMIT");
      return sendJson(res, 201, { groupId, registrations: created });
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  if (method === "POST" && url.pathname === "/api/support-requests") {
    const user = await requireUser(req, "parent");
    const { registrationId = null, topic = "Hỗ trợ đăng ký", message = "" } = await readJson(req);
    if (String(message).trim().length < 10) throw httpError(422, "MESSAGE_REQUIRED", "Vui lòng mô tả yêu cầu tối thiểu 10 ký tự.");
    const requestId = maTheoNgay("HT");
    const supportRequest = {
      id: requestId,
      parentUserId: user.id,
      registrationId: registrationId || null,
      topic: String(topic).trim(),
      message: String(message).trim(),
      status: "open",
      createdAt: nowIso(),
    };
    if (businessStore) await businessStore.createSupportRequest(supportRequest);
    else db.prepare("INSERT INTO support_requests (id, parent_user_id, registration_id, topic, message, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(requestId, user.id, registrationId || null, supportRequest.topic, supportRequest.message, supportRequest.createdAt);
    return sendJson(res, 201, { id: requestId, status: "open" });
  }

  if (method === "GET" && url.pathname === "/api/admin/dashboard") {
    await requireSchoolUser(req, CAP.baoCao);
    return sendJson(res, 200, { dashboard: await dashboardData() });
  }

  if (method === "GET" && url.pathname === "/api/admin/integrations/google-sheets") {
    await requireSchoolUser(req, CAP.dongBoDanhBa);
    return sendJson(res, 200, {
      integration: {
        ...directorySource.getStatus(),
        schedule: syncScheduler.getStatus(),
        // Kèm số liệu đọc từ cơ sở dữ liệu, để màn hình phân biệt được "tiến trình
        // chưa chạy lần nào kể từ lúc bật" với "hệ thống chưa có dữ liệu".
        stored: await directorySummary(),
      },
    });
  }

  if (method === "POST" && url.pathname === "/api/admin/integrations/google-sheets/preview") {
    await requireSchoolUser(req, CAP.dongBoDanhBa);
    return sendJson(res, 200, { preview: await directorySource.preview() });
  }

  if (method === "POST" && url.pathname === "/api/admin/integrations/google-sheets/sync") {
    const user = await requireSchoolUser(req, CAP.dongBoDanhBa);
    const { confirmation = "" } = await readJson(req);
    if (confirmation !== "SYNC_STUDENT_DIRECTORY") throw httpError(422, "SYNC_CONFIRMATION_REQUIRED", "Cần xác nhận rõ trước khi đồng bộ danh bạ học sinh.");
    // Đi qua bộ hẹn giờ để lượt bấm tay không chồng lên lượt chạy theo lịch:
    // hai lượt ghi song song lên cùng bảng học sinh là chuyện phải tránh.
    const startedAt = Date.now();
    const result = await syncScheduler.runNow("thu-cong", { actorUserId: user.id });
    return sendJson(res, 200, { result: { ...result, elapsedMs: Date.now() - startedAt } });
  }

  // Nhập danh bạ học sinh từ file Excel. File được đọc NGAY TRONG TRÌNH DUYỆT bằng
  // public/sheet-reader.js rồi gửi lên dạng bảng ô chữ, nên máy chủ không phải nhận
  // tệp nhị phân, không có tệp tạm, và chỉ dữ liệu đã trích mới đi qua đường truyền.
  if (method === "POST" && url.pathname === "/api/admin/directory/excel/preview") {
    await requireSchoolUser(req, CAP.dongBoDanhBa);
    const payload = await readJson(req, EXCEL_IMPORT_LIMIT);
    const ketQua = buildExcelDirectory(payload.files || [], { mode: payload.mode || IMPORT_MODES.boSung });
    const dangCo = await countActiveStudents();
    return sendJson(res, 200, {
      preview: {
        mode: ketQua.mode,
        readyToSync: ketQua.readyToSync,
        allSourcesLoaded: ketQua.allSourcesLoaded,
        scannedRows: ketQua.scannedRows,
        duplicates: ketQua.duplicates,
        // Con số người vận hành cần để DÁM bấm ghi: đang có bao nhiêu em, file mang
        // vào bao nhiêu em, và ở chế độ đối chiếu thì bao nhiêu em sẽ bị cho nghỉ.
        studentsInFile: ketQua.snapshot.students.length,
        guardiansInFile: ketQua.snapshot.guardians.length,
        activeStudentsNow: dangCo,
        choPhepDoiChieu: CHO_PHEP_DOI_CHIEU,
        willDeactivate: chapNhanCoNghiHoc(ketQua.allSourcesLoaded) ? Math.max(0, dangCo - ketQua.snapshot.students.length) : 0,
        sources: ketQua.results.map((source) => ({
          key: source.key, label: source.label, ok: source.ok, error: source.error || null,
          headerRow: source.headerRow || null, headers: source.headers || [],
          mapping: source.mapping || {}, analysis: source.analysis || null,
        })),
      },
    });
  }

  if (method === "POST" && url.pathname === "/api/admin/directory/excel/commit") {
    const user = await requireSchoolUser(req, CAP.dongBoDanhBa);
    const payload = await readJson(req, EXCEL_IMPORT_LIMIT);
    const mode = payload.mode || IMPORT_MODES.boSung;

    // Chế độ đối chiếu có thể cho hàng nghìn em nghỉ học chỉ vì thiếu một file, nên
    // nó đòi một câu xác nhận riêng — bấm nhầm nút không đủ để kích hoạt.
    if (mode === IMPORT_MODES.doiChieu && !CHO_PHEP_DOI_CHIEU) {
      throw httpError(403, "DOI_CHIEU_DA_TAT",
        "Chế độ đối chiếu toàn trường đang tắt. Danh bạ nay do phần mềm làm chủ: thêm học sinh mới bằng tay "
        + "hoặc bằng chế độ bổ sung, và cho nghỉ học từng em ở màn danh bạ. Cần bật lại để làm sạch đầu năm "
        + "học thì đặt CHO_PHEP_DOI_CHIEU=1 trong .env và sao lưu trước.");
    }
    if (mode === IMPORT_MODES.doiChieu && payload.confirmation !== "DOI_CHIEU_TOAN_TRUONG") {
      throw httpError(422, "SYNC_CONFIRMATION_REQUIRED",
        "Chế độ đối chiếu toàn trường cần xác nhận rõ vì có thể cho học sinh nghỉ học hàng loạt.");
    }

    const ketQua = buildExcelDirectory(payload.files || [], { mode });
    if (!ketQua.results.some((source) => source.ok)) {
      throw httpError(422, "EXCEL_ALL_SOURCES_FAILED",
        `Không đọc được file nào trong ${ketQua.results.length} file đã chọn. ${ketQua.results[0]?.error || ""}`.trim());
    }

    const timestamp = nowIso();
    const context = {
      snapshot: ketQua.snapshot, actorUserId: user.id, timestamp, idFactory: id,
      source: { kind: "excel", mode, files: ketQua.results.map((item) => ({ key: item.key, label: item.label, ok: item.ok })) },
      analysis: { scannedRows: ketQua.scannedRows },
      allSourcesLoaded: chapNhanCoNghiHoc(ketQua.allSourcesLoaded),
    };
    // Đi qua cùng cái khóa với đồng bộ theo lịch: hai lượt ghi song song lên bảng
    // học sinh là chuyện phải tránh tuyệt đối.
    const result = await syncScheduler.runExclusive(() => (businessStore
      ? businessStore.syncDirectory(context)
      : syncDirectoryLocal(context)));
    return sendJson(res, 200, {
      result: {
        ...result, mode, allSourcesLoaded: ketQua.allSourcesLoaded,
        sources: ketQua.sources, duplicates: ketQua.duplicates,
      },
    });
  }

  // ------------------------------------------------- Nhập đăng ký hàng loạt
  //
  // Vài trăm em đã đóng phí và đang học từ đợt đăng ký qua Google Form trước khi có
  // cổng này. Hai đường dưới đây biến từng dòng của file Form thành một đơn thật.
  //
  // Gác bằng quyền duyet-don: đây là tạo đơn thay cho học sinh, cùng loại việc với
  // xác nhận phí và đổi trạng thái. Giáo vụ KHÔNG có quyền này.
  if (method === "POST" && url.pathname.startsWith("/api/admin/registrations/import/")) {
    if (!CHO_PHEP_NHAP_HANG_LOAT) {
      throw httpError(403, "NHAP_HANG_LOAT_DANG_KHOA",
        "Nhập đăng ký hàng loạt đang khoá vì tính năng chưa hoàn thiện — rà soát còn 10 lỗi nặng chưa vá. "
        + "Xem chú thích CHO_PHEP_NHAP_HANG_LOAT trong server.mjs.");
    }
  }

  if (method === "POST" && url.pathname === "/api/admin/registrations/import/preview") {
    await requireSchoolUser(req, CAP.duyetDon);
    const payload = await readJson(req, EXCEL_IMPORT_LIMIT);
    return sendJson(res, 200, {
      preview: await phanTichXepLop({
        files: payload.files || [], mapping: payload.mapping || {}, periodId: String(payload.periodId || ""),
        trangThai: ASSIGNABLE_STATUSES.includes(payload.status) ? payload.status : STATUS.dangHoc,
      }),
    });
  }

  if (method === "POST" && url.pathname === "/api/admin/registrations/import/commit") {
    const user = await requireSchoolUser(req, CAP.duyetDon);
    const payload = await readJson(req, EXCEL_IMPORT_LIMIT);
    if (payload.confirmation !== "NHAP_DANG_KY_HANG_LOAT") {
      throw httpError(422, "IMPORT_CONFIRMATION_REQUIRED",
        "Cần xác nhận rõ trước khi ghi hàng loạt đơn đăng ký vào hệ thống.");
    }
    const trangThai = ASSIGNABLE_STATUSES.includes(payload.status) ? payload.status : STATUS.dangHoc;

    // Cả lượt ghi đi qua CÙNG một khoá với đồng bộ danh bạ. Không có khoá thì hai
    // lượt bấm Ghi song song (mạng chậm, người dùng bấm lại) đều đọc "em này chưa có
    // đơn" rồi cùng chèn — đã đo trên MySQL thật: mỗi em HAI đơn, sĩ số vọt 22/20.
    //
    // Khoá này còn gánh một việc thứ hai: trên SQLite hai lượt ghi song song giành
    // nhau BEGIN IMMEDIATE và TREO hẳn. Thử gỡ khoá ra rồi chạy bài kiểm "bấm Ghi
    // hai lần cùng lúc" thì bộ kiểm thử đứng im tới khi hết giờ, không phải đỏ.
    return syncScheduler.runExclusive(async () => {
      // Phân tích LẠI từ dữ liệu thô, không tin kết quả trình duyệt gửi lên: giữa lúc
      // xem trước và lúc bấm ghi, một ca có thể đã bị tắt hoặc một em đã có đơn khác.
      const phanTich = await phanTichXepLop({
        files: payload.files || [], mapping: payload.mapping || {}, periodId: String(payload.periodId || ""),
        trangThai,
      });
      if (!phanTich.sanSang) {
        throw httpError(422, "IMPORT_NOT_READY",
          phanTich.filesHong ? "Còn file không đọc được, chưa thể ghi." : "Không có dòng nào xếp được.");
      }

      const xepDuoc = phanTich.rows.filter((row) => row.ketCuc === "xepDuoc");
      // Bản xem trước người ta vừa đọc phải khớp với thứ sắp ghi. Lệch đi mà cứ ghi
      // là ghi một số đơn khác với con số trên nút họ vừa bấm — đã đo: xem trước 40
      // dòng, có người tắt một ca giữa chừng, ghi xong chỉ còn 20 mà không báo gì.
      const soDaXem = Number(payload.soDongXepDuoc);
      if (Number.isFinite(soDaXem) && soDaXem !== xepDuoc.length) {
        throw httpError(409, "IMPORT_DA_DOI",
          `Dữ liệu đã đổi từ lúc bạn xem trước: khi đó ${soDaXem} dòng xếp được, bây giờ là ${xepDuoc.length}. `
          + "Hãy bấm Kiểm tra file lại để xem bản mới trước khi ghi.");
      }

      const daThuPhi = payload.feePaid !== false;
      // Chỉ hạ "ghi danh sẵn" khi trạng thái đích THỰC SỰ giữ chỗ. Nhập ở Chờ thanh
      // toán mà vẫn hạ là sĩ số tụt xuống thật, mở chỗ cho 4.445 học sinh khác giành.
      const haGhiDanhSan = payload.haGhiDanhSan !== false && phanTich.giuCho;

      const timestamp = nowIso();
      const groupId = maTheoNgay("NH");
      const ketQua = await nhapDangKyHangLoat({
        actorUserId: user.id, groupId, timestamp, trangThai, daThuPhi, haGhiDanhSan,
        periodId: phanTich.periodId, rows: xepDuoc, caAnhHuong: phanTich.caAnhHuong,
      });
      return sendJson(res, 200, {
        result: { ...ketQua, groupId, trangThai, daThuPhi, haGhiDanhSan, dem: phanTich.dem },
      });
    });
  }

  if (method === "GET" && url.pathname === "/api/admin/export/collections") {
    await requireSchoolUser(req, CAP.xuatDuLieu);
    return sendJson(res, 200, { collections: BACKUP_COLLECTIONS, pageSize: BACKUP_PAGE_SIZE, schemaVersion: BACKUP_SCHEMA_VERSION });
  }

  if (method === "POST" && url.pathname === "/api/admin/export/backup") {
    const user = await requireSchoolUser(req, CAP.xuatDuLieu);
    const { confirmation = "", collection = "", after = null } = await readJson(req);
    if (confirmation !== "EXPORT_FULL_BACKUP") {
      throw httpError(422, "EXPORT_CONFIRMATION_REQUIRED", "Cần xác nhận rõ trước khi xuất toàn bộ dữ liệu.");
    }
    const page = await exportCollectionPage({ actorUserId: user.id, collection: String(collection), after: after || null });
    return sendJson(res, 200, { page });
  }

  /* ---------- Quản lý tài khoản nhà trường (chỉ quản trị cao nhất) ---------- */

  if (method === "GET" && url.pathname === "/api/admin/school-accounts") {
    await requireSchoolUser(req, CAP.quanLyTaiKhoan);
    const search = normalizeAccount(url.searchParams.get("search") || "");
    const accounts = (await listSchoolUsers()).map(schoolUserView)
      .filter((account) => !search
        || normalizeAccount(account.account).includes(search)
        || normalizeAccount(account.displayName).includes(search));
    return sendJson(res, 200, {
      accounts,
      roles: ASSIGNABLE_SCHOOL_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] })),
      domain: MICROSOFT_ALLOWED_DOMAIN,
      // Bằng 0 nghĩa là chưa đặt SUPERADMIN_ACCOUNTS: mất đường cứu, phải cảnh báo.
      superadminCount: SUPERADMIN_ACCOUNTS.size,
    });
  }

  if (method === "POST" && url.pathname === "/api/admin/school-accounts") {
    const actor = await requireSchoolUser(req, CAP.quanLyTaiKhoan);
    const body = await readJson(req);
    const account = await createSchoolAccount(body, actor);
    return sendJson(res, 201, { account: schoolUserView(account) });
  }

  const schoolAccountMatch = url.pathname.match(/^\/api\/admin\/school-accounts\/([^/]+)$/);
  if (method === "PATCH" && schoolAccountMatch) {
    const actor = await requireSchoolUser(req, CAP.quanLyTaiKhoan);
    const target = await getUserById(schoolAccountMatch[1]);
    if (!target || target.role === ROLE.parent) throw httpError(404, "KHONG_TIM_THAY", "Không tìm thấy tài khoản nhà trường này.");
    const body = await readJson(req);

    // Tự vô hiệu hoá chính mình là cách nhanh nhất để không còn ai quản lý được
    // tài khoản. Đặt trước mọi kiểm tra khác để thông báo nói đúng nguyên nhân.
    if (body.active === false && target.id === actor.id) {
      throw httpError(409, "KHONG_TU_VO_HIEU_HOA", "Không thể tự vô hiệu hoá tài khoản của chính mình.");
    }

    // Vai trò cao nhất do biến môi trường quy định, sửa trong cơ sở dữ liệu sẽ bị
    // ghi đè ở lần đăng nhập kế tiếp — nói thẳng thay vì để người dùng tưởng đã đổi.
    assertSchoolAccountWritable(target);

    let updated = target;
    if (body.role !== undefined) {
      const role = normalizeSchoolRole(body.role);
      if (!role) throw httpError(422, "VAI_TRO_KHONG_HOP_LE", `Vai trò chỉ nhận: ${ASSIGNABLE_SCHOOL_ROLES.join(", ")}.`);
      if (role !== target.role) {
        updated = await setSchoolUserRole(target.id, role);
        await writeAudit({
          actorUserId: actor.id, action: "SCHOOL_ACCOUNT_ROLE_CHANGED", entityType: "school_account",
          entityId: target.id, before: { role: target.role }, after: { role },
          reason: String(body.reason || "").trim() || null,
        });
      }
    }

    if (body.active !== undefined) {
      const active = Boolean(body.active);
      if (active !== (asInt(updated.active) === 1)) {
        updated = await setSchoolUserActive(target.id, active);
        await writeAudit({
          actorUserId: actor.id,
          action: active ? "SCHOOL_ACCOUNT_REACTIVATED" : "SCHOOL_ACCOUNT_DEACTIVATED",
          entityType: "school_account", entityId: target.id,
          before: { active: asInt(target.active) === 1 }, after: { active },
          reason: String(body.reason || "").trim() || null,
        });
      }
    }

    return sendJson(res, 200, { account: schoolUserView(updated) });
  }

  if (method === "POST" && url.pathname === "/api/admin/school-accounts/import/preview") {
    await requireSchoolUser(req, CAP.quanLyTaiKhoan);
    const payload = await readJson(req, 4_000_000);
    const { headers, rows } = readSchoolAccountImportPayload(payload);
    const existing = (await listSchoolUsers()).map(schoolUserView);
    return sendJson(res, 200, {
      preview: analyzeSchoolAccountImport({ headers, rows, existing, domain: MICROSOFT_ALLOWED_DOMAIN }),
    });
  }

  if (method === "POST" && url.pathname === "/api/admin/school-accounts/import/commit") {
    const actor = await requireSchoolUser(req, CAP.quanLyTaiKhoan);
    const payload = await readJson(req, 4_000_000);
    const { headers, rows } = readSchoolAccountImportPayload(payload);
    const existing = (await listSchoolUsers()).map(schoolUserView);
    const analysis = analyzeSchoolAccountImport({ headers, rows, existing, domain: MICROSOFT_ALLOWED_DOMAIN });
    if (analysis.missing.length) throw httpError(422, "THIEU_COT", `Thiếu cột bắt buộc: ${analysis.missing.join(", ")}.`);
    // Còn dòng lỗi thì không ghi gì: nhập nửa vời để lại một danh sách mà không
    // ai biết đã vào tới đâu.
    if (analysis.summary.invalid > 0) {
      throw httpError(422, "CON_DONG_LOI", `Còn ${analysis.summary.invalid} dòng chưa hợp lệ. Hãy sửa tệp rồi kiểm tra lại.`);
    }

    const counters = { created: 0, updated: 0, unchanged: analysis.summary.unchanged, skipped: analysis.summary.skipped };
    for (const entry of analysis.entries) {
      if (entry.action === "tao-moi") {
        await createSchoolAccount(
          { email: entry.email, displayName: entry.displayName, role: entry.role },
          actor,
          { source: "nhap-tep" },
        );
        counters.created += 1;
      } else if (entry.action === "cap-nhat") {
        // Cùng một lá chắn với nhánh PATCH. Hai đường ghi vào cùng một bảng mà
        // chỉ một đường có lá chắn thì lá chắn đó vô nghĩa.
        const target = await getUserById(entry.id);
        if (!target) continue;
        assertSchoolAccountWritable(target);

        if (entry.truoc.role !== entry.role) await setSchoolUserRole(entry.id, entry.role);
        if (entry.truoc.displayName !== entry.displayName) await setSchoolUserDisplayName(entry.id, entry.displayName);
        // KHÔNG đụng tới trạng thái hoạt động: bật lại tài khoản của người đã
        // nghỉ việc là việc phải làm có chủ ý, không phải tác dụng phụ của nhập tệp.
        await writeAudit({
          actorUserId: actor.id,
          action: entry.truoc.role !== entry.role ? "SCHOOL_ACCOUNT_ROLE_CHANGED" : "SCHOOL_ACCOUNT_IMPORT_UPDATED",
          entityType: "school_account", entityId: entry.id,
          before: entry.truoc, after: { role: entry.role, displayName: entry.displayName },
          reason: "Nhập hàng loạt từ tệp.",
        });
        counters.updated += 1;
      }
    }
    return sendJson(res, 200, { result: { counters, summary: analysis.summary } });
  }

  // Tệp này chứa mã đăng nhập của TOÀN BỘ phụ huynh: cầm nó là vào được mọi
  // tài khoản. Chỉ quản trị vận hành trở lên.
  if (method === "POST" && url.pathname === "/api/admin/accounts/activation-codes") {
    const user = await requireSchoolUser(req, CAP.maKichHoat);
    const { confirmation = "" } = await readJson(req);
    if (confirmation !== "ISSUE_ACTIVATION_CODES") {
      throw httpError(422, "ISSUE_CONFIRMATION_REQUIRED", "Cần xác nhận rõ trước khi cấp và xem danh sách mã kích hoạt.");
    }
    return sendJson(res, 200, { result: await issueActivationCodes({ actorUserId: user.id }) });
  }

  if (method === "GET" && url.pathname === "/api/admin/accounts/lookup") {
    const actor = await requireSchoolUser(req, CAP.traCuuHoTro);
    const account = url.searchParams.get("account") || "";
    if (!String(account).trim()) throw httpError(400, "ACCOUNT_REQUIRED", "Vui lòng nhập số điện thoại hoặc email cần tra cứu.");
    return sendJson(res, 200, {
      lookup: await lookupAccount(account, { canSeeCode: can(actor.effectiveRole, CAP.maKichHoat) }),
    });
  }

  // Cấp lại mã sẽ XOÁ mật khẩu riêng của phụ huynh rồi trả mã mới cho người gọi,
  // tức là quyền đăng nhập thay họ. Không đi chung với quyền tra cứu.
  if (method === "POST" && url.pathname === "/api/admin/accounts/reset-initial-password") {
    const user = await requireSchoolUser(req, CAP.maKichHoat);
    const { account = "", confirmation = "" } = await readJson(req);
    if (confirmation !== "RESET_INITIAL_PASSWORD") {
      throw httpError(422, "RESET_CONFIRMATION_REQUIRED", "Cần xác nhận rõ trước khi đặt lại mật khẩu của phụ huynh.");
    }
    return sendJson(res, 200, { result: await resetInitialPassword({ actorUserId: user.id, rawAccount: account }) });
  }

  if (method === "GET" && url.pathname === "/api/admin/periods") {
    await requireSchoolUser(req, CAP.danhMuc);
    const periods = await listPeriodRows();
    const active = await getActivePeriod();
    return sendJson(res, 200, { periods, activePeriodId: active?.id || null, serverTime: nowIso() });
  }

  if (method === "POST" && url.pathname === "/api/admin/periods") {
    const user = await requireSchoolUser(req, CAP.danhMuc);
    const period = await savePeriodRecord({ actorUserId: user.id, periodId: null, input: await readJson(req) });
    return sendJson(res, 201, { period });
  }

  const periodMatch = url.pathname.match(/^\/api\/admin\/periods\/([^/]+)$/);
  if (method === "PATCH" && periodMatch) {
    const user = await requireSchoolUser(req, CAP.danhMuc);
    const period = await savePeriodRecord({ actorUserId: user.id, periodId: decodeURIComponent(periodMatch[1]), input: await readJson(req) });
    return sendJson(res, 200, { period });
  }

  if (method === "GET" && url.pathname === "/api/admin/catalog") {
    await requireSchoolUser(req, CAP.danhMuc);
    const [catalog, periods, active] = await Promise.all([adminCatalogData(), listPeriodRows(), getActivePeriod()]);
    return sendJson(res, 200, { ...catalog, periods, activePeriodId: active?.id || null });
  }

  if (method === "POST" && url.pathname === "/api/admin/clubs") {
    const user = await requireSchoolUser(req, CAP.danhMuc);
    const club = await saveClubRecord({ actorUserId: user.id, clubId: null, input: await readJson(req) });
    return sendJson(res, 201, { club });
  }

  const clubMatch = url.pathname.match(/^\/api\/admin\/clubs\/([^/]+)$/);
  if (method === "PATCH" && clubMatch) {
    const user = await requireSchoolUser(req, CAP.danhMuc);
    const club = await saveClubRecord({ actorUserId: user.id, clubId: decodeURIComponent(clubMatch[1]), input: await readJson(req) });
    return sendJson(res, 200, { club });
  }

  if (method === "POST" && url.pathname === "/api/admin/classes") {
    const user = await requireSchoolUser(req, CAP.danhMuc);
    const clubClass = await saveClassRecord({ actorUserId: user.id, classId: null, input: await readJson(req) });
    return sendJson(res, 201, { class: clubClass });
  }

  const classMatch = url.pathname.match(/^\/api\/admin\/classes\/([^/]+)$/);
  if (method === "PATCH" && classMatch) {
    const user = await requireSchoolUser(req, CAP.danhMuc);
    const clubClass = await saveClassRecord({ actorUserId: user.id, classId: decodeURIComponent(classMatch[1]), input: await readJson(req) });
    return sendJson(res, 200, { class: clubClass });
  }

  if (method === "POST" && url.pathname === "/api/admin/catalog/import/preview") {
    await requireSchoolUser(req, CAP.danhMuc);
    const payload = await readJson(req, 8_000_000);
    const { headers, rows } = readCatalogImportPayload(payload);
    const periodId = String(payload.periodId || "");
    const { mapping, missing } = detectCatalogMapping(headers);
    const analysis = missing.length ? null : analyzeCatalogImport(rows, mapping, { periodId });
    return sendJson(res, 200, {
      preview: {
        periodId,
        mapping: Object.fromEntries(Object.entries(mapping).map(([field, descriptor]) => [field, descriptor.header])),
        missing,
        counters: analysis?.counters || null,
        issues: analysis?.issues.slice(0, 60) || [],
        clubs: analysis?.clubs.map((club) => ({ code: club.code, name: club.name, category: club.category, grades: club.grades })) || [],
        classes: analysis?.classes.slice(0, 200) || [],
        readyToImport: Boolean(analysis?.readyToImport && periodId),
      },
    });
  }

  if (method === "POST" && url.pathname === "/api/admin/catalog/import/commit") {
    const user = await requireSchoolUser(req, CAP.danhMuc);
    const payload = await readJson(req, 8_000_000);
    if (payload.confirmation !== "IMPORT_CLUB_CATALOG") {
      throw httpError(422, "IMPORT_CONFIRMATION_REQUIRED", "Cần xác nhận rõ trước khi ghi danh mục vào hệ thống.");
    }
    const periodId = String(payload.periodId || "");
    const { headers, rows } = readCatalogImportPayload(payload);
    const { mapping, missing } = detectCatalogMapping(headers);
    if (missing.length) throw httpError(422, "IMPORT_MAPPING_INCOMPLETE", `File còn thiếu cột bắt buộc: ${missing.join(", ")}.`);
    const analysis = analyzeCatalogImport(rows, mapping, { periodId });
    if (!analysis.readyToImport) throw httpError(422, "IMPORT_NOT_READY", "File còn dòng lỗi, chưa thể ghi vào hệ thống.");
    return sendJson(res, 200, { result: await commitCatalogImport({ actorUserId: user.id, analysis, periodId }) });
  }

  // Chi tiết một đơn: học sinh, bố/mẹ, và lịch sử thay đổi của chính đơn đó.
  // Lọc CỨNG entity_type = 'registration': audit_logs còn chứa nhật ký tài khoản
  // nhà trường và cả email bị từ chối đăng nhập, không được để lọt qua đây.
  const detailMatch = url.pathname.match(/^\/api\/admin\/registrations\/([^/]+)$/);
  if (method === "GET" && detailMatch) {
    await requireSchoolUser(req, CAP.duyetDon);
    const registrationId = decodeURIComponent(detailMatch[1]);
    const detail = businessStore
      ? await businessStore.registrationDetail(registrationId)
      : (() => {
        const registration = db.prepare(`SELECT r.id, r.group_id AS groupId, r.student_id AS studentId, r.class_id AS classId,
            r.status, r.fee_snapshot AS feeSnapshot, r.fee_paid AS feePaid, r.schedule_snapshot AS scheduleSnapshot,
            r.created_at AS createdAt, r.updated_at AS updatedAt,
            cc.name AS classLabel, cc.room, cc.teacher, c.name AS clubName
          FROM registrations r
          LEFT JOIN club_classes cc ON cc.id = r.class_id
          LEFT JOIN clubs c ON c.id = cc.club_id
          WHERE r.id = ?`).get(registrationId);
        if (!registration) return null;
        return {
          registration,
          student: db.prepare(`SELECT id, code, name, date_of_birth AS dateOfBirth, grade, homeroom, level, status
            FROM students WHERE id = ?`).get(registration.studentId) || null,
          parents: db.prepare(`SELECT u.id, u.account, u.display_name AS name, u.email, ps.relationship
            FROM parent_students ps JOIN users u ON u.id = ps.parent_user_id
            WHERE ps.student_id = ?`).all(registration.studentId),
          history: db.prepare(`SELECT a.id, a.action, a.before_json, a.after_json, a.reason, a.created_at AS createdAt,
              u.display_name AS actorName
            FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
            WHERE a.entity_type = 'registration' AND a.entity_id = ?
            ORDER BY a.created_at DESC, a.id DESC`).all(String(registrationId))
            .map((row) => ({
              id: row.id, action: row.action, actorName: row.actorName || null,
              before: parseJsonField(row.before_json, null), after: parseJsonField(row.after_json, null),
              reason: row.reason || null, createdAt: row.createdAt,
            })),
        };
      })();
    if (!detail) throw httpError(404, "REGISTRATION_NOT_FOUND", "Không tìm thấy đơn đăng ký.");
    return sendJson(res, 200, {
      detail: {
        ...detail,
        registration: { ...detail.registration, statusLabel: statusLabel(detail.registration.status) },
      },
    });
  }

  // Đổi trạng thái thủ công theo vòng đời nhà trường đặt ra.
  //
  // KHÔNG chặn theo ma trận bước chuyển. Vòng đời thật có đủ tình huống lùi lại:
  // giáo vụ bấm nhầm, phụ huynh chuyển khoản rồi đòi hoàn, lớp lùi khai giảng rồi
  // lại mở. Chặn cứng sẽ khóa tay người dùng vào đúng lúc họ cần sửa. Đổi lại,
  // MỌI lần đổi đều vào nhật ký kèm người bấm, để tab Lịch sử thay đổi trả lời
  // được câu "ai đổi cái này, lúc nào".
  const statusMatch = url.pathname.match(/^\/api\/admin\/registrations\/([^/]+)\/status$/);
  if (method === "PATCH" && statusMatch) {
    const user = await requireSchoolUser(req, CAP.duyetDon);
    const registrationId = decodeURIComponent(statusMatch[1]);
    const { status = "", reason = null } = await readJson(req);
    const next = String(status);
    if (!ASSIGNABLE_STATUSES.includes(next)) {
      throw httpError(422, "STATUS_INVALID", "Trạng thái không nằm trong vòng đời đơn đăng ký.");
    }
    const timestamp = nowIso();
    if (holdsSeat(next) && !businessStore) {
      const hienTai = db.prepare("SELECT class_id, status FROM registrations WHERE id = ?").get(registrationId);
      if (hienTai && !holdsSeat(hienTai.status)) {
        const cho = classHasFreeSeat(hienTai.class_id, registrationId);
        if (!cho.free) {
          throw httpError(409, "CLASS_FULL",
            `Lớp đã đủ ${cho.capacity} chỗ (tính theo số em đã đóng phí). Không thể chuyển đơn này sang "${statusLabel(next)}".`);
        }
      }
    }
    if (businessStore) {
      const result = await businessStore.changeRegistrationStatus({ registrationId, status: next, actorUserId: user.id, timestamp, reason });
      return sendJson(res, 200, { ...result, statusLabel: statusLabel(next) });
    }
    const registration = db.prepare("SELECT id, status FROM registrations WHERE id = ?").get(registrationId);
    if (!registration) throw httpError(404, "REGISTRATION_NOT_FOUND", "Không tìm thấy đơn đăng ký.");
    if (registration.status === next) return sendJson(res, 200, { id: registrationId, status: next, changed: false, statusLabel: statusLabel(next) });
    db.prepare("UPDATE registrations SET status = ?, updated_at = ? WHERE id = ?").run(next, timestamp, registrationId);
    await writeAudit({
      actorUserId: user.id, action: "CHANGE_REGISTRATION_STATUS", entityType: "registration", entityId: registrationId,
      before: { status: registration.status }, after: { status: next }, reason,
    });
    return sendJson(res, 200, { id: registrationId, status: next, changed: true, statusLabel: statusLabel(next) });
  }

  const confirmMatch = url.pathname.match(/^\/api\/admin\/registrations\/([^/]+)\/confirm-payment$/);
  if (method === "PATCH" && confirmMatch) {
    const user = await requireSchoolUser(req, CAP.duyetDon);
    const timestamp = nowIso();
    if (businessStore) {
      const result = await businessStore.confirmPayment({ registrationId: confirmMatch[1], actorUserId: user.id, timestamp });
      return sendJson(res, 200, result);
    }
    const registration = db.prepare("SELECT * FROM registrations WHERE id = ?").get(confirmMatch[1]);
    if (!registration) throw httpError(404, "REGISTRATION_NOT_FOUND", "Không tìm thấy đơn đăng ký.");
    if (!["payment", "submitted", "waitlist"].includes(registration.status)) throw httpError(409, "INVALID_TRANSITION", "Trạng thái hiện tại không cho phép xác nhận phí.");
    // Lớp đã đủ chỗ thì vẫn ghi nhận đã thu tiền, nhưng đơn sang xếp chờ.
    const cho = classHasFreeSeat(registration.class_id, registration.id);
    const trangThaiMoi = cho.free ? STATUS.daDongPhi : STATUS.xepCho;
    db.prepare("UPDATE registrations SET status = ?, fee_paid = 1, updated_at = ? WHERE id = ?")
      .run(trangThaiMoi, timestamp, registration.id);
    await writeAudit({
      actorUserId: user.id, action: "CONFIRM_PAYMENT", entityType: "registration", entityId: registration.id,
      before: { status: registration.status }, after: { status: trangThaiMoi, feePaid: true },
      reason: cho.free ? null : `Lớp đã đủ ${cho.capacity} chỗ nên đơn đã đóng phí được chuyển sang xếp chờ.`,
    });
    return sendJson(res, 200, { id: registration.id, status: trangThaiMoi, feePaid: true, lopDaDay: !cho.free });
  }

  // Danh sách vận hành, không phải bản trích xuất dữ liệu: giáo vụ cần nó để
  // xếp lớp và cập nhật thông tin học sinh.
  if (method === "GET" && url.pathname === "/api/admin/reports/registrations.csv") {
    await requireSchoolUser(req, CAP.danhSachVanHanh);
    const classId = url.searchParams.get("classId") || "";
    // Phạm vi phải nói ra thành lời, vì trang danh sách lớp có ĐÚNG hai chế độ và
    // tệp tải về buộc phải khớp cái người ta vừa nhìn:
    //   giu-cho  = danh sách chính thức, chỉ các em đã đóng phí trở đi
    //   hieu-luc = kèm đơn chưa đóng phí, nhưng BỎ lớp hủy / hoàn phí / không khai giảng
    // Không truyền gì thì xuất mọi đơn — giữ nguyên hành vi cũ của trang Báo cáo.
    const phamVi = url.searchParams.get("phamVi") || "";
    const loc = phamVi === "giu-cho" ? SEAT_HOLDING_STATUSES
      : phamVi === "hieu-luc" ? ACTIVE_REGISTRATION_STATUSES
      : null;
    let rows = await listRegistrations({ role: "admin" });
    if (classId) rows = rows.filter((row) => row.classId === classId);
    if (loc) rows = rows.filter((row) => loc.includes(row.status));

    const csvRows = [["Mã đơn","Học sinh","Lớp","CLB","Ca học","Lịch","Trạng thái","Đã thu phí","Số tiền"],
      ...rows.map((row) => [row.id,row.student,row.className,row.club,row.classLabel,row.schedule,statusLabel(row.status),row.feePaid ? "Rồi" : "Chưa",row.amount])];
    const csv = "\uFEFF" + csvRows.map((row) => row.map((value) => `"${String(value).replaceAll('"','""')}"`).join(",")).join("\r\n");
    // Tên tệp đi trong header HTTP nên phải là ASCII; mã ca học do hệ thống sinh
    // ra vốn đã an toàn, vẫn lọc lại để không ai chèn được dấu nháy vào header.
    const tenTep = classId ? `NSHM_Danh_sach_${classId.replace(/[^A-Za-z0-9_-]+/g, "_")}.csv` : "NSHM_Danh_sach_dang_ky.csv";
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${tenTep}"`,
      "Cache-Control": "no-store",
      "Content-Length": Buffer.byteLength(csv),
    });
    return res.end(csv);
  }

  throw httpError(404, "NOT_FOUND", "Không tìm thấy API được yêu cầu.");
}

const mimeTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

// Số phiên bản ?v= trong index.html trước đây phải sửa tay mỗi lần đổi giao diện.
// Quên một lần là người dùng chạy mã cũ tới 4 giờ sau khi deploy — đã xảy ra thật:
// CSS cũ không có quy tắc cho logo nên ảnh hiện ở kích thước gốc 1746px, và app.js
// cũ vẫn còn câu đã được xoá. Nay máy chủ tự thay ?v= bằng vân tay nội dung của
// CHÍNH tệp đó, nên không còn bước nào để quên, và sửa một tệp không làm hỏng
// cache của những tệp còn lại.
const assetFingerprints = new Map();
const ASSET_REFERENCE = /\.\/([\w.-]+)\?v=[\w.-]+/g;

async function fingerprintOf(name) {
  if (!PUBLIC_FILES.has(name)) return null;
  const filePath = resolve(PUBLIC_DIR, name);
  if (!existsSync(filePath)) return null;
  const { mtimeMs, size } = statSync(filePath);
  const cached = assetFingerprints.get(name);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.hash;
  const hash = createHash("sha256").update(await readFile(filePath)).digest("hex").slice(0, 12);
  assetFingerprints.set(name, { mtimeMs, size, hash });
  return hash;
}

async function stampAssetVersions(html) {
  const names = new Set([...html.matchAll(ASSET_REFERENCE)].map((match) => match[1]));
  const hashes = new Map();
  for (const name of names) {
    const hash = await fingerprintOf(name);
    if (hash) hashes.set(name, hash);
  }
  return html.replace(ASSET_REFERENCE, (whole, name) => (hashes.has(name) ? `./${name}?v=${hashes.get(name)}` : whole));
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  if (!PUBLIC_FILES.has(safePath.replaceAll("\\", "/"))) throw httpError(404, "NOT_FOUND", "Không tìm thấy tệp.");
  const filePath = resolve(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(resolve(PUBLIC_DIR)) || !existsSync(filePath) || filePath.includes(`${join(ROOT, "data")}`)) throw httpError(404, "NOT_FOUND", "Không tìm thấy tệp.");
  const raw = await readFile(filePath);
  const content = safePath === "index.html" ? Buffer.from(await stampAssetVersions(raw.toString("utf8")), "utf8") : raw;
  res.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream", "Content-Length": content.length, "Cache-Control": "no-cache" });
  res.end(content);
}

export async function handleRequest(req, res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' https://www.gstatic.com https://www.googletagmanager.com; connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://firebase.googleapis.com; img-src 'self' data: https://www.google-analytics.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
      else await serveStatic(req, res, url);
    } catch (error) {
      if (res.headersSent) return res.end();
      const { status, body, logWorthy } = toErrorResponse(error);
      sendJson(res, status, body);
      if (logWorthy) console.error(error);
    }
}

export function createAppServer() {
  return createServer(handleRequest);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  if (DATA_BACKEND !== "sqlite") {
    try {
      await ensureBusinessStore();
    } catch (error) {
      console.error(`[khoi-dong] Không kết nối được kho dữ liệu (${DATA_BACKEND}): ${error.message}`);
      process.exit(1);
    }
  }
  const server = createAppServer();
  if (SYNC_SCHEDULE_ENABLED) {
    syncScheduler.start();
    console.log(`Tự đồng bộ danh sách học sinh mỗi ${Math.round(SYNC_INTERVAL_MS / 60000)} phút.`);
  }
  // Không có nhánh này thì cổng bị chiếm sẽ ném lỗi 'error' không ai bắt, tiến
  // trình chết CÂM: người vận hành thấy lệnh chạy xong, không báo gì, mà site nằm.
  // Đã xảy ra thật hai lần khi bật lại mà tiến trình cũ chưa nhả cổng.
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`[khoi-dong] Cổng ${PORT} đang bị một tiến trình khác giữ, máy chủ không khởi động được.`);
      console.error(`[khoi-dong] Xem ai đang giữ: Get-NetTCPConnection -LocalPort ${PORT} -State Listen | Select-Object OwningProcess`);
    } else {
      console.error(`[khoi-dong] Không mở được cổng ${PORT} trên ${HOST}: ${error.message}`);
    }
    process.exit(1);
  });
  // PORT=0 để hệ điều hành cấp cổng trống; in ra cổng thật để bộ kiểm thử bám vào.
  server.listen(PORT, HOST, () => console.log(`NSHM Clubs running at http://${HOST}:${server.address().port}`));
}
