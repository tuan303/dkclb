// Chuẩn hóa và kiểm tra dữ liệu danh mục: đợt đăng ký, CLB và lớp CLB.
// Module thuần (không chạm CSDL, không phụ thuộc backend) để kiểm thử độc lập
// và dùng chung cho cả nhập thủ công lẫn nhập hàng loạt từ Excel/Google Sheets.
import { normalizeHeader } from "./sheets-directory.mjs";

export const DAY_LABELS = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
export const PERIOD_STATUSES = ["draft", "open", "closed", "locked"];
export const CLUB_VISUALS = ["sport", "stem", "art", "music", "life"];
export const MAX_IMPORT_ROWS = 2000;

const VISUAL_BY_CATEGORY = [
  [/the thao|sport|bong|vo|boi|co vua/, "sport"],
  [/stem|robot|coding|lap trinh|khoa hoc|toan/, "stem"],
  [/nghe thuat|my thuat|ve|hoi hoa|mua|nhay|dance|art/, "art"],
  [/am nhac|nhac|piano|guitar|thanh nhac|music/, "music"],
];

function invalid(code, message, field) {
  const error = new Error(message);
  Object.assign(error, { status: 422, code, field, expose: true });
  return error;
}

const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export function requireText(value, field, label, { max = 200, min = 1 } = {}) {
  const cleaned = text(value);
  if (cleaned.length < min) throw invalid("FIELD_REQUIRED", `Vui lòng nhập ${label}.`, field);
  if (cleaned.length > max) throw invalid("FIELD_TOO_LONG", `${label} tối đa ${max} ký tự.`, field);
  return cleaned;
}

export function optionalText(value, field, label, { max = 500 } = {}) {
  const cleaned = text(value);
  if (cleaned.length > max) throw invalid("FIELD_TOO_LONG", `${label} tối đa ${max} ký tự.`, field);
  return cleaned;
}

export function requireInteger(value, field, label, { min = 0, max = 1_000_000_000 } = {}) {
  const number = Number(String(value ?? "").toString().replace(/[^\d-]/g, ""));
  if (!Number.isFinite(number) || !Number.isInteger(number)) throw invalid("FIELD_NOT_NUMBER", `${label} phải là số nguyên.`, field);
  if (number < min || number > max) throw invalid("FIELD_OUT_OF_RANGE", `${label} phải nằm trong khoảng ${min}–${max}.`, field);
  return number;
}

// Tiền có thể nhập "1.200.000", "1,200,000 đ" hoặc số thuần.
export function parseMoney(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

// Trả về "HH:MM". Chấp nhận "16:15", "16h15", "16.15", "1615" và số thực Excel (0.6771 = 16:15).
export function parseTimeOfDay(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value < 0 || value >= 1) return null;
    const totalMinutes = Math.round(value * 24 * 60);
    return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
  }
  const raw = text(value).toLowerCase();
  // Excel lưu giờ dưới dạng phân số của một ngày; trình đọc .xlsx trả về chuỗi như "0.6770833".
  if (/^0?\.\d+$/.test(raw)) return parseTimeOfDay(Number(raw));
  const match = raw.match(/^(\d{1,2})\s*[:h.,]\s*(\d{1,2})/) || raw.match(/^(\d{1,2})(\d{2})$/) || raw.match(/^(\d{1,2})\s*(h|gio)$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] === "h" || match[2] === "gio" ? 0 : match[2] || 0);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function requireTimeOfDay(value, field, label) {
  const parsed = parseTimeOfDay(value);
  if (!parsed) throw invalid("FIELD_NOT_TIME", `${label} phải theo định dạng giờ HH:MM.`, field);
  return parsed;
}

