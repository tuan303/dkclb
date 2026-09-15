/**
 * Màn Thông tin học sinh: tra cứu học sinh và sửa liên hệ phụ huynh (15/09/2026).
 *
 * Phạm vi ĐÚNG MỘT việc nhà trường yêu cầu: sửa SĐT, email, họ tên bố/mẹ ngay trên
 * phần mềm thay vì nhập lại file. Không sửa thông tin của chính học sinh, không cho
 * nghỉ học, không lên lớp.
 *
 * Tệp này giữ phần THUẦN — kiểm tra đầu vào, che dữ liệu khi ghi nhật ký, ghép và lọc
 * danh bạ — để kiểm thử được mà không dựng máy chủ. Phần ghi nằm ở từng kho dữ liệu vì
 * mỗi nền khoá bản ghi theo cách riêng.
 *
 * Điều phải nhớ: SĐT phụ huynh CHÍNH LÀ TÊN ĐĂNG NHẬP. Sửa SĐT là đổi số đăng nhập của
 * tài khoản đó — giữ nguyên mật khẩu, các con và các đơn đã gửi. Tài khoản chưa kích
 * hoạt thì mật khẩu khởi tạo là chính số điện thoại, nên đổi số là đổi luôn mật khẩu đó.
 */
import { toVietnameseLocalPhone } from "./sheets-directory.mjs";

export const QUAN_HE_PHU_HUYNH = ["Bố", "Mẹ", "Người giám hộ"];
export const TEN_MAC_DINH = "Phụ huynh học sinh";
export const MOI_TRANG_CHO_PHEP = [20, 50, 100];

function loi(status, code, message) {
  const error = new Error(message);
  Object.assign(error, { status, code, expose: true });
  return error;
}

export function boDau(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
}

/** SĐT đăng nhập mới. Chỉ nhận số di động Việt Nam, đưa về dạng 0xxxxxxxxx. */
export function chuanHoaSdt(value) {
  const sdt = toVietnameseLocalPhone(value);
  if (!sdt) throw loi(422, "SDT_KHONG_HOP_LE", "Số điện thoại không hợp lệ. Nhập số di động Việt Nam, ví dụ 0912345678.");
  return sdt;
}

/** Ô trống nghĩa là xoá email. Nhận bừa thì cột Email đầy rác mà không ai biết từ đâu ra. */
export function chuanHoaEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email) return null;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@.]+$/.test(email)) {
    throw loi(422, "EMAIL_KHONG_HOP_LE", "Email không hợp lệ.");
  }
  return email;
}

export function chuanHoaTen(value) {
  const ten = String(value ?? "").replace(/\s+/g, " ").trim();
  if (ten.length > 120) throw loi(422, "TEN_QUA_DAI", "Họ tên phụ huynh dài quá 120 ký tự.");
  return ten || TEN_MAC_DINH;
}

export function chuanHoaQuanHe(value) {
  const quanHe = String(value ?? "").trim();
  if (!QUAN_HE_PHU_HUYNH.includes(quanHe)) {
    throw loi(422, "QUAN_HE_KHONG_HOP_LE", `Quan hệ phải là một trong: ${QUAN_HE_PHU_HUYNH.join(", ")}.`);
  }
  return quanHe;
}

/**
 * Đầu vào của một lần sửa. Trường nào không gửi lên thì giữ nguyên — chỉ những trường
 * có mặt mới được ghi, để một lần sửa email không vô tình đụng tới số đăng nhập.
 */
export function docYeuCauSua(body = {}) {
  const thayDoi = {};
  if (body.account !== undefined) thayDoi.account = chuanHoaSdt(body.account);
  if (body.email !== undefined) thayDoi.email = chuanHoaEmail(body.email);
  if (body.displayName !== undefined) thayDoi.displayName = chuanHoaTen(body.displayName);
  return { thayDoi, saiNguoi: body.saiNguoi === true };
}

export function docYeuCauThem(body = {}) {
  return {
    account: chuanHoaSdt(body.account),
    relationship: chuanHoaQuanHe(body.relationship),
    email: chuanHoaEmail(body.email),
    displayName: chuanHoaTen(body.displayName),
    ganVaoTaiKhoanCo: body.ganVaoTaiKhoanCo === true,
  };
}

