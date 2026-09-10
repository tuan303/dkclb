/**
 * Trùng lịch: học sinh đăng ký hai CLB rơi vào cùng một thứ và giẫm lên nhau về giờ.
 *
 * Quy tắc này trước đây nằm ở BỐN chỗ với BỐN câu thông báo khác nhau — giỏ đăng ký
 * ở trình duyệt, kiểm tra trước khi gửi ở máy chủ, và hai lần kiểm lại lúc ghi trong
 * mỗi kho dữ liệu. Bốn bản sao của một quy tắc là bốn cơ hội để chúng lệch nhau: bản
 * MySQL còn so `toInt(day_of_week) === club.dayOfWeek`, tức là so số với thứ có thể
 * là chuỗi, nên chỉ cần một nguồn dữ liệu trả kiểu khác là lá chắn im lặng ngừng
 * hoạt động.
 *
 * "Trùng lịch" KHÔNG phải một trạng thái của đơn. Nó là kết quả kiểm tra tại thời
 * điểm đăng ký: hoặc chặn không cho thêm, hoặc không. Không có đơn nào nằm trong
 * trạng thái đó, và mã nguồn chưa bao giờ ghi nó xuống cơ sở dữ liệu.
 */

/**
 * Hai ca học giẫm giờ lên nhau. Giờ lưu dạng "HH:MM" 24 giờ có đệm số 0 nên so sánh
 * chuỗi là đúng thứ tự, không cần đổi sang số phút.
 *
 * Ép kiểu thứ về số vì mỗi nguồn trả một kiểu: MySQL trả TINYINT, SQLite trả số,
 * còn dữ liệu đi qua JSON thì thành chuỗi. Thiếu chỗ này là 2 !== "2" và cả lá chắn
 * lặng lẽ vô hiệu.
 */
export function intervalsOverlap(a, b) {
  const thu = (value) => (value === null || value === undefined || value === "" ? NaN : Number(value));
  const thuA = thu(a?.dayOfWeek);
  const thuB = thu(b?.dayOfWeek);
  if (!Number.isFinite(thuA) || !Number.isFinite(thuB) || thuA !== thuB) return false;
  const gio = (value) => String(value ?? "");
  if (!gio(a?.startTime) || !gio(a?.endTime) || !gio(b?.startTime) || !gio(b?.endTime)) return false;
  return gio(a.startTime) < gio(b.endTime) && gio(b.startTime) < gio(a.endTime);
}

/**
 * Câu báo cho phụ huynh. Nhà trường yêu cầu nói rõ ĐÃ ĐĂNG KÝ CLB NÀO và TRÙNG VÀO
 * KHOẢNG GIỜ NÀO — chỉ nói "trùng lịch" thì phụ huynh phải tự đi dò lại lịch của con.
 *
 * @param moi  CLB vừa chọn        { name, schedule }
 * @param cu   CLB đang vướng      { name, schedule }
 * @param daDangKy  true khi cái vướng là đơn ĐÃ GỬI, false khi nó mới nằm trong giỏ
 */
export function conflictMessage(moi, cu, { daDangKy = true } = {}) {
  const lich = String(cu?.schedule || moi?.schedule || "").trim();
  const khoangGio = lich ? ` vào ${lich}` : "";
  const tenMoi = String(moi?.name || "CLB vừa chọn");
  const tenCu = String(cu?.name || "một CLB khác");
  return daDangKy
    ? `Con đã đăng ký “${tenCu}”${khoangGio}. “${tenMoi}” trùng đúng khoảng giờ này, vui lòng chọn ca khác.`
    : `“${tenMoi}” trùng giờ với “${tenCu}”${khoangGio} đang có trong giỏ đăng ký.`;
}

/** Câu rút gọn cho thẻ CLB ngoài danh mục, phải ngắn để không vỡ thẻ. */
export function conflictBadge(cu) {
  const lich = String(cu?.schedule || "").trim();
  return lich ? `Trùng giờ với “${cu.name}” (${lich})` : `Trùng giờ với “${cu?.name || "CLB đã đăng ký"}”`;
}

/**
 * Câu dùng ở lần kiểm lại NGAY TRƯỚC KHI GHI, bên trong giao dịch. Ở đó chỉ còn mã
 * lớp chứ không có tên CLB kia, và người dùng gần như không bao giờ thấy câu này —
 * nó chỉ bật khi hai phụ huynh cùng gửi đơn trong đúng một khoảnh khắc.
 */
export const CONFLICT_AT_COMMIT = (tenMoi) =>
  `“${tenMoi}” trùng giờ với một CLB con đã đăng ký. Vui lòng tải lại trang và chọn ca khác.`;