// "16:15-17:30" hoặc "16h15 – 17h30" → { startTime, endTime }
export function parseTimeRange(value) {
  const parts = text(value).split(/[-–—~>]|den|đến/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const startTime = parseTimeOfDay(parts[0]);
  const endTime = parseTimeOfDay(parts[1]);
  return startTime && endTime ? { startTime, endTime } : null;
}

// Dùng cho dữ liệu nhập từ file: "Thứ 3", "T3", "CN", "Tuesday" hoặc số 2–7 theo cách gọi tiếng Việt.
export function parseDayOfWeek(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = normalizeHeader(value);
  if (!normalized) return null;
  if (/^(cn|chu nhat|sunday|sun)$/.test(normalized)) return 0;
  const english = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
    .findIndex((day) => normalized === day || normalized === day.slice(0, 3));
  if (english >= 0) return english;
  const vietnamese = normalized.match(/^(?:thu|t)\s*([2-7])$/) || normalized.match(/^([2-8])$/);
  if (vietnamese) {
    const number = Number(vietnamese[1]);
    return number === 8 ? 0 : number - 1;
  }
  return null;
}

export function requireDayOfWeek(value, field = "dayOfWeek", label = "Thứ trong tuần") {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 6) throw invalid("FIELD_OUT_OF_RANGE", `${label} phải là số từ 0 (Chủ nhật) đến 6 (Thứ 7).`, field);
  return number;
}

// "1,2,3" | "1-5" | "Khối 1 - 5" | "1;2;3" | [1,2,3] → [1,2,3,4,5]
export function parseGradeList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 1 && item <= 12))].sort((left, right) => left - right);
  }
  const raw = text(value).replace(/kh[oố]i|l[oớ]p|grade/gi, " ");
  if (!raw) return [];
  const grades = new Set();
  for (const chunk of raw.split(/[,;+/]/)) {
    const range = chunk.match(/(\d{1,2})\s*[-–—]\s*(\d{1,2})/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      for (let grade = Math.min(from, to); grade <= Math.max(from, to); grade += 1) grades.add(grade);
      continue;
    }
    for (const single of chunk.match(/\d{1,2}/g) || []) grades.add(Number(single));
  }
  return [...grades].filter((grade) => grade >= 1 && grade <= 12).sort((left, right) => left - right);
}

export function scheduleLabelOf({ dayOfWeek, startTime, endTime }) {
  return `${DAY_LABELS[dayOfWeek] ?? "—"} · ${startTime}–${endTime}`;
}

export function pickVisual(category, explicit = "") {
  const chosen = normalizeHeader(explicit);
  if (CLUB_VISUALS.includes(chosen)) return chosen;
  const normalized = normalizeHeader(category);
  for (const [pattern, visual] of VISUAL_BY_CATEGORY) if (pattern.test(normalized)) return visual;
  return "life";
}

// Sinh mã CLB ổn định từ tên khi file nguồn không có cột mã.
export function slugCode(name, prefix = "CLB") {
  const slug = normalizeHeader(name).split(" ").filter(Boolean).map((word) => word.slice(0, 3).toUpperCase()).join("").slice(0, 12);
  return slug ? `${prefix}-${slug}` : "";
}

export function normalizePeriodInput(input = {}, { existing = null } = {}) {
  const status = text(input.status ?? existing?.status ?? "draft").toLowerCase();
  if (!PERIOD_STATUSES.includes(status)) throw invalid("PERIOD_STATUS_INVALID", "Trạng thái đợt đăng ký không hợp lệ.", "status");
  const openAt = new Date(input.openAt ?? existing?.openAt ?? "");
  const closeAt = new Date(input.closeAt ?? existing?.closeAt ?? "");
  if (Number.isNaN(openAt.getTime())) throw invalid("PERIOD_OPEN_INVALID", "Thời điểm mở đăng ký không hợp lệ.", "openAt");
  if (Number.isNaN(closeAt.getTime())) throw invalid("PERIOD_CLOSE_INVALID", "Thời điểm đóng đăng ký không hợp lệ.", "closeAt");
  if (closeAt <= openAt) throw invalid("PERIOD_RANGE_INVALID", "Thời điểm đóng phải sau thời điểm mở đăng ký.", "closeAt");
  return {
    name: requireText(input.name ?? existing?.name, "name", "tên đợt đăng ký"),
    schoolYear: requireText(input.schoolYear ?? existing?.schoolYear, "schoolYear", "năm học", { max: 30 }),
    term: requireText(input.term ?? existing?.term, "term", "học kỳ", { max: 40 }),
    openAt: openAt.toISOString(),
    closeAt: closeAt.toISOString(),
    status,
    maxClubsPerStudent: requireInteger(input.maxClubsPerStudent ?? existing?.maxClubsPerStudent ?? 3, "maxClubsPerStudent", "số CLB tối đa mỗi học sinh", { min: 1, max: 20 }),
    note: optionalText(input.note ?? existing?.note ?? "", "note", "ghi chú", { max: 500 }),
  };
}

