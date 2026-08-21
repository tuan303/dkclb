import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers/test-server.mjs";

let server;
let baseUrl;

const login = (account, password) => server.loginCookie(account, password);
const request = (path, cookie, options = {}) => server.request(path, cookie, options);

before(async () => {
  server = await startTestServer({ prefix: "nshm-clubs-" });
  baseUrl = server.baseUrl;
});

after(async () => server.stop());

test("health endpoint is available", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  // Nền sqlite là môi trường phát triển nên có tài khoản minh họa; production Firestore thì không.
  assert.equal(body.dataBackend, "sqlite");
  assert.equal(body.demoAccounts, true);
});

test("parent phone login accepts the Sheet format without a leading zero", async () => {
  const cookie = await login("901234567", "123456");
  assert.match(cookie, /^nshm_session=/);
});

test("Microsoft 365 status exposes configuration state but no secret", async () => {
  const response = await fetch(`${baseUrl}/api/auth/microsoft/status`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.microsoft.configured, false);
  assert.equal(payload.microsoft.allowedDomain, "hoangmaistarschool.edu.vn");
  assert.equal(JSON.stringify(payload).includes("clientSecret"), false);
});

test("server source and environment files are never exposed as static assets", async () => {
  // Chỉ các tệp trong thư mục `public` mới được phục vụ; mọi mã nguồn backend,
  // cấu hình và tài liệu nội bộ ở thư mục gốc đều phải trả 404.
  const blocked = [
    "/server.mjs", "/.env.example", "/catalog-schema.mjs", "/firestore-store.mjs",
    "/microsoft-auth.mjs", "/sheets-directory.mjs", "/google-cloud-auth.mjs",
    "/password-policy.mjs", "/firestore.rules", "/package.json",
    "/BA_CAU_TRUC_HE_THONG_CLB.md", "/api/index.mjs",
  ];
  for (const path of blocked) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 404, `${path} không được phục vụ như tệp tĩnh`);
  }

  const served = ["/", "/index.html", "/app.js", "/styles.css", "/sheet-reader.js", "/firebase-client.js"];
  for (const path of served) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200, `${path} phải phục vụ được`);
  }
});

test("parent is scoped to linked students and eligible clubs", async () => {
  const cookie = await login("0901234567", "123456");
  const studentsResponse = await request("/api/students", cookie);
  const students = (await studentsResponse.json()).students;
  assert.equal(students.length, 2);
  assert.equal(students[0].id, "hs01");

  const clubsResponse = await request("/api/clubs?studentId=hs01", cookie);
  const clubs = (await clubsResponse.json()).clubs;
  assert.equal(clubs.find((club) => club.id === "debate").eligible, false);
  assert.equal(clubs.find((club) => club.id === "basketball").eligible, true);
});

test("server blocks a schedule conflict with an existing registration", async () => {
  const cookie = await login("0901234567", "123456");
  const response = await request("/api/registrations/validate", cookie, { method: "POST", body: JSON.stringify({ studentId: "hs01", clubIds: ["basketball"] }) });
  const payload = await response.json();
  assert.equal(payload.valid, false);
  assert.equal(payload.issues[0].type, "conflict");
});

test("parent can create a valid waitlist registration", async () => {
  const cookie = await login("0901234567", "123456");
  const response = await request("/api/registrations", cookie, { method: "POST", body: JSON.stringify({ studentId: "hs01", clubIds: ["painting"], acceptedTerms: true }) });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.registrations[0].status, "waitlist");
});

test("admin sees dashboard and can confirm payment", async () => {
  const cookie = await login("admin@nshm.edu.vn", "Admin@123");
  const dashboardResponse = await request("/api/admin/dashboard", cookie);
  const dashboard = (await dashboardResponse.json()).dashboard;
  assert.ok(dashboard.total >= 7);

  const response = await request("/api/admin/registrations/DK-260818-0158/confirm-payment", cookie, { method: "PATCH", body: "{}" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "confirmed");

  const integrationResponse = await request("/api/admin/integrations/google-sheets", cookie);
  assert.equal(integrationResponse.status, 200);
  const integration = (await integrationResponse.json()).integration;
  assert.equal(integration.sheetName, "dshs26-27");
  assert.equal(integration.accessMode, "read-only");
});
