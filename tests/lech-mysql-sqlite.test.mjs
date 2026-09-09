// Bộ kiểm thử chạy trên SQLite, còn production chạy MySQL. Mọi khác biệt giữa hai
// nền đều là điểm mù — và đã có một lỗi lọt ra tận người dùng đúng kiểu đó:
//
//   Cột before_json/after_json trong MySQL khai kiểu JSON, nên driver mysql2 TRẢ VỀ
//   OBJECT ĐÃ PHÂN GIẢI SẴN. Gọi JSON.parse lần nữa là ném SyntaxError. Trên SQLite
//   hai cột đó là TEXT nên JSON.parse chạy đúng, test xanh, còn nhà trường bấm "Chi
//   tiết" thì nhận "Hệ thống gặp lỗi không mong muốn."
//
// Tệp này canh đúng lớp lỗi đó: những chỗ mà mã nguồn ngầm giả định kiểu dữ liệu
// của một nền, và những chỗ hai kho dữ liệu lệch giao diện với nhau.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mysql = await readFile(new URL("../mysql-store.mjs", import.meta.url), "utf8");
const firestore = await readFile(new URL("../firestore-store.mjs", import.meta.url), "utf8");

const tenPhuongThuc = (nguon) =>
  new Set([...nguon.matchAll(/^\s{4,6}async ([a-zA-Z][\w]*)\(/gm)].map((m) => m[1]));

test("không JSON.parse thẳng vào cột kiểu JSON của MySQL", () => {
  // MySQL trả object, SQLite trả chuỗi. Phải đi qua jsonOrNull/jsonArray để nhận
  // được cả hai, nếu không thì hỏng đúng ở nền đang chạy thật.
  const pham = [...mysql.matchAll(/JSON\.parse\(\s*(?:row|entry|item)\.\w*_?json/gi)].map((m) => m[0]);
  assert.deepEqual(pham, [], `đọc cột JSON phải qua jsonOrNull: ${pham.join(", ")}`);
});

test("jsonOrNull nhận được cả chuỗi lẫn object đã phân giải", () => {
  // Dựng lại đúng hai hình dạng mà hai nền trả về.
  const khop = mysql.match(/const jsonOrNull = [^\n]+/);
  assert.ok(khop, "thiếu hàm jsonOrNull");
  const jsonOrNull = new Function(`${khop[0]}\nreturn jsonOrNull;`)();

  assert.deepEqual(jsonOrNull('{"status":"payment"}'), { status: "payment" }, "dạng SQLite: chuỗi");
  assert.deepEqual(jsonOrNull({ status: "payment" }), { status: "payment" }, "dạng MySQL: object sẵn");
  assert.equal(jsonOrNull(null), null);
  assert.equal(jsonOrNull(undefined), null);
});

// Khoản nợ CÓ SẴN, không phải mới sinh: Firestore là nền kế thừa và chưa bao giờ
// được nối cổng nhân sự nhà trường (đăng nhập Microsoft, quản lý tài khoản). Ghi ra
// đây để nó không âm thầm phình thêm — thêm phương thức mới cho MySQL mà quên
// Firestore thì bài kiểm dưới đỏ ngay.
const THIEU_O_FIRESTORE_DA_BIET = [
  "close", "findSchoolUserForLogin", "linkMicrosoftLogin", "createSchoolUser",
  "listSchoolUsers", "getUserById", "setSchoolUserDisplayName", "setSchoolUserRole",
  "setSchoolUserActive",
].sort();

test("khoảng lệch giữa hai kho dữ liệu không được rộng thêm", () => {
  // server.mjs gọi businessStore.x() mà không biết đang chạy nền nào. Thêm phương
  // thức cho một bên rồi quên bên kia là lỗi chỉ lộ ra khi đổi nền lưu trữ.
  const thieuOFirestore = [...tenPhuongThuc(mysql)].filter((ten) => !tenPhuongThuc(firestore).has(ten)).sort();
  const thieuOMysql = [...tenPhuongThuc(firestore)].filter((ten) => !tenPhuongThuc(mysql).has(ten)).sort();
  assert.deepEqual(thieuOFirestore, THIEU_O_FIRESTORE_DA_BIET,
    "firestore-store thiếu thêm phương thức mới so với danh sách nợ đã biết");
  // Chiều ngược lại cũng có một khoản nợ cũ: Firestore còn giữ upsertMicrosoftUser
  // của cách đăng nhập SSO đời trước, MySQL đã thay bằng findSchoolUserForLogin +
  // linkMicrosoftLogin.
  assert.deepEqual(thieuOMysql, ["upsertMicrosoftUser"],
    `mysql-store thiếu thêm phương thức mới: ${thieuOMysql.join(", ")}`);
});

test("hai phương thức mới của popup chi tiết có ở cả hai kho", () => {
  for (const ten of ["registrationDetail", "changeRegistrationStatus"]) {
    assert.ok(tenPhuongThuc(mysql).has(ten), `mysql-store thiếu ${ten}`);
    assert.ok(tenPhuongThuc(firestore).has(ten), `firestore-store thiếu ${ten}`);
  }
});