export function normalizeClubInput(input = {}, { existing = null } = {}) {
  const name = requireText(input.name ?? existing?.name, "name", "tên CLB");
  const category = requireText(input.category ?? existing?.category, "category", "nhóm môn", { max: 60 });
  const grades = parseGradeList(input.grades ?? input.grade ?? existing?.grades ?? []);
  if (!grades.length) throw invalid("CLUB_GRADES_REQUIRED", "Vui lòng chọn ít nhất một khối áp dụng.", "grades");
  return {
    code: requireText(input.code ?? existing?.code ?? slugCode(name), "code", "mã CLB", { max: 40 }).toUpperCase(),
    name,
    category,
    description: optionalText(input.description ?? existing?.description ?? "", "description", "mô tả", { max: 1000 }),
    emoji: optionalText(input.emoji ?? existing?.emoji ?? "🎯", "emoji", "biểu tượng", { max: 8 }) || "🎯",
    visual: pickVisual(category, input.visual ?? existing?.visual ?? ""),
    grades,
    sortOrder: requireInteger(input.sortOrder ?? existing?.sortOrder ?? 0, "sortOrder", "thứ tự hiển thị", { min: 0, max: 9999 }),
    active: input.active === undefined ? existing?.active !== false : Boolean(input.active),
  };
}

export function normalizeClassInput(input = {}, { existing = null, knownPeriodIds = null } = {}) {
  const periodId = requireText(input.periodId ?? existing?.periodId, "periodId", "đợt đăng ký", { max: 80 });
  if (knownPeriodIds && !knownPeriodIds.includes(periodId)) throw invalid("PERIOD_NOT_FOUND", "Đợt đăng ký không tồn tại.", "periodId");
  const dayOfWeek = requireDayOfWeek(input.dayOfWeek ?? existing?.dayOfWeek);
  const startTime = requireTimeOfDay(input.startTime ?? existing?.startTime, "startTime", "giờ bắt đầu");
  const endTime = requireTimeOfDay(input.endTime ?? existing?.endTime, "endTime", "giờ kết thúc");
  if (endTime <= startTime) throw invalid("CLASS_TIME_INVALID", "Giờ kết thúc phải sau giờ bắt đầu.", "endTime");
  const capacity = requireInteger(input.capacity ?? existing?.capacity, "capacity", "sĩ số tối đa", { min: 1, max: 500 });
  const minCapacity = requireInteger(input.minCapacity ?? existing?.minCapacity ?? 0, "minCapacity", "sĩ số tối thiểu", { min: 0, max: 500 });
  if (minCapacity > capacity) throw invalid("CLASS_CAPACITY_INVALID", "Sĩ số tối thiểu không được lớn hơn sĩ số tối đa.", "minCapacity");
  // Tổng chỗ đã dùng = ghi danh sẵn + đơn đang giữ chỗ, được đối chiếu với sĩ số ở tầng nghiệp vụ
  // vì số đơn chỉ biết được khi truy vấn CSDL.
  const enrolledBase = requireInteger(input.enrolledBase ?? existing?.enrolledBase ?? 0, "enrolledBase", "số đã ghi danh sẵn", { min: 0, max: 500 });
  return {
    clubId: requireText(input.clubId ?? existing?.clubId, "clubId", "CLB", { max: 80 }),
    periodId,
    name: optionalText(input.name ?? existing?.name ?? "", "name", "tên lớp", { max: 120 }),
    dayOfWeek,
    startTime,
    endTime,
    scheduleLabel: scheduleLabelOf({ dayOfWeek, startTime, endTime }),
    // Rỗng nghĩa là kế thừa khối áp dụng của CLB; khai riêng khi mỗi ca dành cho một khối khác nhau.
    grades: parseGradeList(input.grades ?? existing?.grades ?? []),
    room: requireText(input.room ?? existing?.room, "room", "phòng học", { max: 120 }),
    teacher: requireText(input.teacher ?? existing?.teacher, "teacher", "giáo viên", { max: 160 }),
    capacity,
    minCapacity,
    enrolledBase,
    fee: requireInteger(parseMoney(input.fee ?? existing?.fee) ?? 0, "fee", "học phí", { min: 0, max: 500_000_000 }),
    waitlistEnabled: input.waitlistEnabled === undefined ? existing?.waitlistEnabled !== false : Boolean(input.waitlistEnabled),
    sortOrder: requireInteger(input.sortOrder ?? existing?.sortOrder ?? 0, "sortOrder", "thứ tự hiển thị", { min: 0, max: 9999 }),
    active: input.active === undefined ? existing?.active !== false : Boolean(input.active),
  };
}