/**
 * Lượt ghi liên hệ xếp hàng lần lượt với NHAU, rồi mới xin khoá danh bạ.
 *
 * Khoá danh bạ (sync-scheduler.mjs) từ chối chứ không xếp hàng — đúng cho nhập file, sai
 * cho màn này: hai quản trị bấm Lưu cùng lúc mà đi thẳng vào khoá thì người thứ hai nhận
 * "đang đồng bộ danh bạ" dù không có lượt nhập nào. Khoá vẫn phải xin, vì nhập file đọc
 * bảng tài khoản rồi mới ghi: chen một lần đổi số vào giữa là file tạo lại số vừa đổi đi.
 *
 * @param runExclusive  khoá danh bạ, ném lỗi DIRECTORY_SYNC_BUSY khi đang có lượt khác
 * @param sauKhiGhi     chạy sau mỗi lượt, thành công hay không (xoá bộ nhớ đệm danh bạ)
 */
export function taoHangDoiGhi(runExclusive, sauKhiGhi = () => {}) {
  let hangDoi = Promise.resolve();
  return (task) => {
    const lan = hangDoi.then(() => runExclusive(task)).catch((error) => {
      if (error?.code === "DIRECTORY_SYNC_BUSY") {
        throw loi(409, "DANG_NHAP_DANH_BA", "Đang có một lượt nhập danh bạ chạy. Đợi lượt đó xong rồi bấm lưu lại.");
      }
      throw error;
    }).finally(sauKhiGhi);
    hangDoi = lan.catch(() => {});
    return lan;
  };
}

function loiSdtDaCo(trung) {
  if (trung.role !== "parent") {
    return loi(409, "SDT_LA_TAI_KHOAN_NHA_TRUONG", "Số này đang là tài khoản nhà trường, không dùng làm số đăng nhập phụ huynh được.");
  }
  return loi(409, "SDT_DA_CO_TAI_KHOAN",
    `Số này đã là số đăng nhập của một tài khoản phụ huynh khác (đang gắn ${Number(trung.soHocSinh) || 0} học sinh), `
    + "nên không đổi được: hai tài khoản không thể dùng chung một số. "
    + "Nếu muốn gắn em vào tài khoản đó, dùng mục “Thêm SĐT phụ huynh”.");
}

/**
 * Quyết định một lần sửa, dùng chung cho mọi kho dữ liệu để các nền hành xử y hệt.
 *
 * @param hienTai  bản ghi hiện tại đã giải mã: { id, role, account, email, displayName }
 * @param trung    tài khoản KHÁC đang giữ số mới, nếu có: { id, role, soHocSinh }
 * @param saiNguoi số cũ không phải của phụ huynh này: đặt lại mật khẩu về số điện thoại
 *                 (mới) và đăng xuất mọi thiết bị, để người cầm số cũ không còn ở trong.
 */
export function lapKeHoachSua({ hienTai, thayDoi, saiNguoi = false, trung = null }) {
  if (!hienTai || hienTai.role !== "parent") {
    throw loi(404, "PHU_HUYNH_KHONG_TON_TAI", "Không tìm thấy tài khoản phụ huynh này.");
  }
  const doiSo = thayDoi.account !== undefined && thayDoi.account !== hienTai.account;
  const doiEmail = thayDoi.email !== undefined && (thayDoi.email || null) !== (hienTai.email || null);
  const doiTen = thayDoi.displayName !== undefined && thayDoi.displayName !== hienTai.displayName;
  if (doiSo && trung) throw loiSdtDaCo(trung);
  // Đặt lại mật khẩu mà GIỮ số cũ là trả chìa khoá cho đúng người cần đuổi ra: mật khẩu
  // khởi tạo chính là số điện thoại, người cầm số cũ đăng nhập lại ngay bằng số đó.
  if (saiNguoi && !doiSo) {
    throw loi(422, "SAI_NGUOI_CAN_SO_MOI",
      "Đánh dấu số cũ sai người thì phải nhập số đúng của phụ huynh. Giữ nguyên số cũ mà đặt lại mật khẩu thì người cầm số đó đăng nhập lại được ngay.");
  }

  const before = {};
  const after = {};
  if (doiSo) { before.account = cheSdt(hienTai.account); after.account = cheSdt(thayDoi.account); }
  if (doiEmail) { before.email = cheEmail(hienTai.email); after.email = cheEmail(thayDoi.email); }
  // Không ghi tên vào nhật ký: chỉ ghi là có đổi.
  if (doiTen) after.doiTen = true;
  if (saiNguoi) { after.datLaiMatKhau = true; after.dangXuatMoiThietBi = true; }
  return {
    doiSo, doiEmail, doiTen, saiNguoi: Boolean(saiNguoi),
    khongDoi: !doiSo && !doiEmail && !doiTen && !saiNguoi,
    nhatKy: { before, after },
  };
}

