// Khởi động một máy chủ thử nghiệm trên cổng do hệ điều hành cấp phát.
// Dùng cổng cố định làm bộ kiểm thử chập chờn trên Windows: chạy hai lượt liền
// nhau thì cổng của lượt trước còn ở TIME_WAIT nên máy chủ mới không bind được
// và toàn bộ test trong file cùng đỏ vì "Test server did not start".
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";

const READY_PATTERN = /running at (http:\/\/\S+)/;
const START_TIMEOUT_MS = 30_000;

export async function startTestServer({ prefix = "nshm-test-", env = {} } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), prefix));
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, ...env, PORT: "0", DATA_FILE: join(dataDir, "test.sqlite") },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));

  const baseUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Máy chủ thử nghiệm không khởi động trong ${START_TIMEOUT_MS} ms.\n${stderr.join("")}`)), START_TIMEOUT_MS);
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      const match = line.match(READY_PATTERN);
      if (!match) return;
      clearTimeout(timer);
      lines.close();
      child.stdout.resume();
      resolve(match[1].replace(/\/$/, ""));
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Máy chủ thử nghiệm thoát sớm với mã ${code}.\n${stderr.join("")}`));
    });
  });

  async function stop() {
    child.kill();
    await once(child, "exit");
    await rm(dataDir, { recursive: true, force: true });
  }

  const request = (path, cookie, options = {}) => fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) },
  });

  const login = (account, password) => request("/api/auth/login", null, {
    method: "POST",
    body: JSON.stringify({ account, password }),
  });

  const loginCookie = async (account, password) => {
    const response = await login(account, password);
    if (response.status !== 200) throw new Error(`Đăng nhập ${account} thất bại với mã ${response.status}.`);
    return response.headers.get("set-cookie").split(";")[0];
  };

  return { baseUrl, stop, request, login, loginCookie };
}
