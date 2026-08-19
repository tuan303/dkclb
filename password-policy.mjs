const POLICY_MESSAGE = "Mật khẩu cần có ít nhất 8 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.";

export function validatePasswordPolicy(value, account = "") {
  const password = String(value || "");
  if (password.length < 8 || password.length > 128) {
    return { valid: false, code: "PASSWORD_LENGTH_INVALID", message: `${POLICY_MESSAGE} Độ dài tối đa là 128 ký tự.` };
  }
  const hasUppercase = /\p{Lu}/u.test(password);
  const hasLowercase = /\p{Ll}/u.test(password);
  const hasNumber = /\p{N}/u.test(password);
  const hasSpecial = /[^\p{L}\p{N}\s]/u.test(password);
  if (!hasUppercase || !hasLowercase || !hasNumber || !hasSpecial) {
    return { valid: false, code: "PASSWORD_COMPLEXITY_REQUIRED", message: POLICY_MESSAGE };
  }
  if (account && password.toLowerCase().includes(String(account).toLowerCase())) {
    return { valid: false, code: "PASSWORD_CONTAINS_ACCOUNT", message: "Mật khẩu mới không được chứa số điện thoại đăng nhập." };
  }
  return { valid: true };
}
