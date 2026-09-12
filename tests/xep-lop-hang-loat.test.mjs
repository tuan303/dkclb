// Đọc file kết quả Google Form để xếp học sinh vào ca học.
//
// Nhà trường đã mở một đợt đăng ký qua Google Form trước khi có cổng này: vài trăm
// em đã đóng phí và đang học thật, nhưng hệ thống chưa có đơn nào của các em đó.
//
// Rủi ro lớn nhất của tính năng này KHÔNG phải đọc sai file, mà là ĐOÁN LIỀU: một
// CLB có hai ca mà máy tự chọn hộ thì cả trăm em vào sai buổi, và không ai phát hiện
// cho tới lúc giáo viên điểm danh. Phần lớn tệp này canh đúng ranh giới đó.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DONG_XEP_LOP, chuanHoaSdt, detectXepLopMapping, doanCaHoc, docFileXepLop, gomOChonClb,
} from "../xep-lop-import.mjs";

// Đúng hình dạng file Google Form xuất ra: cột dấu thời gian ở đầu, tiêu đề hàng 1.
const TIEU_DE = ["Dấu thời gian", "Mã học sinh", "Họ và tên học sinh", "Số điện thoại", "Email", "CLB đăng ký"];
const dong = (ma, ten, clb, sdt = "0901234567") => ["01/09/2026 10:12", ma, ten, sdt, "me@vd.vn", clb];
const fileMau = () => [
  TIEU_DE,
  dong("NSHM260301", "Nguyễn Minh An", "Piano nhập môn"),
  dong("NSHM260601", "Nguyễn Gia Hân", "Guitar · Ca 1"),
];

const CA_HOC = [
  { id: "piano", clubName: "Piano nhập môn", className: "" },
  { id: "guitar1", clubName: "Guitar", className: "Ca 1" },
  { id: "guitar2", clubName: "Guitar", className: "Ca 2" },
];

/* ---------- Nhận diện cột ---------- */

test("nhận đúng cột của file Google Form, bỏ qua cột dấu thời gian", () => {
  const { mapping, missing } = detectXepLopMapping(TIEU_DE);
  assert.deepEqual(missing, []);
  assert.equal(mapping.studentCode.header, "Mã học sinh");
  assert.equal(mapping.clubText.header, "CLB đăng ký");
  assert.equal(mapping.phone.header, "Số điện thoại");
});

test("chỉ mã học sinh và ô chọn CLB là bắt buộc", () => {
  // Tên, điện thoại, email chỉ để đối chiếu cho người đọc yên tâm. Thiếu chúng vẫn
  // xếp lớp được, vì mã học sinh mới là thứ dò ra đúng em.
  const { missing } = detectXepLopMapping(["Mã HS", "CLB"]);
  assert.deepEqual(missing, []);
});

test("thiếu mã học sinh thì từ chối cả file, nói rõ thiếu gì", () => {
  // Tên học sinh trong cơ sở dữ liệu được mã hoá nên KHÔNG tra ngược được; không có
  // mã thì không có cách nào dò ra em nào. Thà từ chối còn hơn xếp nhầm.
  const ketQua = docFileXepLop({ rows: [["Họ và tên học sinh", "CLB đăng ký"], ["Nguyễn Minh An", "Piano nhập môn"]] });
  assert.equal(ketQua.ok, false);
  assert.match(ketQua.error, /Thiếu cột bắt buộc.*Mã học sinh/);
});

test("file có một hàng thừa phía trên tiêu đề vẫn đọc được", () => {
  const ketQua = docFileXepLop({ rows: [["KẾT QUẢ ĐĂNG KÝ CLB HỌC KỲ I", "", "", "", "", ""], ...fileMau()] });
  assert.equal(ketQua.ok, true);
  assert.equal(ketQua.headerRow, 2, "phải nói đã lấy hàng nào làm tiêu đề");
  assert.equal(ketQua.rows.length, 2);
});

/* ---------- Đọc dòng ---------- */

