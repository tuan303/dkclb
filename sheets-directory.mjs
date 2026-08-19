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
};

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
      const current = guardians.get(account) || {
        account,
        initialPassword: account,
        mustChangePassword: true,
        displayName: cell(row, mapping[phoneField === "fatherPhone" ? "fatherName" : "motherName"]) || "Phụ huynh học sinh",
        students: [],
      };
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

export function createGoogleSheetsDirectorySource(config) {
  const normalizedConfig = {
    spreadsheetId: String(config.spreadsheetId || "").trim(),
    sheetName: String(config.sheetName || "").trim(),
    headerRow: Number(config.headerRow || 1),
    serviceAccountEmail: String(config.serviceAccountEmail || "").trim(),
    accessToken: String(config.accessToken || "").trim(),
  };
  const authClientFactory = typeof config.authClientFactory === "function" ? config.authClientFactory : null;
  const auth = new GoogleAuth({ scopes: [READONLY_SCOPE] });
  const tokenClient = normalizedConfig.accessToken ? new OAuth2Client() : null;
  if (tokenClient) tokenClient.setCredentials({ access_token: normalizedConfig.accessToken });

  async function request(options) {
    try {
      const client = tokenClient || (authClientFactory ? await authClientFactory() : await auth.getClient());
      const response = await client.request(options);
      return response.data;
    } catch (error) {
      const status = Number(error.response?.status || error.code || 0);
      if (status === 403) throw integrationError(503, "SHEETS_ACCESS_DENIED", "Service account chưa có quyền Viewer trên Sheet hoặc Google Sheets API chưa được bật.", error);
      if (status === 404) throw integrationError(404, "SHEETS_NOT_FOUND", "Không tìm thấy Google Sheet hoặc tab dữ liệu được cấu hình.", error);
      if (/credential|default credentials|Could not load/i.test(String(error.message))) {
        throw integrationError(503, "GOOGLE_ADC_REQUIRED", "Backend chưa có Application Default Credentials. Hãy chạy bằng service account trên Cloud Run hoặc cấu hình ADC an toàn cho môi trường phát triển.", error);
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

  async function readDirectory(maxRows) {
    const spreadsheet = await metadata();
    const sheets = (spreadsheet.sheets || []).map((item) => item.properties);
    const target = sheets.find((item) => item.title === normalizedConfig.sheetName && !item.hidden);
    if (!target) throw integrationError(404, "SHEET_TAB_NOT_FOUND", `Không tìm thấy tab hiển thị có tên chính xác “${normalizedConfig.sheetName}”.`);
    const columnCount = Math.min(Number(target.gridProperties?.columnCount || 26), MAX_COLUMNS);
    const rowCount = Number(target.gridProperties?.rowCount || normalizedConfig.headerRow + maxRows);
    const endRow = Math.min(rowCount, normalizedConfig.headerRow + maxRows);
    const lastColumn = columnName(columnCount);
    const headerRange = `${quoteSheetName(normalizedConfig.sheetName)}!A${normalizedConfig.headerRow}:${lastColumn}${normalizedConfig.headerRow}`;
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
      const chunkRange = `${quoteSheetName(normalizedConfig.sheetName)}!A${startRow}:${lastColumn}${chunkEndRow}`;
      const valuesPayload = await request({
        url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(normalizedConfig.spreadsheetId)}/values/${encodeURIComponent(chunkRange)}`,
        params: { valueRenderOption: "FORMATTED_VALUE", majorDimension: "ROWS" },
      });
      const chunkRows = valuesPayload.values || [];
      while (chunkRows.length < chunkEndRow - startRow + 1) chunkRows.push([]);
      rows.push(...chunkRows);
    }
    const range = `${quoteSheetName(normalizedConfig.sheetName)}!A${normalizedConfig.headerRow}:${lastColumn}${endRow}`;
    const analysis = missing.length ? null : analyzeDirectoryRows(rows, mapping, normalizedConfig.headerRow + 1);
    return { spreadsheet, target, rowCount, columnCount, range, headers, mapping, missing, rows, analysis };
  }

  return {
    getStatus() {
      return {
        configured: Boolean(normalizedConfig.spreadsheetId && normalizedConfig.sheetName && normalizedConfig.headerRow > 0),
        spreadsheetId: normalizedConfig.spreadsheetId,
        sheetName: normalizedConfig.sheetName,
        headerRow: normalizedConfig.headerRow,
        serviceAccountEmail: normalizedConfig.serviceAccountEmail,
        accessMode: "read-only",
        credentialMode: tokenClient ? "short-lived-impersonated-token" : authClientFactory ? "workload-identity-federation" : "application-default-credentials",
      };
    },

    async preview() {
      const { spreadsheet, target, rowCount, columnCount, range, headers, mapping, missing, analysis } = await readDirectory(PREVIEW_ROWS);
      return {
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
        snapshot: buildDirectorySnapshot(result.rows, result.mapping),
        analysis: result.analysis,
        source: { spreadsheetId: normalizedConfig.spreadsheetId, sheetName: normalizedConfig.sheetName, inspectedRange: result.range },
      };
    },
  };
}
