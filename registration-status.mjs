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
 * Trạng thái đang GIỮ MỘT CHỖ trong lớp. Đây là danh sách nguy hiểm nhất trong
 * cả kho mã: nó quyết định lớp còn chỗ hay không, tức là quyết định mọi đơn mới
 * vào CHỜ THANH TOÁN hay bị đẩy sang XẾP CHỜ.
 *
 * - XẾP CHỜ không tính: nó chỉ sinh ra KHI lớp đã đầy, tính vào là tự đẩy sĩ số
 *   vượt trần.
 * - HỌC XONG VẪN tính: sĩ số đếm theo lớp chứ không theo đợt, nên bỏ nó ra là
 *   lớp vừa kết thúc lập tức mở lại cửa nhận đơn mới. Cách gỡ chỗ đúng là đóng
 *   lớp, không phải rút trạng thái khỏi bộ đếm.
 * - LÙI KHAI GIẢNG vẫn tính: học sinh giữ suất, chỉ dời ngày.
 * - KHÔNG KHAI GIẢNG / LỚP HỦY / HOÀN PHÍ không tính: chỗ phải mở lại cho người
 *   đang xếp chờ.
 */
export const SEAT_HOLDING_STATUSES = [
  STATUS.dangKy, STATUS.choThanhToan, STATUS.daDongPhi,
  STATUS.dangHoc, STATUS.hocXong, STATUS.luiKhaiGiang,
];

/** Dạng chuỗi cho câu SQL gõ thẳng: 'submitted','payment',... */
export const SEAT_HOLDING_SQL = SEAT_HOLDING_STATUSES.map((status) => `'${status}'`).join(",");

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
