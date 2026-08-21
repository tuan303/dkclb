// Quy đổi mọi lỗi thành phản hồi cho client.
//
// Nguyên tắc: chỉ những lỗi do chính hệ thống này tạo ra (có cờ `expose`) mới
// được hiển thị nguyên văn. Lỗi từ hạ tầng bên dưới — Firestore, Google API,
// mạng — không bao giờ được trả ra ngoài, vì nội dung của chúng là JSON kỹ
// thuật vô nghĩa với phụ huynh và có thể lộ chi tiết nội bộ.
const QUOTA_PATTERN = /RESOURCE_EXHAUSTED|Quota exceeded|rateLimitExceeded|quotaExceeded|429/i;
const UNAVAILABLE_PATTERN = /UNAVAILABLE|DEADLINE_EXCEEDED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i;
const PERMISSION_PATTERN = /PERMISSION_DENIED|UNAUTHENTICATED|insufficient permission|invalid_grant/i;

function errorText(error) {
  if (!error) return "";
  const parts = [error.code, error.status, error.message, error.details];
  if (error.cause) parts.push(error.cause.code, error.cause.message);
  return parts.filter((part) => typeof part === "string" || typeof part === "number").join(" ");
}

export function classifyInternalError(error) {
  const text = errorText(error);
  if (QUOTA_PATTERN.test(text)) {
    return {
      status: 503,
      code: "DATASTORE_QUOTA_EXCEEDED",
      message: "Cơ sở dữ liệu đã dùng hết hạn ngạch trong ngày nên tạm thời không ghi được. Vui lòng báo bộ phận CNTT nâng gói Firebase, hoặc thử lại sau khi hạn ngạch được đặt lại.",
    };
  }
  if (PERMISSION_PATTERN.test(text)) {
    return {
      status: 503,
      code: "DATASTORE_PERMISSION_DENIED",
      message: "Hệ thống chưa được cấp quyền truy cập cơ sở dữ liệu. Vui lòng báo bộ phận CNTT kiểm tra cấu hình.",
    };
  }
  if (UNAVAILABLE_PATTERN.test(text)) {
    return {
      status: 503,
      code: "DATASTORE_UNAVAILABLE",
      message: "Không kết nối được cơ sở dữ liệu. Vui lòng thử lại sau ít phút.",
    };
  }
  return { status: 500, code: "INTERNAL_ERROR", message: "Hệ thống gặp lỗi không mong muốn." };
}

export function toErrorResponse(error) {
  if (error?.expose) {
    return {
      status: error.status || 400,
      body: { error: { code: error.code || "REQUEST_ERROR", message: error.message, details: error.details } },
      logWorthy: false,
    };
  }
  const classified = classifyInternalError(error);
  return {
    status: classified.status,
    body: { error: { code: classified.code, message: classified.message } },
    logWorthy: true,
  };
}
