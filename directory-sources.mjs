// Cấu hình và đọc song song NHIỀU file Google Sheet danh sách học sinh.
//
// Trường lưu học sinh ở ba file riêng theo cấp học, giáo vụ mỗi cấp tự cập nhật
// file của mình. Lớp này đọc cả ba, giữ nguyên kết quả từng nguồn (thành công hay
// lỗi) rồi giao cho directory-merge.mjs gộp lại. Quan trọng nhất: một file lỗi
// KHÔNG được làm hỏng lần đồng bộ — phần còn lại vẫn cập nhật bình thường, chỉ là
// không ai bị đánh dấu nghỉ học trong lần đó.

import { createGoogleSheetsDirectorySource } from "./sheets-directory.mjs";
import { mergeDirectorySnapshots } from "./directory-merge.mjs";

// Ba file danh sách học sinh của trường. Thay bằng biến môi trường
// GOOGLE_SHEETS_SOURCES nếu cần trỏ sang file khác mà không phải sửa mã nguồn.
export const DEFAULT_DIRECTORY_SOURCES = [
  { key: "tieuhoc", label: "Tiểu học", spreadsheetId: "1h4UXgj7HXNEU6Gm1sTrEC-oZlJQC5Mc4i8QZjtSd38o", sheetGid: "0" },
  { key: "thcs", label: "THCS", spreadsheetId: "1dO1Y8wc3-XpeyrHCzblyCZ6jJKj40OpwAO2Bj6tirUo", sheetGid: "0" },
  { key: "thpt", label: "THPT", spreadsheetId: "1aGSuLq9sgbHDDn8KCABnTKlXQnsRZkLGUYaQ9jua5Ps", sheetGid: "804479104" },
];

function sourcesError(status, code, message, details) {
  const error = new Error(message);
  Object.assign(error, { status, code, details, expose: true });
  return error;
}

/**
 * Tách spreadsheetId và gid từ đường dẫn Google Sheets đầy đủ, để người cấu hình
 * chỉ việc dán nguyên link trên thanh địa chỉ thay vì tự bóc mã file.
 * Nhận cả chuỗi đã là spreadsheetId sẵn.
 */