test("dòng hỏng KHÔNG bị vứt đi im lặng, mà kèm lý do", () => {
  // Nuốt mất dòng hỏng là cách chắc chắn nhất để vài em không bao giờ vào lớp mà
  // không ai biết. Màn xem trước phải nói được "312 dòng, xếp được 305, 7 dòng này".
  const ketQua = docFileXepLop({ rows: [
    TIEU_DE,
    dong("NSHM260301", "Nguyễn Minh An", "Piano nhập môn"),
    dong("", "Không có mã", "Piano nhập môn"),
    dong("NSHM260999", "Thiếu ô chọn", ""),
  ] });
  assert.equal(ketQua.rows.length, 3, "cả ba dòng phải còn trong kết quả");
  assert.equal(ketQua.rows[0].loi, null);
  assert.equal(ketQua.rows[1].loi, "Thiếu mã học sinh");
  assert.equal(ketQua.rows[2].loi, "Thiếu ô chọn CLB");
});

test("số hàng báo ra khớp số hàng người dùng thấy trong Excel", () => {
  // Báo "dòng 3" mà trong Excel là dòng 5 thì người sửa file đi tìm nhầm chỗ.
  const ketQua = docFileXepLop({ rows: fileMau() });
  assert.equal(ketQua.rows[0].dong, 2, "dòng dữ liệu đầu tiên nằm ngay dưới tiêu đề hàng 1");
  assert.equal(ketQua.rows[1].dong, 3);
});

test("hàng trống hoàn toàn thì bỏ qua, không tính là dòng hỏng", () => {
  const ketQua = docFileXepLop({ rows: [TIEU_DE, dong("NSHM260301", "A", "Piano nhập môn"), ["", "", "", "", "", ""]] });
  assert.equal(ketQua.rows.length, 1);
});

test("file rỗng không bị hiểu thành không có em nào đăng ký", () => {
  const ketQua = docFileXepLop({ rows: [] });
  assert.equal(ketQua.ok, false);
  assert.match(ketQua.error, /rỗng/);
});

test("chặn file quá lớn", () => {
  const nhieu = [TIEU_DE, ...Array.from({ length: MAX_DONG_XEP_LOP + 1 }, () => dong("NSHM1", "A", "Piano nhập môn"))];
  const ketQua = docFileXepLop({ rows: nhieu });
  assert.equal(ketQua.ok, false);
  assert.match(ketQua.error, /vượt giới hạn/);
});

/* ---------- Số điện thoại ---------- */

test("số điện thoại chuẩn hoá được về dạng so khớp với tài khoản phụ huynh", () => {
  // Tài khoản phụ huynh chính là số điện thoại. Form thì nhận đủ kiểu người ta gõ.
  assert.equal(chuanHoaSdt("0901234567"), "0901234567");
  assert.equal(chuanHoaSdt("090 123 4567"), "0901234567");
  assert.equal(chuanHoaSdt("+84901234567"), "0901234567");
  assert.equal(chuanHoaSdt("84901234567"), "0901234567");
  assert.equal(chuanHoaSdt("901234567"), "0901234567");
  assert.equal(chuanHoaSdt(""), "");
});

/* ---------- Ghép ô chọn của Form với ca học ---------- */

test("gom các ô chọn khác nhau lại, mỗi giá trị một lần, nhiều dòng nhất lên đầu", () => {
  // Vài trăm dòng nhưng chỉ vài chục giá trị: ghép là việc con người làm MỘT lần,
  // không phải máy đoán 312 lần.
  const ketQua = docFileXepLop({ rows: [
    TIEU_DE,
    dong("A", "a", "Piano nhập môn"), dong("B", "b", "Piano nhập môn"), dong("C", "c", "Guitar · Ca 1"),
  ] });
  const gom = gomOChonClb(ketQua.rows);
  assert.equal(gom.length, 2);
  assert.equal(gom[0].mau, "Piano nhập môn");
  assert.equal(gom[0].soDong, 2);
});

test("CLB chỉ có MỘT ca thì đoán được, kể cả khi người ta gõ không dấu", () => {
  assert.equal(doanCaHoc("Piano nhập môn", CA_HOC).classId, "piano");
  assert.equal(doanCaHoc("piano nhap mon", CA_HOC).classId, "piano");
});

