// Khởi động một máy chủ thử nghiệm trên cổng do hệ điều hành cấp phát.
//
// Dùng cổng cố định làm bộ kiểm thử chập chờn trên Windows: chạy hai lượt liền
// nhau thì cổng của lượt trước còn ở TIME_WAIT nên máy chủ mới không bind được
// và toàn bộ test trong file cùng đỏ vì "Test server did not start".
//
// Nền lưu trữ chọn theo biến môi trường TEST_MYSQL_URL: có thì mỗi file kiểm thử
// chạy trên một database MySQL riêng được tạo và xóa tự động, không có thì dùng
// một file SQLite tạm. Nhờ vậy cùng một bộ kiểm thử nghiệp vụ chạy được trên cả
// hai nền, và khác biệt giữa hai nền sẽ lộ ra ngay.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { generateMasterKey } from "../../field-crypto.mjs";

const READY_PATTERN = /running at (http:\/\/\S+)/;
const START_TIMEOUT_MS = 30_000;

async function createMysqlDatabase(baseUrl) {
  const { createConnection } = await import("mysql2/promise");
  const name = `dkclb_test_${randomBytes(6).toString("hex")}`;
  const admin = await createConnection(baseUrl);
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.end();
  const target = new URL(baseUrl);
  target.pathname = `/${name}`;
  return { name, url: target.toString() };
}

async function dropMysqlDatabase(baseUrl, name) {
  const { createConnection } = await import("mysql2/promise");
  const admin = await createConnection(baseUrl);
  await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
  await admin.end();
}

export async function startTestServer({
  prefix = "nshm-test-", env = {}, mysqlUrl = null, seedDemo = true, encryptionKey = generateMasterKey(),
} = {}) {
  const mysqlBaseUrl = process.env.TEST_MYSQL_URL || "";
  let dataDir = null;
  let database = null;
  let storageEnv;

  if (mysqlUrl) {
    // Chạy trên một cơ sở dữ liệu do người gọi tự quản lý, không tạo và không xóa.
    storageEnv = { DATA_BACKEND: "mysql", MYSQL_URL: mysqlUrl, NSHM_SEED_DEMO: seedDemo ? "1" : "0", DATA_FILE: "", ENCRYPTION_KEY: encryptionKey };
  } else if (mysqlBaseUrl) {
    database = await createMysqlDatabase(mysqlBaseUrl);
    storageEnv = { DATA_BACKEND: "mysql", MYSQL_URL: database.url, NSHM_SEED_DEMO: seedDemo ? "1" : "0", DATA_FILE: "", ENCRYPTION_KEY: encryptionKey };
  } else {
    dataDir = await mkdtemp(join(tmpdir(), prefix));
    storageEnv = { DATA_BACKEND: "sqlite", DATA_FILE: join(dataDir, "test.sqlite"), MYSQL_URL: "", ENCRYPTION_KEY: encryptionKey };
  }

  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, ...env, ...storageEnv, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));

  let baseUrl;
  try {
    baseUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Máy chủ thử nghiệm không khởi động trong ${START_TIMEOUT_MS} ms.\n${stderr.join("")}`)),
        START_TIMEOUT_MS,
      );
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
  } catch (error) {
    child.kill();
    if (database) await dropMysqlDatabase(mysqlBaseUrl, database.name).catch(() => {});
    if (dataDir) await rm(dataDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  async function stop() {
    child.kill();
    await once(child, "exit");
    if (database) await dropMysqlDatabase(mysqlBaseUrl, database.name).catch(() => {});
    if (dataDir) await rm(dataDir, { recursive: true, force: true }).catch(() => {});
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

  return {
    baseUrl, backend: mysqlUrl || mysqlBaseUrl ? "mysql" : "sqlite",
    databaseUrl: mysqlUrl || database?.url || null, encryptionKey,
    stop, request, login, loginCookie,
  };
}
