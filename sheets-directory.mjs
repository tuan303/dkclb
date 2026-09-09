import { GoogleAuth, OAuth2Client } from "google-auth-library";

const READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const PREVIEW_ROWS = 100;
const MAX_SYNC_ROWS = 10_000;
const MAX_COLUMNS = 100;

const FIELD_ALIASES = {
  studentCode: ["ma hoc sinh", "ma hs", "student id", "student code"],
  studentName: ["ho va ten hoc sinh", "ho ten hoc sinh", "ten hoc sinh", "ho va ten", "ho ten"],
  dateOfBirth: ["ngay sinh", "ngay thang nam sinh", "date of birth", "dob"],
  className: ["lop", "lop hoc", "ten lop", "lop 26 27", "lop 2026 2027", "class"],
  gradeBand: ["khoi", "khoi lop", "grade", "grade level"],
  educationLevel: ["cap hoc", "bac hoc", "school level", "education level"],
  fatherName: ["ho ten bo", "ho va ten bo", "ten bo", "ho ten cha", "ten cha"],
  fatherPhone: ["sdt bo", "so dien thoai bo", "dien thoai bo", "dt bo", "sdt cha", "so dien thoai cha", "dien thoai cha"],
  motherName: ["ho ten me", "ho va ten me", "ten me"],
  motherPhone: ["sdt me", "so dien thoai me", "dien thoai me", "dt me"],
  // Cột email trong file danh bạ của trường tên là "Email bố" / "Email mẹ";
  // normalizeHeader bỏ dấu và hạ chữ thường nên khớp thành "email bo" / "email me".
  // KHÔNG đưa vào REQUIRED_FIELDS: thiếu email thì đồng bộ vẫn phải chạy.
  fatherEmail: ["email bo", "mail bo", "email cha", "mail cha"],
  motherEmail: ["email me", "mail me"],
};

// Chỉ nhận chuỗi trông như địa chỉ email. Nhà trường gõ tay 7.119 dòng nên có ô
// ghi "không có", có ô để trống, có ô ghi số điện thoại. Nhận bừa thì cột Email
// trong phần mềm đầy rác mà không ai biết rác từ đâu ra.
function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email.includes("@") || email.includes(" ")) return "";
  const [tenNguoi, tenMien] = email.split("@");
  if (!tenNguoi || !tenMien || !tenMien.includes(".")) return "";
  return email;
}

const REQUIRED_FIELDS = ["studentCode", "studentName", "dateOfBirth", "className"];

function integrationError(status, code, message, cause) {
  const error = new Error(message, { cause });
  Object.assign(error, { status, code });
  return error;
}

export function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function detectColumnMapping(headers) {
  const normalized = headers.map(normalizeHeader);
  const mapping = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const index = normalized.findIndex((header) => aliases.includes(header));
    if (index >= 0) mapping[field] = { index, header: String(headers[index] || "") };
  }
  const missing = REQUIRED_FIELDS.filter((field) => !mapping[field]);
  if (!mapping.educationLevel && !mapping.gradeBand) missing.push("educationLevel hoặc gradeBand");
  if (!mapping.fatherPhone && !mapping.motherPhone) missing.push("fatherPhone hoặc motherPhone");
  return { mapping, missing };
}

export function normalizeVietnamesePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  let national = digits;
  if (national.startsWith("84")) national = national.slice(2);
  else if (national.startsWith("0")) national = national.slice(1);
  if (!/^[35789]\d{8}$/.test(national)) return null;
  return `+84${national}`;
}

export function toVietnameseLocalPhone(value) {
  const e164 = normalizeVietnamesePhone(value);
  return e164 ? `0${e164.slice(3)}` : null;
}

function cell(row, descriptor) {
  return descriptor ? String(row[descriptor.index] || "").trim() : "";
}

function extractGrade(className, gradeBand = "") {
  return Number(String(className).match(/\d{1,2}/)?.[0] || String(gradeBand).match(/\d{1,2}/)?.[0] || 0);
}

function deriveEducationLevel(grade, explicitLevel = "") {
  if (explicitLevel) return explicitLevel;
  if (grade >= 1 && grade <= 5) return "Tiểu học";
  if (grade >= 6 && grade <= 9) return "THCS";
  if (grade >= 10 && grade <= 12) return "THPT";
  return "";
}