test("CLB có HAI ca thì KHÔNG đoán, trả về hai ứng viên để người vận hành chọn", () => {
  // Đây là bài quan trọng nhất tệp này. Đoán liều ở đây là xếp cả trăm em vào sai
  // buổi, mà sai kiểu đó không lộ ra cho tới khi giáo viên gọi tên.
  const ketQua = doanCaHoc("Guitar", CA_HOC);
  assert.equal(ketQua.classId, null, "không được tự chọn hộ khi có hai ca");
  assert.deepEqual(ketQua.ungVien.map((ca) => ca.id), ["guitar1", "guitar2"]);
});

test("ô chọn ghi rõ ca thì ghép đúng ca đó", () => {
  assert.equal(doanCaHoc("Guitar · Ca 2", CA_HOC).classId, "guitar2");
});

test("ô chọn không khớp CLB nào thì nói thẳng là không có ứng viên", () => {
  const ketQua = doanCaHoc("Cờ vua", CA_HOC);
  assert.equal(ketQua.classId, null);
  assert.deepEqual(ketQua.ungVien, []);
});

/* ---------- Chạy thật qua HTTP ---------- */

import { after, before } from "node:test";
import { readFile } from "node:fs/promises";
import { startTestServer } from "./helpers/test-server.mjs";

let server;        // máy chủ CÓ bật tính năng, để kiểm phần nghiệp vụ của nó
let quanTri;
let phuHuynh;
let dotId;
let mayChuThat;    // máy chủ đúng cấu hình đang chạy: tính năng TẮT
let quanTriThat;

before(async () => {
  // Nhập hàng loạt mặc định TẮT vì chưa hoàn thiện — xem CHO_PHEP_NHAP_HANG_LOAT
  // trong server.mjs. Phần nghiệp vụ đã viết vẫn phải được kiểm, nên kiểm nó trên
  // một máy chủ có bật, và kiểm riêng việc "mặc định là khoá" trên cấu hình thật.
  server = await startTestServer({ prefix: "nshm-xeplop-", env: { CHO_PHEP_NHAP_HANG_LOAT: "1" } });
  quanTri = await server.loginCookie("admin@nshm.edu.vn", "Admin@123");
  phuHuynh = await server.loginCookie("0901234567", "123456");
  dotId = (await (await server.request("/api/admin/periods", quanTri)).json())
    .periods.find((item) => item.status === "open").id;

  mayChuThat = await startTestServer({ prefix: "nshm-xeplop-khoa-" });
  quanTriThat = await mayChuThat.loginCookie("admin@nshm.edu.vn", "Admin@123");
});

after(async () => {
  await server.stop();
  await mayChuThat.stop();
});

/* ---------- Khoá trên cấu hình thật ---------- */

test("máy chủ đúng cấu hình thật KHOÁ cả hai đường nhập hàng loạt", async () => {
  // Rà soát đối kháng tìm 10 lỗi nặng còn chưa vá, trong đó bấm Ghi hai lần tạo hai
  // đơn cho cùng một em (đo trên MySQL thật: sĩ số vọt 22/20), và nhập lại sau khi
  // huỷ làm sĩ số tụt xuống dưới số em đang học thật. Khoá lại cho tới khi vá xong.
  for (const duong of ["preview", "commit"]) {
    const response = await mayChuThat.request(`/api/admin/registrations/import/${duong}`, quanTriThat,
      { method: "POST", body: JSON.stringify({ periodId: "x", files: [], confirmation: "NHAP_DANG_KY_HANG_LOAT" }) });
    assert.equal(response.status, 403, `đường ${duong} phải bị khoá`);
    assert.equal((await response.json()).error.code, "NHAP_HANG_LOAT_DANG_KHOA");
  }
});

test("giao diện đọc cờ tính năng từ máy chủ, không tự đoán", async () => {
  // Nút và đường API phải bật/tắt cùng một lúc bằng cùng một biến môi trường; ẩn nút
  // mà để đường API mở là khoá giả.
  const tat = await (await mayChuThat.request("/api/me", quanTriThat)).json();
  assert.equal(tat.user.tinhNang.nhapHangLoat, false);
  const bat = await (await server.request("/api/me", quanTri)).json();
  assert.equal(bat.user.tinhNang.nhapHangLoat, true);

  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const dongNut = app.split("\n").find((row) => row.includes('data-go="nhapDangKy"') && row.includes("Nhập từ file"));
  assert.ok(dongNut, "không tìm thấy nút vào màn nhập hàng loạt");
  assert.ok(dongNut.includes("state.me?.tinhNang?.nhapHangLoat ?"),
    `nút vào phải nằm sau cờ tính năng, dòng: ${dongNut.trim().slice(0, 160)}`);
  assert.ok(app.includes("if (!state.me?.tinhNang?.nhapHangLoat) {"),
    "gõ thẳng đường dẫn cũng phải gặp màn hình khoá");
});

