// Kiểm thử lớp đọc ba file Google Sheet: cấu hình nguồn và hành vi khi một file lỗi.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DIRECTORY_SOURCES,
  createMultiSourceDirectory,
  parseDirectorySources,
  parseSpreadsheetRef,
} from "../directory-sources.mjs";

const TIH_URL = "https://docs.google.com/spreadsheets/d/1h4UXgj7HXNEU6Gm1sTrEC-oZlJQC5Mc4i8QZjtSd38o/edit?gid=0#gid=0";
const THPT_URL = "https://docs.google.com/spreadsheets/d/1aGSuLq9sgbHDDn8KCABnTKlXQnsRZkLGUYaQ9jua5Ps/edit?gid=804479104#gid=804479104";

/* ---------- Cấu hình nguồn ---------- */

test("bóc mã file và gid từ đường dẫn Google Sheets", () => {
  assert.deepEqual(parseSpreadsheetRef(TIH_URL), { spreadsheetId: "1h4UXgj7HXNEU6Gm1sTrEC-oZlJQC5Mc4i8QZjtSd38o", sheetGid: "0" });
  assert.deepEqual(parseSpreadsheetRef(THPT_URL), { spreadsheetId: "1aGSuLq9sgbHDDn8KCABnTKlXQnsRZkLGUYaQ9jua5Ps", sheetGid: "804479104" });
  // Dán thẳng mã file cũng phải nhận.
  assert.deepEqual(parseSpreadsheetRef("1aGSuLq9sgbHDDn8KCABnTKlXQnsRZkLGUYaQ9jua5Ps"),
    { spreadsheetId: "1aGSuLq9sgbHDDn8KCABnTKlXQnsRZkLGUYaQ9jua5Ps", sheetGid: null });
  assert.equal(parseSpreadsheetRef(""), null);
  assert.equal(parseSpreadsheetRef("https://example.com/khong-phai-sheet"), null);
});

test("không cấu hình gì thì dùng đúng ba file của trường", () => {
  const configs = parseDirectorySources({});
  assert.deepEqual(configs.map((item) => item.key), ["tieuhoc", "thcs", "thpt"]);
  assert.equal(configs[2].sheetGid, "804479104", "THPT không nằm ở tab đầu tiên nên bắt buộc phải trỏ đúng gid");
  assert.ok(configs.every((item) => item.headerRow === 1));
});

test("GOOGLE_SHEETS_SOURCES nhận nguyên đường dẫn dán từ trình duyệt", () => {
  const configs = parseDirectorySources({
    GOOGLE_SHEETS_SOURCES: JSON.stringify([
      { key: "tieuhoc", label: "Tiểu học", url: TIH_URL },
      { key: "thpt", label: "THPT", url: THPT_URL, headerRow: 2 },
    ]),
  });
  assert.equal(configs.length, 2);
  assert.equal(configs[0].spreadsheetId, "1h4UXgj7HXNEU6Gm1sTrEC-oZlJQC5Mc4i8QZjtSd38o");
  assert.equal(configs[1].sheetGid, "804479104");
  assert.equal(configs[1].headerRow, 2);
});

test("cấu hình một file kiểu cũ vẫn chạy được", () => {
  const configs = parseDirectorySources({
    GOOGLE_SHEETS_SPREADSHEET_ID: "1YUCh0_U8ASCf4nVMZ_dXj9EAkEGq9ghpHggiYVT1zeM",
    GOOGLE_SHEETS_TAB: "dshs26-27",
  });
  assert.equal(configs.length, 1);
  assert.equal(configs[0].sheetName, "dshs26-27");
  assert.equal(configs[0].key, "default");
});

test("cấu hình sai bị chặn ngay lúc khởi động", () => {
  assert.throws(() => parseDirectorySources({ GOOGLE_SHEETS_SOURCES: "{khong-phai-json" }),
    (error) => error.code === "SHEETS_SOURCE_INVALID");
  assert.throws(() => parseDirectorySources({ GOOGLE_SHEETS_SOURCES: "[]" }),
    (error) => error.code === "SHEETS_SOURCE_INVALID");
  assert.throws(() => parseDirectorySources({ GOOGLE_SHEETS_SOURCES: JSON.stringify([{ key: "a", url: "khong-co-ma-file" }]) }),
    (error) => error.code === "SHEETS_SOURCE_INVALID");
  // Trùng khóa thì nhật ký và màn hình theo dõi sẽ lẫn lộn hai file với nhau.
  assert.throws(() => parseDirectorySources({
    GOOGLE_SHEETS_SOURCES: JSON.stringify([{ key: "thcs", url: TIH_URL }, { key: "thcs", url: THPT_URL }]),
  }), (error) => /trùng/.test(error.message));
});

/* ---------- Đọc nhiều nguồn ---------- */

