/**
 * Nhập danh bạ học sinh từ file Excel, thay cho việc gọi ra Google Sheets.
 *
 * Không viết lại đường ống: file Excel chỉ thay đúng bước LẤY DỮ LIỆU. Từ chỗ có
 * `rows: string[][]` trở đi, mọi thứ dùng chung y hệt đường Google — nhận diện cột,
 * kiểm tra dữ liệu, dựng ảnh chụp, gộp nhiều cấp học, lập kế hoạch ghi. Nhờ vậy mọi
 * lá chắn đã có (chặn co rút bất thường, không bao giờ xoá học sinh, ghi nhật ký
 * trong một giao dịch) áp dụng nguyên vẹn cho đường mới.
 *
 * Lý do bỏ Google Sheets: máy chủ của trường từng mất phân giải tên miền, không ra
 * được Internet, và cả việc đồng bộ danh bạ lẫn đăng nhập Microsoft cùng chết. File
 * Excel nằm trên máy người dùng thì không phụ thuộc đường mạng nào.
 */
import { analyzeDirectoryRows, buildDirectorySnapshot, detectColumnMapping } from "./sheets-directory.mjs";
import { mergeDirectorySnapshots } from "./directory-merge.mjs";

/**
 * HAI CHẾ ĐỘ, và đây là chỗ nguy hiểm nhất của cả tính năng.
 *
 * - BỔ SUNG: chỉ thêm và cập nhật. Không em nào bị đánh dấu nghỉ học, dù có vắng
 *   mặt trong file. Dùng cho tuyển ngang hàng tháng, file chỉ vài chục dòng.
 * - ĐỐI CHIẾU: coi những file vừa nạp là TOÀN BỘ danh sách trường. Em nào đang học
 *   mà không có trong đó sẽ bị đánh dấu nghỉ học. Chỉ dùng đầu năm, và phải nạp đủ
 *   cả ba cấp cùng lúc.
 *
 * Chọn nhầm ĐỐI CHIẾU cho một file tuyển ngang 30 dòng nghĩa là 4.415 em còn lại bị
 * đánh dấu nghỉ học. Vì vậy mặc định luôn là BỔ SUNG, và chế độ đối chiếu phải được
 * người dùng chọn có chủ ý rồi xác nhận thêm một lần nữa ở lớp HTTP.
 */
export const IMPORT_MODES = { boSung: "bo-sung", doiChieu: "doi-chieu" };

const MAX_FILES = 10;
const MAX_ROWS = 20_000;
const HEADER_SCAN_ROWS = 10;

function excelError(code, message, details) {
  const error = new Error(message);
  Object.assign(error, { status: 422, code, details, expose: true });
  return error;
}

const isBlankRow = (row) => !row.some((cell) => String(cell ?? "").trim());

/**
 * Tìm hàng tiêu đề thật. File danh bạ của trường có HAI hàng đầu: một hàng gộp nhóm
 * ("THÔNG TIN CHUNG", "THÔNG TIN LIÊN HỆ") nằm trên hàng tên cột thật. Bắt người
 * dùng tự khai số hàng là thêm một chỗ để gõ sai; dò lấy hàng khớp được nhiều
 * trường nhất thì tự đúng cho cả file có một hàng lẫn hai hàng tiêu đề.
 */
export function detectHeaderRow(rows) {
  let totNhat = null;
  const gioiHan = Math.min(rows.length, HEADER_SCAN_ROWS);
  for (let index = 0; index < gioiHan; index += 1) {
    if (isBlankRow(rows[index])) continue;
    const { mapping, missing } = detectColumnMapping(rows[index]);
    const soTruong = Object.keys(mapping).length;
    if (!soTruong) continue;
    if (!totNhat || missing.length < totNhat.missing.length
      || (missing.length === totNhat.missing.length && soTruong > Object.keys(totNhat.mapping).length)) {
      totNhat = { index, mapping, missing };
    }
  }
  return totNhat;
}