const fileForm = (...dongs) => ({ label: "form.xlsx", rows: [["Mã học sinh", "CLB đăng ký"], ...dongs] });
const goiNhap = (duong, body, cookie = quanTri) => server.request(`/api/admin/registrations/import/${duong}`, cookie,
  { method: "POST", body: JSON.stringify({ periodId: dotId, ...body }) });
const caPainting = async () => (await (await server.request("/api/admin/catalog", quanTri)).json())
  .classes.find((row) => row.id === "painting");

test("nhập vào KHÔNG làm sĩ số phồng lên gấp đôi", async () => {
  // Đây là bài quan trọng nhất tệp này. Các em trong file ĐANG được đếm ở
  // enrolled_base ("ghi danh sẵn ngoài hệ thống"); nhập thành đơn mà không hạ con
  // số đó xuống là đếm hai lần. Đã đo trên máy chủ thật trước khi vá: ca sức chứa
  // 20, base 15, nhập 5 đơn thì hệ thống báo 20/20 "đã đầy".
  const truoc = await caPainting();
  assert.ok(truoc.enrolledBase >= 2, `ca mẫu phải có ghi danh sẵn, đang là ${truoc.enrolledBase}`);

  const body = { files: [fileForm(["NSHM260301", "Mỹ thuật sáng tạo"], ["NSHM260601", "Mỹ thuật sáng tạo"])] };
  const xem = (await (await goiNhap("preview", body)).json()).preview;
  assert.equal(xem.dem.xepDuoc, 2);
  assert.equal(xem.caAnhHuong[0].enrolledBaseDeXuat, truoc.enrolledBase - 2,
    "màn xem trước phải nói trước con số ghi danh sẵn sẽ hạ xuống bao nhiêu");
  assert.equal(xem.caAnhHuong[0].siSoSauNeuHaBase, xem.caAnhHuong[0].siSoTruoc);
  assert.equal(xem.caAnhHuong[0].siSoSauNeuGiuBase, xem.caAnhHuong[0].siSoTruoc + 2,
    "và nói luôn nếu KHÔNG hạ thì sĩ số phồng lên bao nhiêu");

  const ghi = await goiNhap("commit", { ...body, confirmation: "NHAP_DANG_KY_HANG_LOAT" });
  const than = await ghi.text();
  assert.equal(ghi.status, 200, than);
  assert.equal(JSON.parse(than).result.daTao, 2);

  const sau = await caPainting();
  assert.equal(sau.enrolled, truoc.enrolled, "sĩ số phải KHÔNG đổi: hai em này vốn đã được đếm rồi");
  assert.equal(sau.enrolledBase, truoc.enrolledBase - 2);
  assert.equal(sau.activeRegistrations, truoc.activeRegistrations + 2);
});

test("chạy lại đúng file đó KHÔNG tạo đơn trùng", async () => {
  // Không có khoá idempotency nào trong hệ thống; chống trùng dựa vào luật "em này
  // đã có đơn còn hiệu lực cho ca đó". Bấm ghi hai lần vì mạng chậm là chuyện sẽ
  // xảy ra với một lần nhập vài trăm dòng.
  const body = { files: [fileForm(["NSHM260301", "Mỹ thuật sáng tạo"], ["NSHM260601", "Mỹ thuật sáng tạo"])] };
  const xem = (await (await goiNhap("preview", body)).json()).preview;
  assert.equal(xem.dem.daCoDon, 2, "cả hai dòng phải bị nhận ra là đã có đơn");
  assert.equal(xem.dem.xepDuoc, undefined);
  assert.equal(xem.sanSang, false, "không còn dòng nào xếp được thì không cho bấm ghi");

  const ghi = await goiNhap("commit", { ...body, confirmation: "NHAP_DANG_KY_HANG_LOAT" });
  assert.equal(ghi.status, 422);
  assert.equal((await ghi.json()).error.code, "IMPORT_NOT_READY");
});

