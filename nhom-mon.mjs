// Danh mục khai báo "Nhóm môn" của CLB.
//
// Vì sao tách module thuần: club.category là CHỮ chứ không phải khoá ngoại (phụ
// huynh lọc theo chữ, Dashboard gom theo chữ, file Excel nhập vào cũng là chữ).
// Nên đổi tên một nhóm môn là một lượt SỬA DỮ LIỆU HÀNG LOẠT trên bảng clubs,
// và xoá một nhóm đang có CLB dùng sẽ để lại CLB mồ côi mà không ai thấy. Luật
// "đổi được hay không, đổi những gì" nằm ở đây để kiểm thử không cần dựng máy chủ.
//
// Tại sao KHÔNG đổi sang khoá ngoại: 12 nơi trong mã nguồn đang đọc club.category
// như chữ, trong đó có file xuất Excel gửi cho giáo vụ và bộ lọc ở cổng phụ huynh.
// Danh mục này là lớp khai báo nằm TRÊN dữ liệu chữ sẵn có, không thay thế nó.
import { normalizeHeader } from "./sheets-directory.mjs";

// Khớp giới hạn của trường category trong catalog-schema.mjs (requireText max 60).
export const MAX_DAI_TEN_NHOM = 60;
// Chặn khai báo tràn: danh mục dài hơn thế là dấu hiệu nhập nhầm cả bảng vào đây.
export const MAX_SO_NHOM = 100;

function invalid(code, message, field) {
  const error = new Error(message);
  Object.assign(error, { status: 422, code, field, expose: true });
  return error;
}

/**
 * Khoá so trùng: bỏ dấu, bỏ ký tự đặc biệt, gộp khoảng trắng, không phân biệt hoa
 * thường. "Nghệ Thuật" và "nghệ thuật" là MỘT nhóm; "Kỹ năng & Công nghệ" và
 * "Kỹ năng và Công nghệ" thì KHÔNG (chữ "va" khác chuỗi rỗng) — cố tình, vì gộp
 * nhầm hai nhóm khác nhau tệ hơn là để người dùng tự gộp.
 */
export function khoaNhom(ten) {
  return normalizeHeader(ten);
}

export function chuanHoaTenNhom(value, field = "name") {
  const ten = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!ten) throw invalid("NHOM_TEN_REQUIRED", "Vui lòng nhập tên nhóm môn.", field);
  if (ten.length > MAX_DAI_TEN_NHOM) throw invalid("NHOM_TEN_TOO_LONG", `Tên nhóm môn tối đa ${MAX_DAI_TEN_NHOM} ký tự.`, field);
  if (!khoaNhom(ten)) throw invalid("NHOM_TEN_REQUIRED", "Tên nhóm môn phải có chữ hoặc số.", field);
  return ten;
}

export function docYeuCauNhom(body = {}, { existing = null } = {}) {
  const sortOrderRaw = body.sortOrder ?? existing?.sortOrder ?? 0;
  const sortOrder = Number(String(sortOrderRaw).replace(/[^\d-]/g, ""));
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) {
    throw invalid("NHOM_SORT_INVALID", "Thứ tự hiển thị phải là số nguyên từ 0 đến 9999.", "sortOrder");
  }
  return {
    name: chuanHoaTenNhom(body.name ?? existing?.name),
    emoji: String(body.emoji ?? existing?.emoji ?? "").trim().slice(0, 8),
    sortOrder,
    active: body.active === undefined ? existing?.active !== false : Boolean(body.active),
  };
}

/**
 * Nhóm trùng tên trong danh mục. Trả về bản ghi trùng (nếu có) thay vì ném lỗi,
 * để nơi gọi tự chọn: tạo mới thì chặn, còn đổi tên thì có thể mời GỘP.
 */
export function timNhomTrung(ten, danhSach = [], { boQuaId = null } = {}) {
  const khoa = khoaNhom(ten);
  return danhSach.find((nhom) => nhom.id !== boQuaId && khoaNhom(nhom.name) === khoa) || null;
}

