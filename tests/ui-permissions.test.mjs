// Giao diện ẩn/hiện theo QUYỀN máy chủ trả về, không tự suy từ tên vai trò.
// Suy đoán ở trình duyệt là cách chắc chắn để hai bên lệch nhau: người dùng thấy
// nút, bấm vào, rồi nhận 403.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DENIAL_MESSAGE } from "../school-login.mjs";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

test("thông báo từ chối trên giao diện khớp nguyên văn với máy chủ", () => {
  // Hai chỗ nói hai câu khác nhau là lỗi kinh điển khi sửa một bên rồi quên bên kia.
  assert.ok(app.includes(`const SSO_DENIAL_MESSAGE = "${DENIAL_MESSAGE}"`),
    "app.js phải dùng đúng nguyên văn thông báo trong school-login.mjs");
});

test("luồng SSO bị từ chối hiện thông báo trên màn hình đăng nhập, không phải JSON thô", () => {
  assert.match(app, /function showSsoOutcome\(\)/);
  assert.match(app, /params\.get\("sso"\)/);
  assert.match(app, /box\.textContent = SSO_DENIAL_MESSAGE/);
  // Dọn địa chỉ để tải lại trang không hiện lại thông báo cũ.
  assert.match(app, /history\.replaceState/);
});

test("mỗi mục điều hướng quản trị gắn với một quyền", () => {
  const nav = app.slice(app.indexOf("const adminNav = ["), app.indexOf("const pageMeta"));
  for (const [id, capability] of [
    ["dashboard", "bao-cao"],
    ["campaigns", "danh-muc"],
    ["classes", "danh-muc"],
    ["applications", "duyet-don"],
    ["finance", "duyet-don"],
    ["reports", "xuat-du-lieu"],
    ["accounts", "quan-ly-tai-khoan"],
    ["settings", "ma-kich-hoat"],
  ]) {
    const line = nav.split("\n").find((row) => row.includes(`id: "${id}"`));
    assert.ok(line, `thiếu mục điều hướng ${id}`);
    assert.ok(line.includes(`cap: "${capability}"`), `mục ${id} phải gắn quyền ${capability}, dòng: ${line.trim()}`);
  }
  assert.match(app, /\.filter\(\(item\) => !item\.cap \|\| hasCap\(item\.cap\)\)/);
});

test("quyền lấy từ máy chủ chứ không suy từ tên vai trò", () => {
  assert.match(app, /const hasCap = \(capability\) => \(state\.me\?\.capabilities \|\| \[\]\)\.includes\(capability\)/);
});

test("không còn chỗ nào coi 'admin' là vai trò nhà trường duy nhất", () => {
  // Giáo vụ và quản trị cao nhất cũng là nhân sự nhà trường; so sánh bằng
  // role === "admin" sẽ hiển thị họ nhầm thành phụ huynh.
  const offenders = app.split("\n")
    .map((line, index) => [index + 1, line])
    .filter(([, line]) => /state\.role === "admin"|state\.role !== "admin"/.test(line));
  assert.deepEqual(offenders, [], `còn so sánh cứng với 'admin': ${JSON.stringify(offenders)}`);
});

test("gọi endpoint đồng bộ Sheets chỉ khi có quyền", () => {
  // Gọi thẳng sẽ khiến giáo vụ nhận 403 và cả Promise.all đổ, tức là không
  // dùng được ứng dụng.
  assert.match(app, /hasCap\("dong-bo-danh-ba"\) \? api\("\/admin\/integrations\/google-sheets"\) : Promise\.resolve\(null\)/);
});

test("hàm chọn nhiều phần tử không bị viết nhầm thành chọn một", () => {
  // Đã từng hỏng đúng kiểu này: $$ bị nuốt thành $ nên .forEach chạy trên null.
  const broken = app.split("\n")
    .map((line, index) => [index + 1, line.trim()])
    .filter(([, line]) => /[^$]\$\("[^"]+"\)\.forEach/.test(line));
  assert.deepEqual(broken, [], `gọi .forEach trên kết quả chọn một phần tử: ${JSON.stringify(broken)}`);
});

test("phiên bản tài nguyên được nâng cùng lần sửa giao diện", () => {
  // app.js và styles.css được cache 4 giờ; quên nâng là người dùng chạy mã cũ.
  const versions = [...html.matchAll(/\?v=([0-9]{8}-[0-9]+)/g)].map((match) => match[1]);
  assert.ok(versions.length >= 3, "không tìm thấy tham số phiên bản trong index.html");
  assert.equal(new Set(versions).size, 1, `các tệp đang mang phiên bản khác nhau: ${[...new Set(versions)].join(", ")}`);
});