const CATALOG_FIELD_ALIASES = {
  clubCode: ["ma clb", "ma cau lac bo", "ma", "club code", "code"],
  clubName: ["ten clb", "ten cau lac bo", "clb", "cau lac bo", "club", "club name", "ten"],
  category: ["nhom mon", "nhom", "danh muc", "linh vuc", "phan mon", "category", "group"],
  description: ["mo ta", "gioi thieu", "noi dung", "description"],
  emoji: ["bieu tuong", "icon", "emoji"],
  grades: ["khoi", "khoi ap dung", "khoi lop", "doi tuong", "grade", "grades"],
  className: ["ten lop", "lop", "ca", "ca hoc", "nhom lop", "class", "class name"],
  day: ["thu", "ngay hoc", "thu trong tuan", "day", "weekday"],
  timeRange: ["khung gio", "gio hoc", "thoi gian", "time", "gio"],
  startTime: ["gio bat dau", "bat dau", "start", "start time", "tu"],
  endTime: ["gio ket thuc", "ket thuc", "end", "end time", "den"],
  room: ["phong", "phong hoc", "dia diem", "room", "location"],
  teacher: ["giao vien", "gv", "giang vien", "phu trach", "teacher"],
  capacity: ["si so toi da", "si so", "so luong toi da", "toi da", "quota", "capacity", "max"],
  minCapacity: ["si so toi thieu", "toi thieu", "min", "min capacity"],
  fee: ["hoc phi", "phi", "gia", "fee", "tuition"],
};

const REQUIRED_CATALOG_FIELDS = ["clubName", "room", "teacher", "capacity"];

export function detectCatalogMapping(headers = []) {
  const normalized = headers.map(normalizeHeader);
  const mapping = {};
  for (const [field, aliases] of Object.entries(CATALOG_FIELD_ALIASES)) {
    const index = normalized.findIndex((header) => aliases.includes(header));
    if (index >= 0) mapping[field] = { index, header: String(headers[index] ?? "") };
  }
  const missing = REQUIRED_CATALOG_FIELDS.filter((field) => !mapping[field]);
  if (!mapping.day) missing.push("day");
  if (!mapping.timeRange && !(mapping.startTime && mapping.endTime)) missing.push("timeRange hoặc startTime+endTime");
  return { mapping, missing };
}

function cellOf(row, descriptor) {
  if (!descriptor) return "";
  const value = row[descriptor.index];
  return value === null || value === undefined ? "" : value;
}

/**
 * Mỗi dòng trong file là MỘT LỚP. Các dòng cùng mã/tên CLB được gộp về một CLB
 * để một CLB có nhiều ca học khác nhau.
 */
