// Biểu mẫu Excel TRỐNG cho bốn màn nhập của hệ thống.
//
// Người vận hành tải mẫu, tự điền, rồi nhập lại qua đúng màn đó. Mọi quy tắc dưới đây
// lấy từ chính bộ đọc của từng màn (catalog-schema.mjs, sheets-directory.mjs,
// xep-lop-import.mjs, school-account-import.mjs); tests/bieu-mau.test.mjs chạy từng
// mẫu qua bộ đọc thật để mẫu không lệch khỏi bộ đọc khi một bên đổi.
//
// Ba nguyên tắc chung, đều đến từ lỗi đã tái hiện được:
// 1. Tiêu đề cột ghi NGUYÊN VĂN tên bộ đọc nhận. Bộ đọc so khớp tuyệt đối sau khi bỏ
//    dấu, nên "Học phí (VNĐ)" hay "Khối (VD: 1-5)" là cột bị bỏ qua — học phí lặng lẽ
//    về 0. Mọi hướng dẫn nằm ở lời nhắc trong ô và ở sheet "Hướng dẫn", không ở tiêu đề.
// 2. Cột chữ để sẵn định dạng Text. Không thì Excel đổi "1-5" (khối) và "12/04/2017"
//    (ngày sinh) thành số ngày, và số điện thoại mất số 0 đầu.
// 3. Sheet dữ liệu đứng ĐẦU, sheet hướng dẫn tên bắt đầu bằng "Hướng dẫn" đứng sau —
//    các màn nhập bỏ qua sheet có tên đó (laSheetHuongDan trong public/app.js).
import { DAY_LABELS } from "./catalog-schema.mjs";
import { taoXlsx } from "./xlsx-writer.mjs";

const THU = [...DAY_LABELS.slice(1), DAY_LABELS[0]]; // Thứ 2 … Thứ 7, Chủ nhật

const nhac = (title, text) => ({ title, text });

const CHUNG = [
  "• KHÔNG đổi, không thêm chữ vào dòng tiêu đề (dòng 1). Tiêu đề phải giữ nguyên văn thì hệ thống mới nhận ra cột.",
  "• Cột tiêu đề nền ĐỎ là bắt buộc; nền xanh là không bắt buộc. Bấm vào một ô sẽ hiện lời nhắc cách điền cột đó.",
  "• Mỗi dòng một bản ghi, điền liền từ dòng 2, không để dòng trống xen giữa. Không điền sẵn STT hay công thức ở các dòng chưa dùng.",
  "• Không ghi chú, không kẻ tổng cộng bên dưới bảng: mọi dòng có chữ đều bị coi là dữ liệu.",
  "• Lưu lại đúng định dạng .xlsx (không lưu .xls). Nếu cần CSV thì chọn \"CSV UTF-8\".",
  "• Có thể giữ nguyên sheet \"Hướng dẫn\" khi nhập: hệ thống tự bỏ qua sheet có tên bắt đầu bằng \"Hướng dẫn\".",
];

const huongDan = (tieuDe, ...doan) => ({
  name: "Hướng dẫn",
  lines: [
    { text: tieuDe, kieu: "tieuDe" },
    ...doan.flatMap((phan) => [{ text: "" }, { text: phan.tieuDe, kieu: "tieuDe" }, ...phan.dong.map((text) => ({ text }))]),
  ],
});

/* ------------------------------------------------------------------ 1 */