export function parseSpreadsheetRef(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const idMatch = text.match(/[-\w]{25,}/);
  if (!idMatch) return null;
  const gidMatch = text.match(/[?#&]gid=(\d+)/);
  return { spreadsheetId: idMatch[0], sheetGid: gidMatch ? gidMatch[1] : null };
}

function normalizeSourceConfig(input, index) {
  const ref = parseSpreadsheetRef(input.url || input.spreadsheetId);
  if (!ref) throw sourcesError(500, "SHEETS_SOURCE_INVALID", `Nguồn dữ liệu thứ ${index + 1} thiếu mã file Google Sheet hợp lệ.`);
  return {
    key: String(input.key || `nguon${index + 1}`).trim(),
    label: String(input.label || `Nguồn ${index + 1}`).trim(),
    spreadsheetId: ref.spreadsheetId,
    // gid ghi rõ trong cấu hình được ưu tiên hơn gid lẫn trong đường dẫn.
    sheetGid: input.sheetGid ?? ref.sheetGid,
    sheetName: String(input.sheetName || "").trim(),
    headerRow: Number(input.headerRow || 1),
  };
}

/**
 * Thứ tự ưu tiên: GOOGLE_SHEETS_SOURCES (JSON) → cấu hình một file kiểu cũ
 * (GOOGLE_SHEETS_SPREADSHEET_ID) → ba file mặc định của trường.
 */
export function parseDirectorySources(env = {}) {
  const raw = String(env.GOOGLE_SHEETS_SOURCES || "").trim();
  if (raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw sourcesError(500, "SHEETS_SOURCE_INVALID", "GOOGLE_SHEETS_SOURCES không phải JSON hợp lệ.", { cause: String(error.message) });
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw sourcesError(500, "SHEETS_SOURCE_INVALID", "GOOGLE_SHEETS_SOURCES phải là một mảng có ít nhất một nguồn.");
    }
    return dedupeKeys(parsed.map(normalizeSourceConfig));
  }

  if (String(env.GOOGLE_SHEETS_SPREADSHEET_ID || "").trim()) {
    return dedupeKeys([normalizeSourceConfig({
      key: "default",
      label: String(env.GOOGLE_SHEETS_LABEL || "Danh sách học sinh"),
      spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
      sheetName: env.GOOGLE_SHEETS_TAB,
      sheetGid: env.GOOGLE_SHEETS_GID,
      headerRow: env.GOOGLE_SHEETS_HEADER_ROW,
    }, 0)]);
  }

  return dedupeKeys(DEFAULT_DIRECTORY_SOURCES.map(normalizeSourceConfig));
}

// Khóa nguồn được dùng làm định danh trong nhật ký và trên màn hình theo dõi, nên
// trùng khóa là lỗi cấu hình phải chặn ngay chứ không âm thầm ghi đè lẫn nhau.
function dedupeKeys(configs) {
  const seen = new Set();
  for (const config of configs) {
    if (seen.has(config.key)) {
      throw sourcesError(500, "SHEETS_SOURCE_INVALID", `Khóa nguồn “${config.key}” bị khai báo trùng.`);
    }
    seen.add(config.key);
  }
  return configs;
}

function describeFailure(error) {
  return {
    message: error?.message || "Không đọc được nguồn dữ liệu.",
    code: error?.code || "SHEETS_READ_FAILED",
  };
}

/**
 * @param configs        danh sách nguồn đã chuẩn hóa
 * @param credentials    { serviceAccountEmail, accessToken, authClientFactory }
 * @param createSource   cho phép kiểm thử thay bằng nguồn giả
 */
export function createMultiSourceDirectory({ configs, credentials = {}, createSource = createGoogleSheetsDirectorySource }) {
  const sources = configs.map((config) => createSource({ ...config, ...credentials }));

  // Đọc song song: ba file mất bằng thời gian một file, và một file hỏng không
  // chặn hai file kia. allSettled chứ không phải all — đây chính là điểm mấu chốt.
  async function readAll(method) {
    return Promise.all(sources.map(async (source, index) => {
      const config = configs[index];
      try {
        const value = await source[method]();
        return { key: config.key, label: config.label, ok: true, ...value };
      } catch (error) {
        const failure = describeFailure(error);
        return { key: config.key, label: config.label, ok: false, error: failure.message, errorCode: failure.code };
      }
    }));
  }

  return {
    getStatus() {
      const statuses = sources.map((source) => source.getStatus());
      return {
        configured: statuses.every((status) => status.configured),
        sourceCount: statuses.length,
        sources: statuses,
        serviceAccountEmail: statuses[0]?.serviceAccountEmail || "",
        accessMode: "read-only",
        credentialMode: statuses[0]?.credentialMode || "",
      };
    },

    async preview() {
      const results = await readAll("preview");
      return {
        sources: results,
        readyToSync: results.every((result) => result.ok && result.readyToSync),
        failed: results.filter((result) => !result.ok).map((result) => ({ key: result.key, label: result.label, error: result.error })),
      };
    },

    async loadForSync() {
      const results = await readAll("loadForSync");
      const merged = mergeDirectorySnapshots(results);

      // Không nguồn nào đọc được thì gần như chắc chắn là sự cố xác thực hoặc
      // quyền chia sẻ. Dừng hẳn để lỗi hiện ra, thay vì báo "0 thay đổi" đánh lừa.
      if (!results.some((result) => result.ok)) {
        throw sourcesError(503, "SHEETS_ALL_SOURCES_FAILED",
          `Không đọc được file nào trong ${results.length} file danh sách học sinh. ${results[0]?.error || ""}`.trim(),
          { sources: merged.sources });
      }

      return {
        snapshot: merged.snapshot,
        sources: merged.sources,
        duplicates: merged.duplicates,
        allSourcesLoaded: merged.allSourcesLoaded,
        analysis: { scannedRows: merged.scannedRows },
        source: {
          sources: results.filter((result) => result.ok).map((result) => ({
            key: result.key, label: result.label,
            spreadsheetId: result.source?.spreadsheetId || "", sheetName: result.source?.sheetName || "",
          })),
        },
      };
    },
  };
}
