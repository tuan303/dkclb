// Nhà trường tự thêm một học sinh vào lớp CLB.
//
// Trước đây màn "Danh sách lớp CLB" CỐ Ý không có nút này, với lý do: thêm tay là đi
// vòng qua kiểm tra sĩ số và bước thu phí, rồi chỗ đó không có đơn nào để đối chiếu.
// Nhà trường yêu cầu mở lại (10/11/2026), nên đường mới phải trả lời được đúng những
// lo ngại đó: nó TẠO MỘT ĐƠN THẬT (có mã đơn, có nhật ký, hiện trong mọi báo cáo), và
// đi qua CÙNG bộ luật mà cổng phụ huynh đang dùng, chứ không phải một ngõ tắt.
//
// Module thuần: không chạm CSDL, không chạm HTTP. Việc đối chiếu với dữ liệu thật và
// ghi nằm ở server.mjs, nơi có giao dịch và khoá dòng.
import { ACTIVE_REGISTRATION_STATUSES, SEAT_HOLDING_STATUSES } from "./registration-status.mjs";
import { intervalsOverlap } from "./schedule-conflict.mjs";

export const GIOI_HAN_TIM = 20;
export const TOI_THIEU_TU_KHOA = 2;
// Một lượt thêm tay tối đa bấy nhiêu em. Nhiều hơn thì đó là việc của đường nhập
// hàng loạt, nơi có bước xem trước từng dòng.
export const TOI_DA_MOI_LUOT = 100;

