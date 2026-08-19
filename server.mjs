import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createGoogleSheetsDirectorySource, toVietnameseLocalPhone } from "./sheets-directory.mjs";
import { createMicrosoftAuth } from "./microsoft-auth.mjs";
import { createGoogleCloudAuth } from "./google-cloud-auth.mjs";
import { validatePasswordPolicy } from "./password-policy.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const LOCAL_ENV_FILE = join(ROOT, ".env");
if (existsSync(LOCAL_ENV_FILE)) loadEnvFile(LOCAL_ENV_FILE);
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const DB_FILE = process.env.DATA_FILE || join(ROOT, "data", "nshm-clubs.sqlite");
const DATA_BACKEND = String(process.env.DATA_BACKEND || "sqlite").toLowerCase();
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "dkclb-2626f";
const SHEETS_SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "1YUCh0_U8ASCf4nVMZ_dXj9EAkEGq9ghpHggiYVT1zeM";
const SHEETS_TAB_NAME = process.env.GOOGLE_SHEETS_TAB || "dshs26-27";
const SHEETS_HEADER_ROW = Number(process.env.GOOGLE_SHEETS_HEADER_ROW || 1);
const SHEETS_SERVICE_ACCOUNT = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT || "nshm-sheet-reader@dkclb-2626f.iam.gserviceaccount.com";
const MICROSOFT_REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI || `http://127.0.0.1:${PORT}/api/auth/microsoft/callback`;
const SESSION_COOKIE = "nshm_session";
const SESSION_MAX_AGE = 8 * 60 * 60;
const PUBLIC_FILES = new Set(["index.html", "styles.css", "app.js", "firebase-client.js"]);

if (!["sqlite", "firestore"].includes(DATA_BACKEND)) {
  throw new Error("DATA_BACKEND chỉ chấp nhận 'sqlite' hoặc 'firestore'.");
}

const googleCloudAuth = createGoogleCloudAuth({
  projectNumber: process.env.GCP_PROJECT_NUMBER,
  poolId: process.env.GCP_WORKLOAD_IDENTITY_POOL_ID,
  providerId: process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID,
  serviceAccountEmail: process.env.GCP_SERVICE_ACCOUNT_EMAIL || SHEETS_SERVICE_ACCOUNT,
});
const directorySource = createGoogleSheetsDirectorySource({
  spreadsheetId: SHEETS_SPREADSHEET_ID,
  sheetName: SHEETS_TAB_NAME,
  headerRow: SHEETS_HEADER_ROW,
  serviceAccountEmail: SHEETS_SERVICE_ACCOUNT,
  accessToken: process.env.GOOGLE_SHEETS_ACCESS_TOKEN,
  authClientFactory: DATA_BACKEND === "firestore" ? googleCloudAuth.getClient : undefined,
});
const microsoftAuth = createMicrosoftAuth({
  tenantId: process.env.MICROSOFT_TENANT_ID,
  clientId: process.env.MICROSOFT_CLIENT_ID,
  clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
  clientAssertion: process.env.MICROSOFT_CLIENT_SECRET ? undefined : googleCloudAuth.getRuntimeOidcToken,
  redirectUri: MICROSOFT_REDIRECT_URI,
  allowedDomain: process.env.MICROSOFT_ALLOWED_DOMAIN || "hoangmaistarschool.edu.vn",
});

let db = null;

