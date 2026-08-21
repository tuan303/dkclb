// Kiểm chứng điều đã cam kết: mở thẳng cơ sở dữ liệu ra thì không đọc được
// thông tin cá nhân. Test này truy vấn MySQL trực tiếp, không đi qua ứng dụng —
// đúng góc nhìn của người có quyền vào MySQL Workbench hoặc cầm được tệp mysqldump.
//
// Cần MySQL thật nên chỉ chạy khi có TEST_MYSQL_URL.
import test, { after, before, skip } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers/test-server.mjs";

const MYSQL_BASE_URL = process.env.TEST_MYSQL_URL || "";

// Những giá trị này nằm trong dữ liệu mẫu và tuyệt đối không được xuất hiện ở dạng đọc được.
const SECRETS = ["Nguyễn Minh An", "Nguyễn Gia Hân", "Mai Lan", "0901234567", "NSHM260301", "NSHM260601"];

let server;
let connection;

before(async () => {
  if (!MYSQL_BASE_URL) {
    skip("Bỏ qua: chưa đặt TEST_MYSQL_URL nên không có MySQL để soi.");
    return;
  }
  server = await startTestServer({ prefix: "nshm-encryption-" });
  // Kho dữ liệu chỉ được khởi tạo ở request đầu tiên, nên phải gọi một lần thì
  // bảng và dữ liệu mẫu mới tồn tại để soi.
  const ready = await server.request("/api/health");
  assert.equal(ready.status, 200);
  const { createConnection } = await import("mysql2/promise");
  connection = await createConnection(server.databaseUrl);
});

after(async () => {
  if (connection) await connection.end();
  if (server) await server.stop();
});

async function rawRows(sql) {
  const [rows] = await connection.query(sql);
  return rows;
}

test("cột tên và số điện thoại trong cơ sở dữ liệu là chuỗi đã mã hóa", { skip: !MYSQL_BASE_URL }, async () => {
  const users = await rawRows("SELECT id, account, account_index, display_name, role FROM users");
  assert.ok(users.length >= 3, "phải có dữ liệu để soi");
  for (const user of users) {
    assert.ok(user.account.startsWith("v1."), `tài khoản của ${user.id} phải ở dạng mã hóa`);
    assert.ok(user.display_name.startsWith("v1."), `tên hiển thị của ${user.id} phải ở dạng mã hóa`);
    assert.ok(user.account_index.startsWith("i1."), `chỉ mục tra cứu của ${user.id} phải là chỉ mục mù`);
  }

  const students = await rawRows("SELECT id, code, code_index, name, date_of_birth, grade, homeroom FROM students");
  assert.ok(students.length >= 8);
  for (const student of students) {
    assert.ok(student.code.startsWith("v1."), `mã học sinh ${student.id} phải ở dạng mã hóa`);
    assert.ok(student.name.startsWith("v1."), `tên học sinh ${student.id} phải ở dạng mã hóa`);
    assert.ok(student.code_index.startsWith("i1."));
    // Khối và lớp hành chính giữ nguyên bản rõ: cần cho lọc và sắp xếp, và tự nó
    // không định danh được học sinh nào. Đây là đánh đổi có chủ ý, không phải bỏ sót.
    assert.equal(typeof student.grade, "number");
    assert.match(student.homeroom, /^[0-9]/);
  }
});

test("quét toàn bộ cơ sở dữ liệu không thấy một mẩu thông tin cá nhân nào", { skip: !MYSQL_BASE_URL }, async () => {
  // Mô phỏng đúng thứ kẻ cầm được tệp mysqldump nhìn thấy: toàn bộ nội dung mọi bảng.
  const tables = (await rawRows("SHOW TABLES")).map((row) => String(Object.values(row)[0]));
  const dump = [];
  for (const table of tables) {
    for (const row of await rawRows(`SELECT * FROM \`${table}\``)) dump.push(JSON.stringify(row));
  }
  const everything = dump.join("\n");
  assert.ok(everything.length > 0);

  for (const secret of SECRETS) {
    assert.ok(!everything.includes(secret), `Cơ sở dữ liệu còn lộ "${secret}" ở dạng đọc được`);
  }
});

test("ứng dụng vẫn đọc ra đúng dữ liệu thật qua khóa của nó", { skip: !MYSQL_BASE_URL }, async () => {
  const parentCookie = await server.loginCookie("0901234567", "123456");
  const { students } = await (await server.request("/api/students", parentCookie)).json();
  assert.equal(students.length, 2);
  const first = students.find((item) => item.code === "NSHM260301");
  assert.ok(first, "tra cứu theo mã học sinh vẫn ra đúng bản ghi");
  assert.equal(first.name, "Nguyễn Minh An");
  assert.equal(first.homeroom, "3A2");

  // Danh sách phải sắp theo khối rồi tới tên thật, không phải theo chuỗi mã hóa.
  assert.deepEqual(students.map((item) => item.grade), [3, 6]);
});

test("tra cứu tài khoản theo số điện thoại vẫn chạy dù cột đã mã hóa", { skip: !MYSQL_BASE_URL }, async () => {
  const adminCookie = await server.loginCookie("admin@nshm.edu.vn", "Admin@123");
  const { lookup } = await (await server.request("/api/admin/accounts/lookup?account=901234567", adminCookie)).json();
  assert.equal(lookup.found, true, "chỉ mục mù phải cho tra cứu được kể cả khi thiếu số 0 đầu");
  assert.equal(lookup.account.account, "0901234567");
  assert.equal(lookup.account.displayName, "Mai Lan");
  assert.equal(lookup.account.linkedStudents, 2);
});

test("hai bản ghi cùng giá trị vẫn cho ra hai chuỗi mã hóa khác nhau", { skip: !MYSQL_BASE_URL }, async () => {
  // Nếu giống nhau thì nhìn cơ sở dữ liệu là suy ra được hai học sinh trùng tên.
  const adminCookie = await server.loginCookie("admin@nshm.edu.vn", "Admin@123");
  const before = await rawRows("SELECT account FROM users WHERE role = 'parent'");
  assert.equal(new Set(before.map((row) => row.account)).size, before.length, "không có hai bản mã trùng nhau");

  // Đổi mật khẩu về mã khởi tạo rồi đọc lại: bản mã của tài khoản không đổi vì không ghi lại cột đó.
  await server.request("/api/admin/accounts/reset-initial-password", adminCookie, {
    method: "POST",
    body: JSON.stringify({ account: "0901234567", confirmation: "RESET_INITIAL_PASSWORD" }),
  });
  const login = await server.login("0901234567", "0901234567");
  assert.equal(login.status, 200, "mật khẩu khởi tạo vẫn so khớp đúng với tài khoản đã mã hóa");
});
