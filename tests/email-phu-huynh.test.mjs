// Email phụ huynh đọc từ file danh bạ Google Sheets của trường.
//
// Tên cột thật trong file "NSHM_DSHS 26-27 (3 CẤP)_CLB": "Email bố" (cột P) và
// "Email mẹ" (cột T), nằm cùng hàng tiêu đề với "Họ tên bố" / "SDT bố" vốn đã chạy.
//
// Cạm bẫy lớn nhất của việc này KHÔNG phải đọc được cột, mà là hai chuyện sau:
//
//   1. Nếu thêm email vào bản ghi ĐỊNH GHI mà quên thêm email vào bản ghi ĐỌC RA,
//      thì isUnchanged so một chuỗi với undefined, thấy khác nhau, và cứ 15 phút hệ
//      thống lại ghi đè toàn bộ 7.119 tài khoản phụ huynh — mỗi lượt một lần ghi
//      vào cơ sở dữ liệu, mãi mãi.
//   2. Ba file danh bạ do ba giáo vụ khác nhau quản. Nếu một file chưa có cột email
//      mà vẫn ghi null đè lên, thì hai file sẽ xoá email của nhau, luân phiên, cứ
//      15 phút một lần.
import test from "node:test";
import assert from "node:assert/strict";
import { buildGuardianAccounts, detectColumnMapping } from "../sheets-directory.mjs";
import { mergeDirectorySnapshots } from "../directory-merge.mjs";
import { planDirectoryWrites } from "../directory-plan.mjs";

// Đúng thứ tự cột trong file thật của trường.
const TIEU_DE = [
  "Mã học sinh", "Họ và tên học sinh", "Ngày sinh", "Lớp", "Cấp học",
  "Họ tên bố", "Email bố", "SDT bố", "Nghề nghiệp bố",
  "Họ tên mẹ", "Email mẹ", "SDT mẹ", "Nghề nghiệp mẹ",
];
const { mapping } = detectColumnMapping(TIEU_DE);
const dong = (batDau) => [
  "NSHM260301", "Trần Tuệ An", "10/10/2018", "3A4", "Tiểu học",
  "TRẦN HOÀI NAM", batDau.emailBo, "0902116163", "Kỹ sư",
  "PHẠM KHÁNH LY", batDau.emailMe, "0924148843", "Kế toán",
];

test("nhận đúng cột Email bố và Email mẹ trong file thật của trường", () => {
  assert.equal(mapping.fatherEmail?.header, "Email bố");
  assert.equal(mapping.motherEmail?.header, "Email mẹ");
  // Thiếu email KHÔNG được chặn đồng bộ: đây là cột bổ sung, không bắt buộc.
  const { missing } = detectColumnMapping(TIEU_DE.filter((ten) => !ten.startsWith("Email")));
  assert.deepEqual(missing, []);
});

test("email gắn đúng bên với số điện thoại", () => {
  // Ghép nhầm là gửi thư của mẹ tới hòm thư của bố.
  const [bo, me] = buildGuardianAccounts(
    [dong({ emailBo: "tunm@petrolimex.vn", emailMe: "hangjessica5@gmail.com" })], mapping);
  assert.equal(bo.account, "0902116163");
  assert.equal(bo.email, "tunm@petrolimex.vn");
  assert.equal(me.account, "0924148843");
  assert.equal(me.email, "hangjessica5@gmail.com");
});

test("ô email ghi bậy thì bỏ qua, không nhận vào cơ sở dữ liệu", () => {
  // 7.119 dòng gõ tay nên có ô ghi "không có", có ô điền nhầm số điện thoại.
  for (const bay of ["không có", "0902116163", "chưa cập nhật", "a@b", "hai dia@chi.com", ""]) {
    const [bo] = buildGuardianAccounts([dong({ emailBo: bay, emailMe: "" })], mapping);
    assert.equal(bo.email, "", `"${bay}" không được coi là email hợp lệ`);
  }
});

test("phụ huynh có con ở hai cấp: lấy email từ file khai trước", () => {
  const nguon = (key, email) => ({
    key, label: key, ok: true,
    snapshot: {
      students: [{ code: `HS-${key}`, name: "A", dateOfBirth: "01/01/2015", className: "5A1", educationLevel: "Tiểu học", grade: 5 }],
      guardians: [{ account: "0902116163", displayName: "Trần Hoài Nam", email, students: [{ studentCode: `HS-${key}`, relationship: "Bố" }] }],
    },
  });
  const gop = mergeDirectorySnapshots([nguon("tieuhoc", "tunm@petrolimex.vn"), nguon("thcs", "khac@gmail.com")]);
  const phuHuynh = gop.snapshot.guardians.find((item) => item.account === "0902116163");
  assert.equal(phuHuynh.email, "tunm@petrolimex.vn");
  assert.equal(phuHuynh.students.length, 2, "vẫn phải gộp đủ con từ cả hai file");
});