function mauDanhMucClb() {
  const columns = [
    { header: "Mã CLB", width: 14, prompt: nhac("Mã CLB (nên điền)", "Mã ngắn, duy nhất cho mỗi CLB, ví dụ BD-COBAN. Các dòng cùng mã gộp thành một CLB nhiều ca. Là khoá để lần nhập sau cập nhật đúng CLB, nên giữ nguyên mã giữa các lần nhập.") },
    { header: "Tên CLB", required: true, width: 26, prompt: nhac("Tên CLB (bắt buộc)", "Viết giống hệt nhau ở mọi ca của cùng một CLB, ví dụ BÓNG ĐÁ CƠ BẢN.") },
    { header: "Nhóm môn", width: 16, validation: { type: "list", values: ["Thể thao", "STEM", "Nghệ thuật", "Âm nhạc", "Ngôn ngữ", "Kỹ năng sống"], strict: false }, prompt: nhac("Nhóm môn", "Chọn trong danh sách hoặc gõ nhóm khác. Để trống sẽ ghi thành \"Khác\".") },
    { header: "Khối", required: true, width: 12, prompt: nhac("Khối (bắt buộc)", "Các khối được học ca này: khoảng 1-5 hoặc liệt kê 6, 7, 8. Mỗi dòng phải có. Ô đã để dạng chữ, đừng đổi định dạng kẻo Excel biến 1-5 thành ngày.") },
    { header: "Tên lớp", width: 16, prompt: nhac("Tên lớp (tên ca)", "Tên để phân biệt các ca của cùng CLB, ví dụ BD2A1.1 hoặc Ca 1. Nên đặt tên KHÁC NHAU cho từng ca. Đây không phải khối học.") },
    { header: "Thứ", required: true, width: 11, validation: { type: "list", values: THU }, prompt: nhac("Thứ (bắt buộc)", "Chọn đúng MỘT thứ. Ca học hai buổi một tuần thì ghi hai dòng.") },
    { header: "Khung giờ", required: true, width: 14, prompt: nhac("Khung giờ (bắt buộc)", "Giờ bắt đầu - giờ kết thúc theo 24 giờ, ví dụ 16:15-17:30. Không ghi 4:15 PM.") },
    { header: "Phòng", required: true, width: 16, prompt: nhac("Phòng (bắt buộc)", "Phòng hoặc địa điểm học, ví dụ Sân bóng A. Lần nhập sau phải ghi GIỐNG HỆT (cả hoa thường, dấu chấm) thì mới cập nhật đúng ca thay vì tạo ca mới.") },
    { header: "Giáo viên", required: true, width: 22, prompt: nhac("Giáo viên (bắt buộc)", "Họ tên giáo viên phụ trách ca.") },
    { header: "Sĩ số tối đa", required: true, width: 12, text: false, validation: { type: "whole", min: 1, max: 500 }, prompt: nhac("Sĩ số tối đa (bắt buộc)", "Số nguyên từ 1 đến 500. Không ghi số thập phân.") },
    { header: "Sĩ số tối thiểu", width: 13, text: false, validation: { type: "whole", min: 0, max: 500 }, prompt: nhac("Sĩ số tối thiểu", "Số học sinh tối thiểu để mở lớp, không lớn hơn sĩ số tối đa. Để trống = 0.") },
    { header: "Học phí", width: 14, text: false, validation: { type: "whole", min: 0, max: 500000000 }, prompt: nhac("Học phí (đồng)", "Số nguyên, ví dụ 1500000. Không ghi \"1,5 triệu\". Để trống = 0 đồng.") },
    { header: "Mô tả", width: 36, prompt: nhac("Mô tả", "Giới thiệu ngắn về CLB cho phụ huynh, tối đa 1000 ký tự. Ghi ở dòng đầu tiên của CLB là đủ.") },
    { header: "Biểu tượng", width: 11, prompt: nhac("Biểu tượng", "Một emoji đại diện CLB, ví dụ ⚽. Để trống sẽ là 🎯.") },
  ];
  return {
    fileName: "mau-danh-muc-clb-ca-hoc.xlsx",
    sheets: [
      { name: "Danh mục CLB", columns },
      huongDan("MẪU NHẬP DANH MỤC CLB & CA HỌC",
        { tieuDe: "Dùng ở đâu", dong: [
          "Trang \"CLB & lịch học\" → chọn đúng đợt đăng ký ở ô chọn đợt → bấm \"Nhập từ Excel\" → chọn file này → rà soát → Ghi.",
          "Mỗi dòng là MỘT ca học. CLB có nhiều ca thì ghi nhiều dòng cùng Mã CLB và cùng Tên CLB.",
          "Nhập chỉ tạo mới hoặc cập nhật, không xoá CLB hay ca nào không có trong file.",
        ] },
        { tieuDe: "Cách điền", dong: [
          "Mã CLB: nên điền và giữ nguyên giữa các lần nhập. Để trống thì hệ thống tự sinh mã từ tên, và hai CLB tên dài gần giống nhau có thể bị gộp nhầm.",
          "Khối: 1-5, hoặc 6, 7, 8. Thứ: Thứ 2 … Thứ 7, Chủ nhật — mỗi dòng một thứ. Khung giờ: 16:15-17:30.",
          "Sĩ số tối đa: số nguyên 1–500. Học phí: số nguyên đồng, ví dụ 1500000.",
        ] },
        { tieuDe: "Lưu ý khi nhập lại file đã có", dong: [
          "Ca được nhận ra theo: CLB + đợt + thứ + giờ bắt đầu + phòng. Đổi phòng, đổi thứ hay đổi giờ bắt đầu là tạo CA MỚI, ca cũ vẫn còn — sửa những thứ đó trên màn hình thay vì nhập lại.",
          "Để trống Nhóm môn, Mô tả, Biểu tượng, Sĩ số tối thiểu hoặc Học phí sẽ GHI ĐÈ giá trị đang có (thành Khác, trống, 🎯, 0, 0). File nhập lại phải mang đủ dữ liệu.",
          "Không nhập file danh mục cũ còn các CLB trùng tên đã gộp mà chưa sửa mã: sửa Mã CLB của các dòng đó thành mã CLB giữ lại trước khi nhập.",
        ] },
        { tieuDe: "Quy tắc chung", dong: CHUNG }),
    ],
  };
}

