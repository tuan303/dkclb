/**
 * Vòng đời một đơn đăng ký CLB, theo đúng quy trình nhà trường đặt ra:
 *
 *   ĐĂNG KÝ → XẾP CHỜ → CHỜ THANH TOÁN → ĐÃ ĐÓNG PHÍ → ĐANG HỌC → HỌC XONG
 *   Ngoại lệ: LÙI KHAI GIẢNG · KHÔNG KHAI GIẢNG · LỚP HỦY · HOÀN PHÍ
 *
 * MÃ LƯU TRONG CƠ SỞ DỮ LIỆU GIỮ NGUYÊN, chỉ nhãn hiển thị là mới. Lý do không
 * đổi mã: có mười một chỗ trong mã nguồn đếm sĩ số lớp bằng cách so khớp chuỗi
 * trạng thái, và chỉ hai chỗ đọc từ hằng số. Nếu đổi mã trong cơ sở dữ liệu thì
 * chỉ cần mã nguồn và dữ liệu lệch nhau trong vài giây triển khai — hoặc sót một
 * chuỗi trong một tệp — là mọi đơn đang giữ chỗ biến mất khỏi phép đếm: lớp đầy
 * 9/9 tụt xuống 7/9 rồi mở lại cửa cho phụ huynh đăng ký, mà không có thông báo
 * lỗi nào. Đang giữa đợt đăng ký mở với 4.445 học sinh, không có cách nào rút lại
 * lời đã hứa với người đăng ký thừa. Giữ nguyên mã thì cửa sổ lệch đó không tồn
 * tại: triển khai trước hay sau, lùi lúc nào, khôi phục bản sao lưu cũ ngày nào —
 * sĩ số vẫn đúng.
 *
 * Cái giá phải trả: ai mở thẳng bảng MySQL sẽ thấy `confirmed` chứ không phải
 * `da_dong_phi`. Đó là một khoản thuế đọc hiểu, đổi lấy việc không đụng vào dữ
 * liệu đang chạy.
 */

export const STATUS = {
  dangKy: "submitted",
  xepCho: "waitlist",
  choThanhToan: "payment",
  daDongPhi: "confirmed",
  dangHoc: "dang_hoc",
  hocXong: "hoc_xong",
  luiKhaiGiang: "lui_khai_giang",
  khongKhaiGiang: "khong_khai_giang",
  lopHuy: "cancelled",
  hoanPhi: "hoan_phi",
};

/** Thứ tự hiện trong ô chọn: sáu bước vòng đời trước, bốn ngoại lệ sau. */
export const LIFECYCLE_STATUSES = [
  STATUS.dangKy, STATUS.xepCho, STATUS.choThanhToan,
  STATUS.daDongPhi, STATUS.dangHoc, STATUS.hocXong,
];

export const EXCEPTION_STATUSES = [
  STATUS.luiKhaiGiang, STATUS.khongKhaiGiang, STATUS.lopHuy, STATUS.hoanPhi,
];

/**
 * Nhãn và màu huy hiệu. Màu chỉ được chọn trong năm lớp có sẵn ở styles.css
 * (green/gold/red/blue/purple); thêm tên khác là huy hiệu hiện trần không kiểu.
 */
export const STATUS_LABELS = {
  [STATUS.dangKy]: ["Đăng ký", "blue"],
  [STATUS.xepCho]: ["Xếp chờ", "purple"],
  [STATUS.choThanhToan]: ["Chờ thanh toán", "gold"],
  [STATUS.daDongPhi]: ["Đã đóng phí", "green"],
  [STATUS.dangHoc]: ["Đang học", "green"],
  [STATUS.hocXong]: ["Học xong", "blue"],
  [STATUS.luiKhaiGiang]: ["Lùi khai giảng", "gold"],
  [STATUS.khongKhaiGiang]: ["Không khai giảng", "red"],
  [STATUS.lopHuy]: ["Lớp hủy", "red"],
  [STATUS.hoanPhi]: ["Hoàn phí", "red"],
  // Hai nhãn cũ: không còn được cấp cho đơn mới, nhưng dữ liệu cũ và dữ liệu minh
  // họa vẫn còn mang chúng. Bỏ đi là giao diện vỡ khi gặp một đơn cũ.
  draft: ["Bản nháp", "blue"],
  conflict: ["Trùng lịch", "red"],
};