export function kiemTrungKhiTao(ten, danhSach = [], { boQuaId = null } = {}) {
  if (danhSach.filter((nhom) => nhom.id !== boQuaId).length >= MAX_SO_NHOM) {
    throw invalid("NHOM_QUA_NHIEU", `Danh mục nhóm môn tối đa ${MAX_SO_NHOM} mục.`, "name");
  }
  const trung = timNhomTrung(ten, danhSach, { boQuaId });
  if (trung) throw invalid("NHOM_DA_CO", `Nhóm môn “${trung.name}” đã có trong danh mục.`, "name");
  return ten;
}

/** Số CLB đang mang đúng tên nhóm này (so theo khoá, bắt cả bản gõ lệch dấu/hoa thường). */
export function clbTheoNhom(ten, clubs = []) {
  const khoa = khoaNhom(ten);
  return clubs.filter((club) => khoaNhom(club.category) === khoa);
}

/**
 * CLB thuộc nhóm này nhưng ghi lệch chính tả so với tên chuẩn — cần ghi lại.
 *
 * Danh mục gom theo khoá đã bỏ dấu, còn cổng phụ huynh dựng nút lọc bằng CHUỖI
 * NGUYÊN VĂN. Nên một CLB ghi "THỂ THAO" cạnh một CLB ghi "Thể thao" hiện ra ở màn
 * quản trị là MỘT nhóm, nhưng phía phụ huynh là HAI nút lọc gần giống hệt nhau.
 */
export function clbLechChinhTa(ten, clubs = []) {
  return clbTheoNhom(ten, clubs).filter((club) => club.category !== ten);
}

/**
 * Kế hoạch đổi tên một nhóm môn.
 *
 * Ba tình huống khác hẳn nhau, nên trả về kiểu rõ ràng chứ không chỉ true/false:
 *  - "doi-ten": tên mới chưa ai dùng → đổi tên nhóm + cập nhật mọi CLB đang dùng.
 *  - "sua-chinh-ta": khoá không đổi (chỉ sửa dấu/hoa thường) → vẫn phải đẩy chữ mới
 *    xuống clubs, nếu không bộ lọc phía phụ huynh sẽ hiện hai nhóm gần giống nhau.
 *  - "gop": tên mới trùng một nhóm KHÁC đang có → đây là gộp hai nhóm, phải được
 *    xác nhận, vì không có đường lùi tự động.
 */
export function lapKeHoachDoiTen({ nhom, tenMoi, clubs = [], danhSach = [], choPhepGop = false }) {
  if (!nhom) throw invalid("NHOM_NOT_FOUND", "Không tìm thấy nhóm môn cần sửa.", "id");
  const ten = chuanHoaTenNhom(tenMoi);
  const trung = timNhomTrung(ten, danhSach, { boQuaId: nhom.id });
  const tenDich = trung ? trung.name : ten;

  // Mọi CLB sẽ mang tên đích: CLB của nhóm nguồn, CỘNG cả CLB đang thuộc nhóm đích mà
  // ghi lệch chính tả. Bỏ qua CLB đã ghi đúng y hệt chuỗi đích — ghi lại cũng vô ích.
  const clubIds = [...new Set([
    ...clbTheoNhom(nhom.name, clubs).map((club) => club.id),
    ...clbLechChinhTa(tenDich, clubs).map((club) => club.id),
  ])].filter((id) => clubs.find((club) => club.id === id)?.category !== tenDich);
  const soClbChuyen = clbTheoNhom(nhom.name, clubs).length;

  if (trung) {
    if (!choPhepGop) {
      const them = trung.id ? "" : " Nhóm này chưa khai báo: nó đang nằm trong dữ liệu CLB.";
      const an = trung.active === false ? " LƯU Ý: nhóm đích đang ẩn." : "";
      throw invalid("NHOM_CAN_XAC_NHAN_GOP",
        `Nhóm môn “${trung.name}” đã có. Đổi sang tên này là GỘP hai nhóm: ${soClbChuyen} CLB của “${nhom.name}” sẽ chuyển sang “${trung.name}”. Việc này không tự hoàn lại được.${them}${an}`,
        "name");
    }
    // gopVaoId rỗng nghĩa là nhóm đích CHƯA khai báo: không có dòng danh mục nào để
    // xoá, chỉ đổi tên chính nhóm nguồn rồi hút các CLB kia vào.
    return { kieu: "gop", tenCu: nhom.name, tenMoi: trung.name, gopVaoId: trung.id || null, clubIds, soClbChuyen };
  }

  if (nhom.name === ten) {
    // Tên không đổi nhưng vẫn có CLB ghi lệch dấu/hoa thường: bấm Lưu phải chuẩn hoá
    // chúng, nếu không thì người dùng không có cách nào sửa ngoài việc gõ bừa một
    // cách viết khác rồi gõ lại — gần như không ai đoán ra.
    return { kieu: clubIds.length ? "chuan-hoa" : "khong-doi", tenCu: nhom.name, tenMoi: ten, gopVaoId: null, clubIds, soClbChuyen };
  }
  const kieu = khoaNhom(nhom.name) === khoaNhom(ten) ? "sua-chinh-ta" : "doi-ten";
  return { kieu, tenCu: nhom.name, tenMoi: ten, gopVaoId: null, clubIds, soClbChuyen };
}