/**
 * Thêm một SĐT phụ huynh cho em. Số đã có tài khoản thì gắn em vào tài khoản đó (thường
 * là anh/chị em ruột) và KHÔNG sửa email hay tên của tài khoản ấy; chưa có thì tạo tài
 * khoản mới y như lúc nhập danh bạ: mật khẩu khởi tạo là chính số điện thoại.
 *
 * Gắn vào tài khoản đã có phải được xác nhận RIÊNG: dán nhầm số của gia đình khác là
 * phụ huynh ấy thấy em và đăng ký, huỷ CLB được cho em. Lượt đầu trả 409 kèm tên tài
 * khoản và các em đang gắn, người sửa đọc xong mới gửi lại với ganVaoTaiKhoanCo.
 *
 * @param taiKhoan  tài khoản đang giữ số này, nếu có: { id, role, displayName, hocSinh: [{ name, homeroom }] }
 */
export function lapKeHoachThem({ coHocSinh, taiKhoan = null, daLienKet = false, ganVaoTaiKhoanCo = false }) {
  if (!coHocSinh) throw loi(404, "HOC_SINH_KHONG_TON_TAI", "Không tìm thấy học sinh này.");
  if (taiKhoan && taiKhoan.role !== "parent") throw loiSdtDaCo(taiKhoan);
  if (daLienKet) throw loi(409, "DA_LIEN_KET", "Số này đã gắn với em rồi.");
  if (taiKhoan && !ganVaoTaiKhoanCo) {
    const hocSinh = taiKhoan.hocSinh || [];
    const ds = hocSinh.slice(0, 5).map((em) => `${em.name} (${em.homeroom || "—"})`).join(", ");
    const error = loi(409, "CAN_XAC_NHAN_GAN_TAI_KHOAN",
      `Số này đã là tài khoản của phụ huynh “${taiKhoan.displayName || TEN_MAC_DINH}”, đang gắn ${hocSinh.length} học sinh`
      + `${ds ? `: ${ds}${hocSinh.length > 5 ? ", …" : ""}` : ""}. `
      + "Gắn em vào tài khoản này thì phụ huynh ấy thấy em và đăng ký, huỷ CLB được cho em.");
    error.details = [{ field: "account", message: error.message }];
    throw error;
  }
  return { taoTaiKhoan: !taiKhoan };
}

/**
 * Nhật ký thao tác lưu JSON thường (không mã hoá) và đi theo bản sao lưu. Ghi nguyên
 * số điện thoại vào đó là rải số của 7.119 phụ huynh ra ngoài lớp mã hoá — nên chỉ ghi
 * đủ để đối soát: ba số đầu, ba số cuối.
 */
export function cheSdt(value) {
  const so = String(value ?? "");
  if (!so) return null;
  if (!/^\d{9,11}$/.test(so)) return "***";
  return `${so.slice(0, 3)}****${so.slice(-3)}`;
}

export function cheEmail(value) {
  const email = String(value ?? "");
  if (!email) return null;
  const [ten, mien] = email.split("@");
  return `${ten.slice(0, 2)}***@${mien || ""}`;
}

/**
 * Ghép ba bảng thành danh sách học sinh, mỗi em kèm các tài khoản phụ huynh.
 *
 * @param students  { id, code, name, grade, homeroom, level, status }
 * @param links     { parentUserId, studentId, relationship }
 * @param parents   { id, account, displayName, email, active, daKichHoat }
 */
export function ghepDanhBa({ students = [], links = [], parents = [] }) {
  const phuHuynhTheoId = new Map(parents.map((item) => [item.id, item]));
  const soConTheoPhuHuynh = new Map();
  const lienKetTheoHocSinh = new Map();
  for (const link of links) {
    if (!phuHuynhTheoId.has(link.parentUserId)) continue;
    soConTheoPhuHuynh.set(link.parentUserId, (soConTheoPhuHuynh.get(link.parentUserId) || 0) + 1);
    if (!lienKetTheoHocSinh.has(link.studentId)) lienKetTheoHocSinh.set(link.studentId, []);
    lienKetTheoHocSinh.get(link.studentId).push(link);
  }
  const thuTuQuanHe = (quanHe) => ({ "Bố": 0, "Bố/Mẹ": 1, "Mẹ": 2 })[quanHe] ?? 3;
  return students.map((student) => ({
    id: student.id, code: student.code, name: student.name, grade: Number(student.grade) || 0,
    homeroom: student.homeroom || "", level: student.level || "", status: student.status || "active",
    phuHuynh: (lienKetTheoHocSinh.get(student.id) || [])
      .map((link) => {
        const parent = phuHuynhTheoId.get(link.parentUserId);
        return {
          userId: parent.id, relationship: link.relationship, account: parent.account || "",
          displayName: parent.displayName || "", email: parent.email || null,
          active: parent.active !== false, daKichHoat: Boolean(parent.daKichHoat),
          soHocSinh: soConTheoPhuHuynh.get(parent.id) || 0,
        };
      })
      .sort((a, b) => thuTuQuanHe(a.relationship) - thuTuQuanHe(b.relationship)),
  }));
}