/**
 * MỘT: Trạng thái đang GIỮ MỘT CHỖ trong lớp — "chỗ này đã có chủ".
 *
 * Nhà trường quyết: chỗ chỉ có chủ khi phụ huynh ĐÃ ĐÓNG PHÍ. Lý do là thực tế,
 * nhiều gia đình đăng ký rồi không đóng tiền, mà chỗ vẫn bị treo cho họ.
 *
 * - ĐĂNG KÝ và CHỜ THANH TOÁN KHÔNG tính: đây chính là thay đổi nhà trường yêu cầu.
 * - XẾP CHỜ không tính: nó chỉ sinh ra KHI lớp đã đầy.
 * - HỌC XONG VẪN tính: sĩ số đếm theo lớp chứ không theo đợt, bỏ ra là lớp vừa
 *   kết thúc lập tức mở lại cửa nhận đơn mới. Cách gỡ chỗ đúng là đóng lớp.
 * - LÙI KHAI GIẢNG vẫn tính: học sinh đã trả tiền, giữ suất, chỉ dời ngày.
 * - KHÔNG KHAI GIẢNG / LỚP HỦY / HOÀN PHÍ không tính: chỗ mở lại cho người xếp chờ.
 */
export const SEAT_HOLDING_STATUSES = [
  STATUS.daDongPhi, STATUS.dangHoc, STATUS.hocXong, STATUS.luiKhaiGiang,
];

/**
 * HAI: Đơn CÒN HIỆU LỰC của một học sinh — "em này đã có đơn cho lớp đó".
 *
 * Đây là danh sách KHÁC HẲN danh sách trên, dù trước đây cả hai dùng chung một
 * hằng. Nó trả lời câu hỏi khác: không phải "chỗ đã có chủ chưa" mà "em này đã
 * đăng ký cái đó chưa". Dùng để chặn ba thứ:
 *   - đăng ký trùng lớp, hoặc trùng CLB ở một ca khác
 *   - đăng ký hai CLB trùng khung giờ
 *   - vượt giới hạn số CLB mỗi học sinh trong một đợt
 *
 * PHẢI RỘNG HƠN danh sách giữ chỗ, và đặc biệt phải chứa CHỜ THANH TOÁN. Đã dựng
 * máy chủ thật và đo: nếu dùng chung danh sách giữ chỗ đã thu hẹp, một em đang có
 * đơn Piano chưa đóng phí sẽ đăng ký lại ĐÚNG lớp Piano đó lần thứ hai, đăng ký
 * thêm được lớp trùng đúng khung giờ, và vượt được giới hạn số CLB — phí phải thu
 * của một cháu nhảy từ 1,9 triệu lên 5,0 triệu.
 *
 * XẾP CHỜ cũng nằm đây: em đang xếp chờ Piano thì không được đăng ký Piano lần nữa.
 * Ba nhánh nhả chỗ (KHÔNG KHAI GIẢNG, LỚP HỦY, HOÀN PHÍ) KHÔNG nằm đây, để em bị
 * huỷ lớp còn đăng ký lại được.
 */
export const ACTIVE_REGISTRATION_STATUSES = [
  STATUS.dangKy, STATUS.xepCho, STATUS.choThanhToan,
  STATUS.daDongPhi, STATUS.dangHoc, STATUS.hocXong, STATUS.luiKhaiGiang,
];

/** Dạng chuỗi cho câu SQL gõ thẳng: 'confirmed','dang_hoc',... */
export const SEAT_HOLDING_SQL = SEAT_HOLDING_STATUSES.map((status) => `'${status}'`).join(",");

/**
 * Đơn còn hiệu lực nhưng CHƯA giữ chỗ — tức là đang chờ đóng phí hoặc đang xếp chờ.
 * Đây là con số thứ hai mà mọi màn hình sĩ số cần: chỉ hiện "còn 17 chỗ" mà giấu
 * đi 40 đơn đang treo là nói thật một nửa.
 */
export const PENDING_SEAT_STATUSES = ACTIVE_REGISTRATION_STATUSES.filter((status) => !SEAT_HOLDING_STATUSES.includes(status));

export const PENDING_SEAT_SQL = PENDING_SEAT_STATUSES.map((status) => `'${status}'`).join(",");

export const holdsSeat = (status) => SEAT_HOLDING_STATUSES.includes(status);

export const isKnownStatus = (status) => Object.hasOwn(STATUS_LABELS, status);

/** Nhãn để hiện ra; trạng thái lạ thì trả về chính mã, không ném lỗi. */
export function statusLabel(status) {
  return STATUS_LABELS[status]?.[0] || String(status ?? "");
}

/**
 * Trạng thái giáo vụ được phép đặt tay trong màn hình chi tiết đơn. Hai nhãn cũ
 * (draft, conflict) cố tình không nằm đây: chúng chỉ còn để hiển thị dữ liệu cũ,
 * cấp mới là làm bẩn thêm dữ liệu bằng một mô hình đã bỏ.
 */
export const ASSIGNABLE_STATUSES = [...LIFECYCLE_STATUSES, ...EXCEPTION_STATUSES];
