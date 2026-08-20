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