const nowIso = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${randomBytes(7).toString("hex")}`;
const sessionStorageKey = (token) => createHash("sha256").update(String(token)).digest("hex");
const asInt = (value) => Number(value || 0);
const publicUser = (user) => ({
  id: user.id,
  account: user.account,
  displayName: user.display_name,
  role: user.role,
  authProvider: user.auth_provider || "local",
  mustChangePassword: Boolean(user.must_change_password),
});

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: scryptSync(password, salt, 64).toString("hex") };
}

function hashPasswordAsync(password, salt = randomBytes(16).toString("hex")) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) reject(error);
      else resolve({ salt, hash: derivedKey.toString("hex") });
    });
  });
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

function verifyPassword(password, salt, expectedHex) {
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      account TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('parent', 'admin')),
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
      status TEXT NOT NULL
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
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS club_classes (
      id TEXT PRIMARY KEY,
      club_id TEXT NOT NULL REFERENCES clubs(id),
      period_id TEXT NOT NULL REFERENCES registration_periods(id),
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
      status TEXT NOT NULL,
      fee_snapshot INTEGER NOT NULL,
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
  ensureColumn("users", "must_change_password", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("users", "login_failures", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("users", "locked_until", "TEXT");
  ensureColumn("students", "date_of_birth", "TEXT");
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
  insertUser.run("u_seed", "seed@nshm.local", "Dữ liệu hệ thống", "parent", seedPassword.salt, seedPassword.hash, createdAt);

  const insertStudent = db.prepare("INSERT INTO students (id, code, name, grade, homeroom, level) VALUES (?, ?, ?, ?, ?, ?)");
  const studentRows = [
    ["hs01", "NSHM260301", "Nguyễn Minh An", 3, "3A2", "Tiểu học"],
    ["hs02", "NSHM260601", "Nguyễn Gia Hân", 6, "6A1", "THCS"],
    ["hs03", "NSHM260311", "Lê Minh Khang", 3, "3A1", "Tiểu học"],
    ["hs04", "NSHM260203", "Trần Bảo Ngọc", 2, "2A3", "Tiểu học"],
    ["hs05", "NSHM260622", "Phạm Anh Tú", 6, "6A2", "THCS"],
    ["hs06", "NSHM260411", "Nguyễn Hà My", 4, "4A1", "Tiểu học"],
    ["hs07", "NSHM260344", "Đỗ Gia Linh", 3, "3A4", "Tiểu học"],
    ["hs08", "NSHM260522", "Vũ Minh Quân", 5, "5A2", "Tiểu học"],
  ];
  studentRows.forEach((row) => insertStudent.run(...row));
  db.prepare("INSERT INTO parent_students VALUES (?, ?, ?)").run("u_parent", "hs01", "Mẹ");
  db.prepare("INSERT INTO parent_students VALUES (?, ?, ?)").run("u_parent", "hs02", "Mẹ");

  db.prepare(`INSERT INTO registration_periods
    (id, name, school_year, term, open_at, close_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("period_2026_hk1", "Đăng ký CLB · Học kỳ I", "2026–2027", "Học kỳ I", "2026-08-12T01:00:00.000Z", "2026-08-24T16:59:59.000Z", "open");

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
  const seedRegistrations = [
    ["DK-260812-0142", "GR-260812-01", "hs01", "u_parent", "piano", "payment", 1900000, "Thứ 3 · 16:15–17:30", "2026-08-12T08:42:00.000Z"],
    ["DK-260818-0158", "GR-260818-58", "hs03", "u_seed", "robotics", "payment", 1650000, "Thứ 5 · 16:15–17:45", "2026-08-18T08:42:00.000Z"],
    ["DK-260818-0157", "GR-260818-57", "hs04", "u_seed", "painting", "waitlist", 1100000, "Thứ 4 · 16:15–17:30", "2026-08-18T08:38:00.000Z"],
    ["DK-260818-0156", "GR-260818-56", "hs05", "u_seed", "debate", "confirmed", 1450000, "Thứ 6 · 16:15–17:45", "2026-08-18T08:31:00.000Z"],
    ["DK-260818-0155", "GR-260818-55", "hs06", "u_seed", "basketball", "conflict", 1200000, "Thứ 3 · 16:15–17:30", "2026-08-18T08:22:00.000Z"],
    ["DK-260818-0154", "GR-260818-54", "hs07", "u_seed", "piano", "submitted", 1900000, "Thứ 3 · 16:15–17:30", "2026-08-18T08:17:00.000Z"],
    ["DK-260818-0153", "GR-260818-53", "hs08", "u_seed", "dance", "confirmed", 1250000, "Thứ 7 · 08:30–10:00", "2026-08-18T08:03:00.000Z"],
  ];
  for (const row of seedRegistrations) insertReg.run(...row, row[8], row[8]);
}