test("đơn nhập vào gắn đúng phụ huynh, không thì cả trăm gia đình không thấy đơn của con", async () => {
  // parent_user_id để trống thì không màn nào vỡ, nhưng nó là BỘ LỌC DUY NHẤT của
  // màn "Đăng ký của tôi" — đã đo: mẹ của một em không thấy đơn của chính con mình.
  const cuaPhuHuynh = (await (await server.request("/api/registrations", phuHuynh)).json()).registrations;
  const don = cuaPhuHuynh.find((row) => row.classId === "painting");
  assert.ok(don, "phụ huynh phải thấy đơn vừa nhập cho con mình trong cổng");
  assert.equal(don.status, "dang_hoc");
  assert.equal(don.feePaid, true, "các em này đã đóng phí, cột đã thu tiền phải ghi nhận");
});

test("trùng giờ với CLB em ấy đã học thì không xếp, nói rõ trùng với ca nào", async () => {
  const trung = (await (await goiNhap("preview", {
    files: [fileForm(["NSHM260301", "Bóng rổ nền tảng"])],
  })).json()).preview;
  const dong = trung.rows[0];
  assert.equal(dong.ketCuc, "trungGio", `mong đợi trùng giờ, nhận được ${dong.ketCuc}: ${dong.lyDo}`);
  assert.match(dong.lyDo, /Trùng giờ với/);
});

test("giáo vụ không nhập đăng ký hàng loạt được", async () => {
  // Tạo đơn thay học sinh là cùng loại việc với xác nhận phí và đổi trạng thái —
  // đều do quyền duyet-don gác, mà giáo vụ không có.
  const giaoVu = await server.loginCookie("giaovu@nshm.edu.vn", "Admin@123");
  const body = { files: [fileForm(["NSHM260301", "Mỹ thuật sáng tạo"])] };
  assert.equal((await goiNhap("preview", body, giaoVu)).status, 403);
  assert.equal((await goiNhap("commit", { ...body, confirmation: "NHAP_DANG_KY_HANG_LOAT" }, giaoVu)).status, 403);
});

test("bấm nhầm nút không đủ để ghi vài trăm đơn", async () => {
  const ghi = await goiNhap("commit", { files: [fileForm(["NSHM260301", "Mỹ thuật sáng tạo"])] });
  assert.equal(ghi.status, 422);
  assert.equal((await ghi.json()).error.code, "IMPORT_CONFIRMATION_REQUIRED");
});

/* ---------- Mười lỗi rà soát tìm ra, mỗi lỗi một bài ---------- */

const doiTrangThai = (id, status) => server.request(`/api/admin/registrations/${encodeURIComponent(id)}/status`,
  quanTri, { method: "PATCH", body: JSON.stringify({ status }) });

test("một em tick HAI CLB TRÙNG GIỜ trong cùng file thì chỉ xếp được một", async () => {
  // Đo được trước khi vá: cả hai dòng đều "xếp được", em học một buổi nhưng chiếm
  // hai chỗ, và nhà trường ghi nhận đã thu phí cả hai. Dữ liệu mẫu có Bóng rổ và
  // Piano đều Thứ 3 16:15–17:30.
  const xem = (await (await goiNhap("preview", {
    files: [fileForm(["NSHM260311", "Bóng rổ nền tảng"], ["NSHM260311", "Piano nhập môn"])],
  })).json()).preview;
  assert.equal(xem.dem.xepDuoc, 1, "chỉ được xếp một trong hai buổi trùng giờ");
  assert.equal(xem.dem.trungGioTrongFile, 1);
  assert.match(xem.rows[1].lyDo, /ở dòng 2 trong chính file này/);
});