test("file thiếu cột email KHÔNG xoá email đã có", () => {
  // Ba file do ba giáo vụ quản. Ghi null đè lên là hai file xoá email của nhau,
  // luân phiên, cứ 15 phút một lần.
  const ketQua = planDirectoryWrites({
    snapshot: {
      students: [{ code: "NSHM260301", name: "Trần Tuệ An", dateOfBirth: "10/10/2018", className: "3A4", educationLevel: "Tiểu học", grade: 3 }],
      guardians: [{ account: "0902116163", displayName: "Trần Hoài Nam", email: "", students: [{ studentCode: "NSHM260301", relationship: "Bố" }] }],
    },
    students: [{ id: "hs1", code: "NSHM260301", name: "Trần Tuệ An", dateOfBirth: "10/10/2018", grade: 3, homeroom: "3A4", level: "Tiểu học", status: "active" }],
    users: [{ id: "u1", account: "0902116163", accountLower: "0902116163", role: "parent", active: true, email: "tunm@petrolimex.vn" }],
    links: [{ parentUserId: "u1", studentId: "hs1", relationship: "Bố" }],
    timestamp: "2026-09-09T00:00:00.000Z",
    idFactory: (prefix) => `${prefix}_moi`,
    allSourcesLoaded: true,
  });
  const ghiUser = ketQua.writes.filter((write) => write.collection === "users");
  assert.deepEqual(ghiUser, [], "không được ghi gì khi nguồn không có email");
});

test("email đã khớp thì KHÔNG ghi lại — nếu không, 15 phút một lần ghi đè 7.119 tài khoản", () => {
  // Đây là bài quan trọng nhất của tệp. isUnchanged chỉ so những trường có trong
  // data, nên bản ghi ĐỌC RA bắt buộc phải mang email.
  const chay = (emailTrongCoSoDuLieu) => planDirectoryWrites({
    snapshot: {
      students: [{ code: "NSHM260301", name: "Trần Tuệ An", dateOfBirth: "10/10/2018", className: "3A4", educationLevel: "Tiểu học", grade: 3 }],
      guardians: [{ account: "0902116163", displayName: "Trần Hoài Nam", email: "tunm@petrolimex.vn", students: [{ studentCode: "NSHM260301", relationship: "Bố" }] }],
    },
    students: [{ id: "hs1", code: "NSHM260301", name: "Trần Tuệ An", dateOfBirth: "10/10/2018", grade: 3, homeroom: "3A4", level: "Tiểu học", status: "active" }],
    users: [{ id: "u1", account: "0902116163", accountLower: "0902116163", role: "parent", active: true, email: emailTrongCoSoDuLieu }],
    links: [{ parentUserId: "u1", studentId: "hs1", relationship: "Bố" }],
    timestamp: "2026-09-09T00:00:00.000Z",
    idFactory: (prefix) => `${prefix}_moi`,
    allSourcesLoaded: true,
  });

  const daKhop = chay("tunm@petrolimex.vn");
  assert.deepEqual(daKhop.writes.filter((write) => write.collection === "users"), [],
    "email không đổi thì tuyệt đối không được ghi lại");
  assert.equal(daKhop.counters.parentsUnchanged, 1);

  const chuaCo = chay(null);
  const ghi = chuaCo.writes.filter((write) => write.collection === "users");
  assert.equal(ghi.length, 1, "email mới thì phải ghi");
  assert.equal(ghi[0].data.email, "tunm@petrolimex.vn");
  assert.equal(chuaCo.counters.parentsUpdated, 1);
});

test("tài khoản phụ huynh tạo mới mang theo email ngay từ đầu", () => {
  const ketQua = planDirectoryWrites({
    snapshot: {
      students: [{ code: "NSHM260301", name: "Trần Tuệ An", dateOfBirth: "10/10/2018", className: "3A4", educationLevel: "Tiểu học", grade: 3 }],
      guardians: [{ account: "0902116163", displayName: "Trần Hoài Nam", email: "tunm@petrolimex.vn", students: [{ studentCode: "NSHM260301", relationship: "Bố" }] }],
    },
    students: [], users: [], links: [],
    timestamp: "2026-09-09T00:00:00.000Z",
    idFactory: (prefix) => `${prefix}_moi`,
    allSourcesLoaded: true,
  });
  const taoMoi = ketQua.writes.find((write) => write.collection === "users");
  assert.equal(taoMoi.data.email, "tunm@petrolimex.vn");
  assert.equal(taoMoi.data.mustChangePassword, true, "vẫn phải giữ nguyên luật mật khẩu khởi tạo");
});
