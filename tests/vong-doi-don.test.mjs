// Vòng đời đơn đăng ký theo quy trình nhà trường:
//   ĐĂNG KÝ → XẾP CHỜ → CHỜ THANH TOÁN → ĐÃ ĐÓNG PHÍ → ĐANG HỌC → HỌC XONG
//   Ngoại lệ: LÙI KHAI GIẢNG · KHÔNG KHAI GIẢNG · LỚP HỦY · HOÀN PHÍ
//
// Mã lưu trong cơ sở dữ liệu giữ nguyên, chỉ nhãn là mới — xem lý do ở đầu
// registration-status.mjs. Tệp này khóa hai thứ dễ hỏng nhất:
//
// 1. Danh sách trạng thái GIỮ CHỖ. Có mười một chỗ trong mã đếm sĩ số lớp; quên
//    ĐANG HỌC trong đó thì đúng ngày giáo vụ chuyển hàng loạt ĐÃ ĐÓNG PHÍ sang
//    ĐANG HỌC, mọi lớp đồng loạt tụt sĩ số và hệ thống bán lại chỗ đã có chủ.
// 2. Bảng nhãn ở trình duyệt phải khớp bảng nhãn ở máy chủ. app.js nạp bằng thẻ
//    script thường nên không import được, phải chép tay — và chép tay thì lệch.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { startTestServer } from "./helpers/test-server.mjs";
import {
  ACTIVE_REGISTRATION_STATUSES, ASSIGNABLE_STATUSES, EXCEPTION_STATUSES, LIFECYCLE_STATUSES,
  SEAT_HOLDING_STATUSES, STATUS, STATUS_LABELS, holdsSeat, statusLabel,
} from "../registration-status.mjs";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const layMang = (ten) => {
  const khop = app.match(new RegExp(`const ${ten} = \\[([^\\]]*)\\]`));
  assert.ok(khop, `app.js thiếu hằng ${ten}`);
  return [...khop[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
};

let server;
let adminCookie;
let don;

before(async () => {
  server = await startTestServer({ prefix: "nshm-vongdoi-" });
  adminCookie = await server.loginCookie("admin@nshm.edu.vn", "Admin@123");
  don = (await (await server.request("/api/registrations", adminCookie)).json()).registrations[0];
});

after(async () => server.stop());

test("sáu bước vòng đời đúng thứ tự nhà trường đặt ra", () => {
  assert.deepEqual(LIFECYCLE_STATUSES.map(statusLabel),
    ["Đăng ký", "Xếp chờ", "Chờ thanh toán", "Đã đóng phí", "Đang học", "Học xong"]);
  assert.deepEqual(EXCEPTION_STATUSES.map(statusLabel),
    ["Lùi khai giảng", "Không khai giảng", "Lớp hủy", "Hoàn phí"]);
});

test("ĐANG HỌC, HỌC XONG và LÙI KHAI GIẢNG đều GIỮ CHỖ trong lớp", () => {
  // Đây là khẳng định quan trọng nhất của cả tệp. Học sinh đang ngồi trong phòng
  // thì chỗ đó có chủ; lớp vừa học xong mà bỏ ra khỏi bộ đếm là mở lại cửa cho đơn
  // mới vào một lớp đã kết thúc; lùi khai giảng thì suất vẫn của em ấy.
  for (const status of [STATUS.dangHoc, STATUS.hocXong, STATUS.luiKhaiGiang]) {
    assert.ok(holdsSeat(status), `${statusLabel(status)} phải được tính vào sĩ số`);
  }
});

test("XẾP CHỜ và ba nhánh nhả chỗ thì KHÔNG tính sĩ số", () => {
  // Xếp chờ chỉ sinh ra KHI lớp đã đầy; tính nó vào là tự đẩy sĩ số vượt trần.
  for (const status of [STATUS.xepCho, STATUS.khongKhaiGiang, STATUS.lopHuy, STATUS.hoanPhi]) {
    assert.ok(!holdsSeat(status), `${statusLabel(status)} không được tính vào sĩ số`);
  }
});

test("CHƯA ĐÓNG PHÍ thì KHÔNG giữ chỗ", () => {
  // Quyết định của nhà trường: nhiều gia đình đăng ký rồi không đóng tiền, mà chỗ
  // vẫn bị treo cho họ. Chỗ chỉ có chủ từ khi ĐÃ ĐÓNG PHÍ trở đi.
  for (const status of [STATUS.dangKy, STATUS.choThanhToan, STATUS.xepCho]) {
    assert.ok(!holdsSeat(status), `${statusLabel(status)} không được giữ chỗ`);
  }
  assert.ok(holdsSeat(STATUS.daDongPhi));
});

test("nhưng đơn CHƯA ĐÓNG PHÍ vẫn là đơn CÒN HIỆU LỰC của học sinh", () => {
  // Hai danh sách khác nhau. Gộp lại là em có đơn Piano chưa đóng phí sẽ đăng ký
  // lại đúng lớp Piano đó lần thứ hai, và đăng ký được lớp trùng khung giờ — đã
  // dựng máy chủ thật và đo: phí phải thu của một cháu nhảy 1,9 lên 5,0 triệu.
  for (const status of [STATUS.dangKy, STATUS.xepCho, STATUS.choThanhToan, STATUS.daDongPhi]) {
    assert.ok(ACTIVE_REGISTRATION_STATUSES.includes(status), `${statusLabel(status)} phải là đơn còn hiệu lực`);
  }
  // Ba nhánh nhả chỗ thì KHÔNG, để em bị huỷ lớp còn đăng ký lại được.
  for (const status of [STATUS.lopHuy, STATUS.hoanPhi, STATUS.khongKhaiGiang]) {
    assert.ok(!ACTIVE_REGISTRATION_STATUSES.includes(status), `${statusLabel(status)} không được coi là đơn còn hiệu lực`);
  }
});

test("không còn chỗ nào gõ cứng bộ ba trạng thái cũ", () => {
  // Mười một chỗ từng lặp lại chuỗi 'submitted','payment','confirmed'; chỉ hai chỗ
  // đọc từ hằng. Sửa hằng mà sót một chuỗi là hai công thức đếm chỗ lệch nhau.
  // Khai báo chính hằng SEAT_HOLDING_STATUSES thì được, nên chỉ bắt bộ BA đóng lại.
  const goCung = app.match(/\["submitted", "payment", "confirmed"\]/);
  assert.equal(goCung?.[0] ?? null, null, "app.js vẫn còn gõ cứng bộ trạng thái cũ");
});

test("bảng nhãn ở trình duyệt khớp nguyên văn bảng ở máy chủ", () => {
  for (const [status, [nhan, mau]] of Object.entries(STATUS_LABELS)) {
    assert.match(app, new RegExp(`${status}: \\["${nhan}", "${mau}"\\]`),
      `app.js thiếu hoặc lệch nhãn của ${status}`);
  }
  assert.deepEqual(layMang("SEAT_HOLDING_STATUSES"), SEAT_HOLDING_STATUSES);
  assert.deepEqual(layMang("LIFECYCLE_STATUSES"), LIFECYCLE_STATUSES);
  assert.deepEqual(layMang("EXCEPTION_STATUSES"), EXCEPTION_STATUSES);
});

test("trạng thái lạ không làm trắng trang", () => {
  // Ba chỗ trong app.js từng rã mảng thẳng từ statusMap; gặp trạng thái chưa khai
  // là ném TypeError giữa vòng map và cả trang trắng bóc, không thông báo gì.
  assert.equal(app.match(/const \[label, color\] = statusMap\[/), null,
    "không được rã mảng thẳng từ statusMap, phải đi qua statusBadge");
  const khop = app.match(/const statusBadge = [^\n]+/);
  assert.ok(khop, "thiếu hàm statusBadge");
  assert.match(khop[0], /\|\| \[String\(status \|\| "—"\), "blue"\]/);
});

test("chi tiết đơn trả về học sinh, phụ huynh và lịch sử", async () => {
  const response = await server.request(`/api/admin/registrations/${encodeURIComponent(don.id)}`, adminCookie);
  assert.equal(response.status, 200);
  const { detail } = await response.json();
  assert.equal(detail.registration.id, don.id);
  assert.match(detail.student.code, /^NSHM\d+$/);
  assert.ok(detail.student.name && detail.student.dateOfBirth);
  assert.ok(Array.isArray(detail.parents));
  assert.ok(Array.isArray(detail.history));
});

test("đơn không tồn tại trả 404 chứ không phải 500", async () => {
  const response = await server.request("/api/admin/registrations/DK-khong-co-that", adminCookie);
  assert.equal(response.status, 404);
});

test("đổi trạng thái ghi vào lịch sử kèm trạng thái trước và sau", async () => {
  const doi = await server.request(`/api/admin/registrations/${encodeURIComponent(don.id)}/status`, adminCookie, {
    method: "PATCH", body: JSON.stringify({ status: STATUS.dangHoc }),
  });
  assert.equal(doi.status, 200);
  assert.equal((await doi.json()).status, STATUS.dangHoc);

  const { detail } = await (await server.request(`/api/admin/registrations/${encodeURIComponent(don.id)}`, adminCookie)).json();
  assert.equal(detail.registration.status, STATUS.dangHoc);
  const moiNhat = detail.history[0];
  assert.equal(moiNhat.action, "CHANGE_REGISTRATION_STATUS");
  assert.equal(moiNhat.after.status, STATUS.dangHoc);
  assert.equal(moiNhat.before.status, don.status);
  assert.ok(moiNhat.actorName, "lịch sử phải nói ai đã đổi");
});

test("đổi sang chính trạng thái đang có thì không ghi thêm dòng lịch sử", async () => {
  const truoc = (await (await server.request(`/api/admin/registrations/${encodeURIComponent(don.id)}`, adminCookie)).json()).detail.history.length;
  const doi = await server.request(`/api/admin/registrations/${encodeURIComponent(don.id)}/status`, adminCookie, {
    method: "PATCH", body: JSON.stringify({ status: STATUS.dangHoc }),
  });
  assert.equal((await doi.json()).changed, false);
  const sau = (await (await server.request(`/api/admin/registrations/${encodeURIComponent(don.id)}`, adminCookie)).json()).detail.history.length;
  assert.equal(sau, truoc, "bấm Lưu mà không đổi gì thì không được làm bẩn lịch sử");
});

test("chỉ nhận trạng thái nằm trong vòng đời", async () => {
  for (const xau of ["dang_hoc_them", "draft", "conflict", ""]) {
    const response = await server.request(`/api/admin/registrations/${encodeURIComponent(don.id)}/status`, adminCookie, {
      method: "PATCH", body: JSON.stringify({ status: xau }),
    });
    assert.equal(response.status, 422, `"${xau}" phải bị từ chối`);
    assert.equal((await response.json()).error.code, "STATUS_INVALID");
  }
  assert.equal(ASSIGNABLE_STATUSES.length, 10);
});

test("giáo vụ không xem và không đổi được chi tiết đơn", async () => {
  // Trang Đơn đăng ký chắn bằng quyền duyet-don mà giáo vụ không có; hai tuyến này
  // phải chắn cùng một quyền, nếu không giao diện chặn còn API thì mở.
  const giaoVu = await server.loginCookie("giaovu@nshm.edu.vn", "Admin@123");
  const xem = await server.request(`/api/admin/registrations/${encodeURIComponent(don.id)}`, giaoVu);
  assert.equal(xem.status, 403);
  const doi = await server.request(`/api/admin/registrations/${encodeURIComponent(don.id)}/status`, giaoVu, {
    method: "PATCH", body: JSON.stringify({ status: STATUS.hocXong }),
  });
  assert.equal(doi.status, 403);
});

test("lịch sử chỉ chứa sự kiện của chính đơn đó", async () => {
  // audit_logs còn chứa nhật ký tài khoản nhà trường và email bị từ chối đăng
  // nhập; lọc lỏng là lộ hết qua một tuyến đọc.
  const { detail } = await (await server.request(`/api/admin/registrations/${encodeURIComponent(don.id)}`, adminCookie)).json();
  const choPhep = new Set(["CREATE_REGISTRATION", "CONFIRM_PAYMENT", "CHANGE_REGISTRATION_STATUS"]);
  for (const entry of detail.history) {
    assert.ok(choPhep.has(entry.action), `lọt sự kiện lạ vào lịch sử đơn: ${entry.action}`);
  }
});

test("sĩ số lớp lên xuống đúng theo từng trạng thái, không chỉ theo lý thuyết", async () => {
  // Bài quan trọng nhất của tệp: ba bài ở trên chỉ đọc hằng số, bài này chạy thật
  // qua cả tuyến API rồi hỏi lại sĩ số. Đây là lưới an toàn cho lần đổi trạng thái
  // tiếp theo — quên một trạng thái mới trong danh sách giữ chỗ là lớp đầy tự mở
  // lại cửa và nhà trường bán chỗ đã có chủ.
  const mau = (await (await server.request("/api/registrations", adminCookie)).json())
    .registrations.find((row) => row.id !== don.id && row.classId);
  assert.ok(mau, "cần một đơn minh họa khác để đo sĩ số");

  // Nới sĩ số tối đa trước: từ khi chỗ chỉ tính lúc đóng phí, chuyển một đơn TRỞ
  // LẠI trạng thái giữ chỗ sẽ bị chốt chặn từ chối nếu lớp đã đầy. Bài này đo cách
  // ĐẾM chỗ, không đo chốt chặn — chốt chặn có bài riêng ngay dưới.
  const noiSiSo = await server.request(`/api/admin/classes/${encodeURIComponent(mau.classId)}`, adminCookie, {
    method: "PATCH", body: JSON.stringify({ capacity: 99 }),
  });
  assert.equal(noiSiSo.status, 200, "cần nới sĩ số để đo được cả chiều tăng");

  const siSo = async () => {
    const catalog = await (await server.request("/api/admin/catalog", adminCookie)).json();
    return catalog.classes.find((item) => item.id === mau.classId).activeRegistrations;
  };
  const dat = async (status) => {
    const response = await server.request(`/api/admin/registrations/${encodeURIComponent(mau.id)}/status`, adminCookie, {
      method: "PATCH", body: JSON.stringify({ status }),
    });
    assert.equal(response.status, 200, `đặt ${status} thất bại`);
    return siSo();
  };

  const giuCho = await dat(STATUS.daDongPhi);
  for (const status of [STATUS.dangHoc, STATUS.hocXong, STATUS.luiKhaiGiang]) {
    assert.equal(await dat(status), giuCho, `${statusLabel(status)} phải giữ nguyên chỗ trong lớp`);
  }
  // Chưa đóng phí và ba nhánh nhả chỗ đều KHÔNG chiếm chỗ nữa.
  for (const status of [STATUS.choThanhToan, STATUS.dangKy, STATUS.xepCho, STATUS.lopHuy, STATUS.hoanPhi, STATUS.khongKhaiGiang]) {
    assert.equal(await dat(status), giuCho - 1, `${statusLabel(status)} phải nhả chỗ ra cho người khác`);
  }
});

test("lớp đã đủ chỗ thì đơn đã đóng phí chuyển sang XẾP CHỜ, không nhận vượt trần", async () => {
  // Từ khi chỗ chỉ tính lúc đóng phí, XÁC NHẬN PHÍ mới là thời điểm giành chỗ thật
  // sự — mà trước đây hàm đó không hề đếm sĩ số. Đã dựng máy chủ thật và đo: lớp 12
  // chỗ chốt được 13 đơn, không một cảnh báo nào.
  //
  // Nhà trường chọn: tiền đã cầm rồi thì không chặn cứng người ta được, nhưng cũng
  // không nhận vượt trần lớp — nên đơn vẫn ghi nhận đã thu tiền và sang xếp chờ.
  const lop = "piano";
  const boSiSo = async (capacity) => {
    const response = await server.request(`/api/admin/classes/${lop}`, adminCookie, {
      method: "PATCH", body: JSON.stringify({ capacity }),
    });
    assert.equal(response.status, 200, `đặt sĩ số ${capacity} thất bại`);
  };
  const catalogLop = async () => (await (await server.request("/api/admin/catalog", adminCookie)).json())
    .classes.find((item) => item.id === lop);

  const donCuaLop = async () => (await (await server.request("/api/registrations", adminCookie)).json())
    .registrations.filter((row) => row.classId === lop);
  const dat = async (registrationId, status) => server.request(
    `/api/admin/registrations/${encodeURIComponent(registrationId)}/status`, adminCookie,
    { method: "PATCH", body: JSON.stringify({ status }) });

  // Dữ liệu mẫu có hai đơn cho lớp này. Đưa cả hai về CHỜ THANH TOÁN để bắt đầu từ
  // một trạng thái đã biết, thay vì phụ thuộc vào thứ tự chạy của các bài trước.
  const donLop = await donCuaLop();
  assert.ok(donLop.length >= 2, "dữ liệu mẫu phải có ít nhất hai đơn cho lớp này");
  for (const item of donLop) await dat(item.id, STATUS.choThanhToan);

  // Đặt sĩ số vừa đúng để còn CHÍNH XÁC MỘT chỗ trống. Không gõ cứng số 1: lớp có
  // enrolled_base (ghi danh sẵn ngoài hệ thống) nên hạ xuống dưới đó là bị chặn.
  const banDau = await catalogLop();
  await boSiSo(banDau.enrolledBase + banDau.activeRegistrations + 1);
  const truoc = await catalogLop();
  const [don1, don2] = donLop;

  const xacNhan = async (registrationId) => {
    const response = await server.request(`/api/admin/registrations/${encodeURIComponent(registrationId)}/confirm-payment`,
      adminCookie, { method: "PATCH", body: "{}" });
    assert.equal(response.status, 200);
    return response.json();
  };

  // Đơn đầu tiên lấp đúng chỗ trống duy nhất.
  const ketQua1 = await xacNhan(don1.id);
  assert.equal(ketQua1.status, STATUS.daDongPhi, "chỗ còn trống thì đơn vào thẳng đã đóng phí");
  assert.equal(ketQua1.feePaid, true);
  assert.equal((await catalogLop()).activeRegistrations, truoc.activeRegistrations + 1);

  // Đơn thứ hai: lớp đã đầy. Vẫn ghi nhận đã thu tiền, nhưng sang xếp chờ.
  const ketQua2 = await xacNhan(don2.id);
  assert.equal(ketQua2.status, STATUS.xepCho, "lớp đầy thì đơn đã đóng phí phải sang xếp chờ");
  assert.equal(ketQua2.feePaid, true, "tiền đã thu KHÔNG được biến mất khi đơn sang xếp chờ");
  assert.equal(ketQua2.lopDaDay, true);

  // Và sĩ số KHÔNG vượt trần.
  const sau = await catalogLop();
  assert.ok(sau.activeRegistrations + sau.enrolledBase <= sau.capacity,
    `sĩ số vượt trần: ${sau.enrolledBase}+${sau.activeRegistrations} > ${sau.capacity}`);
  assert.ok(sau.pendingRegistrations >= 1, "đơn đang chờ đóng phí phải đếm được riêng");
});

test("cửa sau đổi trạng thái tay cũng không vượt được trần sĩ số", async () => {
  // Vá xác nhận phí mà quên chỗ này là vá nửa vời: giáo vụ đổi tay trong popup chi
  // tiết là đi thẳng vào trạng thái giữ chỗ.
  const lop = "piano";
  const dangXepCho = (await (await server.request("/api/registrations", adminCookie)).json())
    .registrations.find((row) => row.classId === lop && row.status === STATUS.xepCho);
  assert.ok(dangXepCho, "cần một đơn đang xếp chờ ở lớp đã đầy");

  const response = await server.request(`/api/admin/registrations/${encodeURIComponent(dangXepCho.id)}/status`, adminCookie, {
    method: "PATCH", body: JSON.stringify({ status: STATUS.daDongPhi }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "CLASS_FULL");
});

test("đơn chưa đóng phí đếm riêng, KHÔNG cộng vào sĩ số phụ huynh nhìn thấy", async () => {
  // Hai con số phải nhúc nhích NGƯỢC chiều nhau khi một đơn nhả chỗ. Chỉ khoá con
  // số sĩ số là chưa đủ: màn hình phụ huynh chỉ hiện "còn 5 chỗ" mà giấu đi 30 đơn
  // đang chờ đóng phí thì vẫn là nói thật một nửa, và gia đình thứ 31 đóng phí xong
  // mới biết mình bị đẩy sang xếp chờ.
  const lop = "piano";
  const xemLop = async () => (await (await server.request("/api/clubs", adminCookie)).json())
    .clubs.find((item) => item.id === lop);
  const donGiuCho = (await (await server.request("/api/registrations", adminCookie)).json())
    .registrations.find((row) => row.classId === lop && row.status === STATUS.daDongPhi);
  assert.ok(donGiuCho, "cần một đơn đang giữ chỗ ở lớp này");

  const truoc = await xemLop();
  const doi = await server.request(`/api/admin/registrations/${encodeURIComponent(donGiuCho.id)}/status`,
    adminCookie, { method: "PATCH", body: JSON.stringify({ status: STATUS.choThanhToan }) });
  assert.equal(doi.status, 200);
  const sau = await xemLop();

  assert.equal(sau.enrolled, truoc.enrolled - 1, "đơn quay về chờ đóng phí thì nhả chỗ, sĩ số phải giảm");
  assert.equal(sau.pending, truoc.pending + 1, "và phải hiện ra ở con số đơn đang chờ đóng phí");
});

test("popup chi tiết nói đúng đơn đã thu tiền hay chưa", async () => {
  // Bảng ngoài đọc feePaid từ danh sách đơn, popup đọc từ một câu truy vấn KHÁC.
  // Bản SQLite thiếu cột ở câu thứ hai nên popup ghi "Chưa" cho đúng cái đơn mà
  // dòng bảng ngay trên đó ghi "đã thu phí" — đã mở trình duyệt và nhìn thấy.
  const don = (await (await server.request("/api/registrations", adminCookie)).json())
    .registrations.find((row) => !row.feePaid);
  assert.ok(don, "cần một đơn chưa từng thu tiền");
  await server.request(`/api/admin/registrations/${encodeURIComponent(don.id)}/status`, adminCookie,
    { method: "PATCH", body: JSON.stringify({ status: STATUS.choThanhToan }) });

  const chiTiet = async () => (await (await server.request(
    `/api/admin/registrations/${encodeURIComponent(don.id)}`, adminCookie)).json()).detail.registration;
  assert.ok(!(await chiTiet()).feePaid, "chưa thu tiền thì popup phải nói là chưa");

  const xacNhan = await server.request(`/api/admin/registrations/${encodeURIComponent(don.id)}/confirm-payment`,
    adminCookie, { method: "PATCH", body: "{}" });
  assert.equal(xacNhan.status, 200);
  assert.ok((await chiTiet()).feePaid, "đã thu tiền thì popup phải nói là rồi");
});