test("hai ca khác nhau của CÙNG một CLB thì chỉ xếp được một", async () => {
  // Cổng phụ huynh chặn đúng việc này ("Học sinh đã đăng ký một lớp khác của ..."),
  // đường nhập trước đây thì không — em bị tính học hai ca và hai lần học phí.
  const painting = await caPainting();
  const them = await server.request("/api/admin/classes", quanTri, {
    method: "POST",
    body: JSON.stringify({
      clubId: "painting", periodId: dotId, name: "Ca chiều thứ 6", dayOfWeek: 6,
      startTime: "16:15", endTime: "17:30", room: painting.room, teacher: painting.teacher,
      capacity: 20, minCapacity: 0, enrolledBase: 0, fee: painting.fee, grades: painting.grades,
    }),
  });
  assert.equal(them.status, 201, `tạo ca thứ hai thất bại: ${await them.text()}`);
  const caMoi = (await (await server.request("/api/admin/catalog", quanTri)).json())
    .classes.find((row) => row.name === "Ca chiều thứ 6");

  const xem = (await (await goiNhap("preview", {
    files: [fileForm(["NSHM260311", "Mỹ thuật A"], ["NSHM260311", "Mỹ thuật B"])],
    mapping: { "my thuat a": "painting", "my thuat b": caMoi.id },
  })).json()).preview;
  assert.equal(xem.dem.xepDuoc, 1);
  assert.equal(xem.dem.trungClbTrongFile, 1);
  assert.match(xem.rows[1].lyDo, /một ca khác của Mỹ thuật sáng tạo/);

  // Dọn lại: để ca thứ hai tồn tại thì mọi bài sau gõ "Mỹ thuật sáng tạo" đều rơi
  // vào "chưa ghép ca" — đúng hành vi mới, nhưng che mất thứ những bài đó muốn đo.
  assert.equal((await server.request(`/api/admin/classes/${caMoi.id}`, quanTri, {
    method: "PATCH", body: JSON.stringify({ active: false }),
  })).status, 200);
});

test("hạn mức CLB đếm theo ĐÚNG ĐỢT, không chặn oan em đã học học kỳ trước", async () => {
  // Đo được trước khi vá: em có đơn hoc_xong ở đợt ĐÃ ĐÓNG bị loại khỏi lần nhập,
  // trong khi cổng phụ huynh cùng lúc vẫn cho em ấy đăng ký bình thường. Trạng thái
  // hoc_xong nằm trong ACTIVE_REGISTRATION_STATUSES vĩnh viễn, cố ý, để giữ chỗ.
  const xem = (await (await goiNhap("preview", { files: [fileForm(["NSHM260622", "Mỹ thuật sáng tạo"])] })).json()).preview;
  assert.notEqual(xem.rows[0].ketCuc, "vuotHanMuc", `không được chặn oan: ${xem.rows[0].lyDo}`);
});

test("nhập ở trạng thái KHÔNG giữ chỗ thì không hạ ghi danh sẵn", async () => {
  // Đo được trước khi vá: chọn "Chờ thanh toán" mà vẫn hạ enrolled_base, sĩ số tụt
  // xuống thật và mở chỗ cho 4.445 học sinh khác giành.
  const xem = (await (await goiNhap("preview", {
    files: [fileForm(["NSHM260311", "Mỹ thuật sáng tạo"])], status: "payment",
  })).json()).preview;
  assert.equal(xem.giuCho, false, "Chờ thanh toán không giữ chỗ");
  const ca = xem.caAnhHuong[0];
  assert.equal(ca.enrolledBaseDeXuat, ca.enrolledBaseHienTai, "không được hạ ghi danh sẵn");
  assert.equal(ca.siSoSauNeuHaBase, ca.siSoTruoc, "sĩ số phải không đổi, vì đơn này chưa giữ chỗ");
});

test("máy chủ TỪ CHỐI hạ ghi danh sẵn khi trạng thái không giữ chỗ, dù giao diện có gửi lên", async () => {
  const truoc = await caPainting();
  const ghi = await goiNhap("commit", {
    files: [fileForm(["NSHM260311", "Mỹ thuật sáng tạo"])],
    status: "payment", feePaid: false, haGhiDanhSan: true,
    confirmation: "NHAP_DANG_KY_HANG_LOAT",
  });
  const than = await ghi.text();
  assert.equal(ghi.status, 200, than);
  assert.equal(JSON.parse(than).result.haGhiDanhSan, false, "máy chủ phải tự tắt việc hạ");
  const sau = await caPainting();
  assert.equal(sau.enrolledBase, truoc.enrolledBase, "ghi danh sẵn phải giữ nguyên");
});