export function buildGuardianAccounts(rows, mapping) {
  const guardians = new Map();
  for (const row of rows) {
    const studentCode = cell(row, mapping.studentCode);
    if (!studentCode) continue;
    for (const [phoneField, relationship] of [["fatherPhone", "Bố"], ["motherPhone", "Mẹ"]]) {
      const account = toVietnameseLocalPhone(cell(row, mapping[phoneField]));
      if (!account) continue;
      const laBo = phoneField === "fatherPhone";
      const current = guardians.get(account) || {
        account,
        initialPassword: account,
        mustChangePassword: true,
        displayName: cell(row, mapping[laBo ? "fatherName" : "motherName"]) || "Phụ huynh học sinh",
        email: "",
        students: [],
      };
      // Email lấy đúng bên của số điện thoại: SĐT bố đi với email bố. Giữ giá trị
      // gặp trước để kết quả không đổi giữa các lần chạy, giống cách xử lý tên.
      if (!current.email) current.email = cleanEmail(cell(row, mapping[laBo ? "fatherEmail" : "motherEmail"]));
      const existingStudent = current.students.find((student) => student.studentCode === studentCode);
      if (!existingStudent) {
        current.students.push({ studentCode, relationship });
      } else if (existingStudent.relationship !== relationship) {
        existingStudent.relationship = "Bố/Mẹ";
      }
      guardians.set(account, current);
    }
  }
  return [...guardians.values()];
}

export function buildDirectorySnapshot(rows, mapping) {
  const students = [];
  for (const row of rows) {
    if (!row.some((value) => String(value || "").trim())) continue;
    const code = cell(row, mapping.studentCode);
    const name = cell(row, mapping.studentName);
    const dateOfBirth = cell(row, mapping.dateOfBirth);
    const className = cell(row, mapping.className);
    const grade = extractGrade(className, cell(row, mapping.gradeBand));
    const educationLevel = deriveEducationLevel(grade, cell(row, mapping.educationLevel));
    if (!code || !name || !dateOfBirth || !className || !educationLevel || grade < 1 || grade > 12) continue;
    students.push({ code, name, dateOfBirth, className, educationLevel, grade });
  }
  return { students, guardians: buildGuardianAccounts(rows, mapping) };
}

export function analyzeDirectoryRows(rows, mapping, firstDataRow) {
  const issues = [];
  const students = new Set();
  const phones = new Set();
  let blankRows = 0;
  let validRows = 0;
  let warningRows = 0;

  rows.forEach((row, index) => {
    const sourceRow = firstDataRow + index;
    if (!row.some((value) => String(value || "").trim())) {
      blankRows += 1;
      return;
    }
    const studentCode = cell(row, mapping.studentCode);
    const studentName = cell(row, mapping.studentName);
    const dateOfBirth = cell(row, mapping.dateOfBirth);
    const className = cell(row, mapping.className);
    const grade = extractGrade(className, cell(row, mapping.gradeBand));
    const educationLevel = deriveEducationLevel(grade, cell(row, mapping.educationLevel));
    const fatherPhoneRaw = cell(row, mapping.fatherPhone);
    const motherPhoneRaw = cell(row, mapping.motherPhone);
    const fatherPhone = normalizeVietnamesePhone(fatherPhoneRaw);
    const motherPhone = normalizeVietnamesePhone(motherPhoneRaw);
    const rowErrors = [];
    const rowWarnings = [];

    if (!studentCode) rowErrors.push("MISSING_STUDENT_CODE");
    if (!studentName) rowErrors.push("MISSING_STUDENT_NAME");
    if (!dateOfBirth) rowErrors.push("MISSING_DATE_OF_BIRTH");
    if (!className) rowErrors.push("MISSING_CLASS");
    else {
      if (grade < 1 || grade > 12) rowErrors.push("INVALID_CLASS_GRADE");
    }
    if (!educationLevel) rowErrors.push("MISSING_EDUCATION_LEVEL");
    if (fatherPhoneRaw && !fatherPhone) (motherPhone ? rowWarnings : rowErrors).push("INVALID_FATHER_PHONE");
    if (motherPhoneRaw && !motherPhone) (fatherPhone ? rowWarnings : rowErrors).push("INVALID_MOTHER_PHONE");
    if (!fatherPhone && !motherPhone) rowErrors.push("MISSING_VALID_GUARDIAN_PHONE");
    if (studentCode && students.has(normalizeHeader(studentCode))) rowErrors.push("DUPLICATE_STUDENT_CODE");

    if (studentCode) students.add(normalizeHeader(studentCode));
    if (fatherPhone) phones.add(fatherPhone);
    if (motherPhone) phones.add(motherPhone);
    if (rowWarnings.length) warningRows += 1;
    if (rowErrors.length || rowWarnings.length) {
      if (issues.length < 25) issues.push({ row: sourceRow, severity: rowErrors.length ? "error" : "warning", codes: [...rowErrors, ...rowWarnings] });
    }
    if (!rowErrors.length) validRows += 1;
  });

  return {
    scannedRows: rows.length,
    validRows,
    invalidRows: rows.length - blankRows - validRows,
    warningRows,
    blankRows,
    uniqueStudents: students.size,
    uniqueGuardians: phones.size,
    issues,
    issuesTruncated: issues.length === 25,
  };
}

