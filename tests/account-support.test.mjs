import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const port = 4203;
const baseUrl = `http://127.0.0.1:${port}`;
let processHandle;
let tempDir;
let adminCookie;

async function waitForServer() {
  for (let index = 0; index < 60; index += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Test server did not start");
}

async function login(account, password) {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account, password }),
  });
}

async function request(path, cookie, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Cookie: cookie, ...(options.headers || {}) },
  });
}

before(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "nshm-support-"));
  processHandle = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), DATA_FILE: join(tempDir, "support.sqlite") },
    stdio: "ignore",
  });
  await waitForServer();
  const response = await login("admin@nshm.edu.vn", "Admin@123");
  adminCookie = response.headers.get("set-cookie").split(";")[0];
});

after(async () => {
  processHandle.kill();
  await once(processHandle, "exit");
  await rm(tempDir, { recursive: true, force: true });
});

test("chỉ quản trị mới tra cứu được tài khoản", async () => {
  const anonymous = await fetch(`${baseUrl}/api/admin/accounts/lookup?account=0901234567`);
  assert.equal(anonymous.status, 401);

  const parentCookie = (await login("0901234567", "123456")).headers.get("set-cookie").split(";")[0];
  const asParent = await request("/api/admin/accounts/lookup?account=0901234567", parentCookie);
  assert.equal(asParent.status, 403);
});

test("tra cứu số chưa có tài khoản nói rõ nguyên nhân, không lộ dữ liệu", async () => {
  const response = await request("/api/admin/accounts/lookup?account=0975662437", adminCookie);
  assert.equal(response.status, 200);
  const { lookup } = await response.json();
  assert.equal(lookup.found, false);
  assert.equal(lookup.normalized, "0975662437");
  assert.match(lookup.diagnosis, /Không tìm thấy tài khoản|chưa có tài khoản phụ huynh nào/);
  assert.ok(lookup.directory.parents >= 1);
  assert.equal(lookup.account, undefined);
});

test("tra cứu chuẩn hóa số thiếu số 0 ở đầu và không trả về salt hay hash", async () => {
  const response = await request("/api/admin/accounts/lookup?account=901234567", adminCookie);
  assert.equal(response.status, 200);
  const { lookup } = await response.json();
  assert.equal(lookup.normalized, "0901234567");
  assert.equal(lookup.found, true);
  assert.equal(lookup.account.linkedStudents, 2);
  assert.equal(lookup.account.authProvider, "local");
  const serialized = JSON.stringify(lookup);
  assert.ok(!/passwordHash|password_hash|passwordSalt|password_salt/.test(serialized), "không được trả về salt hay hash");
});

test("tài khoản bị khóa do sai nhiều lần được nêu rõ trong kết quả tra cứu", async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) await login("0901234567", "sai-mat-khau");
  const locked = await login("0901234567", "123456");
  assert.equal(locked.status, 429, "sai 5 lần thì tài khoản bị tạm khóa");

  const { lookup } = await (await request("/api/admin/accounts/lookup?account=0901234567", adminCookie)).json();
  assert.equal(lookup.account.loginFailures, 5);
  assert.ok(lookup.account.lockedUntil);
  assert.match(lookup.diagnosis, /tạm khóa/);
});

test("đặt lại mật khẩu khởi tạo mở khóa tài khoản và bắt đổi mật khẩu", async () => {
  const withoutConfirmation = await request("/api/admin/accounts/reset-initial-password", adminCookie, {
    method: "POST",
    body: JSON.stringify({ account: "0901234567" }),
  });
  assert.equal(withoutConfirmation.status, 422);

  const reset = await request("/api/admin/accounts/reset-initial-password", adminCookie, {
    method: "POST",
    body: JSON.stringify({ account: "0901234567", confirmation: "RESET_INITIAL_PASSWORD" }),
  });
  assert.equal(reset.status, 200);

  // Mật khẩu cũ hết hiệu lực, mật khẩu mới chính là số điện thoại.
  const oldPassword = await login("0901234567", "123456");
  assert.equal(oldPassword.status, 401);
  const newPassword = await login("0901234567", "0901234567");
  assert.equal(newPassword.status, 200, "khóa 15 phút phải được gỡ sau khi đặt lại");

  const cookie = newPassword.headers.get("set-cookie").split(";")[0];
  const me = await (await request("/api/me", cookie)).json();
  assert.equal(me.user.mustChangePassword, true);

  // Chưa đổi mật khẩu thì chưa dùng được dữ liệu nghiệp vụ.
  const blocked = await request("/api/students", cookie);
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error.code, "PASSWORD_CHANGE_REQUIRED");

  const { lookup } = await (await request("/api/admin/accounts/lookup?account=0901234567", adminCookie)).json();
  assert.equal(lookup.account.mustChangePassword, true);
  assert.equal(lookup.account.loginFailures, 0);
  assert.equal(lookup.account.lockedUntil, null);
});

test("không đặt lại được mật khẩu của tài khoản nhà trường", async () => {
  const response = await request("/api/admin/accounts/reset-initial-password", adminCookie, {
    method: "POST",
    body: JSON.stringify({ account: "admin@nshm.edu.vn", confirmation: "RESET_INITIAL_PASSWORD" }),
  });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "ACCOUNT_NOT_PHONE");
});