if (DATA_BACKEND === "sqlite") {
  await mkdir(resolve(DB_FILE, ".."), { recursive: true });
  db = new DatabaseSync(DB_FILE);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  initializeDatabase();
}

function firestoreSeedData() {
  const clubs = CLUB_SEED_ROWS.map(([clubId, code, name, category, description, emoji, visual, grades]) => ({
    id: clubId, code, name, category, description, emoji, visual, grades, active: true,
  }));
  const classes = CLUB_SEED_ROWS.map(([clubId, , , , , , , , dayOfWeek, startTime, endTime, scheduleLabel, room, teacher, capacity, enrolledBase, fee]) => ({
    id: clubId, clubId, periodId: "period_2026_hk1", dayOfWeek, startTime, endTime, scheduleLabel,
    room, teacher, capacity, enrolledBase, fee, waitlistEnabled: true, active: true,
  }));
  return {
    users: [], students: [], parentStudents: [], registrations: [], supportRequests: [], auditLogs: [], clubs, classes,
    periods: [{
      id: "period_2026_hk1", name: "Đăng ký CLB · Học kỳ I", schoolYear: "2026–2027", term: "Học kỳ I",
      openAt: "2026-08-12T01:00:00.000Z", closeAt: "2026-08-24T16:59:59.000Z", status: "open",
    }],
  };
}