test("nhập lại sau khi HUỶ đơn KHÔNG hạ ghi danh sẵn lần thứ hai", async () => {
  // Đây là thao tác sửa sai bình thường nhất của giáo vụ: nhập nhầm, huỷ lô, nhập
  // lại. Đo được trước khi vá: ca có 100 em thật, hệ thống báo 60/100 và mở 40 chỗ
  // không có thật. Huỷ đơn không đưa em ấy trở lại nhóm "ghi danh ngoài hệ thống".
  const body = {
    files: [fileForm(["NSHM260411", "Mỹ thuật sáng tạo"])],
    mapping: { "my thuat sang tao": "painting" },
    confirmation: "NHAP_DANG_KY_HANG_LOAT",
  };
  const truoc = await caPainting();

  const lan1 = await goiNhap("commit", body);
  assert.equal(lan1.status, 200, await lan1.text());
  const sauLan1 = await caPainting();
  assert.equal(sauLan1.enrolledBase, truoc.enrolledBase - 1, "lần đầu thì hạ đúng một");

  const donMoi = (await (await server.request("/api/registrations", quanTri)).json())
    .registrations.find((row) => row.studentId === "hs06" && row.classId === "painting" && row.status === "dang_hoc");
  assert.ok(donMoi, "phải tìm được đơn vừa nhập");
  assert.equal((await doiTrangThai(donMoi.id, "cancelled")).status, 200);

  const lan2 = await goiNhap("commit", body);
  assert.equal(lan2.status, 200, await lan2.text());
  const sauLan2 = await caPainting();
  assert.equal(sauLan2.enrolledBase, sauLan1.enrolledBase,
    "nhập lại KHÔNG được hạ tiếp: em này đã được trừ khỏi ghi danh sẵn một lần rồi");
});

test("màn xem trước nói ra số đơn KHÔNG gắn được phụ huynh", async () => {
  // Để trống parent_user_id thì không màn nào vỡ, nhưng gia đình không thấy đơn của
  // con trong cổng. Vài trăm nhà im lặng không biết gì là hậu quả nặng nhất.
  const xem = (await (await goiNhap("preview", {
    files: [fileForm(["NSHM260344", "Mỹ thuật sáng tạo"])],
  })).json()).preview;
  assert.equal(xem.dem.xepDuoc, 1);
  assert.equal(xem.soDonKhongCoPhuHuynh, 1, "phải đếm và nói ra, không im lặng");
});

test("bản xem trước lệch với lúc ghi thì DỪNG lại, không ghi một số đơn khác", async () => {
  // Đo được trước khi vá: xem trước 40 dòng, có người tắt một ca giữa chừng, ghi
  // xong chỉ còn 20 mà không báo một chữ nào.
  const ghi = await goiNhap("commit", {
    files: [fileForm(["NSHM260311", "Piano nhập môn"])],
    soDongXepDuoc: 7,
    confirmation: "NHAP_DANG_KY_HANG_LOAT",
  });
  assert.equal(ghi.status, 409);
  const loi = (await ghi.json()).error;
  assert.equal(loi.code, "IMPORT_DA_DOI");
  assert.match(loi.message, /khi đó 7 dòng xếp được, bây giờ là 1/);
});

test("CLB đã tắt thì không nhập được, giống hệt cổng phụ huynh", async () => {
  assert.equal((await server.request("/api/admin/clubs/debate", quanTri, {
    method: "PATCH", body: JSON.stringify({ active: false }),
  })).status, 200);
  const xem = (await (await goiNhap("preview", { files: [fileForm(["NSHM260311", "English Debate"])] })).json()).preview;
  assert.equal(xem.dem.chuaGhepCa, 1, "CLB đã tắt thì không còn ca nào để ghép");
  assert.equal((await server.request("/api/admin/clubs/debate", quanTri, {
    method: "PATCH", body: JSON.stringify({ active: true }),
  })).status, 200);
});