function fakeSource(behaviour) {
  return (config) => ({
    getStatus: () => ({ key: config.key, label: config.label, configured: true, serviceAccountEmail: "bot@vi-du.iam", credentialMode: "adc" }),
    async preview() {
      const result = behaviour[config.key];
      if (result instanceof Error) throw result;
      return { readyToSync: true, analysis: { scannedRows: result.students.length, issues: [] } };
    },
    async loadForSync() {
      const result = behaviour[config.key];
      if (result instanceof Error) throw result;
      return {
        snapshot: { students: result.students, guardians: result.guardians || [] },
        analysis: { scannedRows: result.students.length, issues: [] },
        source: { spreadsheetId: config.spreadsheetId, sheetName: "DS" },
      };
    },
  });
}

function student(code, level, grade) {
  return { code, name: `Học sinh ${code}`, dateOfBirth: "2015-01-01", className: `${grade}A1`, educationLevel: level, grade };
}

const CONFIGS = parseDirectorySources({});

test("đọc trọn vẹn ba file thì được phép đánh dấu nghỉ học", async () => {
  const directory = createMultiSourceDirectory({
    configs: CONFIGS,
    createSource: fakeSource({
      tieuhoc: { students: [student("HS01", "Tiểu học", 3)] },
      thcs: { students: [student("HS02", "THCS", 7)] },
      thpt: { students: [student("HS03", "THPT", 11)] },
    }),
  });
  const result = await directory.loadForSync();
  assert.equal(result.allSourcesLoaded, true);
  assert.equal(result.snapshot.students.length, 3);
  assert.equal(result.analysis.scannedRows, 3);
  assert.equal(result.source.sources.length, 3);
});

test("một file lỗi: vẫn cập nhật hai file kia nhưng cấm đánh dấu nghỉ học", async () => {
  const directory = createMultiSourceDirectory({
    configs: CONFIGS,
    createSource: fakeSource({
      tieuhoc: { students: [student("HS01", "Tiểu học", 3)] },
      thcs: Object.assign(new Error("Service account chưa có quyền Viewer trên Sheet."), { code: "SHEETS_ACCESS_DENIED" }),
      thpt: { students: [student("HS03", "THPT", 11)] },
    }),
  });
  const result = await directory.loadForSync();
  assert.equal(result.allSourcesLoaded, false, "đây là lá chắn giữ cho cả cấp THCS không bị vô hiệu hóa");
  assert.equal(result.snapshot.students.length, 2);
  const failed = result.sources.find((item) => item.key === "thcs");
  assert.equal(failed.ok, false);
  assert.match(failed.error, /quyền Viewer/);
  // Hai nguồn còn lại vẫn báo đọc thành công để người quản trị biết hỏng đúng chỗ nào.
  assert.deepEqual(result.sources.filter((item) => item.ok).map((item) => item.key), ["tieuhoc", "thpt"]);
});

test("hỏng cả ba file thì báo lỗi rõ, không im lặng báo 0 thay đổi", async () => {
  const directory = createMultiSourceDirectory({
    configs: CONFIGS,
    createSource: fakeSource({
      tieuhoc: Object.assign(new Error("Backend chưa có Application Default Credentials."), { code: "GOOGLE_ADC_REQUIRED" }),
      thcs: new Error("Hỏng"),
      thpt: new Error("Hỏng"),
    }),
  });
  await assert.rejects(() => directory.loadForSync(), (error) => {
    assert.equal(error.code, "SHEETS_ALL_SOURCES_FAILED");
    assert.equal(error.status, 503);
    assert.match(error.message, /Application Default Credentials/);
    return true;
  });
});

test("xem trước báo rõ file nào chưa sẵn sàng", async () => {
  const directory = createMultiSourceDirectory({
    configs: CONFIGS,
    createSource: fakeSource({
      tieuhoc: { students: [student("HS01", "Tiểu học", 3)] },
      thcs: { students: [student("HS02", "THCS", 7)] },
      thpt: Object.assign(new Error("Không tìm thấy tab có gid 804479104."), { code: "SHEET_TAB_NOT_FOUND" }),
    }),
  });
  const preview = await directory.preview();
  assert.equal(preview.readyToSync, false);
  assert.deepEqual(preview.failed.map((item) => item.key), ["thpt"]);
  assert.equal(preview.sources.length, 3);
});

test("trạng thái tích hợp liệt kê đủ ba nguồn", () => {
  const directory = createMultiSourceDirectory({ configs: CONFIGS, createSource: fakeSource({}) });
  const status = directory.getStatus();
  assert.equal(status.sourceCount, 3);
  assert.equal(status.configured, true);
  assert.deepEqual(status.sources.map((item) => item.label), ["Tiểu học", "THCS", "THPT"]);
});

test("danh sách nguồn mặc định khớp với ba file thật của trường", () => {
  assert.equal(DEFAULT_DIRECTORY_SOURCES.length, 3);
  assert.ok(DEFAULT_DIRECTORY_SOURCES.every((item) => /^[-\w]{25,}$/.test(item.spreadsheetId)));
});