/* ------------------------------------------------------------------ 2 */

function mauDanhBaHocSinh() {
  const sdt = (ai) => nhac(`SĐT ${ai}`, `Số di động của ${ai}: 10 số bắt đầu bằng 0, ví dụ 0912345678. Chỉ MỘT số trong một ô. Mỗi dòng cần ít nhất một số của bố hoặc mẹ. Số này là tài khoản đăng nhập của phụ huynh.`);
  const email = (ai) => nhac(`Email ${ai}`, `Email của ${ai}, không bắt buộc. Để trống nếu không có — đừng ghi "không có".`);
  const columns = [
    { header: "Mã học sinh", required: true, width: 14, prompt: nhac("Mã học sinh (bắt buộc)", "Mã học sinh, ví dụ 24151884. Không có khoảng trắng hay dấu chấm ở giữa. Mỗi mã chỉ một dòng. Mã đã có thì thông tin học sinh đó được cập nhật.") },
    { header: "Họ và tên học sinh", required: true, width: 26, prompt: nhac("Họ và tên học sinh (bắt buộc)", "Họ và tên đầy đủ, có dấu.") },
    { header: "Ngày sinh", required: true, width: 12, prompt: nhac("Ngày sinh (bắt buộc)", "Gõ dạng ngày/tháng/năm, ví dụ 12/04/2017. Ô đã để dạng chữ, đừng đổi sang dạng ngày.") },
    { header: "Lớp", required: true, width: 10, prompt: nhac("Lớp (bắt buộc)", "Lớp chủ nhiệm, bắt đầu bằng số khối 1–12, ví dụ 3A2, 6A1, 10A1. Hệ thống lấy khối từ con số đầu tiên.") },
    { header: "Cấp học", required: true, width: 12, validation: { type: "list", values: ["Tiểu học", "THCS", "THPT"] }, prompt: nhac("Cấp học", "Có thể để trống: hệ thống tự suy từ lớp (1–5 Tiểu học, 6–9 THCS, 10–12 THPT). Cột phải có mặt trong file.") },
    { header: "Họ tên bố", width: 22, prompt: nhac("Họ tên bố", "Dùng làm tên hiển thị khi tạo tài khoản phụ huynh mới.") },
    { header: "SĐT bố", width: 13, prompt: sdt("bố") },
    { header: "Email bố", width: 24, prompt: email("bố") },
    { header: "Họ tên mẹ", width: 22, prompt: nhac("Họ tên mẹ", "Dùng làm tên hiển thị khi tạo tài khoản phụ huynh mới.") },
    { header: "SĐT mẹ", width: 13, prompt: sdt("mẹ") },
    { header: "Email mẹ", width: 24, prompt: email("mẹ") },
  ];
  return {
    fileName: "mau-danh-ba-hoc-sinh-phu-huynh.xlsx",
    sheets: [
      { name: "Danh bạ học sinh", columns },
      huongDan("MẪU NHẬP DANH BẠ HỌC SINH & PHỤ HUYNH",
        { tieuDe: "Dùng ở đâu", dong: [
          "Trang \"Cấu hình & phân quyền\" → khung \"Nhập từ file Excel\" → chọn file này → \"Kiểm tra file\" → \"Ghi vào hệ thống\". Cần quyền đồng bộ danh bạ (quản trị).",
          "Mỗi dòng là MỘT học sinh, thông tin bố và mẹ nằm cùng dòng. Anh chị em dùng chung số điện thoại thì mỗi em một dòng, ghi cùng số.",
          "Nhập ở chế độ bổ sung: tạo mới hoặc cập nhật, KHÔNG làm học sinh nào nghỉ học.",
        ] },
        { tieuDe: "Điều sẽ xảy ra", dong: [
          "Mã học sinh đã có: họ tên, ngày sinh, lớp, cấp học được ghi đè theo file, và học sinh được bật lại trạng thái đang học nếu trước đó đã nghỉ.",
          "Số điện thoại chưa có tài khoản: tạo tài khoản phụ huynh mới, mật khẩu ban đầu là chính số điện thoại, bắt buộc đổi ở lần đăng nhập đầu.",
          "Số điện thoại đã có tài khoản: chỉ gắn thêm học sinh và cập nhật email (nếu file có email hợp lệ). Không đổi tên, không đặt lại mật khẩu.",
          "Số điện thoại trùng với tài khoản của cán bộ nhà trường: cả lượt nhập bị dừng.",
          "Sửa số điện thoại của một em KHÔNG gỡ số cũ ra — số cũ vẫn gắn với em đó.",
        ] },
        { tieuDe: "Cách điền", dong: [
          "Mã học sinh, Họ và tên học sinh, Ngày sinh, Lớp: bắt buộc ở mọi dòng. Cột Cấp học phải có trong file nhưng ô có thể để trống.",
          "Ngày sinh gõ 12/04/2017. Số điện thoại gõ đủ 10 số có số 0 đầu. Các ô đã để sẵn dạng chữ để Excel không tự đổi.",
          "Mỗi dòng cần ít nhất một số điện thoại hợp lệ của bố hoặc mẹ. Một số sai mà số kia đúng thì chỉ bị cảnh báo.",
        ] },
        { tieuDe: "Quy tắc chung", dong: CHUNG }),
    ],
  };
}