/** Một file thành một "nguồn" đúng hình dạng mà mergeDirectorySnapshots nhận. */
export function readExcelSource({ key, label, rows }) {
  const nen = { key, label };
  if (!Array.isArray(rows) || !rows.length) {
    return { ...nen, ok: false, error: "File rỗng hoặc không đọc được dòng nào." };
  }
  const tieuDe = detectHeaderRow(rows);
  if (!tieuDe) {
    return { ...nen, ok: false, error: "Không tìm thấy hàng tiêu đề. Kiểm tra lại xem có đúng sheet danh sách học sinh không." };
  }
  if (tieuDe.missing.length) {
    return { ...nen, ok: false, error: `Thiếu cột bắt buộc: ${tieuDe.missing.join(", ")}.` };
  }

  const duLieu = rows.slice(tieuDe.index + 1).filter((row) => !isBlankRow(row));
  // Số hàng theo cách người dùng đếm trong Excel: hàng đầu tiên là 1.
  const analysis = analyzeDirectoryRows(duLieu, tieuDe.mapping, tieuDe.index + 2);
  const snapshot = buildDirectorySnapshot(duLieu, tieuDe.mapping);
  return {
    ...nen, ok: true, snapshot, analysis,
    headerRow: tieuDe.index + 1,
    headers: rows[tieuDe.index].map((value) => String(value ?? "").trim()),
    mapping: Object.fromEntries(Object.entries(tieuDe.mapping).map(([field, item]) => [field, item.header])),
  };
}

/**
 * Gộp nhiều file thành một ảnh chụp duy nhất, y như đường Google gộp ba file Sheets.
 *
 * Phải gộp TRƯỚC rồi mới đối chiếu, không xử lý từng file rời rạc: em lớp 5 lên lớp
 * 6 sẽ rời file Tiểu học sang file THCS, xử lý riêng từng file là vô hiệu hoá nhầm
 * em đó rồi tạo lại thành người mới, mất sạch liên kết phụ huynh và lịch sử đăng ký.
 */
export function buildExcelDirectory(files, { mode = IMPORT_MODES.boSung } = {}) {
  if (!Array.isArray(files) || !files.length) throw excelError("EXCEL_NO_FILE", "Chưa chọn file nào.");
  if (files.length > MAX_FILES) throw excelError("EXCEL_TOO_MANY_FILES", `Mỗi lần nạp tối đa ${MAX_FILES} file.`);
  if (!Object.values(IMPORT_MODES).includes(mode)) throw excelError("EXCEL_MODE_INVALID", "Chế độ nhập không hợp lệ.");

  const tongDong = files.reduce((tong, file) => tong + (file.rows?.length || 0), 0);
  if (tongDong > MAX_ROWS) {
    throw excelError("EXCEL_TOO_MANY_ROWS", `Tổng số dòng (${tongDong}) vượt giới hạn ${MAX_ROWS} cho một lần nạp.`);
  }

  const results = files.map((file, index) => readExcelSource({
    key: file.key || `file-${index + 1}`,
    label: file.label || file.fileName || `File ${index + 1}`,
    rows: file.rows,
  }));
  const merged = mergeDirectorySnapshots(results);

  return {
    ...merged,
    // KHÔNG lấy allSourcesLoaded do merge tự tính. Với đường Google, "mọi nguồn đọc
    // được" nghĩa là đã có đủ cả ba file cấu hình sẵn. Với file nạp tay thì phần mềm
    // không có cách nào biết người dùng đã nạp đủ hay chưa — chỉ chính họ biết. Nên
    // quyền đánh dấu nghỉ học đến từ CHẾ ĐỘ người dùng chọn, không phải từ suy đoán.
    allSourcesLoaded: mode === IMPORT_MODES.doiChieu && merged.allSourcesLoaded,
    mode,
    results,
    readyToSync: results.every((result) => result.ok)
      && results.every((result) => (result.analysis?.invalidRows ?? 0) === 0),
  };
}
