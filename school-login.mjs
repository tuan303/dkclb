// Quyết định cho ai vào cổng Nhà trường qua Microsoft 365.
//
// Tách khỏi tầng HTTP vì đây là phần quan trọng nhất về bảo mật: trước đây nó
// nằm lẫn trong nhánh callback cùng với chuyện đổi mã, đặt cookie và chuyển
// hướng, nên không kiểm thử được nếu không giả lập cả Microsoft.
//
// Nguyên tắc: TỪ CHỐI là mặc định. Trước đây bất kỳ ai thuộc miền của trường
// đăng nhập là tự có một tài khoản quản trị toàn quyền, và vai trò đặt tay bị
// ép về 'admin' ở mỗi lần người đó đăng nhập lại.

import { ROLE, isSuperadminAccount, normalizeAccount } from "./roles.mjs";

// Nguyên văn thông báo hiển thị cho người dùng. Giữ ở một chỗ để giao diện và
// máy chủ không bao giờ nói hai câu khác nhau.
export const DENIAL_MESSAGE = "Tài khoản của bạn chưa được kích hoạt, liên hệ với bộ phận CNTT.";

export const DENIAL = {
  noAccount: "chua-co-tai-khoan",
  disabled: "da-vo-hieu-hoa",
  parentConflict: "trung-tai-khoan-phu-huynh",
};

/**
 * @param user                 bản ghi tìm được theo microsoft_object_id hoặc email, hoặc null
 * @param email                email lấy từ Microsoft
 * @param superadminAccounts   Set email luôn được vào (biến môi trường)
 * @param isActive             hàm đọc trạng thái hoạt động từ bản ghi
 *
 * @returns {{ allow: boolean, reason?: string, action?: string, role?: string, reactivate?: boolean }}
 */
export function decideSchoolLogin({ user, email, superadminAccounts, isActive = (record) => Number(record?.active) === 1 }) {
  const account = normalizeAccount(email);
  const rescue = isSuperadminAccount(account, superadminAccounts);

  if (!user) {
    // Chỉ email trong danh sách cứu mới được tạo bản ghi. Đây là lối duy nhất
    // còn lại để vào hệ thống khi bản ghi quản trị bị vô hiệu hoá nhầm — nếu
    // không thì phải sửa tay trong cơ sở dữ liệu mới cứu được.
    return rescue
      ? { allow: true, action: "tao-moi", role: ROLE.superadmin }
      : { allow: false, reason: DENIAL.noAccount };
  }

  // Tài khoản phụ huynh định danh bằng số điện thoại nên không thể trùng email
  // thật. Trùng được nghĩa là dữ liệu đã hỏng; im lặng cho vào cổng Nhà trường
  // lúc đó là trao quyền nhầm người. Danh sách cứu KHÔNG vượt qua được ca này.
  if (user.role === ROLE.parent) {
    return { allow: false, reason: DENIAL.parentConflict };
  }

  if (!isActive(user)) {
    return rescue
      ? { allow: true, action: "dang-nhap", reactivate: true }
      : { allow: false, reason: DENIAL.disabled };
  }

  // Vào được. KHÔNG trả về vai trò: đăng nhập là xác minh danh tính, không phải
  // dịp cấp quyền. Vai trò giữ nguyên như đã đặt trong màn hình quản lý.
  return { allow: true, action: "dang-nhap" };
}