/** Đọc bộ lọc từ query string, có giới hạn chặt để không trả cả danh bạ trong một lượt. */
export function docBoLoc(searchParams) {
  const lay = (key) => String(searchParams.get(key) || "").trim();
  const khoi = Number(lay("khoi"));
  const moiTrang = Number(lay("moiTrang"));
  return {
    q: lay("q").slice(0, 100),
    khoi: Number.isInteger(khoi) && khoi >= 1 && khoi <= 12 ? khoi : null,
    lop: lay("lop").slice(0, 32),
    lienHe: ["chua-co-sdt", "thieu-email"].includes(lay("lienHe")) ? lay("lienHe") : "",
    trangThai: lay("trangThai") === "tat-ca" ? "tat-ca" : "dang-hoc",
    trang: Math.max(1, Math.floor(Number(lay("trang")) || 1)),
    moiTrang: MOI_TRANG_CHO_PHEP.includes(moiTrang) ? moiTrang : MOI_TRANG_CHO_PHEP[0],
  };
}

export function locDanhBa(rows, boLoc) {
  const tim = boDau(boLoc.q).trim();
  const soTim = tim.replace(/\D/g, "");
  // Gõ "912345678", "0912 345 678" hay "+84 912..." đều phải ra: so phần chữ số, bỏ
  // tiền tố 0 hoặc 84 ở đầu (84 chỉ bỏ khi đã đủ dài để là cả một số).
  const soTimRutGon = soTim.length >= 11 && soTim.startsWith("84") ? soTim.slice(2) : soTim.replace(/^0+/, "");
  const laSo = /^[\d\s.+()-]+$/.test(tim);
  const khopTuKhoa = (row) => {
    if (!tim) return true;
    if (boDau(`${row.name} ${row.code} ${row.homeroom}`).includes(tim)) return true;
    if (laSo) {
      return soTimRutGon.length >= 3 && row.phuHuynh.some((item) => String(item.account).includes(soTimRutGon));
    }
    return row.phuHuynh.some((item) => boDau(`${item.displayName} ${item.email || ""}`).includes(tim));
  };
  const loc = rows.filter((row) => (boLoc.trangThai === "tat-ca" || row.status === "active")
    && (!boLoc.khoi || row.grade === boLoc.khoi)
    && (!boLoc.lop || row.homeroom === boLoc.lop)
    && (boLoc.lienHe !== "chua-co-sdt" || !row.phuHuynh.length)
    && (boLoc.lienHe !== "thieu-email" || row.phuHuynh.some((item) => !item.email))
    && khopTuKhoa(row));
  loc.sort((a, b) => a.grade - b.grade
    || String(a.homeroom).localeCompare(String(b.homeroom), "vi", { numeric: true })
    || String(a.name).localeCompare(String(b.name), "vi"));

  const soTrang = Math.max(1, Math.ceil(loc.length / boLoc.moiTrang));
  const trang = Math.min(boLoc.trang, soTrang);
  const batDau = (trang - 1) * boLoc.moiTrang;
  const lopCoSan = [...new Map(rows.filter((row) => row.homeroom)
    .map((row) => [row.homeroom, { lop: row.homeroom, khoi: row.grade }])).values()]
    .sort((a, b) => a.khoi - b.khoi || a.lop.localeCompare(b.lop, "vi", { numeric: true }));
  return {
    rows: loc.slice(batDau, batDau + boLoc.moiTrang),
    tong: loc.length, trang, soTrang, moiTrang: boLoc.moiTrang, lopCoSan,
  };
}

/** Một em kèm danh sách anh chị em DÙNG CHUNG từng tài khoản — sửa số là sửa cho cả các em đó. */
export function chiTietHocSinh(rows, studentId) {
  const hocSinh = rows.find((row) => row.id === studentId);
  if (!hocSinh) return null;
  const emTheoPhuHuynh = new Map();
  for (const row of rows) {
    for (const item of row.phuHuynh) {
      if (!emTheoPhuHuynh.has(item.userId)) emTheoPhuHuynh.set(item.userId, []);
      emTheoPhuHuynh.get(item.userId).push({ id: row.id, name: row.name, homeroom: row.homeroom, status: row.status });
    }
  }
  return {
    ...hocSinh,
    phuHuynh: hocSinh.phuHuynh.map((item) => ({
      ...item,
      hocSinhKhac: (emTheoPhuHuynh.get(item.userId) || []).filter((em) => em.id !== hocSinh.id),
    })),
  };
}