let businessStore = null;
if (DATA_BACKEND === "firestore") {
  const { createFirestoreStore } = await import("./firestore-store.mjs");
  businessStore = await createFirestoreStore({
    projectId: FIREBASE_PROJECT_ID,
    seed: firestoreSeedData(),
    authClient: googleCloudAuth.workloadIdentityConfigured ? await googleCloudAuth.getClient() : undefined,
  });
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

function httpError(status, code, message, details) {
  const error = new Error(message);
  Object.assign(error, { status, code, details });
  return error;
}

async function readJson(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 1_000_000) throw httpError(413, "PAYLOAD_TOO_LARGE", "Dữ liệu gửi lên vượt giới hạn.");
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
    r.parent_user_id AS parentUserId, r.class_id AS classId, r.status,
    r.fee_snapshot AS feeSnapshot, r.schedule_snapshot AS scheduleSnapshot,
    r.terms_accepted_at AS termsAcceptedAt, r.created_at AS createdAt, r.updated_at AS updatedAt,
    cc.day_of_week AS dayOfWeek, cc.start_time AS startTime, cc.end_time AS endTime
    FROM registrations r JOIN club_classes cc ON cc.id = r.class_id
    WHERE ${conditions.join(" AND ")} ORDER BY r.created_at DESC`).all(...params);
}

async function clubRows(studentId) {
  const student = studentId ? (businessStore ? await businessStore.getStudent(studentId) : db.prepare("SELECT * FROM students WHERE id = ?").get(studentId)) : null;
  const rows = businessStore ? await businessStore.listClubs() : db.prepare(`SELECT c.*, cc.day_of_week, cc.start_time, cc.end_time, cc.schedule_label,
      cc.room, cc.teacher, cc.capacity, cc.enrolled_base, cc.fee, cc.waitlist_enabled
    FROM clubs c JOIN club_classes cc ON cc.club_id = c.id
    WHERE c.active = 1 AND cc.active = 1 ORDER BY c.category, c.name`).all();
  let enrollmentCounts;
  if (businessStore) {
    enrollmentCounts = await businessStore.getEnrollmentCounts();
  } else {
    const counts = db.prepare(`SELECT cc.id, cc.enrolled_base + COALESCE(SUM(
      CASE WHEN r.status IN ('submitted','payment','confirmed') THEN 1 ELSE 0 END), 0) AS enrolled
      FROM club_classes cc LEFT JOIN registrations r ON r.class_id = cc.id GROUP BY cc.id`).all();
    enrollmentCounts = Object.fromEntries(counts.map((row) => [row.id, asInt(row.enrolled)]));
  }
  return rows.map((row) => ({
    ...(() => {
      const grades = businessStore ? row.grades : JSON.parse(row.grades_json);
      return {
    id: row.id, name: row.name, category: row.category, description: row.description, emoji: row.emoji,
    visual: row.visual, grade: grades, schedule: row.scheduleLabel || row.schedule_label, room: row.room,
    teacher: row.teacher, capacity: row.capacity, enrolled: asInt(enrollmentCounts[row.id] ?? row.enrolledBase ?? row.enrolled_base), fee: row.fee,
    eligible: student ? grades.includes(student.grade) : true,
    dayOfWeek: row.dayOfWeek ?? row.day_of_week, startTime: row.startTime || row.start_time, endTime: row.endTime || row.end_time,
      };
    })(),
  }));
}

function intervalsOverlap(a, b) {
  return a.dayOfWeek === b.dayOfWeek && a.startTime < b.endTime && b.startTime < a.endTime;
}

async function validateRegistration(user, studentId, clubIds) {
  if (!studentId || !Array.isArray(clubIds) || clubIds.length === 0) {
    throw httpError(400, "INVALID_REGISTRATION", "Vui lòng chọn học sinh và ít nhất một CLB.");
  }
  if (clubIds.length > 3) throw httpError(422, "MAX_CLUBS", "Mỗi học sinh được đăng ký tối đa 3 CLB trong đợt này.");
  const ownership = businessStore ? await businessStore.parentOwnsStudent(user.id, studentId) : db.prepare(`SELECT s.* FROM students s JOIN parent_students ps ON ps.student_id = s.id
    WHERE ps.parent_user_id = ? AND s.id = ? AND s.status = 'active'`).get(user.id, studentId);
  if (!ownership) throw httpError(403, "STUDENT_SCOPE", "Học sinh không thuộc tài khoản phụ huynh hiện tại.");

  const available = new Map((await clubRows(studentId)).map((club) => [club.id, club]));
  const selected = clubIds.map((clubId) => available.get(clubId));
  if (selected.some((club) => !club)) throw httpError(404, "CLUB_NOT_FOUND", "Có CLB không còn tồn tại hoặc đã bị ẩn.");

  const issues = [];
  for (const club of selected) {
    if (!club.eligible) issues.push({ type: "ineligible", clubId: club.id, message: `${club.name} không áp dụng cho khối của học sinh.` });
  }
  for (let i = 0; i < selected.length; i += 1) {
    for (let j = i + 1; j < selected.length; j += 1) {
      if (intervalsOverlap(selected[i], selected[j])) issues.push({ type: "conflict", clubId: selected[j].id, message: `${selected[j].name} trùng lịch với ${selected[i].name}.` });
    }
  }
  const existing = (await rawRegistrationRows({ studentId }))
    .filter((registration) => ["submitted", "payment", "confirmed"].includes(registration.status))
    .map((registration) => ({
      id: registration.classId,
      name: available.get(registration.classId)?.name || registration.classId,
      dayOfWeek: registration.dayOfWeek,
      startTime: registration.startTime,
      endTime: registration.endTime,
    }));
  for (const club of selected) {
    for (const current of existing) {
      if (current.id === club.id) issues.push({ type: "duplicate", clubId: club.id, message: `${club.name} đã có trong đăng ký hiện tại.` });
      else if (intervalsOverlap(club, current)) issues.push({ type: "conflict", clubId: club.id, message: `${club.name} trùng lịch với ${current.name} đã đăng ký.` });
    }
  }
  return { valid: issues.length === 0, issues, clubs: selected.map((club) => ({ ...club, proposedStatus: club.enrolled >= club.capacity ? "waitlist" : "payment" })) };
}

async function listRegistrations(user, status) {
  const rows = await rawRegistrationRows({ parentUserId: user.role === "parent" ? user.id : undefined, status });
  const hydrated = businessStore ? await businessStore.hydrateRegistrations(rows) : rows.map((registration) => ({
    registration,
    student: db.prepare("SELECT name, homeroom FROM students WHERE id = ?").get(registration.studentId) || {},
    clubClass: db.prepare(`SELECT cc.room, cc.teacher, cc.club_id AS clubId FROM club_classes cc WHERE cc.id = ?`).get(registration.classId) || {},
    club: db.prepare("SELECT id, name FROM clubs WHERE id = ?").get(registration.classId) || {},
  }));
  return hydrated.map(({ registration, student, clubClass, club }) => {
    return {
      id: registration.id,
      groupId: registration.groupId,
      studentId: registration.studentId,
      student: student.name || registration.studentId,
      className: student.homeroom || "—",
      clubId: club.id || registration.classId,
      club: club.name || registration.classId,
      schedule: registration.scheduleSnapshot,
      status: registration.status,
      amount: Number(registration.feeSnapshot || 0),
      createdAt: registration.createdAt,
      room: clubClass.room || "—",
      teacher: clubClass.teacher || "—",
      date: new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(registration.createdAt)),
    };
  });
}

async function dashboardData() {
  const registrations = await rawRegistrationRows();
  const total = registrations.length;
  const students = new Set(registrations.map((item) => item.studentId)).size;
  const needAction = registrations.filter((item) => ["conflict", "waitlist", "submitted"].includes(item.status)).length;
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

async function syncGoogleDirectory(actorUserId) {
  const { snapshot, analysis, source } = await directorySource.loadForSync();
  const timestamp = nowIso();
  const counters = { studentsCreated: 0, studentsUpdated: 0, parentsCreated: 0, parentsExisting: 0, linksCreated: 0, linksUpdated: 0 };
  const studentIdsByCode = new Map();
  const existingAccountRoles = businessStore ? await businessStore.getExistingAccountRoles() : null;
  const newGuardians = snapshot.guardians.filter((guardian) => businessStore
    ? !existingAccountRoles.has(guardian.account.toLowerCase())
    : !db.prepare("SELECT 1 FROM users WHERE lower(account) = lower(?)").get(guardian.account));
  const preparedHashes = new Map(await mapWithConcurrency(newGuardians, 8, async (guardian) => [guardian.account, await hashPasswordAsync(guardian.initialPassword)]));

  if (businessStore) {
    return businessStore.syncDirectory({ snapshot, preparedHashes, actorUserId, timestamp, idFactory: id, source, analysis });
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const student of snapshot.students) {
      const existing = db.prepare("SELECT id FROM students WHERE code = ?").get(student.code);
      if (existing) {
        db.prepare(`UPDATE students SET name = ?, date_of_birth = ?, grade = ?, homeroom = ?, level = ?, status = 'active' WHERE id = ?`)
          .run(student.name, student.dateOfBirth, student.grade, student.className, student.educationLevel, existing.id);
        studentIdsByCode.set(student.code, existing.id);
        counters.studentsUpdated += 1;
      } else {
        const studentId = id("hs");
        db.prepare(`INSERT INTO students (id, code, name, date_of_birth, grade, homeroom, level, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`)
          .run(studentId, student.code, student.name, student.dateOfBirth, student.grade, student.className, student.educationLevel);
        studentIdsByCode.set(student.code, studentId);
        counters.studentsCreated += 1;
      }
    }

    for (const guardian of snapshot.guardians) {
      let user = db.prepare("SELECT * FROM users WHERE lower(account) = lower(?)").get(guardian.account);
      if (user && user.role !== "parent") throw httpError(409, "ACCOUNT_ROLE_CONFLICT", "Có SĐT phụ huynh trùng với một tài khoản vai trò khác; cần IT xử lý thủ công.");
      if (!user) {
        const initial = preparedHashes.get(guardian.account) || hashPassword(guardian.initialPassword);
        const userId = id("u_parent");
        db.prepare(`INSERT INTO users
          (id, account, display_name, role, password_salt, password_hash, auth_provider, must_change_password, active, created_at)
          VALUES (?, ?, ?, 'parent', ?, ?, 'local', 1, 1, ?)`)
          .run(userId, guardian.account, guardian.displayName || "Phụ huynh học sinh", initial.salt, initial.hash, timestamp);
        user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
        counters.parentsCreated += 1;
      } else {
        db.prepare("UPDATE users SET active = 1 WHERE id = ?").run(user.id);
        counters.parentsExisting += 1;
      }

      for (const linkedStudent of guardian.students) {
        const studentId = studentIdsByCode.get(linkedStudent.studentCode);
        if (!studentId) continue;
        const existingLink = db.prepare("SELECT relationship FROM parent_students WHERE parent_user_id = ? AND student_id = ?").get(user.id, studentId);
        const relationship = existingLink && existingLink.relationship !== linkedStudent.relationship ? "Bố/Mẹ" : linkedStudent.relationship;
        if (existingLink) {
          db.prepare("UPDATE parent_students SET relationship = ? WHERE parent_user_id = ? AND student_id = ?").run(relationship, user.id, studentId);
          counters.linksUpdated += 1;
        } else {
          db.prepare("INSERT INTO parent_students (parent_user_id, student_id, relationship) VALUES (?, ?, ?)").run(user.id, studentId, relationship);
          counters.linksCreated += 1;
        }
      }
    }

    const syncId = id("sync");
    db.prepare(`INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, after_json, created_at)
      VALUES (?, ?, 'SYNC_STUDENT_DIRECTORY', 'google_sheet', ?, ?, ?)`)
      .run(id("audit"), actorUserId, syncId, JSON.stringify({ source: { spreadsheetId: source.spreadsheetId, sheetName: source.sheetName }, counters, scannedRows: analysis.scannedRows }), timestamp);
    db.exec("COMMIT");
    return { syncId, counters, scannedRows: analysis.scannedRows };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function handleApi(req, res, url) {
  const method = req.method || "GET";

  if (!["GET", "HEAD", "OPTIONS"].includes(method) && req.headers.origin) {
    const origin = new URL(req.headers.origin);
    if (origin.host !== req.headers.host) throw httpError(403, "INVALID_ORIGIN", "Yêu cầu không đến từ miền ứng dụng hợp lệ.");
  }

  if (method === "GET" && url.pathname === "/api/health") return sendJson(res, 200, {
    ok: true,
    service: "nshm-clubs",
    dataBackend: DATA_BACKEND,
    firebaseProjectId: DATA_BACKEND === "firestore" ? FIREBASE_PROJECT_ID : undefined,
    time: nowIso(),
  });

  if (method === "POST" && url.pathname === "/api/auth/login") {
    const { account = "", password = "" } = await readJson(req);
    const rawAccount = String(account).trim();
    const normalizedAccount = toVietnameseLocalPhone(rawAccount) || rawAccount.toLowerCase();
    const user = businessStore ? await businessStore.getUserByAccount(normalizedAccount) : db.prepare("SELECT * FROM users WHERE lower(account) = lower(?) AND active = 1").get(normalizedAccount);
    if (user?.locked_until && user.locked_until > nowIso()) {
      throw httpError(429, "ACCOUNT_TEMPORARILY_LOCKED", "Tài khoản tạm khóa do đăng nhập sai nhiều lần. Vui lòng thử lại sau 15 phút.");
    }
    const passwordValid = user?.auth_provider === "local" && verifyPassword(String(password), user.password_salt, user.password_hash);
    if (!user || !passwordValid) {
      if (user) {
        const failures = Number(user.login_failures || 0) + 1;
        const lockedUntil = failures >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
        if (businessStore) await businessStore.recordLoginFailure(user.id, failures, lockedUntil);
        else db.prepare("UPDATE users SET login_failures = ?, locked_until = ? WHERE id = ?").run(failures, lockedUntil, user.id);
      }
      throw httpError(401, "INVALID_CREDENTIALS", "Tài khoản hoặc mật khẩu không đúng.");
    }
    if (businessStore) await businessStore.resetLoginFailures(user.id);
    else db.prepare("UPDATE users SET login_failures = 0, locked_until = NULL WHERE id = ?").run(user.id);
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
    const unusablePassword = hashPassword(randomBytes(48).toString("base64url"));
    const userId = `u_ms_${identity.objectId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || randomBytes(8).toString("hex")}`;
    let user;
    if (businessStore) {
      user = await businessStore.upsertMicrosoftUser({ identity, userId, password: unusablePassword, timestamp: nowIso() });
    } else if ((user = db.prepare("SELECT * FROM users WHERE microsoft_object_id = ? OR lower(account) = lower(?)").get(identity.objectId, identity.email))) {
      db.prepare(`UPDATE users SET account = ?, display_name = ?, role = 'admin', auth_provider = 'microsoft',
        microsoft_object_id = ?, must_change_password = 0, login_failures = 0, locked_until = NULL, active = 1 WHERE id = ?`)
        .run(identity.email, identity.name, identity.objectId, user.id);
      user = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    } else {
      db.prepare(`INSERT INTO users
        (id, account, display_name, role, password_salt, password_hash, auth_provider, microsoft_object_id, created_at)
        VALUES (?, ?, ?, 'admin', ?, ?, 'microsoft', ?, ?)`)
        .run(userId, identity.email, identity.name, unusablePassword.salt, unusablePassword.hash, identity.objectId, nowIso());
      user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
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
      db.prepare("UPDATE users SET password_salt = ?, password_hash = ?, must_change_password = 0, login_failures = 0, locked_until = NULL WHERE id = ?")
        .run(secured.salt, secured.hash, user.id);
      return db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    })();
    return sendJson(res, 200, { user: publicUser(updatedUser) });
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
    return sendJson(res, 200, { clubs: await clubRows(studentId) });
  }

  if (method === "GET" && url.pathname === "/api/registrations") {
    const user = await requireUser(req);
    return sendJson(res, 200, { registrations: await listRegistrations(user, url.searchParams.get("status")) });
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
    const dateCode = new Date().toISOString().slice(2,10).replaceAll("-", "");
    const groupId = `GR-${dateCode}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const registrationIds = validation.clubs.map(() => `DK-${dateCode}-${randomBytes(2).toString("hex").toUpperCase()}`);
    const timestamp = nowIso();

    if (businessStore) {
      const created = await businessStore.createRegistrations({ actorUserId: user.id, studentId, groupId, clubs: validation.clubs, registrationIds, timestamp });
      return sendJson(res, 201, { groupId, registrations: created });
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      const created = [];
      const insert = db.prepare(`INSERT INTO registrations
        (id, group_id, student_id, parent_user_id, class_id, status, fee_snapshot, schedule_snapshot, terms_accepted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (let index = 0; index < validation.clubs.length; index += 1) {
        const club = validation.clubs[index];
        const refreshed = (await clubRows(studentId)).find((item) => item.id === club.id);
        const status = refreshed.enrolled >= refreshed.capacity ? "waitlist" : "payment";
        const registrationId = registrationIds[index];
        insert.run(registrationId, groupId, studentId, user.id, club.id, status, club.fee, club.schedule, timestamp, timestamp, timestamp);
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
    const requestId = `HT-${new Date().toISOString().slice(2,10).replaceAll("-","")}-${randomBytes(2).toString("hex").toUpperCase()}`;
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
    await requireUser(req, "admin");
    return sendJson(res, 200, { dashboard: await dashboardData() });
  }

  if (method === "GET" && url.pathname === "/api/admin/integrations/google-sheets") {
    await requireUser(req, "admin");
    return sendJson(res, 200, { integration: directorySource.getStatus() });
  }

  if (method === "POST" && url.pathname === "/api/admin/integrations/google-sheets/preview") {
    await requireUser(req, "admin");
    return sendJson(res, 200, { preview: await directorySource.preview() });
  }

  if (method === "POST" && url.pathname === "/api/admin/integrations/google-sheets/sync") {
    const user = await requireUser(req, "admin");
    const { confirmation = "" } = await readJson(req);
    if (confirmation !== "SYNC_STUDENT_DIRECTORY") throw httpError(422, "SYNC_CONFIRMATION_REQUIRED", "Cần xác nhận rõ trước khi đồng bộ danh bạ học sinh.");
    return sendJson(res, 200, { result: await syncGoogleDirectory(user.id) });
  }

  const confirmMatch = url.pathname.match(/^\/api\/admin\/registrations\/([^/]+)\/confirm-payment$/);
  if (method === "PATCH" && confirmMatch) {
    const user = await requireUser(req, "admin");
    const timestamp = nowIso();
    if (businessStore) {
      const result = await businessStore.confirmPayment({ registrationId: confirmMatch[1], actorUserId: user.id, timestamp });
      return sendJson(res, 200, result);
    }
    const registration = db.prepare("SELECT * FROM registrations WHERE id = ?").get(confirmMatch[1]);
    if (!registration) throw httpError(404, "REGISTRATION_NOT_FOUND", "Không tìm thấy đơn đăng ký.");
    if (!["payment", "submitted"].includes(registration.status)) throw httpError(409, "INVALID_TRANSITION", "Trạng thái hiện tại không cho phép xác nhận phí.");
    db.prepare("UPDATE registrations SET status = 'confirmed', updated_at = ? WHERE id = ?").run(timestamp, registration.id);
    db.prepare(`INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, before_json, after_json, created_at)
      VALUES (?, ?, 'CONFIRM_PAYMENT', 'registration', ?, ?, ?, ?)`)
      .run(id("audit"), user.id, registration.id, JSON.stringify({ status: registration.status }), JSON.stringify({ status: "confirmed" }), timestamp);
    return sendJson(res, 200, { id: registration.id, status: "confirmed" });
  }

  if (method === "GET" && url.pathname === "/api/admin/reports/registrations.csv") {
    await requireUser(req, "admin");
    const rows = await listRegistrations({ role: "admin" });
    const statusNames = { payment: "Chờ thanh toán", confirmed: "Đã xác nhận", waitlist: "Danh sách chờ", conflict: "Trùng lịch", submitted: "Đã gửi", cancelled: "Đã hủy" };
    const csvRows = [["Mã đơn","Học sinh","Lớp","CLB","Lịch","Trạng thái","Số tiền"], ...rows.map((row) => [row.id,row.student,row.className,row.club,row.schedule,statusNames[row.status] || row.status,row.amount])];
    const csv = "\uFEFF" + csvRows.map((row) => row.map((value) => `"${String(value).replaceAll('"','""')}"`).join(",")).join("\r\n");
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="NSHM_Danh_sach_dang_ky.csv"', "Content-Length": Buffer.byteLength(csv) });
    return res.end(csv);
  }

  throw httpError(404, "NOT_FOUND", "Không tìm thấy API được yêu cầu.");
}

const mimeTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  if (!PUBLIC_FILES.has(safePath.replaceAll("\\", "/"))) throw httpError(404, "NOT_FOUND", "Không tìm thấy tệp.");
  const filePath = resolve(ROOT, safePath);
  if (!filePath.startsWith(resolve(ROOT)) || !existsSync(filePath) || filePath.includes(`${join(ROOT, "data")}`)) throw httpError(404, "NOT_FOUND", "Không tìm thấy tệp.");
  const content = await readFile(filePath);
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
      sendJson(res, error.status || 500, { error: { code: error.code || "INTERNAL_ERROR", message: error.status ? error.message : "Hệ thống gặp lỗi không mong muốn.", details: error.details } });
      if (!error.status) console.error(error);
    }
}

export function createAppServer() {
  return createServer(handleRequest);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const server = createAppServer();
  server.listen(PORT, HOST, () => console.log(`NSHM Clubs running at http://${HOST}:${PORT}`));
}