/**
 * Kế hoạch xoá. Còn CLB dùng thì CHẶN chứ không xoá kèm: xoá nhóm không làm CLB
 * biến mất, nó chỉ làm CLB mang một nhóm không còn trong danh mục — lỗi âm thầm,
 * phát hiện ra lúc giáo vụ thấy bộ lọc phía phụ huynh thừa một nhóm lạ.
 */
export function lapKeHoachXoa({ nhom, clubs = [] }) {
  if (!nhom) throw invalid("NHOM_NOT_FOUND", "Không tìm thấy nhóm môn cần xoá.", "id");
  const dangDung = clbTheoNhom(nhom.name, clubs);
  if (dangDung.length) {
    throw invalid("NHOM_DANG_DUOC_DUNG",
      `Còn ${dangDung.length} CLB thuộc nhóm “${nhom.name}” (${dangDung.slice(0, 3).map((club) => club.name).join(", ")}${dangDung.length > 3 ? "…" : ""}). Hãy đổi nhóm cho các CLB đó trước, hoặc đổi tên nhóm này thay vì xoá.`,
      "id");
  }
  return { id: nhom.id, name: nhom.name };
}

/**
 * Danh mục để hiển thị: nhóm ĐÃ KHAI BÁO, cộng thêm nhóm "chưa khai báo" lấy từ
 * chính dữ liệu CLB đang có.
 *
 * Cần thiết vì danh mục này ra đời SAU dữ liệu: trên máy chủ thật đã có sẵn các
 * CLB mang nhóm môn gõ tay hoặc nhập từ Excel. Không hiện chúng ra thì màn khai
 * báo nói "chưa có nhóm nào" trong khi cổng phụ huynh đang lọc theo 4 nhóm.
 */
export function ghepDanhMucNhom(danhSach = [], clubs = []) {
  const theoKhoa = new Map();
  for (const nhom of danhSach) {
    theoKhoa.set(khoaNhom(nhom.name), {
      id: nhom.id,
      name: nhom.name,
      emoji: nhom.emoji || "",
      sortOrder: Number(nhom.sortOrder) || 0,
      active: nhom.active !== false,
      daKhaiBao: true,
      soClb: 0,
      soClbHien: 0,
    });
  }
  for (const club of clubs) {
    const khoa = khoaNhom(club.category);
    if (!khoa) continue;
    if (!theoKhoa.has(khoa)) {
      theoKhoa.set(khoa, {
        id: null,
        name: String(club.category || "").replace(/\s+/g, " ").trim(),
        emoji: "",
        sortOrder: 9999,
        active: true,
        daKhaiBao: false,
        soClb: 0,
        soClbHien: 0,
      });
    }
    const muc = theoKhoa.get(khoa);
    muc.soClb += 1;
    if (club.active !== false) muc.soClbHien += 1;
  }
  return [...theoKhoa.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi"));
}

/**
 * Nhóm suy ra từ dữ liệu CLB hiện có, dùng để nạp danh mục lần đầu. Giữ nguyên
 * cách viết của bản ghi ĐẦU TIÊN gặp được: đổi chính tả hàng loạt là việc của
 * người dùng, không phải của một lần chạy nền.
 */
export function nhomTuClubs(clubs = []) {
  const theoKhoa = new Map();
  for (const club of clubs) {
    const khoa = khoaNhom(club.category);
    if (!khoa || theoKhoa.has(khoa)) continue;
    theoKhoa.set(khoa, String(club.category).replace(/\s+/g, " ").trim());
  }
  return [...theoKhoa.values()];
}
