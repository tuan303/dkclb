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
  ASSIGNABLE_STATUSES, EXCEPTION_STATUSES, LIFECYCLE_STATUSES,
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

test("ba trạng thái cũ vẫn giữ nguyên tư cách chiếm chỗ", () => {
  // Mã trong cơ sở dữ liệu không đổi, nên sĩ số của 4.445 học sinh đang chạy phải
  // giữ nguyên tuyệt đối trước và sau lần thay nhãn này.
  for (const status of ["submitted", "payment", "confirmed"]) assert.ok(holdsSeat(status));
  assert.ok(!holdsSeat("waitlist"));
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
  for (const status of [STATUS.dangHoc, STATUS.hocXong, STATUS.luiKhaiGiang, STATUS.choThanhToan, STATUS.dangKy]) {
    assert.equal(await dat(status), giuCho, `${statusLabel(status)} phải giữ nguyên chỗ trong lớp`);
  }
  for (const status of [STATUS.xepCho, STATUS.lopHuy, STATUS.hoanPhi, STATUS.khongKhaiGiang]) {
    assert.equal(await dat(status), giuCho - 1, `${statusLabel(status)} phải nhả chỗ ra cho người khác`);
  }
});
