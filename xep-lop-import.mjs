// Đọc file kết quả Google Form để xếp học sinh vào ca học.
//
// Bối cảnh: nhà trường đã mở một đợt đăng ký CLB qua Google Form trước khi có cổng
// này. Vài trăm em đã đóng phí và đang học thật, nhưng trong hệ thống chưa có đơn
// nào — sĩ số của các em đó hiện nằm ở con số enrolled_base ("ghi danh sẵn ngoài hệ
// thống") của từng ca. Việc của tệp này là biến từng dòng của file Form thành một
// đơn đăng ký thật, để từ nay các em có mặt trong danh sách lớp, trong lịch học của
// phụ huynh, và trong mọi báo cáo.
//
// Tệp này CỐ Ý thuần tuý: không chạm cơ sở dữ liệu, không chạm HTTP. Nó chỉ đọc
// bảng ô chữ và nói ra "file này muốn gì". Việc đối chiếu với dữ liệu thật và quyết
// định ghi gì nằm ở server.mjs, nơi có giao dịch và khoá dòng.

const KHONG_DAU = (value) => String(value ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replaceAll("đ", "d").replaceAll("Đ", "D")
  .toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Tên cột chấp nhận được, so khớp CHÍNH XÁC sau khi bỏ dấu.
 *
 * Không khớp gần đúng: đoán sai một cột trong file vài trăm dòng là xếp nhầm lớp cho
 * vài trăm em, mà sai kiểu đó không ai nhìn ra cho tới khi giáo viên điểm danh.
 * Thà báo "thiếu cột" rồi để người vận hành sửa tiêu đề còn hơn.
 */
export const COT_XEP_LOP = {
  studentCode: [
    "ma hoc sinh", "ma hs", "mahs", "ma so hoc sinh", "student code", "student id", "ma",
  ],
  studentName: [
    "ho va ten hoc sinh", "ten hoc sinh", "ho ten hoc sinh", "hoc sinh", "ho va ten", "ho ten", "student name",
  ],
  clubText: [
    "clb", "cau lac bo", "ten clb", "dang ky clb", "clb dang ky", "chon clb", "lua chon",
    "club", "mon hoc", "bo mon", "ca hoc", "lop", "lop clb",
  ],
  phone: [
    "so dien thoai", "sdt", "dien thoai", "so dt", "sdt phu huynh", "so dien thoai phu huynh",
    "sdt bo", "sdt me", "phone",
  ],
  email: ["email", "thu dien tu", "email phu huynh", "email bo", "email me"],
};

/** Chỉ hai cột này là bắt buộc: dò ra em nào, và em ấy chọn gì. */
export const COT_BAT_BUOC = ["studentCode", "clubText"];

export function detectXepLopMapping(headers = []) {
  const daBoDau = headers.map(KHONG_DAU);
  const mapping = {};
  for (const [field, aliases] of Object.entries(COT_XEP_LOP)) {
    const index = daBoDau.findIndex((header) => aliases.includes(header));
    if (index >= 0) mapping[field] = { index, header: headers[index] };
  }
  const missing = COT_BAT_BUOC.filter((field) => !mapping[field]);
  return { mapping, missing };
}

/**
 * Dò hàng tiêu đề trong 10 hàng đầu. File Google Form thường có tiêu đề ở hàng 1,
 * nhưng file người ta chép tay lại hay có một hàng tên đợt nằm trên.
 */
export function detectHeaderRow(rows = []) {
  let tot = { index: -1, mapping: {}, missing: COT_BAT_BUOC };
  for (let i = 0; i < Math.min(rows.length, 10); i += 1) {
    const thu = detectXepLopMapping(rows[i] || []);
    if (thu.missing.length < tot.missing.length) tot = { index: i, ...thu };
    if (!tot.missing.length) break;
  }
  return tot;
}

const chuoi = (value) => String(value ?? "").trim();

/** Chuẩn hoá số điện thoại về dạng so khớp được: chỉ còn chữ số, 0 đứng đầu. */
export function chuanHoaSdt(value) {
  const so = chuoi(value).replace(/\D/g, "");
  if (!so) return "";
  if (so.startsWith("84") && so.length >= 10) return `0${so.slice(2)}`;
  return so.startsWith("0") ? so : `0${so}`;
}

export const MAX_DONG_XEP_LOP = 5000;

/**
 * Đọc một file thành danh sách dòng đã chuẩn hoá.
 *
 * Dòng thiếu mã học sinh hoặc thiếu ô chọn CLB KHÔNG bị vứt đi im lặng — nó vẫn nằm
 * trong kết quả kèm lý do, để màn xem trước nói ra được "file có 312 dòng, xếp được
 * 305, 7 dòng này hỏng vì sao". Nuốt mất dòng hỏng là cách chắc chắn nhất để vài em
 * không bao giờ vào lớp mà không ai biết.
 */
export function docFileXepLop({ rows = [], label = "" } = {}) {
  if (!rows.length) {
    return { ok: false, label, error: "File rỗng, không đọc được dòng nào." };
  }
  const tieuDe = detectHeaderRow(rows);
  if (tieuDe.missing.length) {
    const ten = { studentCode: "Mã học sinh", clubText: "CLB" };
    return {
      ok: false, label,
      error: `Thiếu cột bắt buộc: ${tieuDe.missing.map((field) => ten[field] || field).join(", ")}.`,
      headers: rows[0] || [],
    };
  }

  const than = rows.slice(tieuDe.index + 1);
  if (than.length > MAX_DONG_XEP_LOP) {
    return { ok: false, label, error: `File có ${than.length} dòng, vượt giới hạn ${MAX_DONG_XEP_LOP} dòng mỗi lần nhập.` };
  }

  const layO = (row, field) => (tieuDe.mapping[field] ? chuoi(row[tieuDe.mapping[field].index]) : "");
  const danhSach = [];
  for (const [index, row] of than.entries()) {
    if (!Array.isArray(row) || row.every((o) => !chuoi(o))) continue; // hàng trống hoàn toàn
    const studentCode = layO(row, "studentCode");
    const clubText = layO(row, "clubText");
    danhSach.push({
      dong: tieuDe.index + 2 + index, // số hàng như người dùng thấy trong Excel
      studentCode,
      studentName: layO(row, "studentName"),
      clubText,
      phone: chuanHoaSdt(layO(row, "phone")),
      email: layO(row, "email").toLowerCase(),
      loi: !studentCode ? "Thiếu mã học sinh"
        : !clubText ? "Thiếu ô chọn CLB"
          : null,
    });
  }

  return {
    ok: true, label,
    headerRow: tieuDe.index + 1,
    headers: rows[tieuDe.index] || [],
    mapping: Object.fromEntries(Object.entries(tieuDe.mapping).map(([k, v]) => [k, v.header])),
    rows: danhSach,
  };
}

/**
 * Gom các ô chọn CLB khác nhau trong file lại, mỗi giá trị một lần.
 *
 * Google Form cho chọn từ một danh sách thả xuống, nên cả file thường chỉ có vài
 * chục giá trị khác nhau cho hàng trăm dòng. Ghép từng giá trị đó với một ca học là
 * việc con người làm MỘT lần trên màn xem trước, thay vì máy đoán 312 lần.
 */
export function gomOChonClb(danhSach = []) {
  const theoGiaTri = new Map();
  for (const row of danhSach) {
    if (!row.clubText) continue;
    const khoa = KHONG_DAU(row.clubText);
    if (!theoGiaTri.has(khoa)) theoGiaTri.set(khoa, { khoa, mau: row.clubText, soDong: 0 });
    theoGiaTri.get(khoa).soDong += 1;
  }
  return [...theoGiaTri.values()].sort((a, b) => b.soDong - a.soDong || a.mau.localeCompare(b.mau, "vi"));
}

/**
 * Đoán ca học cho một ô chọn của Form, CHỈ khi đoán được chắc chắn.
 *
 * Trả về một ca khi và chỉ khi có ĐÚNG MỘT ca khớp. CLB "Guitar" có hai ca thì
 * không đoán — trả về danh sách ứng viên để người vận hành tự chọn. Đoán liều ở đây
 * là xếp cả trăm em vào sai buổi, và không ai phát hiện cho tới lúc điểm danh.
 */
export function doanCaHoc(clubText, danhSachCa = []) {
  const tim = KHONG_DAU(clubText);
  if (!tim) return { classId: null, ungVien: [] };

  const nhan = (ca) => KHONG_DAU(`${ca.clubName || ""} ${ca.className || ""}`);
  const khopHan = danhSachCa.filter((ca) => nhan(ca) === tim
    || KHONG_DAU(ca.clubName) === tim
    || KHONG_DAU(`${ca.clubName} · ${ca.className}`) === tim);
  if (khopHan.length === 1) return { classId: khopHan[0].id, ungVien: khopHan };

  // Không khớp hẳn thì thử chứa: ô Form hay kèm thêm mô tả ("Guitar (Thứ 2)").
  const khopChua = danhSachCa.filter((ca) => KHONG_DAU(ca.clubName) && tim.includes(KHONG_DAU(ca.clubName)));
  if (khopChua.length === 1) return { classId: khopChua[0].id, ungVien: khopChua };

  return { classId: null, ungVien: khopHan.length ? khopHan : khopChua };
}
