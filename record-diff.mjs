// So sánh dữ liệu sắp ghi với bản ghi đang có, để đồng bộ chỉ ghi những gì thực
// sự đổi. Mỗi lượt ghi Firestore đều tính vào hạn ngạch, mà phần lớn các lần
// đồng bộ lại chỉ thay đổi vài dòng trong danh sách hàng nghìn học sinh.
//
// Chỉ đối chiếu các trường có trong `data`: bản ghi hiện có được phép mang thêm
// trường khác (mật khẩu, thời điểm tạo…) mà không bị coi là khác biệt.

function sameValue(left, right) {
  if (left === right) return true;
  const leftEmpty = left === null || left === undefined || left === "";
  const rightEmpty = right === null || right === undefined || right === "";
  if (leftEmpty || rightEmpty) return leftEmpty && rightEmpty;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => sameValue(item, right[index]));
  }
  if (typeof left === "boolean" || typeof right === "boolean") return Boolean(left) === Boolean(right);
  if (typeof left === "number" || typeof right === "number") {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber === rightNumber;
  }
  return String(left) === String(right);
}

export function isUnchanged(existing, data) {
  if (!existing) return false;
  return Object.entries(data).every(([field, value]) => sameValue(existing[field], value));
}
