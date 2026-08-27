// Google Sheets API có lúc trả 503 rồi tự khỏi sau vài giây — đã gặp thật khi khảo
// sát file danh sách học sinh của trường. Vì một nguồn lỗi khiến cả lần đồng bộ bỏ
// qua phần đánh dấu nghỉ học, một trục trặc thoáng qua không được phép tính là lỗi nguồn.
import test from "node:test";
import assert from "node:assert/strict";
import { isRetryableSheetsError, withRetry } from "../sheets-directory.mjs";

const noSleep = () => Promise.resolve();
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

test("phân loại đúng lỗi nào đáng thử lại", () => {
  for (const status of [408, 425, 429, 500, 502, 503, 504]) {
    assert.equal(isRetryableSheetsError(httpError(status)), true, `${status} phải được thử lại`);
  }
  // Sai quyền hoặc sai cấu hình: thử lại chỉ làm chậm và che mất nguyên nhân thật.
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(isRetryableSheetsError(httpError(status)), false, `${status} không được thử lại`);
  }
  assert.equal(isRetryableSheetsError(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })), true);
  assert.equal(isRetryableSheetsError(new Error("socket hang up")), true);
  assert.equal(isRetryableSheetsError(new Error("Thiếu cột bắt buộc")), false);
});

test("503 thoáng qua rồi khỏi thì lần đọc vẫn thành công", async () => {
  let calls = 0;
  const value = await withRetry(async () => {
    calls += 1;
    if (calls < 3) throw httpError(503);
    return "dữ liệu";
  }, { attempts: 4, baseDelayMs: 1, sleep: noSleep });

  assert.equal(value, "dữ liệu");
  assert.equal(calls, 3);
});

test("hết số lần thử thì ném ra lỗi cuối cùng, không nuốt", async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(async () => { calls += 1; throw httpError(503); }, { attempts: 3, baseDelayMs: 1, sleep: noSleep }),
    (error) => error.response.status === 503,
  );
  assert.equal(calls, 3, "thử đúng số lần đã khai, không nhiều hơn");
});

test("403 hỏng ngay lập tức, không thử lại lần nào", async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(async () => { calls += 1; throw httpError(403); }, { attempts: 5, baseDelayMs: 1, sleep: noSleep }),
    (error) => error.response.status === 403,
  );
  assert.equal(calls, 1, "sai quyền thì thử lại vô nghĩa");
});

test("thời gian chờ giãn theo cấp số nhân", async () => {
  const waited = [];
  await assert.rejects(() => withRetry(
    async () => { throw httpError(500); },
    { attempts: 4, baseDelayMs: 100, sleep: (ms) => { waited.push(ms); return Promise.resolve(); } },
  ));

  assert.equal(waited.length, 3, "chờ giữa các lần thử, không chờ sau lần cuối");
  // Có cộng nhiễu ngẫu nhiên nên kiểm tra theo khoảng: 100, 200, 400 cộng thêm 0..99.
  assert.ok(waited[0] >= 100 && waited[0] < 200, `lần 1 chờ ${waited[0]}ms`);
  assert.ok(waited[1] >= 200 && waited[1] < 300, `lần 2 chờ ${waited[1]}ms`);
  assert.ok(waited[2] >= 400 && waited[2] < 500, `lần 3 chờ ${waited[2]}ms`);
  assert.ok(waited[1] > waited[0] && waited[2] > waited[1], "phải giãn dần");
});

test("thành công ngay lần đầu thì không chờ", async () => {
  const waited = [];
  const value = await withRetry(async () => "xong", { baseDelayMs: 100, sleep: (ms) => { waited.push(ms); return Promise.resolve(); } });
  assert.equal(value, "xong");
  assert.deepEqual(waited, []);
});