function columnName(number) {
  let value = number;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function quoteSheetName(name) {
  return `'${String(name).replaceAll("'", "''")}'`;
}

// Google Sheets API thỉnh thoảng trả 503/500 hoặc 429 trong vài giây rồi tự khỏi —
// đã gặp thật khi khảo sát file của trường. Không thử lại thì một trục trặc thoáng qua
// bị ghi thành "nguồn lỗi", và vì lỗi một nguồn khiến cả lần đồng bộ bỏ qua phần đánh
// dấu nghỉ học, danh sách sẽ đứng yên cho tới lần chạy sau.
//
// Chỉ thử lại những lỗi có thể tự khỏi. 401/403/404 là sai cấu hình hoặc sai quyền:
// thử lại chỉ làm chậm và che mất nguyên nhân thật.
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function isRetryableSheetsError(error) {
  const status = Number(error?.response?.status || 0);
  if (status) return RETRYABLE_STATUSES.has(status);
  // Không có mã HTTP nghĩa là hỏng ở tầng mạng (đứt kết nối, hết thời gian chờ, DNS).
  return /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EPIPE|socket hang up|network/i.test(
    String(error?.code || error?.message || ""),
  );
}

export async function withRetry(task, { attempts = 4, baseDelayMs = 500, sleep = defaultSleep } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryableSheetsError(error)) throw error;
      // Giãn theo cấp số nhân, cộng nhiễu ngẫu nhiên để ba tab không cùng gõ lại một nhịp.
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await sleep(delay + Math.floor(Math.random() * baseDelayMs));
    }
  }
  throw lastError;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createGoogleSheetsDirectorySource(config) {
  const gid = String(config.sheetGid ?? "").trim();
  const normalizedConfig = {
    key: String(config.key || "default").trim(),
    label: String(config.label || "Danh sách học sinh").trim(),
    spreadsheetId: String(config.spreadsheetId || "").trim(),
    sheetName: String(config.sheetName || "").trim(),
    // Link giáo vụ gửi chỉ có gid chứ không có tên tab, mà tên tab thì hay bị đổi.
    // Trỏ theo gid thì đổi tên tab bao nhiêu lần cũng vẫn đọc đúng.
    sheetGid: /^[0-9]+$/.test(gid) ? Number(gid) : null,
    headerRow: Number(config.headerRow || 1),
    serviceAccountEmail: String(config.serviceAccountEmail || "").trim(),
    accessToken: String(config.accessToken || "").trim(),
  };
  const authClientFactory = typeof config.authClientFactory === "function" ? config.authClientFactory : null;
  const retryOptions = { attempts: 4, baseDelayMs: 500, ...(config.retry || {}) };
  const auth = new GoogleAuth({ scopes: [READONLY_SCOPE] });
  const tokenClient = normalizedConfig.accessToken ? new OAuth2Client() : null;
  if (tokenClient) tokenClient.setCredentials({ access_token: normalizedConfig.accessToken });

  async function request(options) {
    try {
      return await withRetry(async () => {
        const client = tokenClient || (authClientFactory ? await authClientFactory() : await auth.getClient());
        const response = await client.request(options);
        return response.data;
      }, retryOptions);
    } catch (error) {
      const status = Number(error.response?.status || error.code || 0);
      if (status === 403) throw integrationError(503, "SHEETS_ACCESS_DENIED", "Service account chưa có quyền Viewer trên Sheet hoặc Google Sheets API chưa được bật.", error);
      if (status === 404) throw integrationError(404, "SHEETS_NOT_FOUND", "Không tìm thấy Google Sheet hoặc tab dữ liệu được cấu hình.", error);
      if (/credential|default credentials|Could not load/i.test(String(error.message))) {
        throw integrationError(503, "GOOGLE_ADC_REQUIRED", "Backend chưa có Application Default Credentials. Hãy chạy bằng service account trên Cloud Run hoặc cấu hình ADC an toàn cho môi trường phát triển.", error);
      }
      if (isRetryableSheetsError(error)) {
        throw integrationError(503, "SHEETS_TEMPORARILY_UNAVAILABLE",
          `Google Sheets tạm thời không phản hồi (${status || "lỗi mạng"}) sau ${retryOptions.attempts} lần thử. Đây là sự cố thoáng qua phía Google, lần đồng bộ theo lịch kế tiếp sẽ tự thử lại.`, error);
      }
      throw integrationError(503, "SHEETS_CONNECTION_FAILED", "Không thể kết nối Google Sheets API. Vui lòng kiểm tra API, quyền Viewer và danh tính runtime.", error);
    }
  }

  async function metadata() {
    const fields = "spreadsheetId,properties.title,sheets.properties(sheetId,title,hidden,gridProperties(rowCount,columnCount,frozenRowCount))";
    return request({
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(normalizedConfig.spreadsheetId)}`,
      params: { fields },
    });
  }

  // Ưu tiên gid, rồi tới tên tab, cuối cùng là tab hiển thị đầu tiên. Mỗi file chỉ
  // có một bảng danh sách nên lấy tab đầu là suy đoán an toàn khi chưa cấu hình gì.
  function resolveTab(sheets) {
    if (normalizedConfig.sheetGid !== null) {
      const byGid = sheets.find((item) => Number(item.sheetId) === normalizedConfig.sheetGid);
      if (byGid) return byGid;
      throw integrationError(404, "SHEET_TAB_NOT_FOUND", `Không tìm thấy tab có gid ${normalizedConfig.sheetGid} trong file “${normalizedConfig.label}”.`);
    }
    if (normalizedConfig.sheetName) {
      const byName = sheets.find((item) => item.title === normalizedConfig.sheetName && !item.hidden);
      if (byName) return byName;
      throw integrationError(404, "SHEET_TAB_NOT_FOUND", `Không tìm thấy tab hiển thị có tên chính xác “${normalizedConfig.sheetName}”.`);
    }
    const firstVisible = sheets.find((item) => !item.hidden);
    if (firstVisible) return firstVisible;
    throw integrationError(404, "SHEET_TAB_NOT_FOUND", `File “${normalizedConfig.label}” không có tab nào đang hiển thị.`);
  }

  async function readDirectory(maxRows) {
    const spreadsheet = await metadata();
    const sheets = (spreadsheet.sheets || []).map((item) => item.properties);
    const target = resolveTab(sheets);
    const tabName = target.title;
    const columnCount = Math.min(Number(target.gridProperties?.columnCount || 26), MAX_COLUMNS);
    const rowCount = Number(target.gridProperties?.rowCount || normalizedConfig.headerRow + maxRows);
    const endRow = Math.min(rowCount, normalizedConfig.headerRow + maxRows);
    const lastColumn = columnName(columnCount);
    const headerRange = `${quoteSheetName(tabName)}!A${normalizedConfig.headerRow}:${lastColumn}${normalizedConfig.headerRow}`;
    const headerPayload = await request({
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(normalizedConfig.spreadsheetId)}/values/${encodeURIComponent(headerRange)}`,
      params: { valueRenderOption: "FORMATTED_VALUE", majorDimension: "ROWS" },
    });
    const headers = headerPayload.values?.[0] || [];
    const { mapping, missing } = detectColumnMapping(headers);
    const rows = [];
    const chunkSize = Math.min(2_000, Math.max(1, Math.floor(40_000 / columnCount)));
    for (let startRow = normalizedConfig.headerRow + 1; startRow <= endRow; startRow += chunkSize) {
      const chunkEndRow = Math.min(endRow, startRow + chunkSize - 1);
      const chunkRange = `${quoteSheetName(tabName)}!A${startRow}:${lastColumn}${chunkEndRow}`;
      const valuesPayload = await request({
        url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(normalizedConfig.spreadsheetId)}/values/${encodeURIComponent(chunkRange)}`,
        params: { valueRenderOption: "FORMATTED_VALUE", majorDimension: "ROWS" },
      });
      const chunkRows = valuesPayload.values || [];
      while (chunkRows.length < chunkEndRow - startRow + 1) chunkRows.push([]);
      rows.push(...chunkRows);
    }
    const range = `${quoteSheetName(tabName)}!A${normalizedConfig.headerRow}:${lastColumn}${endRow}`;
    const analysis = missing.length ? null : analyzeDirectoryRows(rows, mapping, normalizedConfig.headerRow + 1);
    return { spreadsheet, target, rowCount, columnCount, range, headers, mapping, missing, rows, analysis };
  }

  return {
    key: normalizedConfig.key,
    label: normalizedConfig.label,

    getStatus() {
      return {
        key: normalizedConfig.key,
        label: normalizedConfig.label,
        // Chỉ cần biết file nào; tab thì tự dò theo gid hoặc lấy tab hiển thị đầu tiên.
        configured: Boolean(normalizedConfig.spreadsheetId && normalizedConfig.headerRow > 0),
        spreadsheetId: normalizedConfig.spreadsheetId,
        sheetName: normalizedConfig.sheetName,
        sheetGid: normalizedConfig.sheetGid,
        headerRow: normalizedConfig.headerRow,
        serviceAccountEmail: normalizedConfig.serviceAccountEmail,
        accessMode: "read-only",
        credentialMode: tokenClient ? "short-lived-impersonated-token" : authClientFactory ? "workload-identity-federation" : "application-default-credentials",
      };
    },

    async preview() {
      const { spreadsheet, target, rowCount, columnCount, range, headers, mapping, missing, analysis } = await readDirectory(PREVIEW_ROWS);
      return {
        key: normalizedConfig.key,
        label: normalizedConfig.label,
        spreadsheet: { id: spreadsheet.spreadsheetId, title: spreadsheet.properties?.title || "", sheetId: target.sheetId },
        source: { sheetName: target.title, headerRow: normalizedConfig.headerRow, rowCount, columnCount: Number(target.gridProperties?.columnCount || 0), inspectedRange: range },
        headers,
        mapping: Object.fromEntries(Object.entries(mapping).map(([field, item]) => [field, item.header])),
        missing,
        readyToSync: missing.length === 0 && analysis?.invalidRows === 0,
        analysis,
      };
    },

    async loadForSync() {
      const result = await readDirectory(MAX_SYNC_ROWS);
      if (result.missing.length) throw integrationError(422, "SHEETS_MAPPING_INCOMPLETE", `Thiếu cột bắt buộc: ${result.missing.join(", ")}.`);
      if (result.analysis.invalidRows > 0) {
        throw integrationError(422, "SHEETS_DATA_INVALID", `Có ${result.analysis.invalidRows} dòng dữ liệu chưa hợp lệ. Hãy sửa Sheet và kiểm tra lại trước khi đồng bộ.`);
      }
      if (result.rows.length >= MAX_SYNC_ROWS) {
        throw integrationError(422, "SHEETS_SYNC_LIMIT", `Sheet vượt giới hạn ${MAX_SYNC_ROWS} dòng cho một lần đồng bộ an toàn.`);
      }
      return {
        key: normalizedConfig.key,
        label: normalizedConfig.label,
        snapshot: buildDirectorySnapshot(result.rows, result.mapping),
        analysis: result.analysis,
        source: {
          key: normalizedConfig.key, label: normalizedConfig.label,
          spreadsheetId: normalizedConfig.spreadsheetId, sheetName: result.target.title,
          sheetId: result.target.sheetId, inspectedRange: result.range,
        },
      };
    },
  };
}
