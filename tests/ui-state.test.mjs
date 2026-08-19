import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("login and application screens cannot be visible at the same time", async () => {
  const [html, css, script] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="app-shell"[^>]*\bhidden\b/);
  assert.match(css, /\.hidden, \[hidden\] \{ display: none !important; \}/);
  assert.match(script, /loginScreen\.hidden = showApplication;/);
  assert.match(script, /appShell\.hidden = !showApplication;/);
});