export function analyzeCatalogImport(rows = [], mapping = {}, { periodId = "", defaultFee = 0 } = {}) {
  const issues = [];
  const clubsByKey = new Map();
  const classes = [];
  const scanned = rows.slice(0, MAX_IMPORT_ROWS);
  const seenSlots = new Set();

  scanned.forEach((row, index) => {
    const rowNumber = index + 1;
    const codes = [];
    if (!row.some((value) => text(value))) return;

    const clubName = text(cellOf(row, mapping.clubName));
    if (!clubName) codes.push("Thiếu tên CLB");

    const day = parseDayOfWeek(cellOf(row, mapping.day));
    if (day === null) codes.push("Thứ học không đọc được");

    const range = mapping.timeRange ? parseTimeRange(cellOf(row, mapping.timeRange)) : null;
    const startTime = range?.startTime || parseTimeOfDay(cellOf(row, mapping.startTime));
    const endTime = range?.endTime || parseTimeOfDay(cellOf(row, mapping.endTime));
    if (!startTime || !endTime) codes.push("Khung giờ không đọc được");
    else if (endTime <= startTime) codes.push("Giờ kết thúc không sau giờ bắt đầu");

    const room = text(cellOf(row, mapping.room));
    if (!room) codes.push("Thiếu phòng học");
    const teacher = text(cellOf(row, mapping.teacher));
    if (!teacher) codes.push("Thiếu giáo viên");

    const capacity = Number(String(cellOf(row, mapping.capacity) ?? "").replace(/[^\d]/g, ""));
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) codes.push("Sĩ số tối đa không hợp lệ");

    const minCapacityRaw = text(cellOf(row, mapping.minCapacity));
    const minCapacity = minCapacityRaw ? Number(minCapacityRaw.replace(/[^\d]/g, "")) : 0;
    if (minCapacity > capacity) codes.push("Sĩ số tối thiểu lớn hơn sĩ số tối đa");

    const fee = parseMoney(cellOf(row, mapping.fee)) ?? defaultFee;
    if (fee === null || fee < 0) codes.push("Học phí không hợp lệ");

    const grades = parseGradeList(cellOf(row, mapping.grades));
    if (!grades.length) codes.push("Khối áp dụng không đọc được");

    if (codes.length) {
      issues.push({ row: rowNumber, severity: "error", codes });
      return;
    }

    const clubCode = (text(cellOf(row, mapping.clubCode)) || slugCode(clubName)).toUpperCase();
    const key = clubCode || normalizeHeader(clubName);
    if (!clubsByKey.has(key)) {
      clubsByKey.set(key, {
        key,
        code: clubCode,
        name: clubName,
        category: text(cellOf(row, mapping.category)) || "Khác",
        description: text(cellOf(row, mapping.description)),
        emoji: text(cellOf(row, mapping.emoji)) || "🎯",
        grades,
        sortOrder: clubsByKey.size,
      });
    } else {
      // Một CLB xuất hiện ở nhiều dòng: hợp nhất khối áp dụng của tất cả các ca.
      const club = clubsByKey.get(key);
      club.grades = [...new Set([...club.grades, ...grades])].sort((left, right) => left - right);
    }

    const slotKey = `${key}|${day}|${startTime}|${room}`;
    if (seenSlots.has(slotKey)) issues.push({ row: rowNumber, severity: "warning", codes: ["Trùng lớp đã khai báo ở dòng trước (cùng CLB, thứ, giờ, phòng)"] });
    seenSlots.add(slotKey);

    classes.push({
      clubKey: key,
      periodId,
      name: text(cellOf(row, mapping.className)),
      grades,
      dayOfWeek: day,
      startTime,
      endTime,
      scheduleLabel: scheduleLabelOf({ dayOfWeek: day, startTime, endTime }),
      room,
      teacher,
      capacity,
      minCapacity,
      fee,
      sortOrder: classes.length,
      sourceRow: rowNumber,
    });
  });

  // Cảnh báo xếp phòng: hai lớp khác CLB nhưng cùng phòng, cùng thứ, giao giờ.
  for (let left = 0; left < classes.length; left += 1) {
    for (let right = left + 1; right < classes.length; right += 1) {
      const a = classes[left];
      const b = classes[right];
      if (a.room === b.room && a.dayOfWeek === b.dayOfWeek && a.startTime < b.endTime && b.startTime < a.endTime) {
        issues.push({ row: b.sourceRow, severity: "warning", codes: [`Trùng phòng ${b.room} với dòng ${a.sourceRow}`] });
      }
    }
  }

  const errorRows = new Set(issues.filter((issue) => issue.severity === "error").map((issue) => issue.row));
  return {
    clubs: [...clubsByKey.values()],
    classes,
    issues: issues.sort((left, right) => left.row - right.row),
    counters: {
      scannedRows: scanned.length,
      validRows: classes.length,
      invalidRows: errorRows.size,
      warningRows: issues.filter((issue) => issue.severity === "warning").length,
      clubs: clubsByKey.size,
      classes: classes.length,
      truncated: rows.length > MAX_IMPORT_ROWS,
    },
    readyToImport: classes.length > 0 && errorRows.size === 0,
  };
}