const boDau = (value) => String(value ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replaceAll("đ", "d").replaceAll("Đ", "D")
  .toLowerCase().replace(/\s+/g, " ").trim();

export function chuanHoaTuKhoa(value) {
  return boDau(value).slice(0, 100);
}

/**
 * Tìm học sinh theo mã hoặc họ tên (và lớp hành chính, vì giáo vụ hay gõ "3A2").
 *
 * CỐ Ý không tìm theo SĐT phụ huynh như màn Thông tin học sinh: ô này nằm trong màn
 * danh sách lớp, nơi SĐT phụ huynh nằm ngoài phạm vi. Trả về tối đa GIOI_HAN_TIM kết
 * quả — danh bạ có vài nghìn em, đổ hết xuống trình duyệt mỗi lần gõ là vô ích.
 */
export function timHocSinh(students = [], tuKhoa, { gioiHan = GIOI_HAN_TIM, keCaDaNghi = false } = {}) {
  const khoa = chuanHoaTuKhoa(tuKhoa);
  if (khoa.length < TOI_THIEU_TU_KHOA) return [];
  const hop = [];
  for (const em of students) {
    if (!keCaDaNghi && em.status && em.status !== "active") continue;
    const dong = boDau([em.name, em.code, em.homeroom].filter(Boolean).join(" "));
    if (!dong.includes(khoa)) continue;
    hop.push(em);
    if (hop.length >= gioiHan) break;
  }
  return hop;
}

/**
 * Khối áp dụng thật của một lớp: khối khai riêng cho lớp được ưu tiên, không khai thì
 * theo khối của CLB. Giống hệt quy tắc ở clubRows, nếu lệch là em hợp lệ bị chặn hoặc
 * em sai khối lọt vào.
 */
export function khoiCuaLop(lop = {}, clb = {}) {
  const rieng = Array.isArray(lop.grades) ? lop.grades : [];
  return rieng.length ? rieng : (Array.isArray(clb.grades) ? clb.grades : []);
}

/**
 * Xét một em có thêm được vào lớp không.
 *
 * Trả về KẾT CỤC chứ không ném lỗi: một lượt thêm có thể gồm nhiều em, và người vận
 * hành cần thấy em nào vào được, em nào không và vì sao — giống hệt cách đường nhập
 * hàng loạt báo cáo từng dòng.
 */
export function xetThemVaoLop({
  hocSinh, lop, clb, donCuaEm = [], maxClubsPerStudent = 3, siSoDangDung = 0, choPhepVuotSiSo = false,
}) {
  if (!hocSinh) return { ketCuc: "khongTimThayHocSinh", thongBao: "Không tìm thấy học sinh." };
  if (!lop) return { ketCuc: "khongTimThayLop", thongBao: "Không tìm thấy lớp." };
  const ten = hocSinh.name || hocSinh.code || hocSinh.id;

  if (hocSinh.status && hocSinh.status !== "active") {
    return { ketCuc: "hocSinhNghiHoc", thongBao: `${ten} đã nghỉ học, không thêm vào lớp được.` };
  }

  const conHieuLuc = donCuaEm.filter((don) => ACTIVE_REGISTRATION_STATUSES.includes(don.status));

  // Trùng ĐÚNG lớp này: hai đơn cho cùng một em một lớp là hai lần thu phí.
  if (conHieuLuc.some((don) => don.classId === lop.id)) {
    return { ketCuc: "daCoDon", thongBao: `${ten} đã có đơn ở lớp này rồi.` };
  }

  // Trùng khung giờ với một lớp khác em đang học.
  const trung = conHieuLuc.find((don) => intervalsOverlap(lop, don));
  if (trung) {
    return {
      ketCuc: "trungGio",
      thongBao: `${ten} đã có lớp trùng khung giờ này (${trung.scheduleLabel || "lịch khác"}${trung.clubName ? ` · ${trung.clubName}` : ""}).`,
    };
  }

  // Sai khối. Lớp chưa khai khối nào thì coi như mở cho mọi khối.
  const khoi = khoiCuaLop(lop, clb);
  if (khoi.length && hocSinh.grade && !khoi.includes(Number(hocSinh.grade))) {
    return { ketCuc: "saiKhoi", thongBao: `${ten} học khối ${hocSinh.grade}, lớp này dành cho khối ${khoi.join(", ")}.` };
  }

  // Hạn mức số CLB mỗi em trong một đợt. Đếm theo CLB chứ không theo lớp: nhiều lớp
  // của cùng một CLB tính là một (quyết định 11/09/2026).
  if (lop.periodId && maxClubsPerStudent > 0) {
    const clbTrongDot = new Set(conHieuLuc.filter((don) => don.periodId === lop.periodId).map((don) => don.clubId));
    if (!clbTrongDot.has(lop.clubId) && clbTrongDot.size >= maxClubsPerStudent) {
      return {
        ketCuc: "vuotHanMuc",
        thongBao: `${ten} đã đăng ký đủ ${maxClubsPerStudent} CLB trong đợt này.`,
      };
    }
  }

  // Sĩ số. Nhà trường chọn CHẶN (10/11/2026) thay vì cho vượt: lớp 21/20 là một
  // phòng học không đủ chỗ ngồi, và không ai nhìn thấy cho tới buổi đầu tiên.
  if (!choPhepVuotSiSo && lop.capacity && siSoDangDung >= Number(lop.capacity)) {
    return {
      ketCuc: "lopDaDay",
      thongBao: `Lớp đã đủ ${siSoDangDung}/${lop.capacity} chỗ. Hãy nâng sĩ số tối đa của lớp trước khi thêm ${ten}.`,
    };
  }

  return { ketCuc: "themDuoc", thongBao: "" };
}

/**
 * Lên kế hoạch cho cả một lượt thêm nhiều em.
 *
 * Sĩ số được cộng dồn TRONG lượt: thêm 5 em vào lớp còn 3 chỗ thì phải chặn từ em thứ
 * tư, chứ không phải xét cả 5 em trên cùng một con số sĩ số đầu lượt.
 */
export function lapKeHoachThemNhieu({
  hocSinhIds = [], danhBa = new Map(), lop, clb, donTheoHocSinh = new Map(),
  maxClubsPerStudent = 3, siSoDangDung = 0, choPhepVuotSiSo = false,
}) {
  const ketQua = [];
  const daXet = new Set();
  let siSo = Number(siSoDangDung) || 0;
  for (const studentId of hocSinhIds.slice(0, TOI_DA_MOI_LUOT)) {
    if (daXet.has(studentId)) {
      ketQua.push({ studentId, ketCuc: "trungTrongLuot", thongBao: "Em này được chọn hai lần trong cùng một lượt." });
      continue;
    }
    daXet.add(studentId);
    const hocSinh = danhBa.get(studentId) || null;
    const xet = xetThemVaoLop({
      hocSinh, lop, clb, donCuaEm: donTheoHocSinh.get(studentId) || [],
      maxClubsPerStudent, siSoDangDung: siSo, choPhepVuotSiSo,
    });
    ketQua.push({ studentId, ten: hocSinh?.name || "", code: hocSinh?.code || "", ...xet });
    if (xet.ketCuc === "themDuoc") siSo += 1;
  }
  return { ketQua, siSoSau: siSo, themDuoc: ketQua.filter((item) => item.ketCuc === "themDuoc") };
}

/**
 * Có hạ "ghi danh sẵn ngoài hệ thống" đi không, và đi bao nhiêu.
 *
 * Chỉ hạ khi trạng thái đích THỰC SỰ giữ chỗ, và chỉ trừ những em CHƯA TỪNG có đơn ở
 * lớp đó. Em đã từng được nhập rồi bị huỷ đơn thì enrolled_base đã trừ cho em ấy một
 * lần; trừ tiếp là mở ra chỗ trống không có thật. Đúng luật mà đường nhập hàng loạt
 * đang dùng — hai đường lệch nhau là sĩ số lệch nhau.
 */
export function tinhHaGhiDanhSan({ trangThai, enrolledBaseHienTai = 0, studentIds = [], daTungCoDon = new Set() }) {
  if (!SEAT_HOLDING_STATUSES.includes(trangThai)) {
    return { soHa: 0, enrolledBaseMoi: Number(enrolledBaseHienTai) || 0, thieuGhiDanhSan: false };
  }
  const soEmMoi = studentIds.filter((studentId) => !daTungCoDon.has(studentId)).length;
  const base = Number(enrolledBaseHienTai) || 0;
  return {
    soHa: Math.min(base, soEmMoi),
    enrolledBaseMoi: Math.max(0, base - soEmMoi),
    // Hạ không đủ nghĩa là sĩ số sẽ TĂNG thật — nói ra thay vì âm thầm.
    thieuGhiDanhSan: soEmMoi > base,
  };
}

/**
 * Dò cột chứa mã học sinh / họ tên trong một bảng ô chữ bất kỳ.
 *
 * Nhận cả file có hàng tiêu đề lẫn file chỉ là một cột mã dán từ chỗ khác sang. Tên
 * cột so khớp CHÍNH XÁC sau khi bỏ dấu, không đoán gần đúng: đoán sai một cột trong
 * file vài trăm dòng là xếp nhầm lớp cho vài trăm em mà không ai nhìn ra cho tới khi
 * giáo viên điểm danh.
 *
 * Luật này nằm ở MỘT chỗ và chạy trên máy chủ; trình duyệt chỉ đọc file ra bảng ô
 * chữ rồi gửi lên, không tự dò cột — hai bản dò khác nhau là hai kết quả khác nhau.
 */
const TIEU_DE_MA = ["ma hoc sinh", "ma hs", "mahs", "ma so hoc sinh", "student code", "student id", "ma"];
const TIEU_DE_TEN = ["ho va ten hoc sinh", "ten hoc sinh", "ho ten hoc sinh", "hoc sinh", "ho va ten", "ho ten", "student name", "ten"];

export function docKhoaTuBang(rows = []) {
  const bang = rows
    .map((hang) => (Array.isArray(hang) ? hang.map((o) => String(o ?? "").trim()) : []))
    .filter((hang) => hang.some(Boolean));
  if (!bang.length) return { khoa: [], cot: null, coTieuDe: false };

  for (const [chiSo, hang] of bang.slice(0, 10).entries()) {
    const chuanHoa = hang.map((o) => boDau(o));
    const cotMa = chuanHoa.findIndex((o) => TIEU_DE_MA.includes(o));
    const cotTen = chuanHoa.findIndex((o) => TIEU_DE_TEN.includes(o));
    if (cotMa < 0 && cotTen < 0) continue;
    const khoa = bang.slice(chiSo + 1)
      .map((than) => (cotMa >= 0 && than[cotMa]) || (cotTen >= 0 && than[cotTen]) || "")
      .filter(Boolean);
    return { khoa, cot: cotMa >= 0 ? "ma" : "ten", coTieuDe: true };
  }

  // Không có hàng tiêu đề: lấy ô có chữ đầu tiên của mỗi hàng.
  return { khoa: bang.map((hang) => hang.find(Boolean) || "").filter(Boolean), cot: null, coTieuDe: false };
}

/**
 * Khớp từng khoá trong file với danh bạ: mã khớp CHÍNH XÁC trước, rồi mới tới họ tên
 * khớp chính xác sau khi bỏ dấu. Tên trùng nhau trong trường thì KHÔNG đoán — báo ra
 * để người vận hành tự chọn bằng ô tìm kiếm, vì chọn hộ là xếp nhầm lớp cho một em
 * có thật.
 */
export function khopKhoaVoiDanhBa(khoa = [], students = []) {
  const theoMa = new Map();
  const theoTen = new Map();
  for (const hocSinh of students) {
    const ma = String(hocSinh.code || "").trim().toUpperCase();
    if (ma) theoMa.set(ma, hocSinh);
    const ten = boDau(hocSinh.name);
    if (!ten) continue;
    if (!theoTen.has(ten)) theoTen.set(ten, []);
    theoTen.get(ten).push(hocSinh);
  }
  const khop = [];
  const khongKhop = [];
  const nhieuNguoi = [];
  const daCo = new Set();
  const nhan = (hocSinh) => {
    if (daCo.has(hocSinh.id)) return;
    daCo.add(hocSinh.id);
    khop.push(hocSinh);
  };
  for (const o of khoa) {
    const theoMaKhop = theoMa.get(String(o).trim().toUpperCase());
    if (theoMaKhop) { nhan(theoMaKhop); continue; }
    const cungTen = theoTen.get(boDau(o)) || [];
    if (cungTen.length === 1) nhan(cungTen[0]);
    else if (cungTen.length > 1) nhieuNguoi.push({ khoa: o, so: cungTen.length });
    else khongKhop.push(o);
  }
  return { khop, khongKhop, nhieuNguoi };
}

/**
 * Phụ huynh gắn vào đơn. Đơn chỉ gắn được MỘT người, và phải chọn theo thứ tự ỔN ĐỊNH
 * (mã tài khoản) để chạy lại cho cùng kết quả.
 *
 * Để trống thì gia đình em đó KHÔNG thấy đơn trong cổng của họ — truy vấn của cổng
 * phụ huynh lọc theo parent_user_id chứ không theo student_id. Vì vậy nơi gọi phải
 * đếm và báo ra số em không có phụ huynh.
 */
export function chonPhuHuynh(links = []) {
  const theoHocSinh = new Map();
  const soPhuHuynh = new Map();
  for (const link of [...links].sort((a, b) => String(a.parentUserId).localeCompare(String(b.parentUserId)))) {
    soPhuHuynh.set(link.studentId, (soPhuHuynh.get(link.studentId) || 0) + 1);
    if (!theoHocSinh.has(link.studentId)) theoHocSinh.set(link.studentId, link.parentUserId);
  }
  return { theoHocSinh, soPhuHuynh };
}
