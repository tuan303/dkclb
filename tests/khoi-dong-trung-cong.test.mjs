// Bật máy chủ khi cổng đang bị chiếm phải NÓI RA rồi thoát, không được chết câm.
//
// Đã hỏng thật hai lần trên máy chủ của trường: người vận hành bật lại trong khi
// tiến trình cũ chưa nhả cổng, `server.listen` phát sự kiện 'error' mà không ai
// bắt, Node ném ra rồi tiến trình biến mất. Trên màn hình thì lệnh chạy xong,
// không báo gì — nên không ai biết site đang nằm cho tới khi có phụ huynh gọi.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { startTestServer } from "./helpers/test-server.mjs";
import { generateMasterKey } from "../field-crypto.mjs";

let server;
let cong;

before(async () => {
  server = await startTestServer({ prefix: "nshm-trungcong-" });
  // Lấy cổng thật do hệ điều hành cấp, thay vì gõ cứng một số: chạy hai lượt kiểm
  // thử liền nhau trên Windows là cổng cũ còn ở TIME_WAIT và cả tệp cùng đỏ.
  cong = Number(new URL(server.baseUrl).port);
});

after(async () => server.stop());

test("cổng đang bị chiếm thì máy chủ báo rõ rồi thoát mã 1", async () => {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env, NSHM_IGNORE_ENV_FILE: "1", DATA_BACKEND: "sqlite",
      DATA_FILE: "", MYSQL_URL: "", ENCRYPTION_KEY: generateMasterKey(), PORT: String(cong),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let loi = "";
  child.stderr.on("data", (chunk) => { loi += String(chunk); });
  child.stdout.on("data", () => {});

  const [ma] = await once(child, "exit");
  assert.equal(ma, 1, "phải thoát với mã 1 chứ không phải treo hay thoát 0");
  assert.match(loi, new RegExp(`Cổng ${cong} đang bị một tiến trình khác giữ`),
    `thông báo phải nêu rõ cổng nào; nhận được: ${loi.slice(0, 400)}`);
  // Nói luôn cách tìm thủ phạm, vì lúc đọc được dòng này là lúc site đang nằm.
  assert.match(loi, /Get-NetTCPConnection/);
});

test("máy chủ đang chạy vẫn phục vụ bình thường sau cú va cổng", async () => {
  // Tiến trình thứ hai chết không được kéo theo tiến trình thứ nhất.
  const response = await fetch(`${server.baseUrl}/api/health`);
  assert.equal(response.status, 200);
});
