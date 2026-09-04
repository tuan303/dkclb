// index.html được phục vụ với Cache-Control: no-cache, nhưng app.js và styles.css
// thì trình duyệt giữ lại. Trước đây số phiên bản ?v= phải sửa tay mỗi lần đổi
// giao diện — và đã quên một lần: CSS cũ không có quy tắc cho logo nên ảnh hiện ở
// kích thước gốc 1746px, còn app.js cũ vẫn hiển thị câu đã được xoá.
//
// Nay máy chủ tự thay ?v= bằng vân tay nội dung của chính tệp đó. Kiểm thử này giữ
// cho cơ chế đó không bị gỡ bỏ.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers/test-server.mjs";

let server;
const layHtml = async () => (await fetch(server.baseUrl)).text();
const layPhienBan = (html) =>
  Object.fromEntries([...html.matchAll(/\.\/([\w.-]+)\?v=([\w.-]+)/g)].map((m) => [m[1], m[2]]));

before(async () => { server = await startTestServer({ prefix: "nshm-cache-" }); });
after(async () => server.stop());

test("mỗi tệp giao diện mang một vân tay riêng, không phải số phiên bản đặt tay", async () => {
  const phienBan = layPhienBan(await layHtml());
  assert.ok(Object.keys(phienBan).length >= 3, `chỉ thấy ${Object.keys(phienBan).length} tệp có ?v=`);

  for (const [ten, v] of Object.entries(phienBan)) {
    // Vân tay là chuỗi băm hex 12 ký tự; số phiên bản đặt tay có dạng 20260904-1.
    assert.match(v, /^[0-9a-f]{12}$/, `${ten} vẫn mang số phiên bản đặt tay "${v}"`);
  }

  // Hai tệp khác nội dung phải có vân tay khác nhau, nếu không đổi một tệp sẽ
  // không làm mới được cache của nó.
  const giaTri = Object.values(phienBan);
  assert.equal(new Set(giaTri).size, giaTri.length, "có hai tệp trùng vân tay");
});

test("nội dung không đổi thì vân tay giữ nguyên giữa hai lần tải", async () => {
  // Nếu vân tay đổi mỗi lần tải, trình duyệt sẽ tải lại toàn bộ giao diện ở mọi
  // lượt truy cập — đúng nghĩa là mất sạch tác dụng của cache.
  assert.deepEqual(layPhienBan(await layHtml()), layPhienBan(await layHtml()));
});

test("index.html không được để trình duyệt giữ lại", async () => {
  // Nếu chính index.html bị cache thì vân tay bên trong nó cũng bị cache theo,
  // và cả cơ chế trở nên vô nghĩa.
  const response = await fetch(server.baseUrl);
  assert.match(response.headers.get("cache-control") || "", /no-cache|no-store/);
});
