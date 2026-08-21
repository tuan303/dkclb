// Vercel cài phụ thuộc bằng pnpm với lockfile khóa cứng. Thêm một gói vào
// package.json mà quên cập nhật pnpm-lock.yaml sẽ làm build hỏng, và biểu hiện
// rất khó nhận ra: bản đang chạy vẫn phục vụ bình thường, chỉ là mọi thay đổi
// mới không bao giờ lên tới người dùng. Đã xảy ra thật với gói mysql2.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const projectUrl = new URL("../", import.meta.url);

async function readProjectFile(name) {
  return readFile(new URL(name, projectUrl), "utf8");
}

function importerDependencies(lockfile) {
  // Lấy đúng khối "importers:" cho gói gốc, không lẫn với danh sách gói phụ thuộc.
  const importersBlock = lockfile.split(/\npackages:/)[0];
  const names = new Set();
  for (const line of importersBlock.split(/\r?\n/)) {
    const match = line.match(/^ {6}'?([@a-zA-Z0-9._/-]+)'?:$/);
    if (match) names.add(match[1]);
  }
  return names;
}

test("mọi phụ thuộc trong package.json đều có trong pnpm-lock.yaml", async () => {
  const [packageJson, lockfile] = await Promise.all([
    readProjectFile("package.json"),
    readProjectFile("pnpm-lock.yaml"),
  ]);
  const declared = Object.keys(JSON.parse(packageJson).dependencies || {});
  const locked = importerDependencies(lockfile);

  assert.ok(declared.length > 0, "dự án phải có ít nhất một phụ thuộc");
  const missing = declared.filter((name) => !locked.has(name));
  assert.deepEqual(missing, [], `Thiếu trong pnpm-lock.yaml: ${missing.join(", ")}. Chạy: npx pnpm install --lockfile-only`);
});

test("phiên bản khai trong package.json khớp với phiên bản đã khóa", async () => {
  const [packageJson, lockfile] = await Promise.all([
    readProjectFile("package.json"),
    readProjectFile("pnpm-lock.yaml"),
  ]);
  const declared = JSON.parse(packageJson).dependencies || {};
  const importersBlock = lockfile.split(/\npackages:/)[0];

  for (const [name, specifier] of Object.entries(declared)) {
    const pattern = new RegExp(`^ {6}'?${name.replace(/[/@.]/g, "\\$&")}'?:\\r?\\n {8}specifier: (.+)$`, "m");
    const match = importersBlock.match(pattern);
    assert.ok(match, `Không tìm thấy ${name} trong khối importers của pnpm-lock.yaml`);
    assert.equal(match[1].trim(), specifier, `Phiên bản khai của ${name} khác với phiên bản đã khóa`);
  }
});

test("không lẫn lockfile của trình quản lý gói khác vào repo", async () => {
  // Hai lockfile cùng tồn tại có thể khiến Vercel chọn nhầm trình quản lý gói.
  const gitignore = await readProjectFile(".gitignore");
  assert.match(gitignore, /package-lock\.json/, "package-lock.json phải nằm trong .gitignore");
});
