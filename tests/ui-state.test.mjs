import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("login and application screens cannot be visible at the same time", async () => {
  const [html, css, script] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="app-shell"[^>]*\bhidden\b/);
  assert.match(css, /\.hidden, \[hidden\] \{ display: none !important; \}/);
  assert.match(script, /loginScreen\.hidden = showApplication;/);
  assert.match(script, /appShell\.hidden = !showApplication;/);
});

test("lối tắt tài khoản minh họa bị ẩn khi máy chủ không có tài khoản demo", async () => {
  const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  // Cờ demo phải lấy từ máy chủ, không suy đoán ở trình duyệt.
  assert.match(script, /state\.demoAccounts = Boolean\(\(await api\("\/health"\)\)\.demoAccounts\)/);
  assert.match(script, /\$\("\.role-switcher"\)\?\.classList\.toggle\("hidden", !state\.demoAccounts\)/);
  assert.match(script, /\$\("#credential-box"\)\?\.classList\.toggle\("hidden", !state\.demoAccounts\)/);
  // Mặc định phải là không có tài khoản demo để lỡ gọi /health thất bại vẫn an toàn.
  assert.match(script, /demoAccounts: false,/);
  assert.match(script, /catch \{\s*state\.demoAccounts = false;\s*\}/);
});

test("màn hình đăng nhập chỉ có MỘT nơi quyết định hiện gì theo cổng", async () => {
  const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  // Trước đây logic này được viết ở hai nơi: showLogin và handler đổi cổng. Thêm
  // một phần tử mới mà quên một chỗ thì lỗi chỉ lộ ra ở đường ít dùng hơn — đã
  // xảy ra thật với khối liên hệ Phòng Tuyển sinh.
  assert.match(script, /function applyLoginRoleView()/);
  const calls = script.split("applyLoginRoleView()").length - 1;
  assert.ok(calls >= 3, `applyLoginRoleView phải được gọi ở cả hai đường, thấy ${calls - 1} lời gọi`);

  const introCount = script.split("Lần đầu, mật khẩu chính là số điện thoại đó").length - 1;
  assert.equal(introCount, 1, "câu giới thiệu chỉ được viết một lần");
});

test("màn hình đăng nhập nói đúng thông điệp tuyển sinh câu lạc bộ", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  // Không tách riêng Tiểu học và Trung học: một thông điệp chung cho toàn trường.
  assert.match(html, /Dành cho học sinh lớp 1 – 11/);
  assert.ok(!/Khối Tiểu học|Khối Trung học/.test(html), "không tách riêng hai cấp trên màn hình đăng nhập");
  for (const group of ["Thể thao", "Nghệ thuật", "Robotacon WRO 2026", "Trại sáng tác"]) {
    assert.ok(html.includes(group), `thiếu nhóm câu lạc bộ: ${group}`);
  }
  // Phụ huynh không vào được phải có đường liên hệ ngay trên màn hình.
  assert.match(html, /1900 888689/);
  assert.match(html, /tuyensinh@hoangmaistarschool.edu.vn/);
});