/* ------------------------------------------------------------------ 3 */

/**
 * @param {{ caHoc?: Array<{ nhan: string, lich?: string, khoi?: number[], phong?: string, giaoVien?: string }>, tenDot?: string }} tuyChon
 *   caHoc: danh sách ca của đợt (máy chủ truyền vào khi tải từ hệ thống) — có thì ô CLB có
 *   ô chọn thả xuống đúng tên từng ca, và sheet "Hướng dẫn - Danh sách ca" để tra.
 */
function mauXepLopClb({ caHoc = [], tenDot = "" } = {}) {
  const coDanhSach = caHoc.length > 0;
  const soCa = Math.max(caHoc.length, 1);
  const columns = [
    { header: "Mã học sinh", required: true, width: 14, prompt: nhac("Mã học sinh (bắt buộc)", "Mã học sinh đúng như trong danh bạ, ví dụ 24151884. Không có khoảng trắng hay ký tự khác ở giữa.") },
    { header: "Họ và tên học sinh", width: 26, prompt: nhac("Họ và tên (đối chiếu)", "Chỉ để người điền dễ đối chiếu. Hệ thống tìm học sinh theo MÃ, không theo tên.") },
    {
      header: "CLB đăng ký", required: true, width: 40,
      validation: coDanhSach ? { type: "listRange", sheet: "Hướng dẫn - Danh sách ca", range: `$A$2:$A$${soCa + 1}`, strict: false } : undefined,
      prompt: nhac("CLB đăng ký (bắt buộc)", coDanhSach
        ? "Chọn đúng MỘT ca trong danh sách thả xuống. Một em học hai CLB thì ghi hai dòng."
        : "Ghi đúng MỘT ca: chép nguyên văn \"Tên CLB · Tên ca\" như trên hệ thống. CLB chỉ có một ca thì ghi tên CLB. Một em học hai CLB thì ghi hai dòng."),
    },
    { header: "Ghi chú", width: 24, prompt: nhac("Ghi chú", "Không bắt buộc, hệ thống không đọc cột này.") },
  ];
  const sheets = [
    { name: "Xếp lớp CLB", columns },
    huongDan("MẪU XẾP HỌC SINH VÀO LỚP CLB",
      { tieuDe: "Dùng ở đâu", dong: [
        "Trang \"Đơn đăng ký\" → \"Nhập từ file đăng ký\" → chọn đợt → chọn file này → \"Kiểm tra file\" → rà soát từng dòng → Ghi.",
        "Tính năng này đang KHOÁ trên máy chủ (CHO_PHEP_NHAP_HANG_LOAT=0) cho tới khi được thử bằng dữ liệu thật. Điền sẵn file trước cũng được.",
        "Mỗi dòng là MỘT học sinh vào MỘT ca. Mỗi dòng xếp được sẽ thành một đơn đăng ký của em đó.",
        tenDot ? `File này tải cho đợt: ${tenDot}. Danh sách ca ở sheet "Hướng dẫn - Danh sách ca" là các ca đang mở của đợt này lúc tải.` : "",
      ].filter(Boolean) },
      { tieuDe: "Cách ghi ô CLB đăng ký", dong: [
        coDanhSach
          ? "Chọn từ danh sách thả xuống — đó là tên chính xác của từng ca, chắc chắn ghép đúng."
          : "Cách chắc chắn nhất: tải file mẫu từ màn \"Nhập từ file đăng ký\" trên hệ thống — file tải từ đó có sẵn danh sách thả xuống tên từng ca.",
        "Nếu gõ tay: ghi \"Tên CLB · Tên ca\" (dấu chấm giữa ·, có khoảng trắng hai bên), đúng chính tả như trên hệ thống.",
        "CLB chỉ có một ca: ghi tên CLB là đủ. CLB có nhiều ca dành cho các khối khác nhau: ghi tên CLB, hệ thống chọn ca theo khối của em; nếu còn hai ca hợp khối, ghi thêm thứ, ví dụ \"BÓNG ĐÁ CƠ BẢN - Thứ 6\".",
        "KHÔNG ghi hai CLB trong một ô, không thêm phòng, giáo viên hay lớp chủ nhiệm vào ô: ô đó sẽ không ghép được.",
      ] },
      { tieuDe: "Hệ thống sẽ kiểm tra", dong: [
        "Mã học sinh có trong danh bạ và em đang học; ca đúng khối của em; em chưa có đơn ở ca đó; không trùng giờ; không vượt số CLB tối đa của đợt. Một em được học nhiều lớp của cùng một CLB.",
        "Dòng không đạt được liệt kê kèm lý do, không bị bỏ im lặng. Em chưa liên kết tài khoản phụ huynh vẫn được xếp, nhưng gia đình sẽ không thấy đơn trong cổng.",
        "Không thêm cột tên \"Lớp\" bên trái cột CLB đăng ký: hệ thống sẽ hiểu nhầm cột đó là cột CLB. Muốn ghi lớp chủ nhiệm thì dùng cột Ghi chú.",
      ] },
      { tieuDe: "Quy tắc chung", dong: CHUNG }),
  ];
  if (coDanhSach) {
    sheets.push({
      name: "Hướng dẫn - Danh sách ca",
      bang: {
        headers: ["Tên ca (chọn ở cột CLB đăng ký)", "Lịch học", "Khối", "Phòng", "Giáo viên"],
        widths: [42, 22, 12, 18, 24],
        rows: caHoc.map((ca) => [ca.nhan, ca.lich || "", (ca.khoi || []).join(", "), ca.phong || "", ca.giaoVien || ""]),
      },
    });
  }
  return { fileName: "mau-xep-lop-clb.xlsx", sheets };
}

