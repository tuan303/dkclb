// Kiểm thử bộ hẹn giờ đồng bộ. Trọng tâm: lỗi không được im lặng, và hai lượt
// chạy không được chồng lên nhau.
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SYNC_INTERVAL_MS, SYNC_HEALTH, createSyncScheduler } from "../sync-scheduler.mjs";

// Đồng hồ giả: kiểm thử không phải chờ phút nào.
function fakeClock() {
  let current = 1_000_000;
  const pending = [];
  return {
    now: () => current,
    setTimer(callback, delay) {
      const entry = { at: current + delay, callback, cancelled: false };
      pending.push(entry);
      return entry;
    },
    clearTimer(entry) {
      if (entry) entry.cancelled = true;
    },
    async advance(ms) {
      current += ms;
      const due = pending.filter((entry) => !entry.cancelled && entry.at <= current);
      for (const entry of due) {
        pending.splice(pending.indexOf(entry), 1);
        entry.callback();
      }
      // Nhường vòng lặp sự kiện để phần bất đồng bộ trong callback chạy xong.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    },
    pendingCount: () => pending.filter((entry) => !entry.cancelled).length,
  };
}

const OK_RESULT = { counters: { writes: 3 }, sources: [{ key: "tieuhoc", ok: true }], allSourcesLoaded: true, scannedRows: 120 };

test("dữ liệu kèm theo được chuyển thẳng cho hàm đồng bộ", async () => {
  const clock = fakeClock();
  const seen = [];
  const scheduler = createSyncScheduler({ run: async (context) => { seen.push(context); return OK_RESULT; }, ...clock });
  await scheduler.runNow("thu-cong", { actorUserId: "u_admin" });
  await scheduler.runNow("theo-lich");
  assert.deepEqual(seen, [{ trigger: "thu-cong", actorUserId: "u_admin" }, { trigger: "theo-lich" }]);
});

test("chưa chạy lần nào thì nói rõ là chưa chạy", () => {
  const clock = fakeClock();
  const scheduler = createSyncScheduler({ run: async () => OK_RESULT, ...clock });
  const status = scheduler.getStatus();
  assert.equal(status.health, SYNC_HEALTH.never);
  assert.equal(status.healthy, false);
  assert.equal(status.lastRun, null);
  assert.equal(status.enabled, false);
});

test("chạy thành công thì ghi lại kết quả và đếm số dòng đã đọc", async () => {
  const clock = fakeClock();
  const scheduler = createSyncScheduler({ run: async () => OK_RESULT, ...clock });
  const result = await scheduler.runNow("thu-cong");
  assert.equal(result, OK_RESULT, "trả về thẳng kết quả đồng bộ cho phía gọi");
  const status = scheduler.getStatus();
  assert.equal(status.lastRun.ok, true);
  assert.equal(status.lastRun.trigger, "thu-cong");
  assert.equal(status.health, SYNC_HEALTH.ok);
  assert.equal(status.healthy, true);
  assert.equal(status.lastRun.scannedRows, 120);
  assert.equal(status.consecutiveFailures, 0);
  assert.equal(status.totalRuns, 1);
});

test("đọc thiếu một file thì không được báo là bình thường", async () => {
  const clock = fakeClock();
  const scheduler = createSyncScheduler({
    run: async () => ({ ...OK_RESULT, allSourcesLoaded: false, sources: [{ key: "thcs", ok: false, error: "Mất quyền Viewer." }] }),
    ...clock,
  });
  await scheduler.runNow();
  const status = scheduler.getStatus();
  assert.equal(status.health, SYNC_HEALTH.partial);
  assert.equal(status.healthy, false, "vẫn phải hiện cảnh báo lên màn hình quản trị");
  assert.equal(status.lastRun.sources[0].error, "Mất quyền Viewer.");
});

test("lỗi được giữ lại nguyên văn và đếm số lần hỏng liên tiếp", async () => {
  const clock = fakeClock();
  const failure = Object.assign(new Error("Service account chưa có quyền Viewer."), { code: "SHEETS_ACCESS_DENIED" });
  const scheduler = createSyncScheduler({ run: async () => { throw failure; }, ...clock });

  await assert.rejects(() => scheduler.runNow());
  await assert.rejects(() => scheduler.runNow());

  const status = scheduler.getStatus();
  assert.equal(status.health, SYNC_HEALTH.failed);
  assert.equal(status.consecutiveFailures, 2);
  assert.equal(status.lastRun.error.code, "SHEETS_ACCESS_DENIED");
  assert.match(status.lastRun.error.message, /quyền Viewer/);
  assert.equal(status.lastSuccessAt, null);
});

test("thành công trở lại thì xóa bộ đếm hỏng", async () => {
  const clock = fakeClock();
  let shouldFail = true;
  const scheduler = createSyncScheduler({
    run: async () => { if (shouldFail) throw new Error("Hỏng"); return OK_RESULT; },
    ...clock,
  });
  await assert.rejects(() => scheduler.runNow());
  shouldFail = false;
  await scheduler.runNow();
  const status = scheduler.getStatus();
  assert.equal(status.consecutiveFailures, 0);
  assert.equal(status.health, SYNC_HEALTH.ok);
});

test("quá lâu không có lần nào thành công thì chuyển sang quá hạn", async () => {
  const clock = fakeClock();
  const scheduler = createSyncScheduler({ run: async () => OK_RESULT, intervalMs: 1000, staleAfterMs: 3000, ...clock });
  await scheduler.runNow();
  assert.equal(scheduler.getStatus().health, SYNC_HEALTH.ok);

  // Không lỗi nào được ném ra, chỉ là chẳng có gì chạy nữa — đúng kiểu hỏng
  // âm thầm mà màn hình quản trị vẫn xanh nếu chỉ nhìn vào lần chạy cuối.
  await clock.advance(5000);
  const status = scheduler.getStatus();
  assert.equal(status.health, SYNC_HEALTH.stale);
  assert.equal(status.healthy, false);
  assert.equal(status.msSinceLastSuccess, 5000);
});

test("bấm đồng bộ khi lịch đang chạy thì cùng chờ, không ghi hai lượt", async () => {
  const clock = fakeClock();
  let started = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const scheduler = createSyncScheduler({
    run: async () => { started += 1; await gate; return OK_RESULT; },
    ...clock,
  });

  const first = scheduler.runNow("theo-lich");
  const second = scheduler.runNow("thu-cong");
  assert.equal(scheduler.isRunning(), true);
  release();
  const [left, right] = await Promise.all([first, second]);

  assert.equal(started, 1, "chỉ được gọi đúng một lần");
  assert.equal(left, right, "cả hai cùng nhận một kết quả");
  assert.equal(scheduler.getStatus().totalRuns, 1);
  assert.equal(scheduler.isRunning(), false);
});

test("chạy lại được sau khi lượt trước lỗi, khóa không bị kẹt", async () => {
  const clock = fakeClock();
  let attempts = 0;
  const scheduler = createSyncScheduler({
    run: async () => { attempts += 1; if (attempts === 1) throw new Error("Hỏng"); return OK_RESULT; },
    ...clock,
  });
  await assert.rejects(() => scheduler.runNow());
  assert.equal(scheduler.isRunning(), false, "lỗi không được để khóa kẹt lại");
  await scheduler.runNow();
  assert.equal(attempts, 2);
});

test("lịch tự chạy lại theo chu kỳ và lỗi không làm sập tiến trình", async () => {
  const clock = fakeClock();
  let calls = 0;
  const scheduler = createSyncScheduler({
    run: async () => { calls += 1; throw new Error("Luôn hỏng"); },
    intervalMs: 1000,
    ...clock,
  });

  scheduler.start();
  assert.equal(calls, 0, "không chạy ngay lúc khởi động");
  await clock.advance(1000);
  assert.equal(calls, 1);
  await clock.advance(1000);
  assert.equal(calls, 2, "lỗi ở lượt trước không được làm dừng lịch");

  scheduler.stop();
  await clock.advance(5000);
  assert.equal(calls, 2, "dừng rồi thì không chạy nữa");
  assert.equal(clock.pendingCount(), 0);
});

test("chu kỳ mặc định là 15 phút", () => {
  assert.equal(DEFAULT_SYNC_INTERVAL_MS, 15 * 60 * 1000);
  const clock = fakeClock();
  const scheduler = createSyncScheduler({ run: async () => OK_RESULT, ...clock });
  assert.equal(scheduler.getStatus().intervalMs, 15 * 60 * 1000);
  assert.equal(scheduler.getStatus().staleAfterMs, 45 * 60 * 1000);
});
