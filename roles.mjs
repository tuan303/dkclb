// Vai trò và quyền của tài khoản nhà trường.
//
// Tách thành module thuần để ma trận quyền nằm ở ĐÚNG MỘT chỗ và kiểm thử được
// mà không cần dựng máy chủ. Trước đây mọi endpoint quản trị đều kiểm tra
// `user.role !== "admin"`, nên thêm một vai trò thứ hai sẽ phải sửa hơn hai chục
// chỗ rời rạc — kiểu sửa mà bỏ sót một chỗ là mở toang một cánh cửa.
//
// Nguyên tắc: endpoint hỏi "thao tác này cần QUYỀN gì", không hỏi "ai được vào".
// Thêm vai trò mới sau này chỉ phải sửa bảng MATRIX bên dưới.

export const ROLE = {
  superadmin: "superadmin",
  admin: "admin",
  giaovu: "giaovu",
  parent: "parent",
};

export const ROLE_LABELS = {
  superadmin: "Quản trị cao nhất",
  admin: "Quản trị vận hành",
  giaovu: "Giáo vụ",
  parent: "Phụ huynh",
};

// Vai trò của nhân sự nhà trường (đăng nhập bằng Microsoft 365).
export const SCHOOL_ROLES = [ROLE.superadmin, ROLE.admin, ROLE.giaovu];

// Vai trò cấp được từ màn hình quản lý tài khoản. KHÔNG có superadmin: quyền cao
// nhất chỉ đến từ biến môi trường, để một tài khoản bị chiếm cũng không thể tự
// nâng mình lên mức cao nhất rồi khoá người khác ra ngoài.
export const ASSIGNABLE_SCHOOL_ROLES = [ROLE.admin, ROLE.giaovu];

export const CAP = {
  quanLyTaiKhoan: "quan-ly-tai-khoan",
  // Sao lưu TOÀN BỘ cơ sở dữ liệu: tài khoản phụ huynh, mã kích hoạt, mọi trường
  // cá nhân của học sinh. Khác hẳn danh sách vận hành bên dưới.
  xuatDuLieu: "xuat-du-lieu",
  // Danh sách đăng ký để xếp lớp và điểm danh: mã đơn, tên học sinh, lớp hành
  // chính, CLB, lịch, trạng thái, học phí. Không có số điện thoại phụ huynh,
  // không ngày sinh, không mã học sinh. Giáo vụ cần tệp này để làm việc hằng ngày.
  danhSachVanHanh: "danh-sach-van-hanh",
  dongBoDanhBa: "dong-bo-danh-ba",
  duyetDon: "duyet-don",
  danhMuc: "danh-muc",
  baoCao: "bao-cao",
  // Tra cứu vì sao một phụ huynh không đăng nhập được: chỉ đọc trạng thái, KHÔNG
  // thấy mã kích hoạt.
  traCuuHoTro: "tra-cuu-ho-tro",
  // Cấp lại mã kích hoạt, và tải tệp mã của toàn bộ phụ huynh. Đây thực chất là
  // quyền ĐĂNG NHẬP THAY một phụ huynh bất kỳ: cấp lại mã sẽ xoá mật khẩu riêng
  // của họ rồi trả mã mới cho người gọi. Vì vậy nó không đi chung với tra cứu.
  maKichHoat: "ma-kich-hoat",
};

const ALL_CAPS = Object.values(CAP);

// Giáo vụ nhập danh mục CLB, xem báo cáo, cấp mã kích hoạt cho phụ huynh, và
// tải danh sách đăng ký để xếp lớp. KHÔNG sao lưu toàn bộ cơ sở dữ liệu và
// KHÔNG quản lý tài khoản nhà trường.
const MATRIX = {
  [ROLE.superadmin]: ALL_CAPS,
  [ROLE.admin]: [CAP.xuatDuLieu, CAP.danhSachVanHanh, CAP.dongBoDanhBa, CAP.duyetDon, CAP.danhMuc, CAP.baoCao, CAP.traCuuHoTro, CAP.maKichHoat],
  [ROLE.giaovu]: [CAP.danhMuc, CAP.baoCao, CAP.traCuuHoTro, CAP.danhSachVanHanh],
  [ROLE.parent]: [],
};

export function can(role, capability) {
  return (MATRIX[role] || []).includes(capability);
}

export function isSchoolRole(role) {
  return SCHOOL_ROLES.includes(role);
}

export function normalizeAccount(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * Danh sách email luôn đăng nhập được, phân tách bằng dấu phẩy.
 *
 * Đây là lớp bảo hiểm ĐỘC LẬP VỚI DỮ LIỆU: khi đã tắt tự tạo tài khoản, một bản
 * ghi quản trị bị vô hiệu hoá nhầm sẽ khoá tất cả mọi người ra ngoài và chỉ cứu
 * được bằng cách sửa tay trong MySQL. Biến môi trường không nằm trong cơ sở dữ
 * liệu nên không thể bị chính hệ thống làm hỏng.
 */
export function parseSuperadminAccounts(raw) {
  return new Set(
    String(raw || "")
      .split(/[,;\s]+/)
      .map(normalizeAccount)
      .filter(Boolean),
  );
}

export const SUPERADMIN_CONFLICT = "SUPERADMIN_CONFLICT";

/**
 * Vai trò thực tế khi xử lý một yêu cầu. Email nằm trong SUPERADMIN_ACCOUNTS
 * luôn được nâng lên mức cao nhất, bất kể vai trò lưu trong cơ sở dữ liệu — nếu
 * không thì việc hạ nhầm vai trò cũng khoá luôn đường cứu.
 *
 * Ngoại lệ: bản ghi mang vai trò phụ huynh thì KHÔNG nâng. Tài khoản phụ huynh
 * định danh bằng số điện thoại nên không thể trùng email thật; trùng được nghĩa
 * là dữ liệu đã hỏng, và im lặng trao toàn quyền trong tình huống đó là sai.
 */
export function effectiveRole(user, superadminAccounts) {
  if (!user) return null;
  const account = normalizeAccount(user.account);
  if (!account || !superadminAccounts?.has(account)) return user.role;
  if (user.role === ROLE.parent) return SUPERADMIN_CONFLICT;
  return ROLE.superadmin;
}

export function isSuperadminAccount(account, superadminAccounts) {
  const normalized = normalizeAccount(account);
  return Boolean(normalized) && Boolean(superadminAccounts?.has(normalized));
}

/**
 * Chỉ nhận email thuộc miền của trường. Nhận email ngoài miền là mở đường cho
 * việc cấp quyền quản trị cho một tài khoản mà nhà trường không kiểm soát.
 */
export function isSchoolEmail(email, domain) {
  const normalized = normalizeAccount(email);
  const suffix = `@${normalizeAccount(domain)}`;
  if (!normalized || !normalizeAccount(domain)) return false;
  // Kiểm tra dạng email tối thiểu: đúng một dấu @, có phần tên, không có khoảng trắng.
  if (!/^[^\s@]+@[^\s@]+$/.test(normalized)) return false;
  return normalized.endsWith(suffix);
}

export function normalizeSchoolRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return ASSIGNABLE_SCHOOL_ROLES.includes(role) ? role : null;
}
