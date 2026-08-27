// Tự động đồng bộ danh sách học sinh từ Google Sheets theo chu kỳ.
//
// Điều nguy hiểm nhất với một tác vụ nền không phải là nó lỗi, mà là nó lỗi
// trong im lặng: giáo vụ thêm học sinh mới cả tháng, không ai đăng ký được, và
// không ai biết vì màn hình quản trị vẫn xanh. Vì vậy lớp này giữ lại toàn bộ
// kết quả lần chạy gần nhất và tự chuyển sang trạng thái "quá hạn" khi đã quá
// lâu không có lần chạy nào thành công — kể cả khi chẳng có lỗi nào được ném ra.
//
// Đồng hồ và bộ hẹn giờ đều tiêm từ ngoài vào để kiểm thử chạy tức thì.

export const DEFAULT_SYNC_INTERVAL_MS = 15 * 60 * 1000;

export const SYNC_HEALTH = {
  never: "chua-chay",
  ok: "tot",
  partial: "thieu-nguon",
  failed: "loi",
  stale: "qua-han",
};

export function createSyncScheduler({
  run,
  intervalMs = DEFAULT_SYNC_INTERVAL_MS,
  // Quá ba chu kỳ không có lần nào thành công thì coi là hỏng, dù lần chạy cuối
  // có báo lỗi hay không — bắt được cả trường hợp tiến trình nền chết lặng lẽ.
  staleAfterMs = intervalMs * 3,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onEvent = () => {},
}) {
  let timer = null;
  let enabled = false;
  let inFlight = null;
  const state = {
    lastRun: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    totalRuns: 0,
  };

  function health(at = now()) {
    if (!state.lastRun) return SYNC_HEALTH.never;
    if (!state.lastRun.ok) return SYNC_HEALTH.failed;
    if (state.lastSuccessAt !== null && at - state.lastSuccessAt > staleAfterMs) return SYNC_HEALTH.stale;
    if (state.lastRun.allSourcesLoaded === false) return SYNC_HEALTH.partial;
    return SYNC_HEALTH.ok;
  }

  function schedule() {
    if (!enabled || timer !== null) return;
    timer = setTimer(() => {
      timer = null;
      // Bỏ qua lỗi ở đây là có chủ ý: lỗi đã được ghi vào state và sẽ hiện trên
      // màn hình quản trị. Ném ra khỏi bộ hẹn giờ chỉ làm sập tiến trình.
      runNow("theo-lich").catch(() => {}).finally(schedule);
    }, intervalMs);
    if (typeof timer?.unref === "function") timer.unref();
  }

  async function execute(trigger, meta) {
    const startedAt = now();
    state.totalRuns += 1;
    onEvent({ type: "bat-dau", trigger, startedAt });
    try {
      const result = await run({ trigger, ...meta });
      const finishedAt = now();
      state.lastRun = {
        trigger, ok: true, startedAt, finishedAt, durationMs: finishedAt - startedAt,
        counters: result?.counters || null,
        sources: result?.sources || [],
        duplicates: result?.duplicates || [],
        allSourcesLoaded: result?.allSourcesLoaded !== false,
        scannedRows: result?.scannedRows ?? null,
        error: null,
      };
      state.lastSuccessAt = finishedAt;
      state.consecutiveFailures = 0;
      onEvent({ type: "xong", trigger, run: state.lastRun });
      // Trả về kết quả thô của lần đồng bộ; tình hình lịch chạy tra qua getStatus().
      return result;
    } catch (error) {
      const finishedAt = now();
      state.lastRun = {
        trigger, ok: false, startedAt, finishedAt, durationMs: finishedAt - startedAt,
        counters: null, sources: error?.details?.sources || [], duplicates: [],
        allSourcesLoaded: false, scannedRows: null,
        error: { message: error?.message || "Đồng bộ thất bại.", code: error?.code || "SYNC_FAILED" },
      };
      state.consecutiveFailures += 1;
      onEvent({ type: "loi", trigger, run: state.lastRun });
      throw error;
    }
  }

  /**
   * Một lần chạy tại một thời điểm. Quản trị viên bấm "Đồng bộ" đúng lúc lịch
   * đang chạy thì cùng chờ lần chạy đó, chứ không mở thêm một lượt ghi song song.
   *
   * @param meta  dữ liệu kèm theo chuyển thẳng cho hàm run, ví dụ actorUserId.
   *              Truyền qua tham số chứ không gán lên scheduler, vì hai quản trị
   *              bấm cùng lúc sẽ ghi đè lẫn nhau.
   */
  async function runNow(trigger = "thu-cong", meta = {}) {
    if (inFlight) return inFlight;
    inFlight = execute(trigger, meta).finally(() => { inFlight = null; });
    return inFlight;
  }

  return {
    runNow,

    start() {
      if (enabled) return;
      enabled = true;
      schedule();
    },

    stop() {
      enabled = false;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
    },

    isRunning() {
      return inFlight !== null;
    },

    getStatus(at = now()) {
      const status = health(at);
      return {
        enabled,
        running: inFlight !== null,
        intervalMs,
        staleAfterMs,
        health: status,
        healthy: status === SYNC_HEALTH.ok,
        lastRun: state.lastRun,
        lastSuccessAt: state.lastSuccessAt,
        msSinceLastSuccess: state.lastSuccessAt === null ? null : at - state.lastSuccessAt,
        consecutiveFailures: state.consecutiveFailures,
        totalRuns: state.totalRuns,
        nextRunAt: enabled && state.lastRun ? state.lastRun.finishedAt + intervalMs : null,
      };
    },
  };
}
