// Bộ kiểm thử dựng máy chủ ngay trong thư mục repo. Trên máy chủ của trường,
// thư mục đó có .env production — credential Microsoft thật, cấu hình Google
// Sheets thật, chuỗi kết nối MySQL thật.
//
// Đã xảy ra thật: chạy `npm test` trên máy chủ trường làm hai ca đỏ vì máy chủ
// thử nghiệm thừa hưởng cấu hình production. Đỏ là còn may — nguy hiểm hơn là
// kiểm thử im lặng chạm vào dịch vụ thật.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const harness = await readFile(new URL("./helpers/test-server.mjs", import.meta.url), "utf8");

test("máy chủ bỏ qua .env khi được yêu cầu", () => {
  assert.match(server, /if \(!process\.env\.NSHM_IGNORE_ENV_FILE && existsSync\(LOCAL_ENV_FILE\)\) loadEnvFile\(LOCAL_ENV_FILE\);/);
});

test("bộ khung kiểm thử luôn bật cách ly", () => {
  assert.match(harness, /NSHM_IGNORE_ENV_FILE: "1"/);
});

test("cách ly đặt TRƯỚC phần env do lời gọi truyền vào", () => {
  // Thứ tự trong object quyết định ai thắng. Nếu NSHM_IGNORE_ENV_FILE đứng sau
  // `...env` thì một ca kiểm thử muốn tự đặt biến này sẽ không đè được.
  // Tìm dòng MÃ chứ không phải dòng chú thích: dòng mã có cả hai thứ.
  const line = harness.split("\n").find((row) => row.includes("NSHM_IGNORE_ENV_FILE") && row.includes("...env"));
  const flagAt = line.indexOf("NSHM_IGNORE_ENV_FILE");
  const spreadAt = line.indexOf("...env");
  assert.ok(flagAt >= 0 && spreadAt >= 0, `không đọc được dòng env: ${line}`);
  assert.ok(flagAt < spreadAt, "cờ cách ly phải đứng trước ...env để ca kiểm thử ghi đè được khi cần");
});