/* ------------------------------------------------------------------ 4 */

function mauTaiKhoanNhaTruong({ tenMien = "hoangmaistarschool.edu.vn" } = {}) {
  const columns = [
    { header: "Email", required: true, width: 38, prompt: nhac("Email (bắt buộc)", `Email Microsoft 365 của nhà trường dùng để đăng nhập, dạng ten@${tenMien}. Mỗi người một dòng, không trùng. Không dán kèm "mailto:".`) },
    { header: "Họ và tên", required: true, width: 28, prompt: nhac("Họ và tên (bắt buộc)", "Họ và tên đầy đủ trong MỘT ô, nên ghi đúng như tên trên Microsoft 365.") },
    { header: "Vai trò", required: true, width: 20, validation: { type: "list", values: ["Giáo vụ", "Quản trị vận hành"] }, prompt: nhac("Vai trò (bắt buộc)", "Chọn Giáo vụ hoặc Quản trị vận hành.") },
  ];
  return {
    fileName: "mau-tai-khoan-nha-truong.xlsx",
    sheets: [
      { name: "Tài khoản", columns },
      huongDan("MẪU NHẬP TÀI KHOẢN NHÀ TRƯỜNG",
        { tieuDe: "Dùng ở đâu", dong: [
          "Trang \"Tài khoản nhà trường\" (chỉ quản trị cao nhất thấy) → \"Nhập hàng loạt từ tệp\" → chọn file này → rà soát → \"Ghi vào hệ thống\".",
          "Người được nhập đăng nhập được bằng Microsoft 365 ngay. Nhập lại cùng file không tạo trùng.",
        ] },
        { tieuDe: "Cách điền", dong: [
          `Email: đúng địa chỉ đăng nhập Microsoft 365, đuôi @${tenMien}. Email cá nhân hoặc tên miền khác bị từ chối.`,
          "Vai trò: Giáo vụ (nhập danh mục CLB, xem báo cáo, danh sách lớp) hoặc Quản trị vận hành (thêm duyệt đơn, đồng bộ danh bạ, mã kích hoạt, xuất dữ liệu).",
          "Một dòng sai là cả file chưa ghi được: sửa hết các dòng được liệt kê rồi chọn lại file.",
          "Nhập không bật lại tài khoản đã vô hiệu hoá và không cấp được quyền quản trị cao nhất.",
        ] },
        { tieuDe: "Quy tắc chung", dong: CHUNG }),
    ],
  };
}

export const BIEU_MAU = {
  "danh-muc-clb": { ten: "Danh mục CLB & ca học", tao: mauDanhMucClb },
  "danh-ba-hoc-sinh": { ten: "Danh bạ học sinh & phụ huynh", tao: mauDanhBaHocSinh },
  "xep-lop-clb": { ten: "Xếp học sinh vào lớp CLB", tao: mauXepLopClb },
  "tai-khoan-nha-truong": { ten: "Tài khoản nhà trường", tao: mauTaiKhoanNhaTruong },
};

/** Định nghĩa một biểu mẫu (để kiểm thử đọc lại tiêu đề) — không ghi file. */
export function dinhNghiaBieuMau(khoa, tuyChon = {}) {
  const mau = BIEU_MAU[khoa];
  if (!mau) return null;
  return mau.tao(tuyChon);
}

/** @returns {{ fileName: string, buffer: Buffer } | null} */
export function taoBieuMau(khoa, tuyChon = {}) {
  const dinhNghia = dinhNghiaBieuMau(khoa, tuyChon);
  if (!dinhNghia) return null;
  return { fileName: dinhNghia.fileName, buffer: taoXlsx({ sheets: dinhNghia.sheets }) };
}