test("chọn bỏ qua một ô thì lựa chọn đó DÍNH, máy không đoán lại", async () => {
  // Người vận hành cố ý loại một ô chọn ra khỏi lần nhập. Trước đây máy cứ đoán lại
  // và ô tự nhảy về giá trị cũ, không một dòng chữ giải thích.
  const xem = (await (await goiNhap("preview", {
    files: [fileForm(["NSHM260311", "Mỹ thuật sáng tạo"])],
    mapping: { "my thuat sang tao": "" },
  })).json()).preview;
  assert.equal(xem.oChon[0].classId, null, "lựa chọn bỏ qua phải được giữ");
  assert.equal(xem.dem.chuaGhepCa, 1);
});

test("sửa ca học vẫn lưu được khi lớp đang quá tải, miễn là không hạ sức chứa thêm", async () => {
  // Nhập vượt sức chứa từng khoá cứng ca học: đổi tên giáo viên cũng 409. Luật đúng
  // là "không được HẠ sức chứa xuống dưới số chỗ đang dùng", chứ không phải "không
  // được lưu khi đang quá tải" — người ta có thể đang lưu để sửa chính chỗ đó.
  const ca = await caPainting();
  const doiTen = await server.request(`/api/admin/classes/${ca.id}`, quanTri, {
    method: "PATCH", body: JSON.stringify({ teacher: "Cô Minh Trang (đã đổi)" }),
  });
  assert.equal(doiTen.status, 200, `đổi tên giáo viên phải lưu được: ${await doiTen.text()}`);

  const haThem = await server.request(`/api/admin/classes/${ca.id}`, quanTri, {
    method: "PATCH", body: JSON.stringify({ capacity: 1 }),
  });
  assert.equal(haThem.status, 409, "nhưng hạ sức chứa xuống sâu hơn thì vẫn phải chặn");
  assert.equal((await haThem.json()).error.code, "CAPACITY_BELOW_ENROLLED");
});

test("mọi kết cục máy chủ sinh ra đều có nhãn tiếng Việt trên màn hình", async () => {
  // Thiếu nhãn thì bảng hiện thẳng mã máy ("trungGioTrongFile") — người vận hành
  // đọc không ra, mà đó lại đúng là lúc họ cần hiểu vì sao một em không được xếp.
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const srv = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const bang = app.slice(app.indexOf("const KET_CUC_XEP_LOP"), app.indexOf("function renderNhapDangKy"));
  const coNhan = new Set([...bang.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]));
  const maySinh = new Set([...srv.matchAll(/ghi\("(\w+)"/g)].map((m) => m[1]));
  assert.ok(maySinh.size >= 10, `không đọc được danh sách kết cục: ${[...maySinh]}`);
  const thieu = [...maySinh].filter((khoa) => !coNhan.has(khoa));
  assert.deepEqual(thieu, [], `thiếu nhãn tiếng Việt cho: ${thieu.join(", ")}`);
});

test("bấm Ghi HAI LẦN cùng lúc không tạo đơn trùng", async () => {
  // Lỗi nặng nhất rà soát tìm ra, đo trên MySQL thật: hai lượt commit song song đều
  // đọc "em này chưa có đơn" rồi cùng chèn — mỗi em HAI đơn, sĩ số vọt 22/20. Mạng
  // chậm là người dùng bấm lại, nên đây không phải tình huống hiếm.
  //
  // Nay cả lượt ghi đi qua cùng một khoá với đồng bộ danh bạ, và phân tích lại nằm
  // TRONG khoá đó, nên lượt thứ hai nhìn thấy đơn lượt đầu vừa tạo.
  const body = {
    files: [fileForm(["NSHM260411", "Nhảy hiện đại"])],
    mapping: { "nhay hien dai": "dance" },
    confirmation: "NHAP_DANG_KY_HANG_LOAT",
  };
  const [a, b] = await Promise.all([goiNhap("commit", body), goiNhap("commit", body)]);
  const ja = await a.json();
  const jb = await b.json();

  const daTao = [ja, jb].filter((item) => item.result).reduce((tong, item) => tong + item.result.daTao, 0);
  assert.equal(daTao, 1, `chỉ được tạo đúng một đơn, đang tạo ${daTao}`);

  const cuaEm = (await (await server.request("/api/registrations", quanTri)).json())
    .registrations.filter((row) => row.studentId === "hs06" && row.classId === "dance");
  assert.equal(cuaEm.length, 1, `em này có ${cuaEm.length} đơn cho cùng một ca`);
});
