const state = {
  me: null,
  role: "parent",
  page: "home",
  studentId: null,
  cart: [],
  registrations: [],
  filters: { search: "", category: "all", availability: "all" },
  adminStatus: "all",
  // Danh sách lớp mặc định chỉ hiện các em ĐÃ ĐÓNG PHÍ — đó mới là danh sách
  // giáo viên cầm đi điểm danh. Bật sang "kèm chưa đóng phí" là việc của giáo vụ.
  rosterOnlyPaid: true,
  rosterSearch: "",
  rosterPage: 1,
  rosterPageSize: 10,
  rosterDetailId: null,
  rosterTab: "hoc-sinh",
  dashboard: null,
  sheetIntegration: null,
  sheetPreview: null,
  excelImport: null,
  catalog: null,
  catalogPeriodId: null,
  importDraft: null,
  period: null,
  demoAccounts: false,
  schoolAccounts: null,
  schoolAccountSearch: "",
  schoolAccountImport: null,
  schoolAccountImportPayload: null,
  accountLookup: null,
  accountLookupInput: "",
  lastBackup: null,
};

let students = [];
let clubs = [];
let adminApplications = [];
let selectedLoginRole = "parent";

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    // Máy chủ bị cắt giữa chừng sẽ trả HTML chứ không phải JSON; nêu rõ mã lỗi để còn lần ra nguyên nhân.
    const fallback = [504, 502, 408].includes(response.status)
      ? `Máy chủ xử lý quá lâu và bị ngắt (lỗi ${response.status}). Hãy thử lại; nếu vẫn vậy thì dữ liệu nguồn quá lớn cho một lần chạy.`
      : response.status >= 500
        ? `Máy chủ gặp sự cố (lỗi ${response.status}). Vui lòng thử lại sau ít phút.`
        : `Yêu cầu không được chấp nhận (lỗi ${response.status}).`;
    const error = new Error(payload?.error?.message || fallback);
    error.status = response.status;
    error.code = payload?.error?.code;
    error.details = payload?.error?.details;
    throw error;
  }
  return payload;
}

const parentNav = [
  { section: "Dành cho gia đình" },
  { id: "home", label: "Tổng quan", icon: "home" },
  { id: "clubs", label: "Khám phá CLB", icon: "grid" },
  { id: "registrations", label: "Đăng ký của tôi", icon: "clipboard", badge: 1 },
  { id: "schedule", label: "Lịch học", icon: "calendar" },
  { section: "Tài khoản" },
  { id: "account", label: "Đổi mật khẩu", icon: "settings" },
  { section: "Hỗ trợ" },
  { id: "support", label: "Yêu cầu hỗ trợ", icon: "help" },
];

// Mỗi mục gắn với một QUYỀN. Giáo vụ sẽ không thấy những mục mình không dùng
// được, thay vì bấm vào rồi nhận lỗi 403.
const adminNav = [
  { section: "Vận hành" },
  { id: "dashboard", label: "Dashboard", icon: "home", cap: "bao-cao" },
  { id: "campaigns", label: "Đợt đăng ký", icon: "calendar", cap: "danh-muc" },
  { id: "classes", label: "CLB & lịch học", icon: "grid", cap: "danh-muc" },
  { id: "applications", label: "Đơn đăng ký", icon: "clipboard", badge: 12, cap: "duyet-don" },
  { id: "rosters", label: "Danh sách lớp CLB", icon: "users", cap: "danh-sach-van-hanh" },
  { section: "Quản trị" },
  { id: "reports", label: "Báo cáo & xuất file", icon: "chart", cap: "danh-sach-van-hanh" },
  { id: "accounts", label: "Tài khoản nhà trường", icon: "settings", cap: "quan-ly-tai-khoan" },
  { id: "structure", label: "Cấu trúc hệ thống", icon: "file" },
  { id: "settings", label: "Cấu hình & phân quyền", icon: "settings", cap: "tra-cuu-ho-tro" },
];

const pageMeta = {
  home: ["Tổng quan", "Học kỳ I · 2026–2027"], clubs: ["Khám phá câu lạc bộ", "Dành cho phụ huynh"],
  registrations: ["Đăng ký của tôi", "Theo dõi trạng thái"], schedule: ["Lịch học", "Lịch cá nhân của học sinh"],
  account: ["Tài khoản của tôi", "Bảo mật đăng nhập"],
  support: ["Yêu cầu hỗ trợ", "Trung tâm trợ giúp"], dashboard: ["Dashboard vận hành", "Cập nhật lúc 16:00 · 18/08/2026"],
  campaigns: ["Đợt đăng ký", "Học kỳ I · 2026–2027"], classes: ["CLB & lịch học", "Quản lý danh mục và quota"],
  applications: ["Đơn đăng ký", "158 bản ghi trong đợt hiện tại"], rosters: ["Danh sách lớp CLB", "Xếp lớp và điểm danh"],
  nhapDangKy: ["Nhập đăng ký hàng loạt", "Chuyển đợt đăng ký cũ vào hệ thống"],
  reports: ["Báo cáo & xuất file", "Trung tâm dữ liệu vận hành"], structure: ["Cấu trúc hệ thống", "Bản đồ module MVP"],
  settings: ["Cấu hình & phân quyền", "Quản trị hệ thống"],
  accounts: ["Tài khoản nhà trường", "Chỉ quản trị cao nhất truy cập được"],
};

// Bản sao của registration-status.mjs cho phía trình duyệt: app.js được nạp bằng
// thẻ <script> thường nên không import được. Kiểm thử tests/vong-doi-don.test.mjs
// so hai bảng với nhau, sửa một bên quên bên kia là test đỏ ngay.
const LIFECYCLE_STATUSES = ["submitted", "waitlist", "payment", "confirmed", "dang_hoc", "hoc_xong"];
const EXCEPTION_STATUSES = ["lui_khai_giang", "khong_khai_giang", "cancelled", "hoan_phi"];
// Chỗ đã có chủ trong lớp: chỉ tính từ khi ĐÃ ĐÓNG PHÍ trở đi.
const SEAT_HOLDING_STATUSES = ["confirmed", "dang_hoc", "hoc_xong", "lui_khai_giang"];
// Đơn còn hiệu lực của học sinh: rộng hơn, gồm cả chưa đóng phí và đang xếp chờ.
// Dùng để chặn đăng ký trùng lớp và trùng khung giờ.
const ACTIVE_REGISTRATION_STATUSES = ["submitted", "waitlist", "payment", "confirmed", "dang_hoc", "hoc_xong", "lui_khai_giang"];

const statusMap = {
  submitted: ["Đăng ký", "blue"],
  waitlist: ["Xếp chờ", "purple"],
  payment: ["Chờ thanh toán", "gold"],
  confirmed: ["Đã đóng phí", "green"],
  dang_hoc: ["Đang học", "green"],
  hoc_xong: ["Học xong", "blue"],
  lui_khai_giang: ["Lùi khai giảng", "gold"],
  khong_khai_giang: ["Không khai giảng", "red"],
  cancelled: ["Lớp hủy", "red"],
  hoan_phi: ["Hoàn phí", "red"],
  draft: ["Bản nháp", "blue"],
  conflict: ["Trùng lịch", "red"],
};

// Rã mảng thẳng từ statusMap[status] sẽ ném TypeError khi gặp một trạng thái chưa
// khai — và ba chỗ trong tệp này từng làm đúng như vậy, nghĩa là một đơn mang
// trạng thái mới đủ làm trắng cả trang. Đi qua hàm này thì tệ nhất chỉ là nhãn xấu.
const statusBadge = (status) => statusMap[status] || [String(status || "—"), "blue"];

// Bản sao của schedule-conflict.mjs cho trình duyệt: app.js nạp bằng thẻ <script>
// thường nên không import được. Kiểm thử tests/trung-lich.test.mjs so hai bên với
// nhau, sửa một bên quên bên kia là test đỏ ngay.
function intervalsOverlap(a, b) {
  const thu = (value) => (value === null || value === undefined || value === "" ? NaN : Number(value));
  const thuA = thu(a?.dayOfWeek);
  const thuB = thu(b?.dayOfWeek);
  if (!Number.isFinite(thuA) || !Number.isFinite(thuB) || thuA !== thuB) return false;
  const gio = (value) => String(value ?? "");
  if (!gio(a?.startTime) || !gio(a?.endTime) || !gio(b?.startTime) || !gio(b?.endTime)) return false;
  return gio(a.startTime) < gio(b.endTime) && gio(b.startTime) < gio(a.endTime);
}

function conflictMessage(moi, cu, { daDangKy = true } = {}) {
  const lich = String(cu?.schedule || moi?.schedule || "").trim();
  const khoangGio = lich ? ` vào ${lich}` : "";
  const tenMoi = String(moi?.name || "CLB vừa chọn");
  const tenCu = String(cu?.name || "một CLB khác");
  return daDangKy
    ? `Con đã đăng ký “${tenCu}”${khoangGio}. “${tenMoi}” trùng đúng khoảng giờ này, vui lòng chọn ca khác.`
    : `“${tenMoi}” trùng giờ với “${tenCu}”${khoangGio} đang có trong giỏ đăng ký.`;
}

function conflictBadge(cu) {
  const lich = String(cu?.schedule || "").trim();
  return lich ? `Trùng giờ với “${cu.name}” (${lich})` : `Trùng giờ với “${cu?.name || "CLB đã đăng ký"}”`;
}

// Đơn đã gửi tự mang theo thứ, giờ và nhãn lịch của chính nó (listRegistrations trả
// về), nên đối chiếu thẳng trên đơn thay vì tra ngược sang danh mục CLB đang hiển
// thị. Tra ngược sẽ hụt khi lớp đã đăng ký không còn trong danh mục của đợt này —
// và hụt nghĩa là phụ huynh không được cảnh báo.
function donDaGuiCuaCon() {
  return state.registrations
    .filter((registration) => registration.studentId === state.studentId
      && ACTIVE_REGISTRATION_STATUSES.includes(registration.status))
    .map((registration) => ({
      id: registration.classId,
      clubId: registration.clubId,
      name: registration.club,
      schedule: registration.schedule,
      dayOfWeek: registration.dayOfWeek,
      startTime: registration.startTime,
      endTime: registration.endTime,
    }));
}

// Tìm CLB đang vướng giờ với CLB được xét. Ưu tiên báo cái ĐÃ ĐĂNG KÝ trước, vì đó
// là ràng buộc phụ huynh không tự gỡ được; cái trong giỏ thì chỉ cần bỏ chọn.
function findScheduleConflict(club) {
  const daGui = donDaGuiCuaCon().find((don) => don.id !== club.id && intervalsOverlap(don, club));
  if (daGui) return { doiThu: daGui, daDangKy: true };
  const trongGio = state.cart
    .filter((id) => id !== club.id)
    .map((id) => clubs.find((item) => item.id === id))
    .find((item) => item && intervalsOverlap(item, club));
  return trongGio ? { doiThu: trongGio, daDangKy: false } : null;
}
// Mọi lý do khiến thẻ CLB không bấm được, gom về một chỗ để hiện NGAY trên thẻ.
// Trước đây phụ huynh phải bấm rồi mới biết mình đã đăng ký ca đó — thẻ vẫn mời
// "Chọn" như thường.
function findCardWarning(club) {
  const daGui = donDaGuiCuaCon();
  if (daGui.some((don) => don.id === club.id)) {
    return { nhan: "Con đã đăng ký chính ca này", nut: "Đã đăng ký" };
  }
  const khacCa = daGui.find((don) => don.clubId && don.clubId === club.clubId);
  if (khacCa) {
    const lich = String(khacCa.schedule || "").trim();
    return { nhan: `Con đã đăng ký một ca khác của CLB này${lich ? ` (${lich})` : ""}`, nut: "Đã đăng ký" };
  }
  const vuongGio = findScheduleConflict(club);
  return vuongGio ? { nhan: conflictBadge(vuongGio.doiThu), nut: "Trùng giờ" } : null;
}

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const icon = (name, className = "icon") => `<svg class="${className}"><use href="#i-${name}"></use></svg>`;
const formatMoney = (value) => new Intl.NumberFormat("vi-VN").format(value) + " đ";
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const student = () => students.find((item) => item.id === state.studentId);
const gradeNumber = () => student()?.gradeNumber || Number(student()?.grade.match(/\d+/)?.[0] || 0);

function normalizeStudent(item) {
  return { ...item, gradeNumber: item.grade, grade: item.gradeLabel || `Lớp ${item.homeroom}` };
}

function showScreen(screen) {
  const showApplication = screen === "application";
  const loginScreen = $("#login-screen");
  const appShell = $("#app-shell");
  loginScreen.hidden = showApplication;
  appShell.hidden = !showApplication;
  loginScreen.classList.toggle("hidden", showApplication);
  appShell.classList.toggle("hidden", !showApplication);
}

async function hydrateRole() {
  state.cart = [];
  state.filters = { search: "", category: "all", availability: "all" };
  if (state.role === "parent") {
    const studentPayload = await api("/students");
    students = studentPayload.students.map(normalizeStudent);
    state.studentId = students.some((item) => item.id === state.studentId) ? state.studentId : students[0]?.id;
    const [clubPayload, registrationPayload] = await Promise.all([
      api(`/clubs?studentId=${encodeURIComponent(state.studentId)}`),
      api("/registrations"),
    ]);
    clubs = clubPayload.clubs;
    state.period = clubPayload.period || null;
    state.registrations = registrationPayload.registrations;
    state.dashboard = null;
    state.catalog = null;
    adminApplications = [];
  } else {
    const [clubPayload, registrationPayload, dashboardPayload, sheetPayload] = await Promise.all([
      api("/clubs"), api("/registrations"), api("/admin/dashboard"),
      hasCap("dong-bo-danh-ba") ? api("/admin/integrations/google-sheets") : Promise.resolve(null),
      refreshCatalog(),
    ]);
    clubs = clubPayload.clubs;
    adminApplications = registrationPayload.registrations;
    state.dashboard = dashboardPayload.dashboard;
    state.period = clubPayload.period || null;
    state.sheetIntegration = sheetPayload?.integration || null;
    await loadSchoolAccounts();
    state.sheetPreview = null;
    state.importDraft = null;
    state.registrations = [];
    students = [];
    state.studentId = null;
  }
}

function applyDemoVisibility() {
  $(".role-switcher")?.classList.toggle("hidden", !state.demoAccounts);
  $("#credential-box")?.classList.toggle("hidden", !state.demoAccounts);
  if (!state.demoAccounts) {
    $("#login-account").value = "";
    $("#login-password").value = "";
  }
}

// Một nguồn sự thật duy nhất cho việc màn hình đăng nhập hiện gì theo cổng đang
// chọn. Cả lúc mở màn hình lẫn lúc bấm đổi cổng đều gọi hàm này.
function applyLoginRoleView() {
  const parent = selectedLoginRole === "parent";
  $("#local-login-fields").classList.toggle("hidden", !parent);
  $("#login-submit").classList.toggle("hidden", !parent);
  $("#microsoft-login").classList.toggle("hidden", parent);
  $("#credential-box").classList.toggle("hidden", !parent || !state.demoAccounts);
  // Khối liên hệ Phòng Tuyển sinh chỉ có nghĩa với phụ huynh.
  $("#login-help")?.classList.toggle("hidden", !parent);
  $("#login-intro").textContent = parent
    ? "Đăng nhập bằng số điện thoại đã đăng ký với nhà trường để chọn câu lạc bộ cho con."
    : "Cán bộ nhà trường đăng nhập bằng tài khoản Microsoft 365 @hoangmaistarschool.edu.vn đã được cấp quyền.";
}

function showLogin(message = "") {
  showScreen("login");
  $(".login-role-tabs").classList.remove("hidden");
  $("#password-change-panel").classList.add("hidden");
  applyLoginRoleView();
  $("#login-error").textContent = message;
}

function showInitialPasswordChange(user) {
  state.me = user;
  showScreen("login");
  $(".login-role-tabs").classList.add("hidden");
  $("#local-login-fields").classList.add("hidden");
  $("#login-submit").classList.add("hidden");
  $("#microsoft-login").classList.add("hidden");
  $("#credential-box").classList.add("hidden");
  $("#login-help")?.classList.add("hidden");
  $("#password-change-panel").classList.remove("hidden");
  $("#login-intro").textContent = `Xin chào ${user.displayName}. Đây là lần đăng nhập đầu tiên của tài khoản.`;
  $("#login-error").textContent = "";
  $("#new-password").focus();
}

async function enterApplication(user) {
  state.me = user;
  state.role = user.role;
  state.page = state.role === "parent" ? "home" : "dashboard";
  await hydrateRole();
  showApplication();
  renderApp();
}

function showApplication() {
  showScreen("application");
}

async function login(account, password) {
  const submit = $("#login-submit");
  submit.disabled = true;
  submit.textContent = "Đang đăng nhập...";
  $("#login-error").textContent = "";
  try {
    const payload = await api("/auth/login", { method: "POST", body: JSON.stringify({ account, password }) });
    if (payload.user.mustChangePassword) showInitialPasswordChange(payload.user);
    else await enterApplication(payload.user);
  } catch (error) {
    showLogin(error.message);
  } finally {
    submit.disabled = false;
    submit.textContent = "Đăng nhập →";
  }
}

async function switchRole(role) {
  const credentials = role === "parent"
    ? ["0901234567", "123456"]
    : ["admin@nshm.edu.vn", "Admin@123"];
  await login(...credentials);
  toast(role === "parent" ? "Đã chuyển sang cổng Phụ huynh." : "Đã chuyển sang cổng Nhà trường.");
}

async function logout() {
  try { await api("/auth/logout", { method: "POST", body: "{}" }); } catch {}
  state.me = null;
  showLogin();
}

const SSO_DENIAL_MESSAGE = "Tài khoản của bạn chưa được kích hoạt, liên hệ với bộ phận CNTT.";

// Luồng SSO quay về bằng chuyển hướng chứ không phải lời gọi API, nên lý do bị
// từ chối đi kèm trong địa chỉ. Hiện nó ngay trên màn hình đăng nhập; để nguyên
// một trang JSON thô là cách chắc chắn làm người dùng hoảng.
function showSsoOutcome() {
  const params = new URLSearchParams(window.location.search);
  const outcome = params.get("sso");
  if (!outcome) return;
  // Dọn địa chỉ để tải lại trang không hiện lại thông báo cũ.
  window.history.replaceState({}, "", window.location.pathname);
  if (outcome === "success") return;
  const box = $("#login-error");
  if (box) box.textContent = SSO_DENIAL_MESSAGE;
}

async function boot() {
  bindLoginEvents();
  bindGlobalEvents();
  // Chỉ nền dữ liệu phát triển mới có tài khoản minh họa; production ẩn hẳn các lối tắt này.
  try {
    state.demoAccounts = Boolean((await api("/health")).demoAccounts);
  } catch {
    state.demoAccounts = false;
  }
  applyDemoVisibility();
  try {
    const payload = await api("/me");
    if (payload.user.mustChangePassword) showInitialPasswordChange(payload.user);
    else await enterApplication(payload.user);
  } catch {
    showLogin();
  }
  showSsoOutcome();
}

function renderApp() {
  applyDemoVisibility();
  renderNav();
  renderHeader();
  renderPage();
  if (state.role === "parent") renderCart();
  else closeCart();
}

function renderNav() {
  const nav = (state.role === "parent" ? parentNav : adminNav)
    .filter((item) => !item.cap || hasCap(item.cap));
  $("#main-nav").innerHTML = nav.map((item) => {
    if (item.section) return `<div class="nav-section">${item.section}</div>`;
    const badge = item.id === "registrations" ? state.registrations.length : item.id === "applications" ? state.dashboard?.needAction : item.badge;
    return `<button class="nav-link ${state.page === item.id ? "active" : ""}" data-page="${item.id}">
      ${icon(item.icon)}<span>${item.label}</span>${badge ? `<b class="nav-badge">${badge}</b>` : ""}
    </button>`;
  }).join("");
  $$(".role-button").forEach((button) => button.classList.toggle("active", button.dataset.role === state.role));
}

// Phụ đề trên thanh tiêu đề lấy theo dữ liệu đang có, không ghi cứng theo năm học.
function pageContext(page, fallback) {
  const period = state.role === "parent"
    ? state.period
    : state.catalog?.periods.find((item) => item.id === state.catalog.activePeriodId) || null;
  const periodLabel = period ? `${period.term} · ${period.schoolYear}` : "Chưa có đợt đăng ký đang mở";
  if (["home", "clubs", "registrations", "schedule", "dashboard", "campaigns"].includes(page)) return periodLabel;
  if (page === "classes") return `${state.catalog?.clubs.length || 0} CLB · ${state.catalog?.classes.length || 0} lớp`;
  if (page === "applications") return `${adminApplications.length} đơn trong hệ thống`;
  if (page === "rosters") return state.period ? `${clubs.length} ca học trong đợt` : `${clubs.length} ca học · chưa có đợt nào đang mở`;
  return fallback;
}

function renderHeader() {
  const [title, context] = pageMeta[state.page] || ["NSHM Clubs", "Cổng đăng ký ngoại khóa"];
  $("#page-title").textContent = title;
  $("#topbar-context").textContent = pageContext(state.page, context);
  const staff = state.role !== "parent";
  $("#profile-name").textContent = state.me?.displayName || (staff ? "Nhà trường" : "Phụ huynh");
  $("#profile-role").textContent = state.me?.roleLabel || (staff ? "Nhà trường" : "Phụ huynh");
  $("#profile-avatar").textContent = (state.me?.displayName || "NS").split(" ").slice(-2).map((part) => part[0]).join("").toUpperCase();
  $("#cart-button").style.display = staff ? "none" : "flex";
  $("#cart-count").textContent = state.cart.length;
}

function renderPage() {
  const pages = {
    home: renderParentHome, clubs: renderClubsPage, registrations: renderRegistrations,
    schedule: renderSchedule, account: renderAccount, support: renderSupport, dashboard: renderAdminDashboard,
    campaigns: renderCampaigns, classes: renderClasses, applications: renderApplications,
    rosters: renderRosters, reports: renderReports, structure: renderStructure, settings: renderSettings,
    nhapDangKy: renderNhapDangKy,
    accounts: renderSchoolAccounts,
  };
  $("#page-content").innerHTML = (pages[state.page] || renderParentHome)();
  bindPageEvents();
}

function renderParentHome() {
  const recommendations = eligibleClubs().slice(0, 3);
  const open = Boolean(state.period);
  return `
    ${renderPeriodNotice()}
    <section class="hero">
      <div class="hero-content">
        <span class="eyebrow">${open ? escapeHtml(state.period.name) : "Ngoại khóa NSHM"}</span>
        <h2>Khám phá điều con yêu thích ngoài giờ học.</h2>
        <p>${open
          ? "Chọn học sinh, xem CLB phù hợp và hoàn tất đăng ký trong một quy trình có kiểm tra lịch, sĩ số và điều kiện."
          : "Đợt đăng ký tiếp theo chưa mở. Bạn vẫn có thể xem lại các đăng ký đã gửi và lịch học hiện tại."}</p>
        <div class="hero-actions">
          ${open ? `<button class="button button-light" data-go="clubs">Khám phá CLB ${icon("arrow")}</button>` : ""}
          <button class="button button-ghost-light" data-go="registrations">Xem đăng ký của tôi</button>
        </div>
      </div>
      ${renderPeriodSide()}
    </section>

    <section class="section">
      <div class="section-head"><div><span class="eyebrow">Hồ sơ học sinh</span><h2>Đăng ký cho con nào?</h2><p>CLB sẽ được lọc tự động theo khối và cấp học.</p></div></div>
      <div class="grid grid-3">${students.map(renderChildCard).join("")}<button class="child-card add-child" data-toast="Dữ liệu học sinh được đồng bộ từ hệ thống nhà trường."><b>+</b><span>Liên hệ trường để bổ sung học sinh</span></button></div>
    </section>

    <section class="section">
      <div class="section-head"><div><span class="eyebrow">Hành trình đăng ký</span><h2>4 bước rõ ràng</h2></div></div>
      ${renderSteps(2)}
    </section>

    <section class="section">
      <div class="section-head">
        <div><span class="eyebrow">Gợi ý cho ${student().name}</span><h2>CLB phù hợp</h2><p>Dựa trên ${student().grade} và tình trạng còn chỗ.</p></div>
        ${recommendations.length ? `<button class="text-button" data-go="clubs">Xem tất cả ${icon("arrow")}</button>` : ""}
      </div>
      ${recommendations.length
        ? `<div class="grid grid-3">${recommendations.map(renderClubCard).join("")}</div>`
        : `<div class="panel empty-state"><div class="empty-icon">${icon("grid")}</div><h3>Chưa có CLB nào để hiển thị</h3><p>${open ? "Đợt hiện tại chưa có CLB phù hợp với khối của học sinh." : "Danh mục sẽ hiện khi nhà trường mở đợt đăng ký mới."}</p></div>`}
    </section>`;
}

function renderChildCard(item) {
  const selected = item.id === state.studentId;
  return `<button class="child-card ${selected ? "selected" : ""}" data-student="${item.id}">
    <div class="child-avatar child-${item.color}">${item.short}</div>
    <div class="child-copy"><strong>${item.name}</strong><span>${item.grade} · ${item.level}</span></div>
    ${selected ? `<span class="selected-check">${icon("check")}</span>` : ""}
  </button>`;
}

function renderSteps(current) {
  const items = [["Chọn học sinh","Đúng hồ sơ"],["Chọn CLB","Theo điều kiện"],["Kiểm tra","Lịch & sĩ số"],["Xác nhận","Nhận mã đơn"]];
  return `<div class="step-strip">${items.map((item, index) => `<div class="step-item ${index + 1 < current ? "done" : index + 1 === current ? "current" : ""}">
    <span class="step-number">${index + 1 < current ? icon("check") : index + 1}</span><div class="step-copy"><strong>${item[0]}</strong><span>${item[1]}</span></div>
  </div>`).join("")}</div>`;
}

function eligibleClubs() {
  const grade = gradeNumber();
  return clubs.filter((club) => club.grade.includes(grade));
}

function filteredClubs() {
  return eligibleClubs().filter((club) => {
    const matchesSearch = club.name.toLowerCase().includes(state.filters.search.toLowerCase()) || club.category.toLowerCase().includes(state.filters.search.toLowerCase());
    const matchesCategory = state.filters.category === "all" || club.category === state.filters.category;
    const open = club.enrolled < club.capacity;
    const matchesAvailability = state.filters.availability === "all" || (state.filters.availability === "open" && open) || (state.filters.availability === "full" && !open);
    return matchesSearch && matchesCategory && matchesAvailability;
  });
}

function renderClubsPage() {
  const list = filteredClubs();
  return `
    ${renderPeriodNotice()}
    <div class="demo-banner"><span><strong>Học sinh đang chọn: ${student().name}</strong> · ${student().grade}. Hệ thống chỉ hiển thị CLB phù hợp.</span><button class="text-button" data-go="home">Đổi học sinh</button></div>
    <section>${renderSteps(2)}</section>
    <section class="section">
      <div class="filters">
        <label class="search-field">${icon("search")}<input id="club-search" type="search" value="${state.filters.search}" placeholder="Tìm tên CLB hoặc nhóm môn..." /></label>
        <select id="category-filter" class="select-field" aria-label="Nhóm môn">
          <option value="all">Tất cả nhóm môn</option>${[...new Set(eligibleClubs().map(c => c.category))].map(value => `<option ${state.filters.category === value ? "selected" : ""}>${value}</option>`).join("")}
        </select>
        <select id="availability-filter" class="select-field" aria-label="Tình trạng chỗ">
          <option value="all">Tất cả sĩ số</option><option value="open" ${state.filters.availability === "open" ? "selected" : ""}>Còn chỗ</option><option value="full" ${state.filters.availability === "full" ? "selected" : ""}>Đã đầy</option>
        </select>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><div><span class="eyebrow">${list.length} kết quả phù hợp</span><h2>Danh mục CLB</h2></div><button class="button button-secondary" data-open-cart>${icon("cart")} Giỏ đăng ký (${state.cart.length})</button></div>
      ${list.length
        ? `<div class="grid grid-3">${list.map(renderClubCard).join("")}</div>`
        : !state.period
          ? `<div class="panel empty-state"><div class="empty-icon">${icon("calendar")}</div><h3>Chưa đến kỳ đăng ký</h3><p>Nhà trường chưa mở đợt đăng ký nào. Danh mục CLB sẽ hiển thị ngay khi đợt mới được mở.</p></div>`
          : `<div class="panel empty-state"><div class="empty-icon">${icon("search")}</div><h3>Không tìm thấy CLB</h3><p>Hãy thử thay đổi từ khóa hoặc bộ lọc sĩ số.</p><button class="button button-secondary" data-clear-filters>Xóa bộ lọc</button></div>`}
    </section>`;
}

function renderClubCard(club) {
  const left = club.capacity - club.enrolled;
  const ratio = Math.round((club.enrolled / club.capacity) * 100);
  // Số đơn đã đăng ký nhưng chưa đóng phí. Chỗ chỉ được giữ khi đóng phí, nên con
  // số này KHÔNG trừ vào sĩ số — nhưng giấu nó đi thì "Còn 5 chỗ" là nói dối phụ
  // huynh đang xếp sau 30 gia đình khác.
  const dangCho = Number(club.pending || 0);
  const statusClass = left <= 0 ? "full" : left <= 3 ? "warning" : "";
  const statusText = left <= 0 ? "Đã đầy · Có DS chờ" : left <= 3 ? `Chỉ còn ${left} chỗ` : `Còn ${left} chỗ`;
  const inCart = state.cart.includes(club.id);
  // Báo trùng giờ NGAY TRÊN THẺ, không đợi phụ huynh bấm rồi mới biết. Nhà trường
  // yêu cầu nói rõ vướng CLB nào và vào khoảng giờ nào.
  const canhBao = inCart ? null : findCardWarning(club);
  return `<article class="club-card">
    <div class="club-visual visual-${club.visual}"><span class="club-status ${statusClass}">${statusText}</span><span class="club-symbol">${club.emoji}</span></div>
    <div class="club-body">
      <span class="category">${club.category}${club.className ? ` · ${escapeHtml(club.className)}` : ""}</span><h3>${escapeHtml(club.name)}</h3>
      <div class="club-meta"><span>${icon("clock")}${club.schedule}</span><span>${icon("pin")}${club.room} · ${club.teacher}</span></div>
      ${canhBao ? `<p class="club-conflict">${icon("clock")}${escapeHtml(canhBao.nhan)}</p>` : ""}
      <div class="capacity"><div class="capacity-head"><span>Sĩ số đã đóng phí</span><strong>${club.enrolled}/${club.capacity}</strong></div><div class="capacity-track ${statusClass}"><span style="width:${ratio}%"></span></div>${dangCho > 0 ? `<p class="capacity-pending">${dangCho} đơn đã đăng ký nhưng chưa giữ chỗ · chỗ chỉ được giữ khi đã đóng phí</p>` : ""}</div>
      <div class="club-price"><div><strong>${formatMoney(club.fee)}</strong><small>/ học kỳ</small></div><div class="club-actions"><button class="button button-secondary" data-detail="${club.id}">Chi tiết</button><button class="button button-primary" data-add="${club.id}" ${inCart || canhBao ? "disabled" : ""}>${inCart ? "Đã chọn" : canhBao ? canhBao.nut : left <= 0 ? "Vào DS chờ" : "Chọn"}</button></div></div>
    </div>
  </article>`;
}

function renderRegistrations() {
  const currentRegistrations = state.registrations.filter((registration) => registration.studentId === state.studentId);
  const rows = currentRegistrations.map((registration) => {
    // Đơn tham chiếu tới ca học (classId); danh mục cũng được đánh mã theo ca.
    const club = clubs.find(c => c.id === registration.classId);
    const [label, color] = statusBadge(registration.status);
    const room = registration.room && registration.room !== "—" ? registration.room : club?.room || "";
    const teacher = registration.teacher && registration.teacher !== "—" ? registration.teacher : club?.teacher || "";
    return `<div class="application-card"><div class="application-icon">${icon("clipboard")}</div>
      <div class="application-copy"><h3>${escapeHtml(club?.name || registration.club)}${registration.classLabel ? ` · ${escapeHtml(registration.classLabel)}` : ""}</h3>
      <p>${registration.id} · ${escapeHtml(student().name)} · ${escapeHtml(registration.schedule || club?.schedule || "")}${room ? ` · ${escapeHtml(room)}` : ""}${teacher ? ` · ${escapeHtml(teacher)}` : ""}</p>
      <p class="field-hint">${escapeHtml(STATUS_GUIDE[registration.status] || "")}</p></div>
      <div class="application-meta"><span class="badge badge-${color}">${label}</span><strong>${formatMoney(registration.amount || club?.fee || 0)}</strong></div></div>`;
  }).join("");
  return `
    <div class="kpi-strip"><div class="kpi-item"><span>Tổng đăng ký</span><strong>${currentRegistrations.length}</strong></div><div class="kpi-item"><span>Đã đóng phí</span><strong>${currentRegistrations.filter(r => r.status === "confirmed").length}</strong></div><div class="kpi-item"><span>Đang học</span><strong>${currentRegistrations.filter(r => r.status === "dang_hoc").length}</strong></div><div class="kpi-item"><span>Xếp chờ</span><strong>${currentRegistrations.filter(r => r.status === "waitlist").length}</strong></div></div>
    <section class="section"><div class="section-head"><div><span class="eyebrow">Theo dõi theo thời gian thực</span><h2>Đăng ký của ${student().name}</h2><p>Trạng thái được cập nhật sau khi nhà trường xử lý hoặc đối soát phí.</p></div><button class="button button-primary" data-go="clubs">+ Đăng ký thêm</button></div>
    <div class="grid">${rows || `<div class="panel empty-state"><div class="empty-icon">${icon("clipboard")}</div><h3>Chưa có đăng ký</h3><p>Khám phá danh mục CLB phù hợp để bắt đầu.</p></div>`}</div></section>
    <section class="section"><div class="info-note"><strong>Quy ước trạng thái:</strong> “Đăng ký” chưa đồng nghĩa với có tên trong danh sách chính thức. Đăng ký chỉ được chốt khi đạt điều kiện xác nhận/đối soát theo quy định của nhà trường.</div></section>`;
}

/* ---------- Cổng phụ huynh: đợt đăng ký, hạn nộp và thời khóa biểu ---------- */

const DAY_MS = 24 * 60 * 60 * 1000;

// Mọi mốc thời gian lấy từ cấu hình đợt trên máy chủ, không phụ thuộc đồng hồ thiết bị.
function periodCountdown() {
  const period = state.period;
  if (!period) return null;
  const now = Date.now();
  const openAt = new Date(period.openAt).getTime();
  const closeAt = new Date(period.closeAt).getTime();
  const remaining = closeAt - now;
  return {
    period,
    remainingDays: Math.max(0, Math.ceil(remaining / DAY_MS)),
    remainingHours: Math.max(0, Math.ceil(remaining / (60 * 60 * 1000))),
    progress: Math.min(100, Math.max(0, Math.round(((now - openAt) / Math.max(1, closeAt - openAt)) * 100))),
    closingSoon: remaining <= 3 * DAY_MS,
  };
}

function remainingLabel(countdown) {
  if (countdown.remainingDays > 1) return `Còn ${countdown.remainingDays} ngày`;
  if (countdown.remainingHours > 1) return `Còn ${countdown.remainingHours} giờ`;
  return "Sắp hết hạn";
}

function renderPeriodSide() {
  const countdown = periodCountdown();
  if (!countdown) {
    return `<div class="hero-side">
      <div class="period-line"><span>Trạng thái</span><strong>Chưa mở đăng ký</strong></div>
      <div class="progress-track"><span style="width:0%"></span></div>
      <div class="period-foot"><span>Nhà trường sẽ thông báo</span><strong>Theo dõi tại đây</strong></div></div>`;
  }
  return `<div class="hero-side">
    <div class="period-line"><span>Hạn đăng ký</span><strong>${formatDateTime(countdown.period.closeAt)}</strong></div>
    <div class="progress-track"><span style="width:${countdown.progress}%"></span></div>
    <div class="period-foot"><span>${escapeHtml(countdown.period.term)} · ${escapeHtml(countdown.period.schoolYear)}</span><strong>${remainingLabel(countdown)}</strong></div></div>`;
}

function renderPeriodNotice() {
  const countdown = periodCountdown();
  if (!countdown) {
    return `<div class="demo-banner"><span><strong>Hiện chưa có đợt đăng ký nào đang mở.</strong> Bạn vẫn xem được các đăng ký đã gửi trước đó.</span><button class="text-button" data-go="registrations">Xem đăng ký của tôi</button></div>`;
  }
  if (!countdown.closingSoon) return "";
  return `<div class="inline-alert">${icon("clock")}<span>Đợt <b>${escapeHtml(countdown.period.name)}</b> đóng lúc ${formatDateTime(countdown.period.closeAt)} — ${remainingLabel(countdown).toLowerCase()}. Sau thời điểm này hệ thống ngừng nhận đơn mới.</span></div>`;
}

const STATUS_GUIDE = {
  submitted: "Đơn đã được ghi nhận, nhà trường đang xử lý.",
  payment: "Chỗ của con CHƯA được giữ. Chỗ chỉ được giữ khi nhà trường xác nhận đã đóng phí, nên vui lòng hoàn tất học phí sớm.",
  confirmed: "Đã đóng phí và có tên trong danh sách chính thức của lớp.",
  dang_hoc: "Lớp đã khai giảng, con đang theo học.",
  hoc_xong: "Con đã hoàn thành khóa học của lớp này.",
  lui_khai_giang: "Lớp lùi ngày khai giảng, suất học của con vẫn được giữ.",
  khong_khai_giang: "Lớp không đủ điều kiện khai giảng. Nhà trường sẽ liên hệ về phương án thay thế hoặc hoàn phí.",
  hoan_phi: "Nhà trường đã xử lý hoàn phí cho đăng ký này.",
  waitlist: "Lớp đã đủ sĩ số. Nhà trường sẽ liên hệ nếu có chỗ trống. Nếu con đã đóng phí, khoản phí vẫn được giữ nguyên.",
  conflict: "Lịch học bị trùng. Vui lòng gửi yêu cầu hỗ trợ để chọn ca khác.",
  cancelled: "Đơn đã hủy.",
  draft: "Đơn chưa gửi.",
};

function renderSchedule() {
  const active = state.registrations.filter((registration) =>
    registration.studentId === state.studentId && ACTIVE_REGISTRATION_STATUSES.includes(registration.status));
  const entries = active.map((registration) => {
    const clubClass = clubs.find((item) => item.id === registration.classId) || null;
    return {
      registration,
      name: registration.club || clubClass?.name || registration.classId,
      classLabel: registration.classLabel || clubClass?.className || "",
      emoji: clubClass?.emoji || "★",
      room: registration.room !== "—" ? registration.room : clubClass?.room || "",
      teacher: registration.teacher !== "—" ? registration.teacher : clubClass?.teacher || "",
      dayOfWeek: registration.dayOfWeek ?? clubClass?.dayOfWeek ?? null,
      startTime: registration.startTime || clubClass?.startTime || "",
      endTime: registration.endTime || clubClass?.endTime || "",
      schedule: registration.schedule || clubClass?.schedule || "",
    };
  });

  // Tuần bắt đầu từ Thứ 2; Chủ nhật xếp cuối cho đúng thói quen đọc lịch.
  const dayOrder = [1, 2, 3, 4, 5, 6, 0];
  const scheduled = entries.filter((entry) => entry.dayOfWeek !== null);
  const unscheduled = entries.filter((entry) => entry.dayOfWeek === null);
  const columns = dayOrder.map((day) => ({
    day,
    label: DAY_LABELS[day],
    items: scheduled.filter((entry) => entry.dayOfWeek === day).sort((left, right) => left.startTime.localeCompare(right.startTime)),
  }));

  const grid = `<div class="week-grid">${columns.map((column) => `
    <div class="week-day ${column.items.length ? "" : "empty"}">
      <span class="week-day-label">${column.label}</span>
      ${column.items.map((entry) => {
        const [label, color] = statusBadge(entry.registration.status);
        return `<div class="week-slot visual-${clubs.find((item) => item.id === entry.registration.classId)?.visual || "life"}">
          <strong>${entry.startTime}–${entry.endTime}</strong>
          <span>${entry.emoji} ${escapeHtml(entry.name)}${entry.classLabel ? ` · ${escapeHtml(entry.classLabel)}` : ""}</span>
          <small>${escapeHtml(entry.room)}${entry.teacher ? ` · ${escapeHtml(entry.teacher)}` : ""}</small>
          <span class="badge badge-${color}">${label}</span>
        </div>`;
      }).join("") || '<p class="week-empty">—</p>'}
    </div>`).join("")}</div>`;

  const totalHours = scheduled.reduce((sum, entry) => {
    const minutes = (Number(entry.endTime.slice(0, 2)) * 60 + Number(entry.endTime.slice(3))) - (Number(entry.startTime.slice(0, 2)) * 60 + Number(entry.startTime.slice(3)));
    return sum + Math.max(0, minutes);
  }, 0) / 60;

  return `<div class="kpi-strip">
      <div class="kpi-item"><span>Buổi mỗi tuần</span><strong>${scheduled.length}</strong></div>
      <div class="kpi-item"><span>Tổng thời lượng</span><strong>${totalHours ? totalHours.toFixed(1).replace(".0", "") : 0} giờ</strong></div>
      <div class="kpi-item"><span>Đã xác nhận</span><strong>${active.filter((item) => item.status === "confirmed").length}</strong></div>
      <div class="kpi-item"><span>Đang chờ</span><strong>${active.filter((item) => item.status !== "confirmed").length}</strong></div>
    </div>
    <section class="panel"><div class="panel-head">
      <div><h3>Lịch ngoại khóa của ${escapeHtml(student().name)}</h3><p>Lịch lặp hàng tuần trong đợt đang tham gia.</p></div></div>
      <div class="panel-body">
        ${entries.length ? grid : `<div class="empty-state"><div class="empty-icon">${icon("calendar")}</div><h3>Chưa có lịch CLB</h3><p>Sau khi đăng ký được ghi nhận, lịch học sẽ hiện ở đây.</p><button class="button button-primary" data-go="clubs">Khám phá CLB</button></div>`}
        ${unscheduled.length ? `<div class="info-note"><strong>${unscheduled.length} đăng ký chưa có lịch cố định:</strong> ${unscheduled.map((entry) => escapeHtml(entry.name)).join(", ")}.</div>` : ""}
        ${entries.length ? '<p class="field-hint">Buổi học chỉ diễn ra khi đăng ký ở trạng thái “Đã xác nhận”. Các trạng thái khác vẫn hiển thị để phụ huynh sắp xếp trước.</p>' : ""}
      </div></section>`;
}

function renderSupport() {
  const options = state.registrations.filter((item) => item.studentId === state.studentId).map((item) => `<option value="${item.id}">${item.id} · ${item.club}</option>`).join("");
  return `<div class="dashboard-layout"><section class="panel"><div class="panel-head"><div><h3>Gửi yêu cầu hỗ trợ</h3><p>Yêu cầu được chuyển tới CSKH/điều phối CLB.</p></div></div><div class="panel-body">
    <div class="grid grid-2"><label class="search-field"><input id="support-topic" placeholder="Nội dung: đổi lịch, hủy, phí..." /></label><select id="support-registration" class="select-field"><option value="">Chọn đăng ký liên quan</option>${options}</select></div>
    <textarea id="support-message" style="width:100%;min-height:140px;margin-top:12px;padding:12px;border:1px solid var(--line);border-radius:10px" placeholder="Mô tả yêu cầu và thời gian có thể liên hệ..."></textarea>
    <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="button button-primary" data-send-support>Gửi yêu cầu</button></div>
  </div></section><aside class="panel"><div class="panel-head"><div><h3>Kênh hỗ trợ</h3><p>Giờ làm việc 08:00–17:00</p></div></div><div class="panel-body"><div class="attention-list"><div class="attention-item"><span class="attention-dot" style="background:var(--blue)"></span><div class="attention-copy"><strong>Hotline CLB</strong><span>024 7300 6688</span></div></div><div class="attention-item"><span class="attention-dot" style="background:var(--aqua)"></span><div class="attention-copy"><strong>Email</strong><span>clb@nshm.edu.vn</span></div></div><div class="attention-item"><span class="attention-dot" style="background:var(--gold)"></span><div class="attention-copy"><strong>Thời gian phản hồi</strong><span>Trong 01 ngày làm việc</span></div></div></div></div></aside></div>`;
}

// Trang tự đổi mật khẩu của phụ huynh. Chỉ có trong parentNav nên nhân sự nhà
// trường không thấy: họ đăng nhập bằng Microsoft 365, mật khẩu không nằm ở đây.
function renderAccount() {
  return `<div class="dashboard-layout"><section class="panel"><div class="panel-head"><div><h3>Đổi mật khẩu</h3><p>Mật khẩu dùng để đăng nhập cổng đăng ký CLB ngoại khóa.</p></div></div><div class="panel-body">
    <label class="form-field"><span>Mật khẩu hiện tại</span><input id="account-current-password" type="password" maxlength="128" autocomplete="current-password" /></label>
    <label class="form-field"><span>Mật khẩu mới</span><input id="account-new-password" type="password" minlength="8" maxlength="128" autocomplete="new-password" /></label>
    <label class="form-field"><span>Nhập lại mật khẩu mới</span><input id="account-confirm-password" type="password" minlength="8" maxlength="128" autocomplete="new-password" /></label>
    <div id="account-password-error" class="form-error" role="alert"></div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="button button-primary" id="account-password-submit">Lưu mật khẩu mới</button></div>
  </div></section><aside class="panel"><div class="panel-head"><div><h3>Thông tin đăng nhập</h3><p>Tài khoản gắn với số điện thoại đã đăng ký với nhà trường.</p></div></div><div class="panel-body">
    <div class="attention-list"><div class="attention-item"><span class="attention-dot" style="background:var(--blue)"></span><div class="attention-copy"><strong>Tài khoản</strong><span>${escapeHtml(state.me?.account || "")}</span></div></div></div>
    <div class="info-note" style="margin-top:12px"><strong>Yêu cầu mật khẩu:</strong> ít nhất 8 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt; không được chứa số điện thoại.</div>
    <div class="info-note" style="margin-top:9px"><strong>Quên mật khẩu:</strong> liên hệ Phòng Tuyển sinh 1900 888689 (bấm phím 1) để được cấp lại.</div>
  </div></aside></div>`;
}

function renderAdminDashboard() {
  const dashboard = state.dashboard || { total: 0, students: 0, needAction: 0, pendingPayment: 0, pendingAmount: 0, categories: [] };
  return `
    ${renderPeriodBanner()}
    <section class="grid grid-4">
      ${renderStat("clipboard","blue",dashboard.total,"Tổng đơn đăng ký","Dữ liệu trực tiếp")}
      ${renderStat("users","aqua",dashboard.students,"Học sinh tham gia",`${dashboard.total ? Math.round(dashboard.students / dashboard.total * 100) : 0}% đơn duy nhất`)}
      ${renderStat("clock","gold",dashboard.needAction,"Đơn cần xử lý","Ngoại lệ & chờ duyệt")}
      ${renderStat("credit","red",dashboard.pendingPayment,"Chờ đối soát phí",formatMoney(dashboard.pendingAmount))}
    </section>
    <section class="section dashboard-layout">
      <div class="panel"><div class="panel-head"><div><h3>Tỷ lệ lấp đầy theo nhóm CLB</h3><p>Đăng ký giữ chỗ so với tổng quota</p></div><select class="select-field"><option>Theo nhóm môn</option><option>Theo khối</option></select></div><div class="panel-body">${renderBarChart(dashboard.categories)}</div></div>
      <div class="panel"><div class="panel-head"><div><h3>Cần chú ý</h3><p>Các ngoại lệ ưu tiên xử lý</p></div><button class="text-button" data-go="applications">Xem đơn</button></div><div class="panel-body"><div class="attention-list">
        ${attention("var(--red)","Trùng lịch","Cần phụ huynh chọn lại", countByStatus("conflict"))}
        ${attention("var(--purple)","Danh sách chờ",`${fullClassCount()} lớp đã đầy`, countByStatus("waitlist"))}
        ${attention("var(--gold)","Chờ thanh toán","Chưa đối soát", countByStatus("payment"))}
        ${attention("var(--blue)","Đơn mới","Chờ xử lý", countByStatus("submitted"))}
      </div></div></div>
    </section>
    <section class="section panel"><div class="panel-head"><div><h3>Đơn đăng ký gần đây</h3><p>Dữ liệu cập nhật theo thời gian thực</p></div><button class="button button-secondary" data-go="applications">Xem tất cả ${icon("arrow")}</button></div>${renderApplicationTable(adminApplications.slice(0,5), { rutGon: true })}</section>`;
}

const countByStatus = (status) => adminApplications.filter((row) => row.status === status).length;
const fullClassCount = () => clubs.filter((club) => club.enrolled >= club.capacity).length;

// Băng thông báo tình trạng đợt đăng ký, lấy trực tiếp từ cấu hình đang lưu.
function renderPeriodBanner() {
  const period = state.catalog?.periods.find((item) => item.id === state.catalog.activePeriodId) || null;
  if (!period) {
    return `<div class="demo-banner"><span><strong>Chưa có đợt đăng ký nào đang mở.</strong> Phụ huynh chưa gửi được đơn mới.</span><button class="button button-secondary" data-go="campaigns">Mở đợt đăng ký</button></div>`;
  }
  return `<div class="demo-banner"><span><strong>${escapeHtml(period.name)} đang mở</strong> · ${formatDateTime(period.openAt)} → ${formatDateTime(period.closeAt)} · Hệ thống tự ngừng nhận đơn khi hết hạn.</span><button class="button button-secondary" data-go="campaigns">Xem cấu hình</button></div>`;
}

function renderStat(iconName, color, value, label, trend) {
  return `<article class="stat-card"><div class="stat-top"><span class="stat-icon ${color}">${icon(iconName)}</span><span class="trend">${trend}</span></div><h3>${value}</h3><p>${label}</p></article>`;
}

function renderBarChart(categoryData = []) {
  const bars = categoryData.length ? categoryData.map((item) => [item.category, item.fillRate]) : [["Chưa có dữ liệu",0]];
  return `<div class="bar-chart">${bars.map(([label,value],i) => `<div class="bar-group"><div class="bar ${value < 60 ? "gold" : ""}" style="height:${value}%" title="${value}%"></div><span class="bar-label">${label}</span></div>`).join("")}</div><div class="legend"><span><i></i> Từ 60% quota</span><span><i class="gold"></i> Dưới 60% quota</span></div>`;
}

function attention(color, title, sub, value) {
  return `<div class="attention-item"><span class="attention-dot" style="background:${color}"></span><div class="attention-copy"><strong>${title}</strong><span>${sub}</span></div><span class="attention-value">${value}</span></div>`;
}

// ---- Quản trị danh mục: đợt đăng ký, CLB và lớp ----

const DAY_LABELS = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
const PERIOD_STATUS_LABELS = {
  draft: ["Bản nháp", "blue"], open: ["Đang mở", "green"],
  closed: ["Đã đóng", "gold"], locked: ["Đã khóa", "red"],
};
const CATEGORY_SUGGESTIONS = ["Thể thao", "STEM", "Nghệ thuật", "Âm nhạc", "Ngôn ngữ", "Kỹ năng sống"];

const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});
const formatDateTime = (value) => (value ? dateTimeFormatter.format(new Date(value)) : "—");

// Ô nhập datetime-local hiển thị giờ Việt Nam; dữ liệu lưu và so sánh luôn ở UTC.
function toLocalInputValue(value) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value || "00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function fromLocalInputValue(value) {
  return value ? new Date(`${value}:00+07:00`).toISOString() : "";
}

function loadingPanel(message) {
  return `<section class="section panel"><div class="panel-body"><div class="empty-state"><h3>${escapeHtml(message)}</h3></div></div></section>`;
}

async function refreshCatalog() {
  state.catalog = await api("/admin/catalog");
  const known = state.catalog.periods.some((period) => period.id === state.catalogPeriodId);
  if (!known) state.catalogPeriodId = state.catalog.activePeriodId || state.catalog.periods[0]?.id || null;
}

function currentCatalogPeriod() {
  return state.catalog?.periods.find((period) => period.id === state.catalogPeriodId) || null;
}

function classesOfPeriod(periodId) {
  return (state.catalog?.classes || []).filter((row) => row.periodId === periodId);
}

/* ---------- Trang Đợt đăng ký ---------- */

function renderCampaigns() {
  if (!state.catalog) return loadingPanel("Đang tải đợt đăng ký…");
  const { periods, activePeriodId } = state.catalog;
  const active = periods.find((period) => period.id === activePeriodId) || null;
  const heroClasses = active ? classesOfPeriod(active.id) : [];
  const heroClubs = new Set(heroClasses.map((row) => row.clubId));
  const heroCapacity = heroClasses.reduce((sum, row) => sum + row.capacity, 0);
  const heroEnrolled = heroClasses.reduce((sum, row) => sum + row.enrolled, 0);
  const heroFill = heroCapacity ? Math.round((heroEnrolled / heroCapacity) * 100) : 0;

  const hero = active
    ? `<section class="hero"><div class="hero-content"><span class="eyebrow">Đợt đang nhận đơn</span>
        <h2>${escapeHtml(active.name)}</h2>
        <p>${formatDateTime(active.openAt)} → ${formatDateTime(active.closeAt)} · Tối đa ${active.maxClubsPerStudent} CLB mỗi học sinh</p>
        <div class="hero-actions">
          <button class="button button-light" data-edit-period="${escapeHtml(active.id)}">Chỉnh sửa cấu hình</button>
          <button class="button button-ghost-light" data-close-period="${escapeHtml(active.id)}">Đóng đăng ký ngay</button>
        </div></div>
        <div class="hero-side"><div class="period-line"><span>Trạng thái</span><strong>Đang mở đăng ký</strong></div>
        <div class="progress-track"><span style="width:${Math.min(100, heroFill)}%"></span></div>
        <div class="period-foot"><span>${heroEnrolled}/${heroCapacity} chỗ</span><strong>${heroClubs.size} CLB · ${heroClasses.length} lớp</strong></div></div></section>`
    : `<div class="demo-banner"><span><strong>Chưa có đợt nào đang mở.</strong> Phụ huynh sẽ không thấy CLB nào cho tới khi một đợt được mở trong khoảng thời gian hợp lệ.</span><button class="button button-secondary" data-new-period>+ Tạo đợt đăng ký</button></div>`;

  const rows = periods.map((period) => {
    const [label, color] = PERIOD_STATUS_LABELS[period.status] || ["—", "blue"];
    const classes = classesOfPeriod(period.id);
    const isActive = period.id === activePeriodId;
    return `<tr>
      <td><strong>${escapeHtml(period.name)}</strong><br><span style="color:var(--muted)">${escapeHtml(period.schoolYear)} · ${escapeHtml(period.term)}</span></td>
      <td>${formatDateTime(period.openAt)}<br>${formatDateTime(period.closeAt)}</td>
      <td><span class="badge badge-${color}">${label}</span>${isActive ? '<br><span style="color:var(--muted)">đang nhận đơn</span>' : ""}</td>
      <td>${period.maxClubsPerStudent} CLB</td>
      <td>${new Set(classes.map((row) => row.clubId)).size} CLB · ${classes.length} lớp</td>
      <td>
        <button class="table-action" data-edit-period="${escapeHtml(period.id)}">Sửa</button>
        ${period.status === "open"
          ? `<button class="table-action" data-close-period="${escapeHtml(period.id)}">Đóng</button>`
          : `<button class="table-action" data-open-period="${escapeHtml(period.id)}">Mở đăng ký</button>`}
      </td></tr>`;
  }).join("");

  return `${hero}
    <section class="section" style="margin-top:0"><div class="section-head">
      <div><span class="eyebrow">Cấu hình vận hành</span><h2>Đợt đăng ký</h2>
      <p>Thời gian mở/đóng tính theo giờ máy chủ (GMT+7). Hết hạn là hệ thống tự ngừng nhận đơn.</p></div>
      <button class="button button-primary" data-new-period>+ Tạo đợt đăng ký</button></div>
      <div class="panel"><div class="table-wrap"><table class="data-table">
        <thead><tr><th>Đợt</th><th>Mở → Đóng</th><th>Trạng thái</th><th>Giới hạn</th><th>Danh mục</th><th>Thao tác</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6"><div class="empty-state">Chưa có đợt đăng ký nào.</div></td></tr>'}</tbody>
      </table></div></div>
    </section>`;
}

function periodFormMarkup(period) {
  const isNew = !period;
  const now = new Date();
  const defaults = {
    name: "", schoolYear: `${now.getFullYear()}–${now.getFullYear() + 1}`, term: "Học kỳ I",
    openAt: "", closeAt: "", status: "draft", maxClubsPerStudent: 3, note: "",
  };
  const value = { ...defaults, ...(period || {}) };
  return `<div class="modal-head"><div><span class="eyebrow">${isNew ? "Tạo mới" : "Chỉnh sửa"}</span><h2>Đợt đăng ký</h2></div>
    <button class="icon-button" data-close-modal>${icon("x")}</button></div>
    <div class="modal-body"><form id="period-form" class="form-grid">
      <label class="form-field form-span-2"><span>Tên đợt</span><input name="name" value="${escapeHtml(value.name)}" placeholder="Đăng ký CLB · Học kỳ I" required /></label>
      <label class="form-field"><span>Năm học</span><input name="schoolYear" value="${escapeHtml(value.schoolYear)}" required /></label>
      <label class="form-field"><span>Học kỳ</span><input name="term" value="${escapeHtml(value.term)}" required /></label>
      <label class="form-field"><span>Mở đăng ký (giờ VN)</span><input type="datetime-local" name="openAt" value="${toLocalInputValue(value.openAt)}" required /></label>
      <label class="form-field"><span>Đóng đăng ký (giờ VN)</span><input type="datetime-local" name="closeAt" value="${toLocalInputValue(value.closeAt)}" required /></label>
      <label class="form-field"><span>Số CLB tối đa / học sinh</span><input type="number" name="maxClubsPerStudent" min="1" max="20" value="${value.maxClubsPerStudent}" required /></label>
      <label class="form-field"><span>Trạng thái</span><select class="select-field" name="status">
        ${Object.entries(PERIOD_STATUS_LABELS).map(([key, [label]]) => `<option value="${key}" ${value.status === key ? "selected" : ""}>${label}</option>`).join("")}
      </select></label>
      <label class="form-field form-span-2"><span>Ghi chú nội bộ</span><input name="note" value="${escapeHtml(value.note || "")}" placeholder="Ví dụ: chỉ áp dụng Tiểu học" /></label>
      <p class="field-hint form-span-2">Chỉ một đợt được ở trạng thái “Đang mở” tại một thời điểm. Đợt chỉ thực sự nhận đơn khi đang mở và thời gian hiện tại nằm trong khoảng trên.</p>
    </form><div id="form-error" class="form-error" role="alert"></div></div>
    <div class="modal-foot"><button class="button button-secondary" data-close-modal>Hủy</button>
    <button class="button button-primary" data-submit-period="${escapeHtml(period?.id || "")}">${isNew ? "Tạo đợt" : "Lưu thay đổi"}</button></div>`;
}

function readForm(formId) {
  const form = $(`#${formId}`);
  const data = {};
  for (const element of form.elements) {
    if (!element.name) continue;
    if (element.type === "checkbox") {
      if (element.dataset.group) {
        data[element.dataset.group] = data[element.dataset.group] || [];
        if (element.checked) data[element.dataset.group].push(Number(element.value));
      } else data[element.name] = element.checked;
    } else data[element.name] = element.value;
  }
  return data;
}

function showFormError(message) {
  const box = $("#form-error");
  if (box) box.textContent = message;
}

async function withBusyButton(button, label, action) {
  const original = button.innerHTML;
  button.disabled = true;
  button.textContent = label;
  try {
    await action();
  } catch (error) {
    showFormError(error.message);
    toast(error.message, "error");
    button.disabled = false;
    button.innerHTML = original;
  }
}

function openPeriodForm(periodId) {
  const period = state.catalog?.periods.find((item) => item.id === periodId) || null;
  showModal(periodFormMarkup(period), { wide: true });
  $("[data-submit-period]").addEventListener("click", (event) => {
    const button = event.currentTarget;
    const targetId = button.dataset.submitPeriod;
    const form = readForm("period-form");
    const payload = {
      ...form,
      openAt: fromLocalInputValue(form.openAt),
      closeAt: fromLocalInputValue(form.closeAt),
      maxClubsPerStudent: Number(form.maxClubsPerStudent),
    };
    withBusyButton(button, "Đang lưu…", async () => {
      await api(targetId ? `/admin/periods/${encodeURIComponent(targetId)}` : "/admin/periods", {
        method: targetId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      await refreshCatalog();
      closeModal();
      renderApp();
      toast(targetId ? "Đã lưu cấu hình đợt đăng ký." : "Đã tạo đợt đăng ký mới.", "success");
    });
  });
}

async function setPeriodStatus(periodId, status) {
  const period = state.catalog?.periods.find((item) => item.id === periodId);
  const question = status === "open"
    ? `Mở đăng ký cho đợt "${period?.name}"? Phụ huynh sẽ thấy danh mục ngay khi thời gian hợp lệ.`
    : `Đóng đăng ký đợt "${period?.name}"? Phụ huynh sẽ không gửi được đơn mới.`;
  if (!window.confirm(question)) return;
  try {
    await api(`/admin/periods/${encodeURIComponent(periodId)}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await refreshCatalog();
    renderApp();
    toast(status === "open" ? "Đã mở đăng ký." : "Đã đóng đăng ký.", "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

/* ---------- Trang CLB & lịch học ---------- */

function renderClasses() {
  if (!state.catalog) return loadingPanel("Đang tải danh mục CLB…");
  const period = currentCatalogPeriod();
  const rows = period ? classesOfPeriod(period.id) : [];
  const clubIds = new Set(rows.map((row) => row.clubId));
  const full = rows.filter((row) => row.enrolled >= row.capacity).length;
  const belowMin = rows.filter((row) => row.minCapacity > 0 && row.enrolled < row.minCapacity).length;
  const hidden = rows.filter((row) => !row.active).length;

  const periodOptions = state.catalog.periods
    .map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === state.catalogPeriodId ? "selected" : ""}>${escapeHtml(item.name)}${item.id === state.catalog.activePeriodId ? " · đang mở" : ""}</option>`)
    .join("");

  const clubBlocks = [...clubIds]
    .map((clubId) => state.catalog.clubs.find((club) => club.id === clubId))
    .filter(Boolean)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "vi"))
    .map((club) => renderCatalogClubBlock(club, rows.filter((row) => row.clubId === club.id)))
    .join("");

  const orphanClubs = state.catalog.clubs.filter((club) => !clubIds.has(club.id));

  return `<div class="kpi-strip">
      <div class="kpi-item"><span>CLB trong đợt</span><strong>${clubIds.size}</strong></div>
      <div class="kpi-item"><span>Lớp / ca học</span><strong>${rows.length}</strong></div>
      <div class="kpi-item"><span>Đã đầy</span><strong>${full}</strong></div>
      <div class="kpi-item"><span>Dưới sĩ số tối thiểu</span><strong>${belowMin}</strong></div>
      <div class="kpi-item"><span>Đang ẩn</span><strong>${hidden}</strong></div>
    </div>
    <section class="section"><div class="section-head">
      <div><span class="eyebrow">Danh mục vận hành</span><h2>CLB &amp; lịch học</h2>
      <p>Mỗi CLB có thể có nhiều ca; mỗi ca là một đơn vị nhận đăng ký riêng với phòng, giáo viên, sĩ số và học phí riêng.</p></div>
      <div class="club-actions">
        <select class="select-field" id="catalog-period">${periodOptions || "<option>Chưa có đợt</option>"}</select>
        <button class="button button-secondary" data-import-catalog>${icon("file")} Nhập từ Excel</button>
        <button class="button button-primary" data-new-club>+ Tạo CLB</button>
      </div></div>
      ${state.importDraft ? renderCatalogImport() : ""}
      ${period ? "" : '<div class="inline-alert">Hãy tạo một đợt đăng ký trước khi khai báo CLB và lớp.</div>'}
      ${clubBlocks || (period ? '<div class="empty-state"><h3>Đợt này chưa có lớp nào</h3><p>Tạo CLB rồi thêm ca học, hoặc nhập hàng loạt từ file Excel.</p></div>' : "")}
      ${orphanClubs.length ? `<div class="info-note"><strong>${orphanClubs.length} CLB chưa có lớp trong đợt này:</strong> ${orphanClubs.map((club) => `<button class="text-button" data-add-class-for="${escapeHtml(club.id)}">${escapeHtml(club.name)}</button>`).join(" · ")}</div>` : ""}
    </section>`;
}

function renderCatalogClubBlock(club, classes) {
  const capacity = classes.reduce((sum, row) => sum + row.capacity, 0);
  const enrolled = classes.reduce((sum, row) => sum + row.enrolled, 0);
  const ratio = capacity ? Math.round((enrolled / capacity) * 100) : 0;
  const rows = classes
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder || left.dayOfWeek - right.dayOfWeek || left.startTime.localeCompare(right.startTime))
    .map((row) => {
      const left = row.capacity - row.enrolled;
      const badge = !row.active ? ["Đang ẩn", "red"]
        : left <= 0 ? ["Đã đầy", "red"]
        : left <= 3 ? [`Còn ${left} chỗ`, "gold"]
        : [`Còn ${left} chỗ`, "green"];
      const grades = row.grades?.length ? row.grades : club.grades;
      return `<tr>
        <td><strong>${escapeHtml(row.name || "Ca chính")}</strong><br><span style="color:var(--muted)">Khối ${grades.join(", ")}</span></td>
        <td>${escapeHtml(row.scheduleLabel)}</td>
        <td>${escapeHtml(row.room)}<br><span style="color:var(--muted)">${escapeHtml(row.teacher)}</span></td>
        <td>${row.enrolled}/${row.capacity}${row.pendingRegistrations ? `<br><span style="color:var(--muted)">+${row.pendingRegistrations} đơn chưa giữ chỗ</span>` : ""}${row.minCapacity ? `<br><span style="color:var(--muted)">tối thiểu ${row.minCapacity}</span>` : ""}</td>
        <td>${formatMoney(row.fee)}</td>
        <td><span class="badge badge-${badge[1]}">${badge[0]}</span></td>
        <td>
          <button class="table-action" data-edit-class="${escapeHtml(row.id)}">Sửa</button>
          ${row.active
            ? `<button class="table-action" data-toggle-class="${escapeHtml(row.id)}">Ngừng mở</button>`
            : `<button class="table-action" data-toggle-class="${escapeHtml(row.id)}">Mở lại</button>`}
        </td></tr>`;
    }).join("");

  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head">
      <div><h3>${club.emoji} ${escapeHtml(club.name)} ${club.active ? "" : '<span class="badge badge-red">CLB đang ẩn</span>'}</h3>
      <p>${escapeHtml(club.code)} · ${escapeHtml(club.category)} · Khối ${club.grades.join(", ")} · lấp đầy ${ratio}%</p></div>
      <div class="club-actions">
        <button class="button button-secondary" data-edit-club="${escapeHtml(club.id)}">Sửa CLB</button>
        <button class="button button-secondary" data-add-class-for="${escapeHtml(club.id)}">+ Thêm ca</button>
      </div></div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Ca học</th><th>Lịch</th><th>Phòng · Giáo viên</th><th>Sĩ số</th><th>Học phí</th><th>Tình trạng</th><th>Thao tác</th></tr></thead>
        <tbody>${rows}</tbody></table></div></div>`;
}

function gradeChips(selected = [], groupName = "grades") {
  return `<div class="chip-row">${Array.from({ length: 12 }, (unused, index) => index + 1).map((grade) => `
    <label class="chip-toggle"><input type="checkbox" name="${groupName}_${grade}" data-group="${groupName}" value="${grade}" ${selected.includes(grade) ? "checked" : ""} /><span>${grade}</span></label>`).join("")}</div>`;
}

function clubFormMarkup(club) {
  const isNew = !club;
  const value = { code: "", name: "", category: "", description: "", emoji: "🎯", grades: [], sortOrder: 0, active: true, ...(club || {}) };
  return `<div class="modal-head"><div><span class="eyebrow">${isNew ? "Tạo mới" : "Chỉnh sửa"}</span><h2>Câu lạc bộ</h2></div>
    <button class="icon-button" data-close-modal>${icon("x")}</button></div>
    <div class="modal-body"><form id="club-form" class="form-grid">
      <label class="form-field form-span-2"><span>Tên CLB</span><input name="name" value="${escapeHtml(value.name)}" required /></label>
      <label class="form-field"><span>Mã CLB</span><input name="code" value="${escapeHtml(value.code)}" placeholder="Bỏ trống để hệ thống tự sinh" /></label>
      <label class="form-field"><span>Nhóm môn</span><input name="category" list="category-list" value="${escapeHtml(value.category)}" required />
        <datalist id="category-list">${CATEGORY_SUGGESTIONS.map((item) => `<option value="${item}"></option>`).join("")}</datalist></label>
      <label class="form-field"><span>Biểu tượng</span><input name="emoji" value="${escapeHtml(value.emoji)}" maxlength="4" /></label>
      <label class="form-field"><span>Thứ tự hiển thị</span><input type="number" name="sortOrder" min="0" max="9999" value="${value.sortOrder}" /></label>
      <label class="form-field form-span-2"><span>Mô tả cho phụ huynh</span><input name="description" value="${escapeHtml(value.description)}" /></label>
      <div class="form-field form-span-2"><span>Khối áp dụng (mặc định cho mọi ca)</span>${gradeChips(value.grades)}</div>
      <label class="confirm-row form-span-2"><input type="checkbox" name="active" ${value.active ? "checked" : ""} /><span>Hiển thị CLB này cho phụ huynh</span></label>
    </form><div id="form-error" class="form-error" role="alert"></div></div>
    <div class="modal-foot"><button class="button button-secondary" data-close-modal>Hủy</button>
    <button class="button button-primary" data-submit-club="${escapeHtml(club?.id || "")}">${isNew ? "Tạo CLB" : "Lưu thay đổi"}</button></div>`;
}

function openClubForm(clubId) {
  const club = state.catalog?.clubs.find((item) => item.id === clubId) || null;
  showModal(clubFormMarkup(club), { wide: true });
  $("[data-submit-club]").addEventListener("click", (event) => {
    const button = event.currentTarget;
    const targetId = button.dataset.submitClub;
    const form = readForm("club-form");
    withBusyButton(button, "Đang lưu…", async () => {
      const { club: saved } = await api(targetId ? `/admin/clubs/${encodeURIComponent(targetId)}` : "/admin/clubs", {
        method: targetId ? "PATCH" : "POST",
        body: JSON.stringify({ ...form, sortOrder: Number(form.sortOrder || 0) }),
      });
      await refreshCatalog();
      closeModal();
      renderApp();
      toast(targetId ? "Đã lưu CLB." : `Đã tạo CLB ${saved.name}. Hãy thêm ca học cho CLB này.`, "success");
      if (!targetId) openClassForm(null, saved.id);
    });
  });
}

function classFormMarkup(clubClass, clubId) {
  const isNew = !clubClass;
  const club = state.catalog.clubs.find((item) => item.id === (clubClass?.clubId || clubId));
  const value = {
    name: "", dayOfWeek: 2, startTime: "16:15", endTime: "17:30", room: "", teacher: "",
    capacity: 20, minCapacity: 0, enrolledBase: 0, fee: 0, grades: [], waitlistEnabled: true, sortOrder: 0, active: true,
    ...(clubClass || {}),
  };
  const clubOptions = state.catalog.clubs
    .map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === (clubClass?.clubId || clubId) ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("");
  const periodOptions = state.catalog.periods
    .map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === (clubClass?.periodId || state.catalogPeriodId) ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("");
  return `<div class="modal-head"><div><span class="eyebrow">${isNew ? "Thêm ca học" : "Chỉnh sửa ca học"}</span><h2>${escapeHtml(club?.name || "Lớp CLB")}</h2></div>
    <button class="icon-button" data-close-modal>${icon("x")}</button></div>
    <div class="modal-body"><form id="class-form" class="form-grid">
      <label class="form-field"><span>Thuộc CLB</span><select class="select-field" name="clubId">${clubOptions}</select></label>
      <label class="form-field"><span>Đợt đăng ký</span><select class="select-field" name="periodId">${periodOptions}</select></label>
      <label class="form-field"><span>Tên ca</span><input name="name" value="${escapeHtml(value.name)}" placeholder="Ca 1" /></label>
      <label class="form-field"><span>Thứ</span><select class="select-field" name="dayOfWeek">
        ${DAY_LABELS.map((label, index) => `<option value="${index}" ${Number(value.dayOfWeek) === index ? "selected" : ""}>${label}</option>`).join("")}
      </select></label>
      <label class="form-field"><span>Giờ bắt đầu</span><input type="time" name="startTime" value="${escapeHtml(value.startTime)}" required /></label>
      <label class="form-field"><span>Giờ kết thúc</span><input type="time" name="endTime" value="${escapeHtml(value.endTime)}" required /></label>
      <label class="form-field"><span>Phòng học</span><input name="room" value="${escapeHtml(value.room)}" required /></label>
      <label class="form-field"><span>Giáo viên</span><input name="teacher" value="${escapeHtml(value.teacher)}" required /></label>
      <label class="form-field"><span>Sĩ số tối đa</span><input type="number" name="capacity" min="1" max="500" value="${value.capacity}" required /></label>
      <label class="form-field"><span>Sĩ số tối thiểu</span><input type="number" name="minCapacity" min="0" max="500" value="${value.minCapacity}" /></label>
      <label class="form-field"><span>Học phí (đồng)</span><input name="fee" value="${value.fee}" required /></label>
      <label class="form-field"><span>Ghi danh sẵn ngoài hệ thống</span><input type="number" name="enrolledBase" min="0" max="500" value="${value.enrolledBase}" /></label>
      <div class="form-field form-span-2"><span>Khối riêng cho ca này (bỏ trống = theo CLB: khối ${club?.grades.join(", ") || "—"})</span>${gradeChips(value.grades)}</div>
      <label class="confirm-row form-span-2"><input type="checkbox" name="waitlistEnabled" ${value.waitlistEnabled ? "checked" : ""} /><span>Nhận danh sách chờ khi hết chỗ</span></label>
      <label class="confirm-row form-span-2"><input type="checkbox" name="active" ${value.active ? "checked" : ""} /><span>Mở ca này cho phụ huynh đăng ký</span></label>
    </form><div id="form-error" class="form-error" role="alert"></div></div>
    <div class="modal-foot"><button class="button button-secondary" data-close-modal>Hủy</button>
    <button class="button button-primary" data-submit-class="${escapeHtml(clubClass?.id || "")}">${isNew ? "Thêm ca học" : "Lưu thay đổi"}</button></div>`;
}

function openClassForm(classId, clubId = null) {
  const clubClass = state.catalog?.classes.find((item) => item.id === classId) || null;
  if (!state.catalog?.clubs.length) return toast("Hãy tạo ít nhất một CLB trước.", "error");
  showModal(classFormMarkup(clubClass, clubId || state.catalog.clubs[0].id), { wide: true });
  $("[data-submit-class]").addEventListener("click", (event) => {
    const button = event.currentTarget;
    const targetId = button.dataset.submitClass;
    const form = readForm("class-form");
    withBusyButton(button, "Đang lưu…", async () => {
      await api(targetId ? `/admin/classes/${encodeURIComponent(targetId)}` : "/admin/classes", {
        method: targetId ? "PATCH" : "POST",
        body: JSON.stringify({
          ...form,
          dayOfWeek: Number(form.dayOfWeek),
          capacity: Number(form.capacity),
          minCapacity: Number(form.minCapacity || 0),
          enrolledBase: Number(form.enrolledBase || 0),
        }),
      });
      await refreshCatalog();
      closeModal();
      renderApp();
      toast(targetId ? "Đã lưu ca học." : "Đã thêm ca học.", "success");
    });
  });
}

async function toggleClassActive(classId) {
  const clubClass = state.catalog?.classes.find((item) => item.id === classId);
  if (!clubClass) return;
  const turningOff = clubClass.active;
  if (turningOff && !window.confirm(`Ngừng mở ca "${clubClass.name || clubClass.scheduleLabel}"? Phụ huynh sẽ không thấy ca này nữa.`)) return;
  try {
    await api(`/admin/classes/${encodeURIComponent(classId)}`, { method: "PATCH", body: JSON.stringify({ active: !turningOff }) });
    await refreshCatalog();
    renderApp();
    toast(turningOff ? "Đã ngừng mở ca học." : "Đã mở lại ca học.", "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

/* ---------- Nhập danh mục từ Excel ---------- */

const IMPORT_FIELD_LABELS = {
  clubCode: "Mã CLB", clubName: "Tên CLB", category: "Nhóm môn", description: "Mô tả", emoji: "Biểu tượng",
  grades: "Khối", className: "Tên lớp/ca", day: "Thứ", timeRange: "Khung giờ", startTime: "Giờ bắt đầu",
  endTime: "Giờ kết thúc", room: "Phòng", teacher: "Giáo viên", capacity: "Sĩ số tối đa",
  minCapacity: "Sĩ số tối thiểu", fee: "Học phí",
};

function renderCatalogImport() {
  const draft = state.importDraft;
  const preview = draft.preview;
  const head = `<div class="panel-head"><div><span class="eyebrow">Nhập hàng loạt</span><h3>Danh mục CLB từ file</h3>
    <p>${draft.fileName ? `${escapeHtml(draft.fileName)}${draft.sheetName ? ` · sheet ${escapeHtml(draft.sheetName)}` : ""}` : "Chọn file .xlsx hoặc .csv — mỗi dòng là một ca học."}</p></div>
    <button class="button button-secondary" data-cancel-import>Đóng</button></div>`;

  if (!preview) {
    return `<div class="panel" style="margin-bottom:16px">${head}<div class="panel-body">
      <div class="info-note"><strong>Cách khai file:</strong> mỗi dòng là một ca học. Các dòng cùng tên/mã CLB sẽ được gộp thành một CLB nhiều ca.
      Cột tối thiểu: <b>Tên CLB, Khối, Thứ, Khung giờ, Phòng, Giáo viên, Sĩ số, Học phí</b>. Có thể thêm Mã CLB, Nhóm môn, Tên lớp, Mô tả, Sĩ số tối thiểu.</div>
      <label class="form-field"><span>Chọn file danh mục</span><input type="file" id="catalog-file" accept=".xlsx,.csv,.txt" /></label>
      <p class="field-hint">File được đọc ngay trên máy bạn; hệ thống chỉ ghi dữ liệu sau khi bạn bấm xác nhận ở bước rà soát.</p>
    </div></div>`;
  }

  const mappingHtml = `<div class="mapping-list">${Object.entries(preview.mapping)
    .map(([field, header]) => `<span><b>${escapeHtml(IMPORT_FIELD_LABELS[field] || field)}</b>${escapeHtml(header)}</span>`).join("")}</div>`;

  const issuesHtml = preview.issues.length
    ? `<div class="info-note"><strong>Cần rà soát:</strong> ${preview.issues.slice(0, 12)
        .map((issue) => `Dòng ${issue.row} (${issue.severity === "warning" ? "cảnh báo" : "lỗi"}): ${issue.codes.map(escapeHtml).join(", ")}`).join(" · ")}</div>`
    : "";

  const clubByKey = new Map(preview.clubs.map((club) => [String(club.code).toUpperCase(), club]));
  const sampleRows = preview.classes.slice(0, 12).map((row) => {
    const club = clubByKey.get(row.clubKey) || {};
    return `<tr><td>${escapeHtml(club.name || row.clubKey)}</td><td>${escapeHtml(row.name || "—")}</td><td>${escapeHtml(row.scheduleLabel)}</td>
      <td>${escapeHtml(row.room)}<br><span style="color:var(--muted)">${escapeHtml(row.teacher)}</span></td>
      <td>${row.capacity}</td><td>${formatMoney(row.fee)}</td><td>Khối ${(row.grades || club.grades || []).join(", ")}</td></tr>`;
  }).join("");

  return `<div class="panel" style="margin-bottom:16px">${head}<div class="panel-body">
    ${preview.missing.length ? `<div class="inline-alert">Thiếu cột bắt buộc: ${preview.missing.map(escapeHtml).join(", ")}. Hãy sửa tiêu đề file rồi chọn lại.</div>` : mappingHtml}
    ${preview.counters ? `<div class="kpi-strip">
      <div class="kpi-item"><span>Dòng đã đọc</span><strong>${preview.counters.scannedRows}</strong></div>
      <div class="kpi-item"><span>Dòng hợp lệ</span><strong>${preview.counters.validRows}</strong></div>
      <div class="kpi-item"><span>Dòng lỗi</span><strong>${preview.counters.invalidRows}</strong></div>
      <div class="kpi-item"><span>CLB</span><strong>${preview.counters.clubs}</strong></div>
      <div class="kpi-item"><span>Ca học</span><strong>${preview.counters.classes}</strong></div>
    </div>` : ""}
    ${issuesHtml}
    ${sampleRows ? `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>CLB</th><th>Ca</th><th>Lịch</th><th>Phòng · GV</th><th>Sĩ số</th><th>Học phí</th><th>Khối</th></tr></thead>
      <tbody>${sampleRows}</tbody></table></div>
      ${preview.classes.length > 12 ? `<p class="field-hint">Hiển thị 12/${preview.counters.classes} ca đầu tiên.</p>` : ""}` : ""}
    <div class="sync-verdict ${preview.readyToImport ? "ready" : "blocked"}">
      ${preview.readyToImport
        ? `✓ Dữ liệu hợp lệ. Ghi vào đợt "${escapeHtml(currentCatalogPeriod()?.name || "")}" sẽ tạo mới hoặc cập nhật theo mã CLB và khung lịch, không xóa dữ liệu cũ.`
        : "Chưa thể ghi: hãy xử lý các dòng lỗi hoặc cột còn thiếu."}</div>
    ${preview.readyToImport ? '<div class="sync-actions"><button class="button button-primary" data-commit-import>Ghi danh mục vào hệ thống</button><span>Chỉ thêm/cập nhật, không xóa CLB hay lớp đang có.</span></div>' : ""}
  </div></div>`;
}

async function handleCatalogFile(file) {
  try {
    if (!currentCatalogPeriod()) throw new Error("Hãy chọn đợt đăng ký trước khi nhập danh mục.");
    const workbook = await window.NSHMSheet.readFile(file);
    const sheet = workbook.sheets.find((item) => !item.hidden && item.rows.length) || workbook.sheets[0];
    if (!sheet || !sheet.rows.length) throw new Error("File không có dòng dữ liệu nào.");
    const { headers, rows } = window.NSHMSheet.splitHeaderAndRows(sheet.rows);
    if (!headers.length) throw new Error("Không tìm thấy dòng tiêu đề trong file.");
    const { preview } = await api("/admin/catalog/import/preview", {
      method: "POST",
      body: JSON.stringify({ periodId: state.catalogPeriodId, headers, rows }),
    });
    state.importDraft = { fileName: file.name, sheetName: sheet.name, headers, rows, preview };
    renderPage();
    toast(preview.readyToImport ? `Đọc được ${preview.counters.classes} ca học. Hãy rà soát trước khi ghi.` : "Đã đọc file; cần xử lý lỗi trước khi ghi.", preview.readyToImport ? "success" : "");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function commitCatalogImport(button) {
  const draft = state.importDraft;
  if (!draft?.preview?.readyToImport) return;
  if (!window.confirm(`Ghi ${draft.preview.counters.clubs} CLB và ${draft.preview.counters.classes} ca học vào đợt "${currentCatalogPeriod()?.name}"?`)) return;
  button.disabled = true;
  button.textContent = "Đang ghi dữ liệu…";
  try {
    const { result } = await api("/admin/catalog/import/commit", {
      method: "POST",
      body: JSON.stringify({
        periodId: state.catalogPeriodId, headers: draft.headers, rows: draft.rows, confirmation: "IMPORT_CLUB_CATALOG",
      }),
    });
    state.importDraft = null;
    await refreshCatalog();
    renderApp();
    const counters = result.counters;
    toast(`Đã ghi: ${counters.clubsCreated} CLB mới, ${counters.clubsUpdated} CLB cập nhật, ${counters.classesCreated} ca mới, ${counters.classesUpdated} ca cập nhật.`, "success");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Ghi danh mục vào hệ thống";
    toast(error.message, "error");
  }
}

/* ---------- Hỗ trợ tài khoản phụ huynh ---------- */

function renderAccountSupport() {
  const lookup = state.accountLookup;
  const directory = lookup?.directory;
  const summary = directory
    ? `<div class="kpi-strip">
        <div class="kpi-item"><span>Tài khoản phụ huynh</span><strong>${directory.parents}</strong></div>
        <div class="kpi-item"><span>Học sinh trong hệ thống</span><strong>${directory.students}</strong></div>
        <div class="kpi-item"><span>Đồng bộ gần nhất</span><strong>${directory.lastSyncAt ? formatDateTime(directory.lastSyncAt) : "Chưa từng chạy"}</strong></div>
      </div>`
    : "";

  let detail = "";
  if (lookup && !lookup.found) {
    detail = `<div class="sync-verdict blocked">Không tìm thấy tài khoản cho <b>${escapeHtml(lookup.normalized)}</b>.</div>
      <div class="info-note">${escapeHtml(lookup.diagnosis)}</div>`;
  } else if (lookup) {
    const account = lookup.account;
    const rows = [
      ["Tài khoản", account.account],
      ["Tên hiển thị", account.displayName],
      ["Trạng thái", account.active ? "Đang hoạt động" : "Đã tắt"],
      ["Kiểu đăng nhập", account.authProvider === "local" ? "Mật khẩu" : "Microsoft 365"],
      ["Mật khẩu", account.mustChangePassword ? "Vẫn là mật khẩu khởi tạo" : "Phụ huynh đã đổi riêng"],
      ["Đăng nhập sai liên tiếp", String(account.loginFailures)],
      ["Tạm khóa đến", account.lockedUntil ? formatDateTime(account.lockedUntil) : "Không"],
      ["Học sinh đã liên kết", `${account.linkedStudents}`],
      ["Tạo lúc", formatDateTime(account.createdAt)],
    ];
    detail = `<div class="integration-source">${rows.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`).join("")}</div>
      ${lookup.students.length ? `<div class="mapping-list">${lookup.students.map((item) => `<span><b>${escapeHtml(item.name)}</b>${escapeHtml(item.homeroom || "")}${item.relationship ? ` · ${escapeHtml(item.relationship)}` : ""}</span>`).join("")}</div>` : ""}
      <div class="sync-verdict ${account.mustChangePassword && account.active && !account.lockedUntil ? "ready" : "blocked"}">${escapeHtml(lookup.diagnosis)}</div>
      ${account.role === "parent" && account.authProvider === "local"
        ? `<div class="sync-actions"><button class="button button-primary" data-reset-password="${escapeHtml(lookup.normalized)}">Đặt lại về mật khẩu khởi tạo</button><span>Mật khẩu trở lại chính là số điện thoại và phụ huynh phải đổi ngay lần đăng nhập kế tiếp. Thao tác được ghi log.</span></div>`
        : ""}`;
  }

  return `<section class="section panel"><div class="panel-head">
      <div><span class="eyebrow">Hỗ trợ vận hành</span><h3>Tra cứu tài khoản phụ huynh</h3>
      <p>Dùng khi phụ huynh báo không đăng nhập được. Không hiển thị mật khẩu.</p></div></div>
    <div class="panel-body">
      <div class="grid grid-2">
        <label class="search-field">${icon("search")}<input id="account-lookup-input" value="${escapeHtml(state.accountLookupInput || "")}" placeholder="Số điện thoại phụ huynh, ví dụ 0975662437" /></label>
        <div class="club-actions">
          <button class="button button-secondary" data-lookup-account>Tra cứu</button>
          <button class="button button-primary" data-issue-codes>${icon("download")} Cấp &amp; in mã kích hoạt</button>
        </div>
      </div>
      <p class="field-hint">Nút cấp mã chỉ sinh mã cho tài khoản <b>chưa có mã</b>, nên bấm lại nhiều lần không làm hỏng những mã đã phát.</p>
      ${summary}
      ${detail}
    </div></section>`;
}

async function runAccountLookup(button) {
  const value = $("#account-lookup-input").value.trim();
  if (!value) return toast("Vui lòng nhập số điện thoại cần tra cứu.", "error");
  state.accountLookupInput = value;
  button.disabled = true;
  button.textContent = "Đang tra cứu…";
  try {
    state.accountLookup = (await api(`/admin/accounts/lookup?account=${encodeURIComponent(value)}`)).lookup;
    renderPage();
  } catch (error) {
    button.disabled = false;
    button.textContent = "Tra cứu";
    toast(error.message, "error");
  }
}

async function runPasswordReset(account, button) {
  if (!window.confirm(`Đặt lại mật khẩu cho ${account}?\n\nMật khẩu trở về chính số điện thoại và phụ huynh phải đổi ngay lần đăng nhập kế tiếp. Mã kích hoạt cũ (nếu có) sẽ hết hiệu lực.`)) return;
  button.disabled = true;
  button.textContent = "Đang đặt lại…";
  try {
    const { result } = await api("/admin/accounts/reset-initial-password", {
      method: "POST",
      body: JSON.stringify({ account, confirmation: "RESET_INITIAL_PASSWORD" }),
    });
    state.accountLookup = (await api(`/admin/accounts/lookup?account=${encodeURIComponent(account)}`)).lookup;
    renderPage();
    void result;
    toast(`Đã đặt lại. Mật khẩu của ${account} nay chính là số điện thoại đó, và phải đổi ngay lần đăng nhập kế tiếp.`, "success");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Đặt lại về mật khẩu khởi tạo";
    toast(error.message, "error");
  }
}

async function issueActivationCodes(button) {
  const confirmed = window.confirm(
    "Cấp mã kích hoạt cho các tài khoản phụ huynh chưa đặt mật khẩu, rồi tải danh sách về để in?\n\n"
    + "Danh sách chứa số điện thoại và mã đăng nhập của phụ huynh. Chỉ in và phát trực tiếp, không gửi qua kênh công khai.",
  );
  if (!confirmed) return;
  const original = button.innerHTML;
  button.disabled = true;
  button.textContent = "Đang cấp mã…";
  try {
    const { result } = await api("/admin/accounts/activation-codes", {
      method: "POST",
      body: JSON.stringify({ confirmation: "ISSUE_ACTIVATION_CODES" }),
    });
    if (!result.rows.length) {
      toast("Không có tài khoản nào đang chờ kích hoạt.", "");
      return;
    }
    const header = ["So dien thoai", "Ten phu huynh", "Hoc sinh", "Ma kich hoat"];
    const csv = "\uFEFF" + [header, ...result.rows.map((row) => [row.account, row.displayName, row.students, row.activationCode])]
      .map((line) => line.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
      .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `NSHM_Ma_kich_hoat_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`${result.pending} tài khoản chờ kích hoạt, vừa cấp mới ${result.issued} mã. Đã tải danh sách để in.`, "success");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}

function bindAccountSupportEvents() {
  $("[data-lookup-account]")?.addEventListener("click", (event) => runAccountLookup(event.currentTarget));
  $("[data-issue-codes]")?.addEventListener("click", (event) => issueActivationCodes(event.currentTarget));
  $("#account-lookup-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      $("[data-lookup-account]")?.click();
    }
  });
  $("[data-reset-password]")?.addEventListener("click", (event) => runPasswordReset(event.currentTarget.dataset.resetPassword, event.currentTarget));
}

/* ---------- Sao lưu và xuất toàn bộ dữ liệu ---------- */

const BACKUP_COLLECTION_LABELS = {
  users: "Tài khoản", students: "Học sinh", parentStudents: "Liên kết phụ huynh–học sinh",
  registrationPeriods: "Đợt đăng ký", clubs: "Câu lạc bộ", clubClasses: "Lớp / ca học",
  registrations: "Đơn đăng ký", supportRequests: "Yêu cầu hỗ trợ", auditLogs: "Nhật ký thao tác",
  classCounters: "Bộ đếm chỗ",
};

function renderBackupPanel() {
  const summary = state.lastBackup;
  return `<section class="section panel"><div class="panel-head">
      <div><span class="eyebrow">Toàn quyền dữ liệu</span><h3>Sao lưu toàn bộ dữ liệu</h3>
      <p>Xuất một file JSON chứa đầy đủ dữ liệu hệ thống, dùng để sao lưu hoặc chuyển sang nền lưu trữ khác.</p></div>
      <button class="button button-primary" data-export-backup>${icon("download")} Xuất toàn bộ dữ liệu</button></div>
    <div class="panel-body">
      <div class="info-note"><strong>File luôn được mã hóa:</strong> bạn đặt một mật khẩu mở file, dữ liệu được mã hóa
      ngay trong trình duyệt bằng AES-256-GCM trước khi ghi ra đĩa, nên bản rõ không bao giờ nằm trên máy dưới dạng file.
      <b>Mất mật khẩu là mất luôn file sao lưu</b> — không có đường khôi phục. Mỗi lần xuất đều được ghi vào nhật ký thao tác.</div>
      ${summary ? `<div class="kpi-strip">${Object.entries(summary.counts)
        .map(([name, count]) => `<div class="kpi-item"><span>${escapeHtml(BACKUP_COLLECTION_LABELS[name] || name)}</span><strong>${count}</strong></div>`)
        .join("")}</div>
        <div class="sync-verdict ready">✓ Đã xuất ${summary.total} bản ghi lúc ${formatDateTime(summary.exportedAt)}${summary.auditLogged ? "" : " (chưa ghi được nhật ký vì cơ sở dữ liệu đang không ghi được)"}.</div>` : ""}
    </div></section>`;
}

// Nạp module mã hóa khi thật sự cần. Không dùng script nội tuyến vì Content Security
// Policy của trang chỉ cho phép mã nguồn cùng miền, và cũng không nên tải phần này
// cho mọi người dùng khi chỉ quản trị mới xuất dữ liệu.
let backupCryptoModule = null;
async function loadBackupCrypto() {
  if (!backupCryptoModule) backupCryptoModule = await import("./backup-crypto.mjs?v=20260822-1");
  return backupCryptoModule;
}

function saveJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Hỏi mật khẩu TRƯỚC khi lấy dữ liệu: không tải gì về nếu chưa có cách bảo vệ nó.
function askBackupPassphrase() {
  return new Promise((resolve) => {
    showModal(`<div class="modal-head"><div><span class="eyebrow">Bảo vệ file sao lưu</span><h2>Đặt mật khẩu mở file</h2></div>
      <button class="icon-button" data-close-modal>${icon("x")}</button></div>
      <div class="modal-body">
        <div class="info-note">File sao lưu chứa thông tin cá nhân của học sinh và phụ huynh nên luôn được mã hóa.
        Hãy đặt mật khẩu tối thiểu 12 ký tự và lưu ở nơi an toàn: <b>mất mật khẩu là không mở lại được file</b>.</div>
        <label class="form-field"><span>Mật khẩu mở file</span><input id="backup-passphrase" type="password" minlength="12" autocomplete="new-password" /></label>
        <label class="form-field"><span>Nhập lại mật khẩu</span><input id="backup-passphrase-confirm" type="password" minlength="12" autocomplete="new-password" /></label>
        <div id="form-error" class="form-error" role="alert"></div>
      </div>
      <div class="modal-foot"><button class="button button-secondary" data-close-modal>Hủy</button>
      <button class="button button-primary" data-confirm-passphrase>Xuất dữ liệu</button></div>`, { wide: true });

    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    $("[data-confirm-passphrase]").addEventListener("click", () => {
      const passphrase = $("#backup-passphrase").value;
      if (passphrase.length < 12) return showFormError("Mật khẩu phải dài ít nhất 12 ký tự.");
      if (passphrase !== $("#backup-passphrase-confirm").value) return showFormError("Hai lần nhập mật khẩu chưa khớp.");
      closeModal();
      finish(passphrase);
    });
    $$("[data-close-modal]").forEach((element) => element.addEventListener("click", () => finish(null)));
  });
}

async function downloadFullBackup(button) {
  const passphrase = await askBackupPassphrase();
  if (!passphrase) return;
  const original = button.innerHTML;
  button.disabled = true;
  try {
    const { collections } = await api("/admin/export/collections");
    const data = {};
    const counts = {};
    let source = null;
    let schemaVersion = 1;
    let auditLogged = false;
    for (const [index, collection] of collections.entries()) {
      const rows = [];
      let after = null;
      do {
        button.textContent = `Đang xuất ${index + 1}/${collections.length}: ${BACKUP_COLLECTION_LABELS[collection] || collection} (${rows.length})…`;
        const { page } = await api("/admin/export/backup", {
          method: "POST",
          body: JSON.stringify({ confirmation: "EXPORT_FULL_BACKUP", collection, after }),
        });
        rows.push(...page.rows);
        after = page.nextAfter;
        source = page.source;
        schemaVersion = page.schemaVersion;
        auditLogged = auditLogged || page.auditLogged;
      } while (after);
      data[collection] = rows;
      counts[collection] = rows.length;
    }
    const exportedAt = new Date().toISOString();
    button.textContent = "Đang mã hóa file…";
    const { encryptBackup } = await loadBackupCrypto();
    const envelope = await encryptBackup(
      { schemaVersion, exportedAt, source, counts, data },
      passphrase,
    );
    saveJsonFile(`NSHM_Clubs_backup_${exportedAt.slice(0, 19).replaceAll(":", "").replace("T", "-")}.enc.json`, envelope);
    state.lastBackup = { counts, exportedAt, auditLogged, total: Object.values(counts).reduce((sum, count) => sum + count, 0) };
    renderPage();
    toast(`Đã xuất ${state.lastBackup.total} bản ghi ra file đã mã hóa.`, "success");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}

function bindBackupEvents() {
  $("[data-export-backup]")?.addEventListener("click", (event) => downloadFullBackup(event.currentTarget));
}

function bindCatalogEvents() {
  $("[data-new-period]")?.addEventListener("click", () => openPeriodForm(null));
  $$("[data-edit-period]").forEach((element) => element.addEventListener("click", () => openPeriodForm(element.dataset.editPeriod)));
  $$("[data-open-period]").forEach((element) => element.addEventListener("click", () => setPeriodStatus(element.dataset.openPeriod, "open")));
  $$("[data-close-period]").forEach((element) => element.addEventListener("click", () => setPeriodStatus(element.dataset.closePeriod, "closed")));
  $("[data-new-club]")?.addEventListener("click", () => openClubForm(null));
  $$("[data-edit-club]").forEach((element) => element.addEventListener("click", () => openClubForm(element.dataset.editClub)));
  $$("[data-add-class-for]").forEach((element) => element.addEventListener("click", () => openClassForm(null, element.dataset.addClassFor)));
  $$("[data-edit-class]").forEach((element) => element.addEventListener("click", () => openClassForm(element.dataset.editClass)));
  $$("[data-toggle-class]").forEach((element) => element.addEventListener("click", () => toggleClassActive(element.dataset.toggleClass)));
  $("#catalog-period")?.addEventListener("change", (event) => {
    state.catalogPeriodId = event.target.value;
    state.importDraft = null;
    renderPage();
  });
  $("[data-import-catalog]")?.addEventListener("click", () => {
    state.importDraft = state.importDraft ? null : { fileName: "", sheetName: "", headers: [], rows: [], preview: null };
    renderPage();
  });
  $("[data-cancel-import]")?.addEventListener("click", () => { state.importDraft = null; renderPage(); });
  $("#catalog-file")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) handleCatalogFile(file);
  });
  $("[data-commit-import]")?.addEventListener("click", (event) => commitCatalogImport(event.currentTarget));
}

function renderApplications() {
  const filtered = state.adminStatus === "all" ? adminApplications
    : state.adminStatus === "ngoai-le" ? adminApplications.filter((item) => EXCEPTION_STATUSES.includes(item.status))
    : adminApplications.filter((item) => item.status === state.adminStatus);
  const tabs = [["all", "Tất cả"], ...LIFECYCLE_STATUSES.map((status) => [status, statusBadge(status)[0]]), ["ngoai-le", "Ngoại lệ"]];
  return `<section class="section" style="margin-top:0"><div class="section-head"><div><span class="eyebrow">Quản lý tập trung</span><h2>Danh sách đăng ký</h2><p>Lọc, xử lý ngoại lệ và theo dõi lịch sử trạng thái.</p></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="button button-secondary" data-go="nhapDangKy">${icon("file")} Nhập từ file đăng ký</button><button class="button button-secondary" data-export>${icon("download")} Xuất CSV</button></div></div>
  <div class="filters"><label class="search-field">${icon("search")}<input id="admin-search" placeholder="Tìm mã đơn, mã học sinh, tên học sinh, CLB..." /></label><div class="status-tabs">${tabs.map(([id,label]) => `<button class="status-tab ${state.adminStatus === id ? "active" : ""}" data-status-tab="${id}">${label}</button>`).join("")}</div></div></section>
  <section class="section panel"><div class="panel-head"><div><h3>${filtered.length} đơn hiển thị</h3><p>${escapeHtml(pageContext("applications", ""))}</p></div></div><div id="applications-table">${renderApplicationTable(filtered)}</div></section>`;
}

// Ngày sinh đến từ Google Sheets nên là chuỗi thô do nhà trường gõ, thường đã là
// dd/mm/yyyy. Chỉ đổi khi thấy dạng ISO; còn lại giữ nguyên, vì đoán sai định dạng
// một ngày sinh còn tệ hơn hiện đúng thứ người ta đã nhập.
const formatDateOfBirth = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : raw;
};

// Cùng một hàm bảng phục vụ hai chỗ: trang "Đơn đăng ký" (đủ tám cột theo yêu cầu
// của nhà trường) và ô "Đơn đăng ký gần đây" trên Dashboard. Dashboard mở cho giáo
// vụ bằng quyền bao-cao, mà phạm vi của giáo vụ trong roles.mjs KHÔNG gồm mã học
// sinh và ngày sinh — nên hai cột đó phải đánh dấu là riêng của trang đơn. Máy chủ
// cũng đã cắt hai trường này theo quyền; ẩn ở đây chỉ là lớp thứ hai.
function renderApplicationTable(rows, { rutGon = false } = {}) {
  const cot = [
    { title: "Mã đơn", cell: (row) => `<strong>${escapeHtml(row.id)}</strong>` },
    { title: "Ngày đăng ký", cell: (row) => escapeHtml(row.date) },
    { title: "Mã học sinh", rieng: true, cell: (row) => (row.studentCode ? escapeHtml(row.studentCode) : "—") },
    { title: "Học sinh", cell: (row) => `<div class="student-cell"><span class="mini-avatar">${escapeHtml(row.student.split(" ").slice(-2).map((part) => part[0]).join(""))}</span><div><strong>${escapeHtml(row.student)}</strong><span>${escapeHtml(row.className)}</span></div></div>` },
    { title: "Ngày sinh", rieng: true, cell: (row) => escapeHtml(formatDateOfBirth(row.dateOfBirth)) },
    { title: "CLB", cell: (row) => `${escapeHtml(row.club)}${row.classLabel ? `<br><span style="color:var(--muted)">${escapeHtml(row.classLabel)}</span>` : ""}` },
    { title: "Trạng thái", cell: (row) => { const [label, color] = statusBadge(row.status); return `<span class="badge badge-${color}">${label}</span>${row.feePaid && row.status !== "confirmed" ? '<br><span style="color:var(--muted)">đã thu phí</span>' : ""}`; } },
    // "Chi tiết" phải có ở MỌI dòng: popup là nơi duy nhất đổi được trạng thái, mà
    // đơn đang chờ thanh toán lại chính là loại hay phải đổi tay nhất (lùi khai
    // giảng, lớp hủy, hoàn phí). Nút xác nhận phí đứng cạnh như một lối tắt, kèm
    // số tiền vì bảng không còn cột Phí — xác nhận một khoản thu mà không nhìn
    // thấy số tiền là chỗ dễ sai nhất của cả trang.
    { title: "Thao tác", cell: (row) => `<div class="row-actions">${row.status === "payment"
      ? `<button class="table-action" data-confirm-payment="${escapeHtml(row.id)}">Xác nhận ${formatMoney(row.amount)}</button>`
      : ""}<button class="table-action" data-detail-registration="${escapeHtml(row.id)}">Chi tiết</button></div>` },
  ].filter((item) => !(rutGon && item.rieng));

  const body = rows.map((row) => {
    // Ô tìm kiếm lọc theo chuỗi này, nên mã học sinh phải có mặt — giáo vụ tra
    // theo mã nhiều hơn theo tên.
    const searchText = `${row.id} ${row.student} ${row.studentCode || ""} ${row.club}`.toLowerCase();
    return `<tr data-row-text="${escapeHtml(searchText)}">${cot.map((item) => `<td>${item.cell(row)}</td>`).join("")}</tr>`;
  }).join("");

  return `<div class="table-wrap"><table class="data-table">
    <thead><tr>${cot.map((item) => `<th>${item.title}</th>`).join("")}</tr></thead>
    <tbody>${body || `<tr><td colspan="${cot.length}"><div class="empty-state">Không có dữ liệu phù hợp.</div></td></tr>`}</tbody>
  </table></div>`;
}

// Popup chi tiết một đơn đăng ký: ba tab theo đúng bố cục nhà trường yêu cầu.
// Chỉ trạng thái sửa được; thông tin học sinh và phụ huynh do đồng bộ Google
// Sheets làm chủ, sửa ở đây sẽ bị ghi đè ở lượt đồng bộ sau nên để nguyên chỉ đọc.
const AUDIT_ACTION_LABELS = {
  CREATE_REGISTRATION: "Tạo đơn đăng ký",
  CONFIRM_PAYMENT: "Xác nhận đã đóng phí",
  CHANGE_REGISTRATION_STATUS: "Đổi trạng thái",
};

let detailState = null;

const detailField = (label, value) =>
  `<div class="detail-field"><span>${escapeHtml(label)}</span><strong>${value ? escapeHtml(value) : "—"}</strong></div>`;

function renderDetailStudentTab({ registration, student }) {
  const chon = (danhSach) => danhSach.map((status) => {
    const [label] = statusBadge(status);
    return `<option value="${status}" ${registration.status === status ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
  return `<div class="detail-grid">
    <label class="form-field detail-status"><span>Trạng thái đăng ký</span>
      <select id="detail-status" class="select-field">
        <optgroup label="Vòng đời">${chon(LIFECYCLE_STATUSES)}</optgroup>
        <optgroup label="Ngoại lệ">${chon(EXCEPTION_STATUSES)}</optgroup>
      </select></label>
    ${detailField("Mã đơn", registration.id)}
    ${detailField("Ngày đăng ký", registration.date)}
    ${detailField("Mã học sinh", student?.code)}
    ${detailField("Họ và tên con", student?.name)}
    ${detailField("Ngày sinh", formatDateOfBirth(student?.dateOfBirth))}
    ${detailField("Lớp con đang học", student?.homeroom)}
    ${detailField("Cấp học", student?.level)}
    ${detailField("Câu lạc bộ", registration.clubName)}
    ${detailField("Ca học", registration.classLabel)}
    ${detailField("Lịch học", registration.scheduleSnapshot)}
    ${detailField("Phòng", registration.room)}
    ${detailField("Giáo viên", registration.teacher)}
    ${detailField("Học phí", registration.feeSnapshot ? formatMoney(Number(registration.feeSnapshot)) : "")}
    ${detailField("Đã đóng phí", registration.feePaid ? "Rồi" : "Chưa")}
  </div>`;
}

function renderDetailParentTab({ parents }) {
  if (!parents.length) {
    return `<div class="empty-state"><h3>Chưa liên kết phụ huynh</h3><p>Đơn này chưa có tài khoản phụ huynh nào gắn với học sinh. Kiểm tra lại danh bạ trên Google Sheets.</p></div>`;
  }
  return `<div class="table-wrap"><table class="data-table">
    <thead><tr><th>Quan hệ</th><th>Họ và tên</th><th>Số điện thoại</th><th>Email</th></tr></thead>
    <tbody>${parents.map((parent) => `<tr>
      <td>${escapeHtml(parent.relationship || "—")}</td>
      <td><strong>${escapeHtml(parent.name || "—")}</strong></td>
      <td>${escapeHtml(parent.account || "—")}</td>
      <td>${escapeHtml(parent.email || "—")}</td>
    </tr>`).join("")}</tbody>
  </table></div>
  ${parents.some((parent) => parent.email) ? "" : `<div class="info-note" style="margin-top:12px"><strong>Chưa có email:</strong> hệ thống chưa đồng bộ cột email phụ huynh từ file danh bạ. Xem tên cột thực tế ở mục Cấu hình &amp; phân quyền → Đồng bộ danh bạ.</div>`}`;
}

function renderDetailHistoryTab({ history }) {
  if (!history.length) {
    return `<div class="empty-state"><h3>Chưa có thay đổi nào</h3><p>Mọi lần đổi trạng thái từ nay sẽ được ghi lại tại đây kèm người thực hiện.</p></div>`;
  }
  return `<div class="history-list">${history.map((entry) => {
    const truoc = entry.before?.status ? statusBadge(entry.before.status)[0] : null;
    const sau = entry.after?.status ? statusBadge(entry.after.status)[0] : null;
    const doi = truoc && sau ? `${escapeHtml(truoc)} → ${escapeHtml(sau)}` : sau ? escapeHtml(sau) : "";
    return `<div class="history-item">
      <div class="history-when">${escapeHtml(formatAuditTime(entry.createdAt))}</div>
      <div class="history-body">
        <strong>${escapeHtml(AUDIT_ACTION_LABELS[entry.action] || entry.action)}</strong>
        ${doi ? `<span class="history-change">${doi}</span>` : ""}
        <span class="history-actor">${escapeHtml(entry.actorName || "Hệ thống")}</span>
        ${entry.reason ? `<p class="history-reason">${escapeHtml(entry.reason)}</p>` : ""}
      </div>
    </div>`;
  }).join("")}</div>`;
}

function formatAuditTime(value) {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return String(value ?? "");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh", hour12: false,
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).formatToParts(time).map((part) => [part.type, part.value]));
  return `${parts.hour}:${parts.minute} - ${parts.day}/${parts.month}/${parts.year}`;
}

function renderRegistrationDetail() {
  const { detail, tab } = detailState;
  const tabs = [
    ["hoc-sinh", "Thông tin học sinh", () => renderDetailStudentTab(detail)],
    ["phu-huynh", "Thông tin phụ huynh", () => renderDetailParentTab(detail)],
    ["lich-su", "Lịch sử thay đổi", () => renderDetailHistoryTab(detail)],
  ];
  const hienTai = tabs.find(([id]) => id === tab) || tabs[0];
  const [label, color] = statusBadge(detail.registration.status);
  showModal(`<div class="modal-head"><div><span class="eyebrow">Đơn ${escapeHtml(detail.registration.id)}</span>
      <h2>Chi tiết đăng ký</h2></div>
      <span class="badge badge-${color}">${escapeHtml(label)}</span>
      <button class="icon-button" data-close-modal aria-label="Đóng">${icon("x")}</button></div>
    <div class="detail-tabs">${tabs.map(([id, ten]) =>
      `<button class="detail-tab ${id === hienTai[0] ? "active" : ""}" data-detail-tab="${id}">${ten}</button>`).join("")}</div>
    <div class="modal-body">${hienTai[2]()}</div>
    <div id="detail-error" class="form-error" role="alert"></div>
    <div class="modal-foot"><button class="button button-secondary" data-close-modal>Đóng</button>
      <button class="button button-primary" id="detail-save" ${hienTai[0] === "hoc-sinh" ? "" : "disabled"}>Lưu</button></div>`,
    { wide: true });

  $$("[data-detail-tab]").forEach((button) => button.addEventListener("click", () => {
    detailState.tab = button.dataset.detailTab;
    renderRegistrationDetail();
  }));
  $("#detail-save")?.addEventListener("click", saveRegistrationStatus);
}

async function openRegistrationDetail(registrationId) {
  try {
    const payload = await api(`/admin/registrations/${encodeURIComponent(registrationId)}`);
    // Ngày hiển thị lấy từ bản ghi bảng ngoài đã định dạng sẵn, để hai nơi không
    // gọi cùng một mốc thời gian bằng hai kiểu khác nhau.
    const row = adminApplications.find((item) => item.id === registrationId);
    payload.detail.registration.date = row?.date || formatAuditTime(payload.detail.registration.createdAt);
    detailState = { detail: payload.detail, tab: "hoc-sinh" };
    renderRegistrationDetail();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function saveRegistrationStatus() {
  const chon = $("#detail-status");
  if (!chon) return;
  const next = chon.value;
  const box = $("#detail-error");
  box.textContent = "";
  if (next === detailState.detail.registration.status) {
    closeModal();
    return;
  }
  const button = $("#detail-save");
  button.disabled = true;
  try {
    await api(`/admin/registrations/${encodeURIComponent(detailState.detail.registration.id)}/status`,
      { method: "PATCH", body: JSON.stringify({ status: next }) });
    // Tải lại cả danh sách VÀ danh mục ca học: đổi trạng thái làm đổi cả sĩ số lớp
    // và các con số trên dashboard, hiện mỗi một dòng là để người dùng nhìn thấy số
    // cũ ở chỗ khác. Thiếu /api/clubs thì trang Danh sách lớp lấy sĩ số CŨ trừ đi
    // số đơn giữ chỗ MỚI, ra một con số không có thật.
    const [donMoi, lopMoi] = await Promise.all([api("/registrations"), api("/clubs")]);
    adminApplications = donMoi.registrations;
    clubs = lopMoi.clubs;
    closeModal();
    renderApp();
    toast(`Đã chuyển đơn sang “${statusBadge(next)[0]}”.`, "success");
  } catch (error) {
    // Cuộn câu báo lỗi vào tầm mắt: hộp lỗi nằm cuối popup, mà popup thì dài hơn
    // màn hình laptop. Không cuộn thì người dùng chỉ thấy nút Lưu không ăn.
    box.textContent = error.message;
    box.scrollIntoView({ block: "nearest" });
    button.disabled = false;
  }
}

// Ép về số an toàn cho mọi con số đến từ máy chủ: thiếu trường thì ra 0 chứ không
// ra NaN, vì "NaN/20" in ra màn hình là thứ không ai giải thích được.
const conSo = (value) => Number(value) || 0;

const ROSTER_CO_MAU = [10, 20, 50, 100];

/**
 * Bỏ dấu để tìm kiếm. Giáo vụ gõ "my thuat" phải ra "Mỹ thuật sáng tạo" — bắt gõ
 * đủ dấu là bắt họ gõ đúng thứ họ đang đi tìm, mà gõ dấu trên máy trường thì qua
 * bộ gõ, và bộ gõ thì hay nuốt chữ.
 */
const boDau = (value) => String(value ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replaceAll("đ", "d").replaceAll("Đ", "D")
  .toLowerCase();

/** Đơn còn hiệu lực / đơn đang giữ chỗ — hai câu hỏi khác nhau, xem registration-status.mjs. */
const roGiuCho = (row) => SEAT_HOLDING_STATUSES.includes(row.status);
const roConHieuLuc = (row) => ACTIVE_REGISTRATION_STATUSES.includes(row.status);

/**
 * Danh sách ca học để hiển thị: danh mục đang mở, CỘNG các ca "mồ côi".
 *
 * Ca mồ côi là ca còn đơn nhưng không còn trong /api/clubs — lớp đã tắt, hoặc
 * thuộc đợt khác. Đầu mỗi học kỳ, khi nhà trường đóng đợt cũ và mở đợt mới, TOÀN
 * BỘ ca của đợt trước rơi vào diện này. Bỏ chúng đi thì học sinh đang học biến mất
 * khỏi trang mà không một dòng cảnh báo — đã dựng máy chủ thật và đo: 7/7 em mất
 * sạch trong khi ô thống kê vẫn khẳng định có 2 em.
 */
function danhSachCaHoc() {
  const coTrongDanhMuc = new Set(clubs.map((ca) => ca.id));
  const moCoi = new Map();
  for (const row of adminApplications) {
    if (coTrongDanhMuc.has(row.classId) || moCoi.has(row.classId) || !roConHieuLuc(row)) continue;
    moCoi.set(row.classId, {
      id: row.classId, moCoi: true,
      name: row.club || row.classId, className: row.classLabel || "",
      schedule: row.schedule || "", room: row.room || "", teacher: row.teacher || "",
      category: "", grade: [], capacity: 0, minCapacity: 0, enrolled: 0, pending: 0, fee: 0,
    });
  }
  const sapXep = (a, b) => String(a.name).localeCompare(String(b.name), "vi")
    || conSo(a.dayOfWeek) - conSo(b.dayOfWeek)
    || String(a.startTime || "").localeCompare(String(b.startTime || ""));
  return [...clubs].sort(sapXep).concat([...moCoi.values()].sort(sapXep));
}

/** Học sinh của một ca, đã sắp: em đang giữ chỗ trước, rồi tới đơn còn treo. */
function hocSinhCuaCa(classId, chiGiuCho) {
  return adminApplications
    .filter((row) => row.classId === classId && (chiGiuCho ? roGiuCho(row) : roConHieuLuc(row)))
    .sort((a, b) => (roGiuCho(a) ? 0 : 1) - (roGiuCho(b) ? 0 : 1)
      || String(a.student).localeCompare(String(b.student), "vi"));
}

/**
 * Trạng thái một ca học, gọn thành một huy hiệu.
 *
 * "Đã đầy" tính theo sĩ số ĐANG GIỮ CHỖ, đúng luật nhà trường chốt: chỗ chỉ có chủ
 * từ khi đóng phí. Dưới sĩ số tối thiểu phải thấy ngay, vì đó là ca có nguy cơ
 * không khai giảng được.
 */
function trangThaiCa(ca) {
  if (ca.moCoi) return ["Ngoài đợt đang mở", "purple"];
  const daDung = conSo(ca.enrolled);
  const toiDa = conSo(ca.capacity);
  const toiThieu = conSo(ca.minCapacity);
  if (toiDa <= 0) return ["Chưa đặt sĩ số", "gold"];
  if (daDung >= toiDa) return ["Đã đầy", "red"];
  if (toiThieu > 0 && daDung < toiThieu) return [`Chưa đủ tối thiểu ${toiThieu}`, "gold"];
  return [`Còn ${toiDa - daDung} chỗ`, "green"];
}

/**
 * Danh sách lớp CLB: một bảng tra cứu các ca học, bấm "Chi tiết" ra danh sách học
 * sinh của ca đó. Bố cục theo đúng màn "Danh sách lớp" nhà trường đang dùng ở hệ
 * thống quản lý học sinh, để giáo vụ không phải học lại một cách đọc khác.
 *
 * Phạm vi dữ liệu bám quyền danh-sach-van-hanh trong roles.mjs: tên học sinh, lớp
 * hành chính, trạng thái đơn. Mã học sinh và ngày sinh chỉ hiện cho người có quyền
 * duyet-don — máy chủ cũng đã cắt sẵn hai trường đó theo đúng quyền ấy.
 */
function renderRosters() {
  const tatCa = danhSachCaHoc();
  const thieuSiSo = tatCa.filter((ca) => conSo(ca.minCapacity) > 0 && conSo(ca.enrolled) < conSo(ca.minCapacity)).length;
  const donGiuCho = adminApplications.filter(roGiuCho);
  const soCho = adminApplications.filter((row) => roConHieuLuc(row) && !roGiuCho(row)).length;

  // Hết đợt thì máy chủ trả về ca của MỌI đợt. Nói "trong đợt" lúc đó là sai, mà im
  // lặng còn tệ hơn: giáo vụ đếm số ca để bàn giao giáo viên sẽ đếm lẫn cả ca của
  // học kỳ sau. Nhãn phải đổi theo đúng thứ máy chủ vừa trả về.
  const dot = state.period;
  const nhanDot = dot ? `${dot.name} · đang mở nhận đăng ký` : "Chưa có đợt nào đang mở · đang hiện ca của mọi đợt";

  return `<section class="grid grid-4" data-no-print>
    ${renderStat("grid", "blue", String(tatCa.length), dot ? "Ca học đang hiển thị" : "Ca học đang hiển thị", nhanDot)}
    ${renderStat("users", "aqua", String(new Set(donGiuCho.map((row) => row.studentId)).size), "Học sinh đang giữ chỗ", `${donGiuCho.length} lượt đăng ký`)}
    ${renderStat("clock", "gold", String(soCho), "Đơn chưa giữ chỗ", "Chờ đóng phí hoặc đang xếp chờ")}
    ${renderStat("spark", thieuSiSo ? "red" : "aqua", String(thieuSiSo), "Ca dưới sĩ số tối thiểu", thieuSiSo ? "Cần xem lại" : "Không có")}
  </section>

  <section class="section" style="margin-top:0">
    <div class="section-head"><div><span class="eyebrow">Xếp lớp & điểm danh</span><h2>Danh sách lớp CLB</h2>
    <p>${escapeHtml(nhanDot)}. Bấm <strong>Chi tiết</strong> ở từng ca để xem và in danh sách học sinh.</p></div>
    <button class="button button-secondary" data-no-print data-roster-csv-all>${icon("download")} Xuất toàn bộ đơn còn hiệu lực (CSV)</button></div>
    <div class="filters" data-no-print>
      <label class="search-field">${icon("search")}<input id="roster-search" placeholder="Tìm CLB, ca học, phòng, giáo viên, tên học sinh..." value="${escapeHtml(state.rosterSearch || "")}" /></label>
    </div>
  </section>

  <section class="section panel" id="roster-results">${renderRosterResults()}</section>`;
}

/**
 * Phần kết quả tra cứu, tách riêng để ô tìm kiếm KHÔNG bị dựng lại theo mỗi phím.
 *
 * Trước đây gõ một ký tự là vẽ lại cả trang, kể cả lúc bộ gõ tiếng Việt đang soạn
 * dở một chữ — phần tử input bị hủy giữa chừng nên bộ gõ chèn lại nguyên cụm vào
 * cuối giá trị cũ: gõ "mỹ thuật" ra "mmymyxmỹ tththuthuathuaathuaatthuaatjthuật"
 * và tra cứu ra 0 kết quả. Đã tái hiện bằng Chrome thật qua Input.imeSetComposition.
 */
function renderRosterResults() {
  const tim = boDau(state.rosterSearch).trim();
  const tatCa = danhSachCaHoc();
  // Tìm được cả theo TÊN HỌC SINH: giáo vụ hay phải trả lời "em này đang học ca nào".
  const tenTheoCa = new Map();
  for (const row of adminApplications) {
    if (!roConHieuLuc(row)) continue;
    tenTheoCa.set(row.classId, `${tenTheoCa.get(row.classId) || ""} ${boDau(row.student)} ${boDau(row.id)}`);
  }
  const khop = (ca) => !tim
    || boDau([ca.name, ca.className, ca.room, ca.teacher, ca.category, ca.schedule].filter(Boolean).join(" ")).includes(tim)
    || String(tenTheoCa.get(ca.id) || "").includes(tim);
  const dsCa = tatCa.filter(khop);

  // Con số học sinh phải đi theo đúng cái bảng đang hiện, không thì nó đứng cạnh
  // "Kết quả tra cứu: 0 ca học" mà vẫn khẳng định có người.
  const idHien = new Set(dsCa.map((ca) => ca.id));
  const donHien = adminApplications.filter((row) => idHien.has(row.classId) && roGiuCho(row));
  const soHocSinh = new Set(donHien.map((row) => row.studentId)).size;
  const ghiDanhSanTong = dsCa.reduce((tong, ca) => tong + Math.max(0, conSo(ca.enrolled)
    - adminApplications.filter((row) => row.classId === ca.id && roGiuCho(row)).length), 0);

  const moiTrang = ROSTER_CO_MAU.includes(conSo(state.rosterPageSize)) ? conSo(state.rosterPageSize) : 10;
  const soTrang = Math.max(1, Math.ceil(dsCa.length / moiTrang));
  const trang = Math.min(Math.max(1, conSo(state.rosterPage) || 1), soTrang);
  const batDau = (trang - 1) * moiTrang;
  const trongTrang = dsCa.slice(batDau, batDau + moiTrang);

  const cot = [
    { title: "CLB", cell: (ca) => `<strong>${escapeHtml(ca.name)}</strong>` },
    { title: "Ca học", cell: (ca) => escapeHtml(ca.className || "Ca chính") },
    { title: "Lịch học", cell: (ca) => escapeHtml(ca.schedule || "—") },
    { title: "Trạng thái", cell: (ca) => { const [nhan, mau] = trangThaiCa(ca); return `<span class="badge badge-${mau}">${escapeHtml(nhan)}</span>`; } },
    { title: "Nhóm môn", cell: (ca) => escapeHtml(ca.category || "—") },
    { title: "Phòng học", cell: (ca) => escapeHtml(ca.room || "—") },
    // Sĩ số là số em ĐANG GIỮ CHỖ trên sức chứa; đơn chưa giữ chỗ để riêng một dòng
    // vì nó KHÔNG chiếm chỗ — gộp chung là hứa một con số không có thật.
    { title: "Sĩ số", cell: (ca) => (ca.moCoi
      ? `<span style="color:var(--muted)">Ngoài đợt</span>`
      : `${conSo(ca.enrolled)}/${conSo(ca.capacity)}${conSo(ca.pending)
        ? `<br><span style="color:var(--muted)">+${conSo(ca.pending)} đơn chưa giữ chỗ</span>` : ""}`) },
    { title: "Giáo viên phụ trách", cell: (ca) => escapeHtml(ca.teacher || "—") },
  ];

  const than = trongTrang.length
    ? trongTrang.map((ca, i) => `<tr${ca.moCoi ? ' class="roster-mocoi"' : ""}>
        <td>${batDau + i + 1}</td>
        <td><button class="table-action" data-roster-detail="${escapeHtml(ca.id)}">Chi tiết</button></td>
        ${cot.map((item) => `<td>${item.cell(ca)}</td>`).join("")}
      </tr>`).join("")
    : `<tr><td colspan="${cot.length + 2}" class="empty-cell">${tim
        ? "Không có ca học nào khớp từ khóa."
        : "Đợt đăng ký hiện tại chưa mở ca học nào, hoặc tất cả đang tắt."}</td></tr>`;

  const soMoCoi = dsCa.filter((ca) => ca.moCoi).length;
  return `<div class="panel-head">
      <div><h3>Kết quả tra cứu: ${dsCa.length} ca học${tim ? ` / ${tatCa.length}` : ""}</h3>
      <p>Sĩ số tính theo số em đang giữ chỗ (đã đóng phí trở đi).</p></div>
      <div style="text-align:right">
        <strong>Số lượng học sinh: ${soHocSinh} học sinh</strong>
        ${ghiDanhSanTong ? `<br><span class="roster-note">chưa kể ${ghiDanhSanTong} em ghi danh sẵn ngoài hệ thống</span>` : ""}
      </div>
    </div>
    ${soMoCoi ? `<div class="roster-canh-bao">${icon("clock")} ${soMoCoi} ca học không thuộc đợt đang mở (lớp đã tắt hoặc thuộc đợt khác) nhưng vẫn còn học sinh có đơn — vẫn liệt kê ở đây để không sót ai.</div>` : ""}
    <div class="table-wrap"><table class="data-table roster-index">
      <thead><tr><th style="width:44px">#</th><th style="width:80px">Chi tiết</th>${cot.map((item) => `<th>${item.title}</th>`).join("")}</tr></thead>
      <tbody>${than}</tbody>
    </table></div>
    ${renderRosterPager(trang, soTrang, moiTrang, dsCa.length)}`;
}

/** Phân trang giống màn danh sách lớp của hệ thống quản lý học sinh nhà trường. */
function renderRosterPager(trang, soTrang, moiTrang, tong) {
  if (!tong) return "";
  const so = [];
  for (let i = 1; i <= soTrang; i += 1) {
    if (i === 1 || i === soTrang || Math.abs(i - trang) <= 2) so.push(i);
    else if (so[so.length - 1] !== "…") so.push("…");
  }
  return `<div class="roster-pager" data-no-print>
    <span class="roster-note">Hiển thị ${Math.min(tong, (trang - 1) * moiTrang + 1)}–${Math.min(tong, trang * moiTrang)} trên ${tong} ca học</span>
    <div class="roster-pager-nav">
      <button class="table-action" data-roster-page="${trang - 1}" ${trang <= 1 ? "disabled" : ""}>‹</button>
      ${so.map((i) => (i === "…"
        ? `<span class="roster-note">…</span>`
        : `<button class="table-action ${i === trang ? "active" : ""}" data-roster-page="${i}">${i}</button>`)).join("")}
      <button class="table-action" data-roster-page="${trang + 1}" ${trang >= soTrang ? "disabled" : ""}>›</button>
      <select id="roster-page-size" class="select-field">
        ${ROSTER_CO_MAU.map((n) => `<option value="${n}" ${n === moiTrang ? "selected" : ""}>${n} / trang</option>`).join("")}
      </select>
    </div>
  </div>`;
}

/**
 * Popup chi tiết một ca học. Hai thẻ, cả hai đều có dữ liệu thật.
 *
 * KHÔNG có nút "Thêm học sinh vào lớp" / "Xóa học sinh khỏi lớp" như màn quản lý
 * học sinh của nhà trường: ở cổng này, một em vào ca học CHỈ qua đơn đăng ký và
 * rời đi bằng cách đổi trạng thái đơn. Thêm tay là đi vòng qua cả kiểm tra sĩ số
 * lẫn bước thu phí, và chỗ đó sẽ không có đơn nào để đối chiếu. Đường đúng là mở
 * đơn ở cột "Đơn".
 */
function renderRosterDetail() {
  const ca = danhSachCaHoc().find((item) => item.id === state.rosterDetailId);
  if (!ca) { closeModal(); return; }
  const chiGiuCho = state.rosterOnlyPaid !== false;
  const rows = hocSinhCuaCa(ca.id, chiGiuCho);
  const soGiuCho = adminApplications.filter((row) => row.classId === ca.id && roGiuCho(row)).length;
  // Sĩ số còn cộng cả số em ghi danh sẵn ngoài hệ thống (enrolled_base). Lệch mà
  // không nói ra thì giáo vụ tưởng hệ thống làm mất tên học sinh.
  const ghiDanhSan = ca.moCoi ? 0 : Math.max(0, conSo(ca.enrolled) - soGiuCho);
  const [nhanCa, mauCa] = trangThaiCa(ca);
  const tab = state.rosterTab === "thong-tin" ? "thong-tin" : "hoc-sinh";
  const dongLich = [ca.className || "Ca chính", ca.schedule, ca.room, ca.teacher].filter(Boolean).join(" · ");

  const than = tab === "thong-tin"
    ? `<div class="detail-grid">
        ${detailField("Câu lạc bộ", ca.name)}
        ${detailField("Ca học", ca.className || "Ca chính")}
        ${detailField("Nhóm môn", ca.category)}
        ${detailField("Lịch học", ca.schedule)}
        ${detailField("Phòng học", ca.room)}
        ${detailField("Giáo viên phụ trách", ca.teacher)}
        ${detailField("Khối áp dụng", (ca.grade || []).join(", "))}
        ${detailField("Học phí", ca.moCoi ? "" : formatMoney(conSo(ca.fee)))}
        ${detailField("Sĩ số đang giữ chỗ", ca.moCoi ? "" : `${conSo(ca.enrolled)}/${conSo(ca.capacity)}`)}
        ${detailField("Sĩ số tối thiểu", ca.moCoi ? "" : (conSo(ca.minCapacity) || "Không đặt"))}
        ${detailField("Đơn chưa giữ chỗ", ca.moCoi ? "" : `${conSo(ca.pending)} đơn`)}
        ${detailField("Ghi danh sẵn ngoài hệ thống", ghiDanhSan ? `${ghiDanhSan} em` : "Không có")}
      </div>
      ${ca.moCoi ? `<p class="roster-canh-bao">Ca này không còn trong đợt đang mở — lớp đã tắt hoặc thuộc đợt khác. Thông tin lấy từ chính các đơn của học sinh, nên không có sĩ số và học phí.</p>` : ""}`
    : renderRosterStudents(ca, rows, chiGiuCho, ghiDanhSan);

  showModal(`<div class="modal-head"><div><span class="eyebrow">Chi tiết ca học</span>
      <h2>${escapeHtml(ca.name)}</h2>
      <p class="roster-note">${escapeHtml(dongLich)}</p></div>
      <span class="badge badge-${mauCa}">${escapeHtml(nhanCa)}</span>
      <button class="icon-button" data-no-print data-close-modal aria-label="Đóng">${icon("x")}</button></div>
    <div class="detail-tabs" data-no-print>
      <button class="detail-tab ${tab === "thong-tin" ? "active" : ""}" data-roster-tab="thong-tin">Thông tin lớp</button>
      <button class="detail-tab ${tab === "hoc-sinh" ? "active" : ""}" data-roster-tab="hoc-sinh">Danh sách học sinh</button>
    </div>
    <div class="modal-body">${than}</div>
    <div class="modal-foot" data-no-print>
      <button class="button button-secondary" data-close-modal>Đóng</button>
      <button class="button button-secondary" data-roster-csv-ca="${escapeHtml(ca.id)}">${icon("download")} Tải CSV</button>
      <button class="button button-primary" data-roster-print>In danh sách</button>
    </div>`, { wide: true });

  // Buộc mọi lời gọi vào TRONG popup. Trước đây dùng $$ trên cả tài liệu nên mỗi
  // lần mở popup lại gắn thêm một listener vào nút CSV NGOÀI trang — bấm một cái
  // tải về mấy tệp cùng lúc.
  const hop = $(".modal");
  hop?.querySelectorAll("[data-roster-tab]").forEach((el) => el.addEventListener("click", () => {
    state.rosterTab = el.dataset.rosterTab;
    renderRosterDetail();
  }));
  hop?.querySelectorAll("[data-roster-scope]").forEach((el) => el.addEventListener("click", () => {
    state.rosterOnlyPaid = el.dataset.rosterScope === "paid";
    renderRosterDetail();
  }));
  hop?.querySelectorAll("[data-roster-csv-ca]").forEach((el) => el.addEventListener("click", () =>
    exportRosterCsv(el.dataset.rosterCsvCa, state.rosterOnlyPaid !== false ? "giu-cho" : "hieu-luc")));
  hop?.querySelector("[data-roster-print]")?.addEventListener("click", () => window.print());
  hop?.querySelectorAll("[data-detail-registration]").forEach((el) => el.addEventListener("click", () => openRegistrationDetail(el.dataset.detailRegistration)));
}

/** Bảng học sinh trong popup — đúng bộ cột màn danh sách lớp của nhà trường. */
function renderRosterStudents(ca, rows, chiGiuCho, ghiDanhSan) {
  // Mã học sinh và ngày sinh là dữ liệu cá nhân nằm NGOÀI phạm vi quyền
  // danh-sach-van-hanh của giáo vụ. Máy chủ đã không gửi hai trường này cho họ, nên
  // hiện cột rỗng chỉ là bày ra hai ô gạch ngang — ẩn hẳn cột thì đúng hơn.
  const xemDinhDanh = hasCap("duyet-don");
  const cot = [
    ...(xemDinhDanh ? [{ title: "Mã học sinh", cell: (row) => escapeHtml(row.studentCode || "—") }] : []),
    { title: "Tên học sinh", cell: (row) => `<strong>${escapeHtml(row.student)}</strong>` },
    ...(xemDinhDanh ? [{ title: "Ngày sinh", cell: (row) => escapeHtml(formatDateOfBirth(row.dateOfBirth)) }] : []),
    { title: "Lớp", cell: (row) => escapeHtml(row.className) },
    { title: "Trạng thái", cell: (row) => { const [nhan, mau] = statusBadge(row.status); return `<span class="badge badge-${mau}">${escapeHtml(nhan)}</span>${row.feePaid ? '<br><span style="color:var(--muted)">đã thu phí</span>' : ""}`; } },
    // Giáo vụ KHÔNG có quyền duyet-don nên popup chi tiết đơn trả 403 cho họ. Vẽ ra
    // một cái nút chỉ để bấm vào nhận thông báo lỗi là dựng sẵn một ngõ cụt ở mỗi
    // dòng; mã đơn thì họ vẫn được xem, nên hiện thành chữ.
    { title: "Đơn", cell: (row) => (xemDinhDanh
      ? `<button class="table-action" data-detail-registration="${escapeHtml(row.id)}">${escapeHtml(row.id)}</button>`
      : escapeHtml(row.id)) },
  ];

  const trong = ghiDanhSan > 0
    ? `Không em nào đăng ký ca này qua cổng. ${ghiDanhSan} em đang giữ chỗ được ghi danh sẵn ngoài hệ thống, nhà trường giữ danh sách riêng.`
    : chiGiuCho ? "Chưa em nào giữ chỗ ở ca này." : "Chưa có đơn nào cho ca này.";

  return `<div class="roster-scope">
      <div class="status-tabs" data-no-print>
        <button class="status-tab ${chiGiuCho ? "active" : ""}" data-roster-scope="paid">Chính thức (đang giữ chỗ)</button>
        <button class="status-tab ${chiGiuCho ? "" : "active"}" data-roster-scope="all">Kèm đơn chưa giữ chỗ</button>
      </div>
      <span class="roster-note">${rows.length} em trong danh sách${ghiDanhSan ? ` · ${ghiDanhSan} em ghi danh sẵn ngoài hệ thống` : ""}</span>
    </div>
    ${rows.length
      ? `<div class="table-wrap"><table class="data-table roster-table">
          <thead><tr><th style="width:44px">#</th>${cot.map((item) => `<th>${item.title}</th>`).join("")}</tr></thead>
          <tbody>${rows.map((row) => `<tr>
            <td class="roster-stt"></td>
            ${cot.map((item) => `<td>${item.cell(row)}</td>`).join("")}
          </tr>`).join("")}</tbody></table></div>`
      : `<p style="margin:0;color:var(--muted)">${escapeHtml(trong)}</p>`}`;
}

const KET_CUC_XEP_LOP = {
  xepDuoc: ["Xếp được", "green"],
  daCoDon: ["Đã có đơn — bỏ qua", "blue"],
  chuaGhepCa: ["Chưa ghép ca học", "gold"],
  khongTimThayHocSinh: ["Không có mã học sinh", "red"],
  hocSinhNghiHoc: ["Học sinh đã nghỉ", "red"],
  trungGio: ["Trùng giờ", "gold"],
  saiKhoi: ["Sai khối", "gold"],
  vuotHanMuc: ["Vượt hạn mức CLB", "gold"],
  trungTrongFile: ["Trùng trong chính file", "blue"],
  hong: ["Dòng hỏng", "red"],
};

/**
 * Nhập đăng ký hàng loạt từ file Google Form.
 *
 * Đây là công cụ chuyển một đợt đăng ký CŨ vào hệ thống: vài trăm em đã đóng phí và
 * đang học thật, nhưng chưa có đơn nào. Cả màn hình xoay quanh một việc: nói trước
 * chuyện gì SẼ xảy ra, đủ rõ để người vận hành dám bấm ghi vài trăm đơn.
 */
function renderNhapDangKy() {
  const draft = state.nhapDangKy || {};
  const preview = draft.preview || null;
  const dsDot = state.catalog?.periods || [];
  const dotId = draft.periodId || state.catalog?.activePeriodId || dsDot[0]?.id || "";

  return `<section class="section" style="margin-top:0">
    <div class="section-head"><div><span class="eyebrow">Chuyển dữ liệu</span><h2>Nhập đăng ký hàng loạt</h2>
    <p>Dành cho đợt đã đăng ký qua Google Form trước khi có cổng này. Mỗi dòng trong file thành một đơn thật, để các em có tên trong danh sách lớp và phụ huynh thấy được trong cổng.</p></div>
    <button class="button button-secondary" data-go="applications">← Về danh sách đơn</button></div>
  </section>

  <section class="section panel"><div class="panel-head"><div><h3>1. Chọn đợt và file</h3>
    <p>File cần ít nhất hai cột: <b>Mã học sinh</b> và <b>CLB</b>. Đọc ngay trên máy bạn, không tải lên đâu cả.</p></div></div>
    <div class="panel-body">
      <label class="form-field"><span>Đợt đăng ký sẽ ghi các đơn này vào</span>
        <select id="nhap-dot" class="select-field">
          ${dsDot.map((dot) => `<option value="${escapeHtml(dot.id)}" ${dot.id === dotId ? "selected" : ""}>${escapeHtml(dot.name)}</option>`).join("")}
        </select></label>
      <label class="form-field" style="margin-top:11px"><span>File .xlsx hoặc .csv kết quả Google Form</span>
        <input id="nhap-file" type="file" accept=".xlsx,.csv" /></label>
      ${(draft.sources || []).length
        ? `<div class="mapping-list" style="margin-top:11px">${draft.sources.map((source) =>
          `<span><b>${escapeHtml(source.label)}</b>${source.rows.length} dòng</span>`).join("")}</div>` : ""}
      <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:13px">
        <button class="button button-secondary" id="nhap-kiemtra" ${(draft.sources || []).length ? "" : "disabled"}>Kiểm tra file</button>
      </div>
      <div id="nhap-error" class="form-error" role="alert"></div>
    </div>
  </section>

  ${preview ? renderNhapDangKyPreview(preview, draft) : ""}`;
}

function renderNhapDangKyPreview(preview, draft) {
  const dem = preview.dem || {};
  const chuaGhep = preview.oChon.filter((item) => !item.classId).length;
  const xepDuoc = dem.xepDuoc || 0;

  return `<section class="section panel"><div class="panel-head"><div><h3>2. Ghép ô chọn của Form với ca học</h3>
    <p>Google Form chỉ có ${preview.oChon.length} giá trị khác nhau cho ${preview.tongDong} dòng. Ghép một lần ở đây, máy không tự đoán khi một CLB có nhiều ca.</p></div>
    ${chuaGhep ? `<span class="badge badge-gold">${chuaGhep} ô chưa ghép</span>` : `<span class="badge badge-green">Đã ghép đủ</span>`}</div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Ô chọn trong file</th><th style="width:90px">Số dòng</th><th>Ca học trong hệ thống</th></tr></thead>
      <tbody>${preview.oChon.map((item) => `<tr>
        <td><strong>${escapeHtml(item.mau)}</strong>${item.tuChon ? "" : item.classId ? `<br><span style="color:var(--muted)">máy ghép tự động</span>` : ""}</td>
        <td>${item.soDong}</td>
        <td><select class="select-field" data-ghep-ca="${escapeHtml(item.khoa)}">
          <option value="">— chưa ghép —</option>
          ${preview.caTrongDot.map((ca) => `<option value="${escapeHtml(ca.id)}" ${ca.id === item.classId ? "selected" : ""}>${escapeHtml(ca.nhan)}</option>`).join("")}
        </select></td>
      </tr>`).join("")}</tbody>
    </table></div>
  </section>

  <section class="section panel"><div class="panel-head"><div><h3>3. Từng dòng sẽ ra sao</h3>
    <p>${preview.tongDong} dòng trong file. Không dòng nào bị bỏ im lặng.</p></div></div>
    <div class="panel-body"><div class="mapping-list">${Object.entries(dem).map(([ketCuc, so]) => {
      const [nhan, mau] = KET_CUC_XEP_LOP[ketCuc] || [ketCuc, "blue"];
      return `<span><b>${escapeHtml(nhan)}</b><span class="badge badge-${mau}">${so}</span></span>`;
    }).join("")}</div></div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th style="width:60px">Dòng</th><th>Mã học sinh</th><th>Học sinh</th><th>Ô chọn trong file</th><th>Kết cục</th></tr></thead>
      <tbody>${preview.rows.slice(0, 200).map((row) => {
        const [nhan, mau] = KET_CUC_XEP_LOP[row.ketCuc] || [row.ketCuc, "blue"];
        return `<tr>
          <td>${row.dong}</td>
          <td>${escapeHtml(row.studentCode || "—")}</td>
          <td>${escapeHtml(row.studentTen || row.studentName || "—")}</td>
          <td>${escapeHtml(row.clubText || "—")}</td>
          <td><span class="badge badge-${mau}">${escapeHtml(nhan)}</span>${row.lyDo ? `<br><span style="color:var(--muted)">${escapeHtml(row.lyDo)}</span>` : row.caNhan ? `<br><span style="color:var(--muted)">→ ${escapeHtml(row.caNhan)}</span>` : ""}</td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>
    ${preview.rows.length > 200 ? `<div class="panel-body"><p class="roster-note">Chỉ hiện 200 dòng đầu; khi ghi thì xử lý đủ ${preview.rows.length} dòng.</p></div>` : ""}
  </section>

  ${preview.caAnhHuong.length ? `<section class="section panel"><div class="panel-head"><div><h3>4. Sĩ số từng ca sẽ thay đổi thế nào</h3>
    <p>Các em trong file đang được đếm ở ô <b>ghi danh sẵn ngoài hệ thống</b>. Nhập thành đơn mà không hạ con số đó xuống là <b>đếm hai lần</b>.</p></div></div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Ca học</th><th style="width:90px">Nhập vào</th><th>Ghi danh sẵn</th><th>Sĩ số nếu HẠ</th><th>Sĩ số nếu KHÔNG hạ</th></tr></thead>
      <tbody>${preview.caAnhHuong.map((ca) => `<tr>
        <td><strong>${escapeHtml(ca.nhan)}</strong></td>
        <td>${ca.soEmNhapVao} em</td>
        <td>${ca.enrolledBaseHienTai} → <b>${ca.enrolledBaseDeXuat}</b>${ca.thieuGhiDanhSan ? `<br><span style="color:var(--red)">nhập nhiều hơn số ghi danh sẵn</span>` : ""}</td>
        <td><span class="badge badge-green">${ca.siSoSauNeuHaBase}/${ca.capacity}</span></td>
        <td><span class="badge badge-red">${ca.siSoSauNeuGiuBase}/${ca.capacity}</span></td>
      </tr>`).join("")}</tbody>
    </table></div>
  </section>` : ""}

  <section class="section panel"><div class="panel-head"><div><h3>5. Ghi vào hệ thống</h3>
    <p>${xepDuoc} đơn sẽ được tạo. Thao tác này không hoàn tác được bằng một cú bấm — nên sao lưu trước nếu chưa.</p></div></div>
    <div class="panel-body">
      <label class="form-field"><span>Trạng thái của các đơn này</span>
        <select id="nhap-trangthai" class="select-field">
          ${LIFECYCLE_STATUSES.map((status) => `<option value="${status}" ${status === (draft.trangThai || "dang_hoc") ? "selected" : ""}>${escapeHtml(statusBadge(status)[0])}</option>`).join("")}
        </select></label>
      <label class="checkbox-row" style="margin-top:11px">
        <input type="checkbox" id="nhap-dathuphi" ${draft.daThuPhi === false ? "" : "checked"} />
        <span>Đánh dấu <b>đã thu phí</b> cho tất cả các đơn này</span></label>
      <label class="checkbox-row" style="margin-top:7px">
        <input type="checkbox" id="nhap-habase" ${draft.haGhiDanhSan === false ? "" : "checked"} />
        <span>Hạ ô <b>ghi danh sẵn ngoài hệ thống</b> xuống tương ứng, để sĩ số không đếm hai lần</span></label>
      <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:13px">
        <button class="button button-primary" id="nhap-ghi" ${preview.sanSang ? "" : "disabled"}>Ghi ${xepDuoc} đơn vào hệ thống</button>
      </div>
      ${preview.sanSang ? "" : `<p class="field-hint">${preview.filesHong ? "Còn file không đọc được." : "Chưa có dòng nào xếp được — hãy ghép ô chọn với ca học ở bước 2."}</p>`}
      <div id="nhap-error-2" class="form-error" role="alert"></div>
    </div>
  </section>`;
}

function bindNhapDangKy() {
  const draft = () => (state.nhapDangKy = state.nhapDangKy || { sources: [], preview: null });
  const loi = (text) => { const o = $("#nhap-error-2") || $("#nhap-error"); if (o) o.textContent = text; };

  $("#nhap-dot")?.addEventListener("change", (event) => {
    state.nhapDangKy = { ...draft(), periodId: event.target.value, preview: null };
    renderPage();
  });

  $("#nhap-file")?.addEventListener("change", async (event) => {
    loi("");
    try {
      const sources = await docFileExcel([...event.target.files]);
      if (!sources.length) throw new Error("Không đọc được sheet nào có dữ liệu trong file đã chọn.");
      // Đổi file thì bản xem trước cũ hết giá trị; giữ lại là mời người dùng bấm ghi
      // theo một kết quả không còn đúng với file đang chọn.
      state.nhapDangKy = { ...draft(), sources, preview: null, mapping: {} };
      renderPage();
    } catch (error) { loi(error.message); }
  });

  const xemTruoc = async () => {
    const d = draft();
    const payload = {
      files: d.sources, periodId: d.periodId || state.catalog?.activePeriodId, mapping: d.mapping || {},
    };
    const { preview } = await api("/admin/registrations/import/preview", { method: "POST", body: JSON.stringify(payload) });
    // Nhớ lại bảng ghép mà máy vừa đề xuất, để lần xem trước sau không mất lựa chọn
    // người dùng đã sửa tay.
    const mapping = { ...(d.mapping || {}) };
    for (const item of preview.oChon) if (item.classId) mapping[item.khoa] = item.classId;
    state.nhapDangKy = { ...d, preview, mapping, periodId: preview.periodId };
    renderPage();
  };

  $("#nhap-kiemtra")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    loi("");
    try { await xemTruoc(); } catch (error) { loi(error.message); button.disabled = false; }
  });

  $$("[data-ghep-ca]").forEach((select) => select.addEventListener("change", async () => {
    const d = draft();
    state.nhapDangKy = { ...d, mapping: { ...(d.mapping || {}), [select.dataset.ghepCa]: select.value } };
    try { await xemTruoc(); } catch (error) { loi(error.message); }
  }));

  for (const [id, khoa] of [["nhap-trangthai", "trangThai"], ["nhap-dathuphi", "daThuPhi"], ["nhap-habase", "haGhiDanhSan"]]) {
    $(`#${id}`)?.addEventListener("change", (event) => {
      state.nhapDangKy = {
        ...draft(),
        [khoa]: event.target.type === "checkbox" ? event.target.checked : event.target.value,
      };
    });
  }

  $("#nhap-ghi")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const d = draft();
    const soDon = d.preview?.dem?.xepDuoc || 0;
    if (!window.confirm(`Ghi ${soDon} đơn đăng ký vào hệ thống? Thao tác này không hoàn tác được bằng một cú bấm.`)) return;
    button.disabled = true;
    loi("");
    try {
      const payload = {
        files: d.sources, periodId: d.periodId || state.catalog?.activePeriodId, mapping: d.mapping || {},
        confirmation: "NHAP_DANG_KY_HANG_LOAT",
        status: d.trangThai || "dang_hoc",
        feePaid: d.daThuPhi !== false,
        haGhiDanhSan: d.haGhiDanhSan !== false,
      };
      const { result } = await api("/admin/registrations/import/commit", { method: "POST", body: JSON.stringify(payload) });
      const [donMoi, lopMoi, danhMuc] = await Promise.all([api("/registrations"), api("/clubs"), refreshCatalog()]);
      adminApplications = donMoi.registrations;
      clubs = lopMoi.clubs;
      state.nhapDangKy = null;
      goTo("applications");
      toast(`Đã tạo ${result.daTao} đơn và hạ ghi danh sẵn ở ${result.daHaBase} ca học.`, "success");
    } catch (error) { loi(error.message); button.disabled = false; }
  });
}

function renderReports() {
  const reports = [
    ["Tổng quan đợt đăng ký","KPI, tỷ lệ lấp đầy, lớp đầy/thiếu sĩ số"],["Danh sách theo CLB/lớp","Học sinh, lớp hành chính, lịch, phí, ghi chú"],["Danh sách chờ & gọi lại","Thứ tự chờ, lý do, phương án thay thế, người phụ trách"],["Tài chính & công nợ","Phải thu, đã thu, chờ thu, hoàn/chuyển phí"],["Vận hành lớp","Phòng, giáo viên, min/max, lớp cần mở/gộp/hủy"],["Lịch sử thay đổi","Đổi lớp, hủy, chuyển lịch, người xử lý và lý do"],
  ];
  return `<div class="demo-banner"><span><strong>Nguyên tắc bảo mật:</strong> Chỉ xuất các trường dữ liệu nằm trong phạm vi vai trò được cấp.</span><button class="button button-secondary" data-export>${icon("download")} Xuất danh sách đăng ký (CSV)</button></div>
  ${hasCap("xuat-du-lieu") ? renderBackupPanel() : ""}
  <section class="section"><div class="section-head"><div><span class="eyebrow">Đang thiết kế</span><h2>Bộ báo cáo theo vai trò</h2><p>Các mẫu báo cáo dưới đây chưa nối dữ liệu, hiện mới có xuất CSV danh sách đăng ký và sao lưu toàn bộ dữ liệu ở trên.</p></div></div>
  <div class="grid grid-3">${reports.map((r,i)=>renderModuleCard(String(i+1).padStart(2,"0"),r[0],r[1],["Excel (.xlsx)","Bộ lọc theo đợt/trạng thái"])).join("")}</div></section>`;
}

function renderStructure() {
  const modules = [
    ["01","Danh tính & học sinh","Xác thực phụ huynh, liên kết đúng con và phân quyền.",["OTP/tài khoản","Hồ sơ học sinh","RBAC & audit"]],
    ["02","Danh mục CLB","Cấu hình nhóm môn, điều kiện, lớp, lịch, phí và quota.",["CLB & phân môn","Lớp/lịch","Sĩ số min/max"]],
    ["03","Đăng ký & kiểm tra","Giỏ đăng ký và engine kiểm tra điều kiện trước khi gửi.",["Khối/lứa tuổi","Trùng lịch","Giới hạn & sĩ số"]],
    ["04","Phí & xác nhận","Theo dõi trạng thái phí, đối soát và chốt danh sách.",["Chờ phí/đã thu","Import giao dịch","Khóa danh sách"]],
    ["05","Ngoại lệ & hỗ trợ","Danh sách chờ, đổi/hủy và hàng đợi cần gọi lại.",["Waitlist","Change request","CSKH follow-up"]],
    ["06","Vận hành & báo cáo","Dashboard, xuất danh sách và log thay đổi.",["Dashboard","Excel export","Audit log"]],
  ];
  return `<div class="demo-banner"><span><strong>Kiến trúc logic MVP:</strong> Web responsive → API nghiệp vụ → CSDL tập trung; các kênh OTP/thông báo/đối soát là lớp tích hợp thay thế được.</span><button class="button button-secondary" data-toast="Xem tài liệu BA đi kèm để có mô hình dữ liệu và ma trận phân quyền.">${icon("file")} Tài liệu BA</button></div>
  <section class="section" style="margin-top:0"><div class="section-head"><div><span class="eyebrow">6 domain chức năng</span><h2>Bản đồ module</h2><p>Phân ranh giới rõ để phát triển và nghiệm thu theo từng cụm.</p></div></div><div class="module-map">${modules.map(m=>renderModuleCard(...m)).join("")}</div></section>
  <section class="section panel"><div class="panel-head"><div><h3>Luồng dữ liệu chính</h3><p>Từ cấu hình đến danh sách vận hành</p></div></div><div class="panel-body"><div class="flow-line">${flowNodes(["Cấu hình đợt & CLB","PH chọn học sinh","Kiểm tra quy tắc","Tạo đơn & đối soát","Xử lý ngoại lệ","Khóa & xuất danh sách"])}</div></div></section>`;
}

const SHEET_FIELD_LABELS = {
  fatherEmail: "Email bố", motherEmail: "Email mẹ",
  studentCode: "Mã học sinh", studentName: "Họ tên", dateOfBirth: "Ngày sinh", className: "Lớp",
  educationLevel: "Cấp học", gradeBand: "Khối", fatherName: "Tên bố", fatherPhone: "SĐT bố", motherName: "Tên mẹ", motherPhone: "SĐT mẹ",
};

// Lỗi đồng bộ nền phải nhìn thấy ngay trên màn hình cấu hình. Giáo vụ thêm học
// sinh mà việc đồng bộ chết lặng lẽ thì phụ huynh không đăng ký được, và không
// ai truy ra được nguyên nhân.
/**
 * Tình trạng đồng bộ danh bạ.
 *
 * Khái niệm "sức khỏe" ở đây được thiết kế cho thời còn chạy theo lịch 15 phút một
 * lần: lâu không có lần nào thành công là dấu hiệu tiến trình nền chết lặng lẽ.
 * Từ khi chuyển sang chạy tay, "chưa chạy lần nào kể từ lúc bật máy chủ" trở thành
 * trạng thái BÌNH THƯỜNG — mỗi lần triển khai lại rơi vào đúng nó. Kêu báo động ở
 * đó là kêu oan, và kêu oan mãi thì lần kêu thật cũng không ai buồn đọc.
 *
 * Nên cảnh báo chỉ bật khi có chuyện thật: lần chạy gần nhất lỗi, có file không đọc
 * được, lịch đang bật mà quá hạn, hoặc cơ sở dữ liệu trống trơn.
 */
function renderSyncSchedule(schedule, luuTru) {
  if (!schedule) return "";
  const last = schedule.lastRun;
  const failed = (last?.sources || []).filter((source) => source.ok === false);
  const coDuLieu = Number(luuTru?.students || 0) > 0;
  const chayTay = !schedule.enabled;

  const counters = last?.counters;
  const summary = counters
    ? `${counters.writes} bản ghi · ${counters.studentsCreated} HS mới · ${counters.studentsDeactivated ?? 0} HS nghỉ học`
    : last?.error ? escapeHtml(last.error.message)
    : "—";

  // Cơ sở dữ liệu trống là chuyện nghiêm trọng thật, dù lịch bật hay tắt.
  const canhBao = !coDuLieu
    ? ["badge-red", "Chưa có dữ liệu",
      "Cơ sở dữ liệu chưa có học sinh nào. Hãy nhập danh bạ từ file Excel hoặc bấm đồng bộ từ Google Sheets."]
    : failed.length
      ? ["badge-gold", "Đọc thiếu file",
        `Không đọc được: ${failed.map((source) => `${escapeHtml(source.label)} — ${escapeHtml(source.error || "lỗi không rõ")}`).join(" · ")}.`
        + " Trong lúc chưa khắc phục, hệ thống <b>không đánh dấu học sinh nghỉ học</b> để tránh vô hiệu hóa nhầm cả một cấp."]
      : last?.error
        ? ["badge-red", "Lỗi", escapeHtml(last.error.message)]
        : !chayTay && schedule.health === "qua-han"
          ? ["badge-red", "Quá hạn",
            `Đã ${Math.round((schedule.msSinceLastSuccess || 0) / 60000)} phút không có lần đồng bộ nào thành công.`]
          : null;

  // Không có gì bất thường: nhãn nói đúng chế độ đang chạy, không dọa người dùng.
  const [tone, label] = canhBao
    ? [canhBao[0], canhBao[1]]
    : chayTay ? ["badge-green", "Chạy thủ công"] : ["badge-green", "Bình thường"];

  return `${canhBao ? `<div class="inline-alert">${icon("clock")}<span><b>${canhBao[1]}.</b> ${canhBao[2]}</span></div>` : ""}
    <div class="integration-source">
      <div><span>Tình trạng đồng bộ</span><strong><span class="badge ${tone}">${label}</span></strong></div>
      <div><span>Lần chạy gần nhất</span><strong>${last ? `${formatDateTime(new Date(last.finishedAt))} · ${last.trigger === "thu-cong" ? "bấm tay" : "theo lịch"}` : "Chưa chạy kể từ lúc bật máy chủ"}</strong></div>
      <div><span>Kết quả gần nhất</span><strong>${summary}</strong></div>
      <div><span>Lịch tự động</span><strong>${schedule.enabled ? `Mỗi ${Math.round(schedule.intervalMs / 60000)} phút` : "Đã tắt · chỉ chạy khi bấm tay"}</strong></div>
    </div>
    <div class="kpi-strip" style="margin-top:11px">
      <div class="kpi-item"><span>Học sinh đang học · trong CSDL</span><strong>${luuTru ? luuTru.students : "—"}</strong></div>
      <div class="kpi-item"><span>Tài khoản phụ huynh · trong CSDL</span><strong>${luuTru ? luuTru.parents : "—"}</strong></div>
      <div class="kpi-item"><span>Đồng bộ gần nhất</span><strong>${luuTru?.lastSyncAt ? formatDateTime(luuTru.lastSyncAt) : "Chưa từng chạy"}</strong></div>
    </div>`;
}
// Mỗi file nguồn một thẻ, kèm kết quả lần kiểm tra kết nối gần nhất.
function renderSheetSources(sources = [], probes = []) {
  const byKey = new Map((probes || []).map((item) => [item.key, item]));
  return `<div class="integration-source">${sources.map((source) => {
    const probe = byKey.get(source.key);
    // Badge là viên pill không xuống dòng nên chỉ để nhãn ngắn; nguyên văn lỗi
    // xuống dòng riêng để đọc được hết.
    const badge = !probe ? ""
      : probe.ok ? `<strong><span class="badge badge-green">Đọc được</span></strong>`
      : `<strong><span class="badge badge-red">Không đọc được</span></strong><strong style="color:#b23a4c;font-weight:600">${escapeHtml(probe.error || "")}</strong>`;
    const tab = source.sheetGid === null || source.sheetGid === undefined
      ? escapeHtml(source.sheetName || "tab hiển thị đầu tiên")
      : `gid ${escapeHtml(String(source.sheetGid))}`;
    return `<div><span>${escapeHtml(source.label || source.key)}</span><strong>${escapeHtml(source.spreadsheetId || "—")}</strong><strong>${tab} · tiêu đề dòng ${Number(source.headerRow || 1)}</strong>${badge}</div>`;
  }).join("")}</div>`;
}

// Những cột phần mềm ĐỌC ĐƯỢC nhưng chưa gắn với trường nào. Trước đây chúng bị bỏ
// qua hoàn toàn và im lặng, nên khi nhà trường thêm một cột mới vào file danh bạ
// (ví dụ email phụ huynh) thì không có cách nào biết phần mềm đã thấy nó chưa, hay
// thấy rồi mà gọi tên khác. Hiện ra ở đây thì đối chiếu tên cột mất mười giây.
function renderUnmappedColumns(source) {
  const daKhop = new Set(Object.values(source.mapping || {}).map((header) => String(header).trim().toLowerCase()));
  const thua = (source.headers || [])
    .map((header) => String(header || "").trim())
    .filter((header) => header && !daKhop.has(header.toLowerCase()));
  if (!thua.length) return "";
  return `<div class="info-note" style="margin-top:9px"><strong>Cột chưa dùng tới (${thua.length}):</strong>
    ${thua.map(escapeHtml).join(" · ")}. Nếu có cột nào cần đưa vào hệ thống, gửi đúng tên cột cho bộ phận CNTT.</div>`;
}

function renderSheetPreviewSource(source) {
  if (!source.ok) {
    return `<div class="info-note"><strong>${escapeHtml(source.label)}:</strong> ${escapeHtml(source.error || "Không đọc được file.")}</div>`;
  }
  const analysis = source.analysis || {};
  return `<div class="info-note"><strong>${escapeHtml(source.label)}</strong> · ${escapeHtml(source.spreadsheet?.title || "")} → ${escapeHtml(source.source?.sheetName || "")}</div>
    <div class="kpi-strip">
      <div class="kpi-item"><span>Dòng đã kiểm tra</span><strong>${analysis.scannedRows ?? 0}</strong></div>
      <div class="kpi-item"><span>Dòng hợp lệ</span><strong>${analysis.validRows ?? 0}</strong></div>
      <div class="kpi-item"><span>Lỗi / cảnh báo</span><strong>${analysis.invalidRows ?? 0} / ${analysis.warningRows ?? 0}</strong></div>
      <div class="kpi-item"><span>Phụ huynh duy nhất</span><strong>${analysis.uniqueGuardians ?? 0}</strong></div>
    </div>
    <div class="mapping-list">${Object.entries(source.mapping || {}).map(([field, header]) => `<span><b>${escapeHtml(SHEET_FIELD_LABELS[field] || field)}</b>${escapeHtml(header)}</span>`).join("")}</div>
    ${source.missing?.length ? `<div class="inline-alert">Thiếu cột bắt buộc: ${source.missing.map(escapeHtml).join(", ")}.</div>` : ""}
    ${renderUnmappedColumns(source)}
    ${analysis.issues?.length ? `<div class="info-note"><strong>Cần rà soát:</strong> ${analysis.issues.slice(0, 8).map((issue) => `Dòng ${issue.row} (${issue.severity === "warning" ? "cảnh báo" : "lỗi"}): ${issue.codes.map(escapeHtml).join(", ")}`).join(" · ")}</div>` : ""}`;
}

function renderSheetPreview(preview) {
  if (!preview) {
    return `<div class="info-note"><strong>Chế độ an toàn:</strong> Nút kiểm tra chỉ đọc metadata, tiêu đề và tối đa 100 dòng của từng file; không ghi hoặc sửa Google Sheet.</div>`;
  }
  return `<div class="sync-preview">
    ${(preview.sources || []).map(renderSheetPreviewSource).join("")}
    <div class="sync-verdict ${preview.readyToSync ? "ready" : "blocked"}">${preview.readyToSync
      ? "✓ Tất cả file đọc được, cột và dữ liệu mẫu hợp lệ. Có thể đồng bộ vào hệ thống."
      : "Chưa cho phép ghi dữ liệu: cần xử lý cột thiếu hoặc lỗi ở các file nêu bên trên."}</div>
    ${preview.readyToSync ? `<div class="sync-actions"><button class="button button-primary" data-sync-sheets>Đồng bộ học sinh & tài khoản PH</button><span>Chỉ thêm/cập nhật và đánh dấu nghỉ học; không xóa dữ liệu và không sửa Google Sheet.</span></div>` : ""}
  </div>`;
}

// Quyền do máy chủ trả về; giao diện không tự suy từ tên vai trò. Nếu suy đoán,
// hai bên sẽ lệch nhau và người dùng thấy nút bấm vào là báo lỗi.
const hasCap = (capability) => (state.me?.capabilities || []).includes(capability);

const SCHOOL_ACCOUNT_STATUS = {
  "dang-dung": ["badge-green", "Đang dùng"],
  "cho-dang-nhap-lan-dau": ["badge-blue", "Chờ đăng nhập lần đầu"],
  "vo-hieu-hoa": ["badge-red", "Đã vô hiệu hoá"],
};

function renderSchoolAccounts() {
  const data = state.schoolAccounts;
  if (!data) return `<div class="info-note">Đang tải danh sách tài khoản…</div>`;
  const roleOptions = data.roles.map((role) => `<option value="${role.value}">${escapeHtml(role.label)}</option>`).join("");

  const rows = data.accounts.map((account) => {
    const [tone, label] = SCHOOL_ACCOUNT_STATUS[account.status] || ["badge-blue", account.status];
    // Tài khoản do biến môi trường quy định thì mọi nút sửa đều vô nghĩa: sửa
    // trong cơ sở dữ liệu sẽ bị ghi đè ở lần đăng nhập kế tiếp.
    const actions = account.lockedByEnv
      ? `<span class="badge badge-purple">Khoá bởi cấu hình máy chủ</span>`
      : `<select data-account-role="${account.id}">${data.roles.map((role) =>
          `<option value="${role.value}"${role.value === account.role ? " selected" : ""}>${escapeHtml(role.label)}</option>`).join("")}</select>
         <button class="button button-secondary" data-account-toggle="${account.id}" data-active="${account.active ? "1" : "0"}">
           ${account.active ? "Vô hiệu hoá" : "Kích hoạt lại"}
         </button>`;
    return `<tr>
      <td>${escapeHtml(account.displayName)}</td>
      <td>${escapeHtml(account.account)}</td>
      <td>${escapeHtml(account.roleLabel)}</td>
      <td><span class="badge ${tone}">${escapeHtml(label)}</span></td>
      <td>${account.lastLoginAt ? formatDateTime(account.lastLoginAt) : "Chưa đăng nhập"}</td>
      <td class="account-actions">${actions}</td>
    </tr>`;
  }).join("");

  const preview = state.schoolAccountImport;
  const previewHtml = !preview ? "" : `<div class="sync-preview">
    <div class="kpi-strip">
      <div class="kpi-item"><span>Tạo mới</span><strong>${preview.summary.create}</strong></div>
      <div class="kpi-item"><span>Cập nhật</span><strong>${preview.summary.update}</strong></div>
      <div class="kpi-item"><span>Không đổi</span><strong>${preview.summary.unchanged}</strong></div>
      <div class="kpi-item"><span>Bỏ qua</span><strong>${preview.summary.skipped || 0}</strong></div>
      <div class="kpi-item"><span>Dòng lỗi</span><strong>${preview.summary.invalid}</strong></div>
    </div>
    ${preview.missing?.length ? `<div class="inline-alert">Thiếu cột bắt buộc: ${preview.missing.map(escapeHtml).join(", ")}.</div>` : ""}
    ${preview.issues?.length ? `<div class="info-note"><strong>Cần sửa trong tệp:</strong> ${preview.issues.map((issue) =>
      `Dòng ${issue.row}${issue.email ? ` (${escapeHtml(issue.email)})` : ""}: ${issue.codes.join(", ")}`).join(" · ")}</div>` : ""}
    <div class="sync-verdict ${preview.readyToCommit ? "ready" : "blocked"}">${preview.readyToCommit
      ? `✓ Sẵn sàng ghi ${preview.summary.create} tài khoản mới và cập nhật ${preview.summary.update} tài khoản.`
      : "Chưa ghi được: hãy sửa các dòng lỗi trong tệp rồi chọn lại."}</div>
    ${preview.summary.skipped ? `<div class="info-note"><strong>${preview.summary.skipped} dòng bị bỏ qua</strong> vì tài khoản đó do biến môi trường SUPERADMIN_ACCOUNTS quy định. Muốn đổi thì sửa cấu hình máy chủ rồi khởi động lại dịch vụ.</div>` : ""}
    ${preview.readyToCommit ? `<div class="sync-actions"><button class="button button-primary" data-account-import-commit>Ghi vào hệ thống</button><button class="button button-secondary" data-account-import-cancel>Bỏ qua</button></div>` : ""}
  </div>`;

  return `
    ${data.superadminCount === 0 ? `<div class="inline-alert">${icon("clock")}<span><b>Chưa đặt SUPERADMIN_ACCOUNTS trên máy chủ.</b> Nếu tài khoản quản trị bị vô hiệu hoá nhầm thì sẽ không còn ai đăng nhập được, và phải sửa trực tiếp trong cơ sở dữ liệu mới cứu được.</span></div>` : ""}

    <section class="section panel">
      <div class="panel-head">
        <div><span class="eyebrow">Nhân sự nhà trường</span><h3>${data.accounts.length} tài khoản</h3>
        <p>Chỉ những tài khoản trong danh sách này mới đăng nhập được bằng Microsoft 365.</p></div>
        <input id="account-search" type="search" placeholder="Tìm theo tên hoặc email" value="${escapeHtml(state.schoolAccountSearch || "")}" />
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Họ tên</th><th>Email</th><th>Vai trò</th><th>Trạng thái</th><th>Đăng nhập gần nhất</th><th>Thao tác</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6">Không có tài khoản nào khớp.</td></tr>`}</tbody>
      </table></div>
    </section>

    <section class="section panel">
      <div class="panel-head"><div><h3>Thêm tài khoản</h3><p>Email phải thuộc miền @${escapeHtml(data.domain)}. Tài khoản mới ở trạng thái chờ đăng nhập lần đầu.</p></div></div>
      <div class="panel-body">
        <div class="form-grid">
          <label class="form-field"><span>Email</span><input id="new-account-email" type="email" placeholder="ten.nguoi@${escapeHtml(data.domain)}" /></label>
          <label class="form-field"><span>Họ và tên</span><input id="new-account-name" type="text" placeholder="Nguyễn Văn A" /></label>
          <label class="form-field"><span>Vai trò</span><select id="new-account-role">${roleOptions}</select></label>
        </div>
        <div class="sync-actions"><button class="button button-primary" data-account-create>Thêm tài khoản</button></div>
      </div>
    </section>

    <section class="section panel">
      <div class="panel-head"><div><h3>Nhập hàng loạt từ tệp</h3><p>Tệp Excel hoặc CSV gồm ba cột: Email, Họ và tên, Vai trò. Xem trước rồi mới ghi.</p></div></div>
      <div class="panel-body">
        <input id="account-import-file" type="file" accept=".xlsx,.csv" />
        ${previewHtml}
      </div>
    </section>`;
}

async function loadSchoolAccounts() {
  if (!hasCap("quan-ly-tai-khoan")) return;
  const search = state.schoolAccountSearch ? `?search=${encodeURIComponent(state.schoolAccountSearch)}` : "";
  state.schoolAccounts = await api(`/admin/school-accounts${search}`);
}

function bindSchoolAccountEvents() {
  $("#account-search")?.addEventListener("input", debounceSearch(async (event) => {
    state.schoolAccountSearch = event.target.value;
    await loadSchoolAccounts();
    renderPage();
    const box = $("#account-search");
    if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  }));

  $("[data-account-create]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api("/admin/school-accounts", {
        method: "POST",
        body: JSON.stringify({
          email: $("#new-account-email").value.trim(),
          displayName: $("#new-account-name").value.trim(),
          role: $("#new-account-role").value,
        }),
      });
      toast("Đã thêm tài khoản. Người này đăng nhập bằng Microsoft 365 là dùng được ngay.", "success");
      await loadSchoolAccounts();
      renderPage();
    } catch (error) {
      button.disabled = false;
      toast(error.message, "error");
    }
  });

  $$("[data-account-role]").forEach((select) => select.addEventListener("change", async (event) => {
    try {
      await api(`/admin/school-accounts/${event.target.dataset.accountRole}`, {
        method: "PATCH", body: JSON.stringify({ role: event.target.value }),
      });
      toast("Đã đổi vai trò.", "success");
      await loadSchoolAccounts();
      renderPage();
    } catch (error) { toast(error.message, "error"); }
  }));

  $$("[data-account-toggle]").forEach((button) => button.addEventListener("click", async (event) => {
    const target = event.currentTarget;
    const active = target.dataset.active !== "1";
    if (!active && !window.confirm("Vô hiệu hoá tài khoản này? Dữ liệu và nhật ký thao tác vẫn được giữ nguyên.")) return;
    target.disabled = true;
    try {
      await api(`/admin/school-accounts/${target.dataset.accountToggle}`, {
        method: "PATCH", body: JSON.stringify({ active }),
      });
      toast(active ? "Đã kích hoạt lại tài khoản." : "Đã vô hiệu hoá tài khoản.", "success");
      await loadSchoolAccounts();
      renderPage();
    } catch (error) {
      target.disabled = false;
      toast(error.message, "error");
    }
  }));

  $("#account-import-file")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const workbook = await window.NSHMSheet.readFile(file);
      const sheet = workbook.sheets.find((item) => !item.hidden && item.rows.length) || workbook.sheets[0];
      if (!sheet?.rows.length) throw new Error("Tệp không có dòng dữ liệu nào.");
      const { headers, rows } = window.NSHMSheet.splitHeaderAndRows(sheet.rows);
      if (!headers.length) throw new Error("Không tìm thấy dòng tiêu đề trong tệp.");
      state.schoolAccountImportPayload = { headers, rows };
      const { preview } = await api("/admin/school-accounts/import/preview", {
        method: "POST", body: JSON.stringify(state.schoolAccountImportPayload),
      });
      state.schoolAccountImport = preview;
      renderPage();
    } catch (error) { toast(error.message, "error"); }
  });

  $("[data-account-import-cancel]")?.addEventListener("click", () => {
    state.schoolAccountImport = null;
    state.schoolAccountImportPayload = null;
    renderPage();
  });

  $("[data-account-import-commit]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { result } = await api("/admin/school-accounts/import/commit", {
        method: "POST", body: JSON.stringify(state.schoolAccountImportPayload),
      });
      toast(`Đã tạo ${result.counters.created} tài khoản mới, cập nhật ${result.counters.updated}, bỏ qua ${result.counters.unchanged} không đổi.`, "success");
      state.schoolAccountImport = null;
      state.schoolAccountImportPayload = null;
      await loadSchoolAccounts();
      renderPage();
    } catch (error) {
      button.disabled = false;
      toast(error.message, "error");
    }
  });
}

function debounceSearch(handler, delay = 250) {
  let timer = null;
  return (event) => {
    clearTimeout(timer);
    timer = setTimeout(() => handler(event), delay);
  };
}

// Nhập danh bạ học sinh từ file Excel, thay cho việc gọi ra Google Sheets.
//
// File được đọc NGAY TRONG TRÌNH DUYỆT (public/sheet-reader.js), chỉ bảng ô chữ đã
// trích mới gửi lên máy chủ — không tải tệp nhị phân, không có tệp tạm trên đĩa.
//
// MỖI SHEET LÀ MỘT NGUỒN. File danh bạ của trường là một workbook có ba tab theo ba
// cấp học, nên chọn một file cũng ra ba nguồn; chọn ba file riêng thì cũng vậy. Gộp
// chúng lại rồi mới đối chiếu là bắt buộc: em lớp 5 lên lớp 6 rời tab Tiểu học sang
// tab THCS, xử lý riêng từng tab là vô hiệu hoá nhầm em đó rồi tạo lại thành người
// mới, mất sạch liên kết phụ huynh và lịch sử đăng ký.
const IMPORT_MODES = { boSung: "bo-sung", doiChieu: "doi-chieu" };

function renderExcelImport() {
  const draft = state.excelImport;
  const files = draft?.sources || [];
  const preview = draft?.preview || null;
  const mode = draft?.mode || IMPORT_MODES.boSung;
  const doiChieu = mode === IMPORT_MODES.doiChieu;

  return `<section class="section panel"><div class="panel-head"><div>
      <span class="eyebrow">Nguồn dữ liệu học sinh</span><h3>Nhập từ file Excel</h3>
      <p>Đọc ngay trên máy bạn, không phụ thuộc kết nối Internet ra ngoài.</p></div></div>
    <div class="panel-body">
      <label class="form-field"><span>Chọn file .xlsx hoặc .csv (chọn được nhiều file)</span>
        <input id="excel-files" type="file" accept=".xlsx,.csv" multiple /></label>

      ${files.length ? `<div class="mapping-list" style="margin-top:11px">${files.map((source) =>
        `<span><b>${escapeHtml(source.label)}</b>${source.rows.length} dòng</span>`).join("")}</div>` : ""}

      <div class="import-modes">
        <label class="import-mode active">
          <input type="radio" name="excel-mode" value="${IMPORT_MODES.boSung}" checked />
          <div><strong>Bổ sung học sinh mới</strong>
            <span>Chỉ thêm và cập nhật. Không em nào bị cho nghỉ học, kể cả khi vắng mặt trong file. Đây là chế độ duy nhất, và là chế độ đúng cho mọi lần nhập.</span></div>
        </label>
      </div>
      <p class="field-hint">Chế độ <b>đối chiếu toàn trường</b> — coi file là toàn bộ danh sách trường và cho nghỉ học những em vắng mặt — đã được tắt. Danh bạ nay do phần mềm làm chủ; cho nghỉ học thì làm từng em ở màn danh bạ, để không ai bị mất tên vì một file thiếu dòng.</p>

      <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:13px">
        <button class="button button-secondary" id="excel-preview" ${files.length ? "" : "disabled"}>Kiểm tra file</button>
        <button class="button button-primary" id="excel-commit" ${preview?.readyToSync ? "" : "disabled"}>Ghi vào hệ thống</button>
      </div>
      <div id="excel-error" class="form-error" role="alert"></div>
      ${preview ? renderExcelPreview(preview) : `<div class="info-note" style="margin-top:11px"><strong>Chưa kiểm tra:</strong> chọn file rồi bấm “Kiểm tra file”. Bước này chỉ đọc và đối chiếu, không ghi gì vào hệ thống.</div>`}
    </div></section>`;
}

function renderExcelPreview(preview) {
  const conSot = preview.sources.filter((source) => !source.ok);
  const sePhaiNghi = Number(preview.willDeactivate || 0);
  return `
    <div class="kpi-strip" style="margin-top:13px">
      <div class="kpi-item"><span>Đang học trong hệ thống</span><strong>${preview.activeStudentsNow}</strong></div>
      <div class="kpi-item"><span>Học sinh trong file</span><strong>${preview.studentsInFile}</strong></div>
      <div class="kpi-item"><span>Phụ huynh trong file</span><strong>${preview.guardiansInFile}</strong></div>
      <div class="kpi-item"><span>Dòng đã đọc</span><strong>${preview.scannedRows}</strong></div>
    </div>
    ${sePhaiNghi > 0
      ? `<div class="inline-alert" style="margin-top:11px">${icon("clock")}<span><strong>${sePhaiNghi} học sinh sẽ bị đánh dấu nghỉ học</strong> vì không có trong các file vừa chọn. Kiểm tra kỹ đã nạp đủ cả ba cấp chưa trước khi ghi.</span></div>`
      : preview.mode === IMPORT_MODES.doiChieu
        ? `<div class="info-note" style="margin-top:11px"><strong>Không em nào bị cho nghỉ học</strong> — mọi em đang học đều có mặt trong file.</div>`
        : `<div class="info-note" style="margin-top:11px"><strong>Chế độ bổ sung:</strong> không em nào bị cho nghỉ học, kể cả ${Math.max(0, preview.activeStudentsNow - preview.studentsInFile)} em không có trong file.</div>`}
    ${preview.duplicates?.length ? `<div class="inline-alert" style="margin-top:9px">${icon("clock")}<span>${preview.duplicates.length} mã học sinh xuất hiện ở nhiều file: ${preview.duplicates.slice(0, 8).map((item) => escapeHtml(item.code)).join(", ")}. Giữ bản gặp trước.</span></div>` : ""}
    ${conSot.length ? `<div class="inline-alert" style="margin-top:9px">${icon("clock")}<span>${conSot.length} sheet không đọc được: ${conSot.map((source) => `${escapeHtml(source.label)} — ${escapeHtml(source.error || "")}`).join(" · ")}</span></div>` : ""}
    ${preview.sources.filter((source) => source.ok).map(renderExcelSourceCard).join("")}`;
}

function renderExcelSourceCard(source) {
  const analysis = source.analysis || {};
  const daKhop = new Set(Object.values(source.mapping || {}).map((header) => String(header).trim().toLowerCase()));
  const chuaDung = (source.headers || [])
    .map((header) => String(header || "").trim())
    .filter((header) => header && !daKhop.has(header.toLowerCase()));
  return `<div class="info-note" style="margin-top:11px">
      <strong>${escapeHtml(source.label)}</strong> · hàng tiêu đề ${source.headerRow}
      · ${analysis.validRows ?? 0} dòng hợp lệ / ${analysis.scannedRows ?? 0} đã đọc
      ${analysis.invalidRows ? ` · <span style="color:var(--red)">${analysis.invalidRows} dòng lỗi</span>` : ""}
    </div>
    <div class="mapping-list">${Object.entries(source.mapping || {})
      .map(([field, header]) => `<span><b>${escapeHtml(SHEET_FIELD_LABELS[field] || field)}</b>${escapeHtml(header)}</span>`).join("")}</div>
    ${chuaDung.length ? `<div class="info-note" style="margin-top:7px"><strong>Cột chưa dùng tới:</strong> ${chuaDung.map(escapeHtml).join(" · ")}</div>` : ""}
    ${analysis.issues?.length ? `<div class="inline-alert" style="margin-top:7px">${icon("clock")}<span>${analysis.issues.slice(0, 6).map((issue) => `Dòng ${issue.row}: ${issue.codes.map(escapeHtml).join(", ")}`).join(" · ")}</span></div>` : ""}`;
}

// Mỗi sheet nhìn thấy được và có dữ liệu là một nguồn riêng.
async function docFileExcel(fileList) {
  const sources = [];
  for (const file of fileList) {
    const { sheets } = await window.NSHMSheet.readFile(file);
    for (const sheet of sheets) {
      if (sheet.hidden || !sheet.rows?.length) continue;
      sources.push({
        key: `${file.name}::${sheet.name}`,
        label: sheets.length > 1 ? `${file.name} · ${sheet.name}` : file.name,
        rows: sheet.rows,
      });
    }
  }
  return sources;
}

function bindExcelImport() {
  const draft = () => (state.excelImport = state.excelImport || { sources: [], mode: IMPORT_MODES.boSung, preview: null });
  const loi = () => $("#excel-error");

  $("#excel-files")?.addEventListener("change", async (event) => {
    loi().textContent = "";
    try {
      const sources = await docFileExcel([...event.target.files]);
      if (!sources.length) throw new Error("Không đọc được sheet nào có dữ liệu trong các file đã chọn.");
      // Đổi file thì bản xem trước cũ hết giá trị; giữ lại là mời người dùng bấm ghi
      // theo một kết quả không còn đúng với file đang chọn.
      state.excelImport = { sources, mode: draft().mode, preview: null };
      renderPage();
    } catch (error) {
      loi().textContent = error.message;
    }
  });

  $$('input[name="excel-mode"]').forEach((radio) => radio.addEventListener("change", () => {
    state.excelImport = { ...draft(), mode: radio.value, preview: null };
    renderPage();
  }));

  $("#excel-preview")?.addEventListener("click", async () => {
    const button = $("#excel-preview");
    loi().textContent = "";
    button.disabled = true;
    button.textContent = "Đang kiểm tra...";
    try {
      const payload = await api("/admin/directory/excel/preview", {
        method: "POST",
        body: JSON.stringify({ mode: draft().mode, files: draft().sources.map(({ key, label, rows }) => ({ key, label, rows })) }),
      });
      state.excelImport = { ...draft(), preview: payload.preview };
      renderPage();
    } catch (error) {
      loi().textContent = error.message;
      button.disabled = false;
      button.textContent = "Kiểm tra file";
    }
  });

  $("#excel-commit")?.addEventListener("click", async () => {
    const hienTai = draft();
    const doiChieu = hienTai.mode === IMPORT_MODES.doiChieu;
    const sePhaiNghi = Number(hienTai.preview?.willDeactivate || 0);
    const cauHoi = doiChieu
      ? `Ghi ${hienTai.preview.studentsInFile} học sinh vào hệ thống theo chế độ ĐỐI CHIẾU TOÀN TRƯỜNG.`
        + (sePhaiNghi ? `\n\n${sePhaiNghi} em không có trong file sẽ bị đánh dấu NGHỈ HỌC.` : "")
        + "\n\nĐã nạp đủ cả ba cấp học chưa?"
      : `Bổ sung ${hienTai.preview.studentsInFile} học sinh từ file vào hệ thống. Không em nào bị cho nghỉ học.`;
    if (!window.confirm(cauHoi)) return;

    const button = $("#excel-commit");
    loi().textContent = "";
    button.disabled = true;
    button.textContent = "Đang ghi...";
    try {
      const payload = await api("/admin/directory/excel/commit", {
        method: "POST",
        body: JSON.stringify({
          mode: hienTai.mode,
          confirmation: doiChieu ? "DOI_CHIEU_TOAN_TRUONG" : undefined,
          files: hienTai.sources.map(({ key, label, rows }) => ({ key, label, rows })),
        }),
      });
      const dem = payload.result?.counters || {};
      state.excelImport = null;
      await hydrateRole();
      renderApp();
      toast(`Đã ghi: ${dem.studentsCreated || 0} em mới, ${dem.studentsUpdated || 0} em cập nhật`
        + `, ${dem.studentsDeactivated || 0} em cho nghỉ học.`, "success");
    } catch (error) {
      loi().textContent = error.message;
      button.disabled = false;
      button.textContent = "Ghi vào hệ thống";
    }
  });
}

function renderSettings() {
  const integration = state.sheetIntegration || {};
  const preview = state.sheetPreview;
  return `<section class="grid grid-3">${renderModuleCard("01","Người dùng & vai trò","8 nhóm vai trò với phạm vi xem/thao tác khác nhau.",["Phụ huynh","Vận hành/Giáo vụ/Kế toán","GV/BGH/IT Admin"])}${renderModuleCard("02","Quy tắc nghiệp vụ","Cấu hình giới hạn CLB, waitlist, thời hạn đổi/hủy.",["Không hard-code theo năm","Ghi log mọi ngoại lệ"])}${renderModuleCard("03","Tích hợp","Kết nối dữ liệu học sinh, OTP, thông báo và kế toán.",["Google Sheets chỉ đọc","Mã hóa trước khi ghi Firestore"])}</section>
  ${hasCap("dong-bo-danh-ba") ? renderExcelImport() : ""}
  ${hasCap("dong-bo-danh-ba") ? `<section class="section panel"><div class="panel-head"><div><span class="eyebrow">Nguồn dữ liệu học sinh</span><h3>Google Sheets · ${Number(integration.sourceCount || 0)} file theo cấp học</h3><p>${escapeHtml(integration.serviceAccountEmail || "—")} · quyền Viewer, chỉ đọc</p></div><button class="button button-primary" data-preview-sheets>Kiểm tra kết nối</button></div><div class="panel-body">
    ${renderSyncSchedule(integration.schedule, integration.stored)}
    ${renderSheetSources(integration.sources, preview?.sources)}
    ${renderSheetPreview(preview)}
  </div></section>` : ""}
  ${renderAccountSupport()}
  <section class="section panel"><div class="panel-head"><div><h3>Ma trận quyền tóm tắt</h3><p>Ví dụ phạm vi thao tác theo vai trò</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Vai trò</th><th>Xem hồ sơ</th><th>Cấu hình CLB</th><th>Xử lý đơn</th><th>Xác nhận phí</th><th>Xuất dữ liệu</th></tr></thead><tbody><tr><td>Phụ huynh</td><td>Chỉ con mình</td><td>—</td><td>Tạo/yêu cầu đổi</td><td>—</td><td>—</td></tr><tr><td>Vận hành CLB</td><td>Theo phạm vi đợt</td><td>Được phép</td><td>Được phép</td><td>Xem</td><td>Theo mẫu</td></tr><tr><td>Kế toán</td><td>Trường tối thiểu</td><td>—</td><td>Xem</td><td>Được phép</td><td>Báo cáo phí</td></tr><tr><td>Giáo viên</td><td>Lớp phụ trách</td><td>—</td><td>—</td><td>Trạng thái</td><td>DS lớp</td></tr><tr><td>IT Admin</td><td>Theo phân quyền</td><td>Hỗ trợ</td><td>Hỗ trợ</td><td>—</td><td>Audit kỹ thuật</td></tr></tbody></table></div></section>`;
}

function renderModuleCard(number, title, description, bullets) {
  return `<article class="module-card"><span class="module-number">${number}</span><h3>${title}</h3><p>${description}</p><ul>${bullets.map(b=>`<li>${b}</li>`).join("")}</ul></article>`;
}

function flowNodes(nodes) {
  return nodes.map((node,index)=>`${index ? `<span class="flow-arrow">${icon("arrow")}</span>` : ""}<div class="flow-node">${node}</div>`).join("");
}

function addToCart(clubId) {
  if (state.cart.includes(clubId)) return;
  const target = clubs.find(c => c.id === clubId);
  // Ba chuyện khác nhau, ba câu báo khác nhau: đã đăng ký đúng ca này, đã đăng ký
  // một ca khác của cùng CLB, và trùng khoảng giờ với một CLB khác hẳn.
  const daGui = donDaGuiCuaCon();
  if (daGui.some((don) => don.id === target.id)) {
    toast(`“${target.name}” đã có trong đăng ký hiện tại.`, "error");
    return;
  }
  if (daGui.some((don) => don.clubId && don.clubId === target.clubId)) {
    toast(`Con đã đăng ký một ca khác của “${target.name}”.`, "error");
    return;
  }
  const vuongGio = findScheduleConflict(target);
  if (vuongGio) {
    toast(conflictMessage(target, vuongGio.doiThu, { daDangKy: vuongGio.daDangKy }), "error");
    return;
  }
  const sameClubInCart = state.cart.map((id) => clubs.find((club) => club.id === id)).find((club) => club && club.clubId === target.clubId);
  if (sameClubInCart) {
    toast(`Bạn đã chọn một ca khác của “${target.name}”. Vui lòng chỉ giữ một ca.`, "error");
    return;
  }
  state.cart.push(clubId);
  toast(target.enrolled >= target.capacity ? "Đã thêm vào danh sách chờ." : "Đã thêm CLB vào giỏ đăng ký.", "success");
  renderApp();
  openCart();
}

function renderCart() {
  $("#cart-count").textContent = state.cart.length;
  const items = state.cart.map(id => clubs.find(c => c.id === id));
  if (!items.length) {
    $("#cart-body").innerHTML = `<div class="empty-state"><div class="empty-icon">${icon("cart")}</div><h3>Giỏ đăng ký đang trống</h3><p>Chọn một hoặc nhiều CLB phù hợp với ${student().name}.</p><button class="button button-primary" data-drawer-go-clubs>Khám phá CLB</button></div>`;
    $("#cart-footer").innerHTML = "";
  } else {
    $("#cart-body").innerHTML = `<div class="inline-alert">${icon("spark")}<span>Hệ thống đã kiểm tra khối/lứa tuổi. Trùng lịch và quota sẽ được kiểm tra lại khi gửi.</span></div>${items.map(club => `<div class="cart-item"><span class="cart-emoji">${club.emoji}</span><div class="cart-copy"><h3>${escapeHtml(club.name)}${club.className ? ` · ${escapeHtml(club.className)}` : ""}</h3><p>${club.schedule}<br>${club.room}</p><strong>${club.enrolled >= club.capacity ? "Danh sách chờ" : formatMoney(club.fee)}</strong></div><button class="remove-item" data-remove="${club.id}" aria-label="Xóa">${icon("x")}</button></div>`).join("")}`;
    const total = items.filter(c => c.enrolled < c.capacity).reduce((sum,c)=>sum+c.fee,0);
    $("#cart-footer").innerHTML = `<div class="summary-lines"><div class="summary-line"><span>Học sinh</span><strong>${student().name}</strong></div><div class="summary-line"><span>${items.length} lựa chọn</span><strong>${items.some(c=>c.enrolled>=c.capacity)?"Có DS chờ":"Hợp lệ"}</strong></div><div class="summary-line total"><span>Phí dự kiến</span><strong>${formatMoney(total)}</strong></div></div><label class="confirm-row"><input id="terms-check" type="checkbox" /><span>Tôi đã kiểm tra lịch học, mức phí và đồng ý với quy định đổi/hủy của nhà trường.</span></label><button id="submit-cart" class="button button-primary" disabled>${icon("check")} Xác nhận và gửi đăng ký</button>`;
  }
  bindDrawerEvents();
}

function openCart() { $("#cart-drawer").classList.add("open"); $("#drawer-overlay").classList.add("open"); }
function closeCart() { $("#cart-drawer").classList.remove("open"); $("#drawer-overlay").classList.remove("open"); }

function showDetail(clubId) {
  const club = clubs.find(c => c.id === clubId);
  const left = club.capacity - club.enrolled;
  showModal(`<div class="modal-head"><div><span class="eyebrow">${club.category}</span><h2>Chi tiết câu lạc bộ</h2></div><button class="icon-button" data-close-modal>${icon("x")}</button></div><div class="modal-body"><div class="detail-hero"><span>${club.emoji}</span><div><h3>${escapeHtml(club.name)}${club.className ? ` · ${escapeHtml(club.className)}` : ""}</h3><p>${club.description}</p></div></div><div class="detail-grid"><div class="detail-cell"><span>Lịch học</span><strong>${club.schedule}</strong></div><div class="detail-cell"><span>Địa điểm</span><strong>${club.room}</strong></div><div class="detail-cell"><span>Giáo viên</span><strong>${club.teacher}</strong></div><div class="detail-cell"><span>Sĩ số đã đóng phí</span><strong>${left > 0 ? `Còn ${left}/${club.capacity} chỗ` : "Đã đầy · nhận DS chờ"}</strong>${club.pending ? `<small style="display:block;color:var(--muted)">${club.pending} đơn đã đăng ký nhưng chưa giữ chỗ</small>` : ""}</div><div class="detail-cell"><span>Khối áp dụng</span><strong>${club.grade.join(", ")}</strong></div><div class="detail-cell"><span>Học phí</span><strong>${formatMoney(club.fee)} / học kỳ</strong></div></div></div><div class="modal-foot"><button class="button button-secondary" data-close-modal>Đóng</button><button class="button button-primary" data-modal-add="${club.id}" ${state.cart.includes(club.id)?"disabled":""}>${state.cart.includes(club.id)?"Đã chọn":left<=0?"Vào DS chờ":"Chọn CLB"}</button></div>`);
}

function showModal(content, { wide = false } = {}) {
  // Đánh dấu lên body để @media print biết đang có popup mở mà in đúng nó — xem
  // khối in ở cuối styles.css.
  document.body.classList.add("co-modal");
  $("#modal-root").innerHTML = `<div class="modal-backdrop"><div class="modal${wide ? " modal-wide" : ""}">${content}</div></div>`;
  $$('[data-close-modal]').forEach(el => el.addEventListener("click", closeModal));
  $(".modal-backdrop")?.addEventListener("click", e => { if (e.target.classList.contains("modal-backdrop")) closeModal(); });
  $("[data-modal-add]")?.addEventListener("click", e => { closeModal(); addToCart(e.currentTarget.dataset.modalAdd); });
}
function closeModal() {
  document.body.classList.remove("co-modal");
  $("#modal-root").innerHTML = "";
}

async function submitRegistration() {
  const submit = $("#submit-cart");
  submit.disabled = true;
  submit.textContent = "Đang kiểm tra và gửi...";
  const count = state.cart.length;
  try {
    const result = await api("/registrations", { method: "POST", body: JSON.stringify({ studentId: state.studentId, clubIds: state.cart, acceptedTerms: true }) });
    state.cart = [];
    const [registrationPayload, clubPayload] = await Promise.all([
      api("/registrations"), api(`/clubs?studentId=${encodeURIComponent(state.studentId)}`),
    ]);
    state.registrations = registrationPayload.registrations;
    clubs = clubPayload.clubs;
    closeCart();
    renderApp();
    showModal(`<div class="modal-body" style="padding-top:28px"><div class="success-mark">${icon("check")}</div><div class="success-copy"><h2>Đã gửi đăng ký thành công</h2><p>Hệ thống đã tiếp nhận ${count} lựa chọn cho ${student().name}. Dữ liệu đã được lưu vào hệ thống.</p></div><div class="code-box"><span>Mã nhóm đăng ký</span><strong>${result.groupId}</strong></div><div class="info-note"><strong>Bước tiếp theo:</strong> Theo dõi trạng thái “Chờ thanh toán” hoặc “Danh sách chờ” tại mục Đăng ký của tôi.</div></div><div class="modal-foot"><button class="button button-secondary" data-close-modal>Đóng</button><button class="button button-primary" data-view-registrations>Xem trạng thái</button></div>`);
    $("[data-view-registrations]")?.addEventListener("click", () => { closeModal(); goTo("registrations"); });
  } catch (error) {
    const details = error.details?.map((item) => item.message).join(" ");
    toast(details || error.message, "error");
    submit.disabled = false;
    submit.innerHTML = `${icon("check")} Xác nhận và gửi đăng ký`;
  }
}

function goTo(page) {
  state.page = page;
  closeSidebar();
  renderApp();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function setRole(role) {
  closeSidebar();
  await switchRole(role);
}

function openSidebar() { $("#sidebar").classList.add("open"); $("#sidebar-overlay").classList.add("open"); }
function closeSidebar() { $("#sidebar").classList.remove("open"); $("#sidebar-overlay").classList.remove("open"); }

function toast(message, type = "") {
  const el = document.createElement("div"); el.className = `toast ${type}`; el.textContent = message;
  $("#toast-root").appendChild(el); setTimeout(() => el.remove(), 3200);
}

/**
 * Tải danh sách của MỘT ca học, hoặc của cả đợt khi classId rỗng. Phạm vi "chỉ đã
 * đóng phí" phải khớp đúng cái đang hiện trên màn hình — xuất ra một tệp khác với
 * cái người ta vừa nhìn là cách nhanh nhất để giáo vụ điểm danh nhầm.
 */
/** Gắn lại sự kiện cho khối kết quả sau mỗi lần vẽ lại — xem ô tìm kiếm ở trên. */
function bindRosterResults() {
  const khung = $("#roster-results");
  if (!khung) return;
  khung.querySelectorAll("[data-roster-detail]").forEach((el) => el.addEventListener("click", () => {
    state.rosterDetailId = el.dataset.rosterDetail;
    state.rosterTab = "hoc-sinh";
    renderRosterDetail();
  }));
  const veLai = () => { khung.innerHTML = renderRosterResults(); bindRosterResults(); };
  khung.querySelectorAll("[data-roster-page]").forEach((el) => el.addEventListener("click", () => {
    state.rosterPage = conSo(el.dataset.rosterPage) || 1;
    veLai();
  }));
  khung.querySelector("#roster-page-size")?.addEventListener("change", (event) => {
    state.rosterPageSize = conSo(event.target.value) || 10;
    state.rosterPage = 1;
    veLai();
  });
}

function exportRosterCsv(classId, phamVi) {
  const params = new URLSearchParams();
  if (classId) params.set("classId", classId);
  params.set("phamVi", phamVi === "giu-cho" ? "giu-cho" : "hieu-luc");
  const link = document.createElement("a");
  link.href = `/api/admin/reports/registrations.csv${params.toString() ? `?${params}` : ""}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  toast("Đang xuất danh sách từ hệ thống.", "success");
}

function exportCsv() {
  const link = document.createElement("a");
  link.href = "/api/admin/reports/registrations.csv";
  link.download = "NSHM_Danh_sach_dang_ky.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  toast("Đang xuất danh sách từ hệ thống.", "success");
}

function bindGlobalEvents() {
  document.addEventListener("click", (event) => {
    const nav = event.target.closest("[data-page]"); if (nav) goTo(nav.dataset.page);
    const role = event.target.closest("[data-role]"); if (role) setRole(role.dataset.role);
  });
  $("#menu-toggle").addEventListener("click", openSidebar);
  $("#sidebar-overlay").addEventListener("click", closeSidebar);
  $("#cart-button").addEventListener("click", openCart);
  $("#drawer-overlay").addEventListener("click", closeCart);
  $("#logout-button").addEventListener("click", logout);
  $$('[data-close-drawer]').forEach(el => el.addEventListener("click", closeCart));
}

function bindLoginEvents() {
  $$("[data-login-role]").forEach((button) => button.addEventListener("click", () => {
    selectedLoginRole = button.dataset.loginRole;
    $$("[data-login-role]").forEach((item) => item.classList.toggle("active", item === button));
    applyLoginRoleView();
    $("#login-account").value = "0901234567";
    $("#login-password").value = "123456";
    $("#credential-hint").textContent = "Phụ huynh: 0901234567 / 123456";
    $("#login-error").textContent = "";
  }));
  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (selectedLoginRole !== "parent") return;
    await login($("#login-account").value, $("#login-password").value);
  });
  $("#microsoft-login").addEventListener("click", async () => {
    $("#login-error").textContent = "";
    try {
      const payload = await api("/auth/microsoft/status");
      if (!payload.microsoft.configured) throw new Error("Microsoft 365 SSO chưa được cấu hình trên máy chủ. Cần bổ sung Tenant ID, Client ID, Client Secret và Redirect URI.");
      window.location.assign("/api/auth/microsoft/start");
    } catch (error) {
      $("#login-error").textContent = error.message;
    }
  });
  $("#change-password-submit").addEventListener("click", async () => {
    const password = $("#new-password").value;
    const confirmation = $("#confirm-password").value;
    $("#login-error").textContent = "";
    if (password !== confirmation) {
      $("#login-error").textContent = "Hai mật khẩu mới chưa trùng khớp.";
      return;
    }
    const button = $("#change-password-submit");
    button.disabled = true;
    try {
      const payload = await api("/auth/change-initial-password", { method: "POST", body: JSON.stringify({ newPassword: password }) });
      await enterApplication(payload.user);
      toast("Đã đổi mật khẩu khởi tạo thành công.", "success");
    } catch (error) {
      $("#login-error").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

function bindPageEvents() {
  $$('[data-go]').forEach(el => el.addEventListener("click", () => goTo(el.dataset.go)));
  $$('[data-student]').forEach(el => el.addEventListener("click", async () => {
    state.studentId = el.dataset.student;
    state.cart = [];
    try {
      clubs = (await api(`/clubs?studentId=${encodeURIComponent(state.studentId)}`)).clubs;
      renderApp();
      toast(`Đã chọn ${student().name}.`);
    } catch (error) { toast(error.message, "error"); }
  }));
  $$('[data-add]').forEach(el => el.addEventListener("click", () => addToCart(el.dataset.add)));
  $$('[data-detail]').forEach(el => el.addEventListener("click", () => showDetail(el.dataset.detail)));
  $$("[data-detail-registration]").forEach((el) => el.addEventListener("click", () => openRegistrationDetail(el.dataset.detailRegistration)));
  $$('[data-open-cart]').forEach(el => el.addEventListener("click", openCart));
  $$('[data-toast]').forEach(el => el.addEventListener("click", () => toast(el.dataset.toast)));
  $("#account-password-submit")?.addEventListener("click", async () => {
    const box = $("#account-password-error");
    const current = $("#account-current-password").value;
    const password = $("#account-new-password").value;
    box.textContent = "";
    // Kiểm tại chỗ hai ô nhập giống nhau; mọi luật còn lại do máy chủ quyết, để
    // giao diện không bao giờ nói khác luật thật.
    if (password !== $("#account-confirm-password").value) {
      box.textContent = "Hai mật khẩu mới chưa trùng khớp.";
      return;
    }
    const button = $("#account-password-submit");
    button.disabled = true;
    try {
      const payload = await api("/auth/change-password", {
        method: "POST", body: JSON.stringify({ currentPassword: current, newPassword: password }),
      });
      state.me = payload.user;
      $$("#account-current-password, #account-new-password, #account-confirm-password").forEach((input) => { input.value = ""; });
      toast("Đã đổi mật khẩu. Lần đăng nhập sau hãy dùng mật khẩu mới.", "success");
    } catch (error) {
      box.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  // Bàn phím điện thoại có nút "Go"; không nối phím Enter thì bấm vào không có gì
  // xảy ra và phụ huynh tưởng trang hỏng.
  $$("#account-current-password, #account-new-password, #account-confirm-password")
    .forEach((input) => input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); $("#account-password-submit").click(); }
    }));
  $("#club-search")?.addEventListener("input", (event) => { state.filters.search = event.target.value; const cursor = event.target.selectionStart; renderPage(); $("#club-search")?.focus(); $("#club-search")?.setSelectionRange(cursor,cursor); });
  $("#category-filter")?.addEventListener("change", e => { state.filters.category = e.target.value; renderPage(); });
  $("#availability-filter")?.addEventListener("change", e => { state.filters.availability = e.target.value; renderPage(); });
  $("[data-clear-filters]")?.addEventListener("click", () => { state.filters = {search:"",category:"all",availability:"all"}; renderPage(); });
  $$('[data-status-tab]').forEach(el => el.addEventListener("click", () => { state.adminStatus = el.dataset.statusTab; renderPage(); }));
  $("#admin-search")?.addEventListener("input", e => { const q=e.target.value.toLowerCase(); $$('[data-row-text]').forEach(row=>row.style.display=row.dataset.rowText.includes(q)?"":"none"); });
  $$('[data-confirm-payment]').forEach(el => el.addEventListener("click", async () => {
    const registrationId = el.dataset.confirmPayment;
    el.disabled = true;
    try {
      await api(`/admin/registrations/${encodeURIComponent(registrationId)}/confirm-payment`, { method: "PATCH", body: "{}" });
      // Xem chú thích ở saveRegistrationStatus: phải tải lại cả /api/clubs, không thì
      // sĩ số trên trang Danh sách lớp lệch đúng bằng số đơn vừa đổi.
      const [registrationPayload, dashboardPayload, clubPayload] = await Promise.all([
        api("/registrations"), api("/admin/dashboard"), api("/clubs"),
      ]);
      adminApplications = registrationPayload.registrations;
      state.dashboard = dashboardPayload.dashboard;
      clubs = clubPayload.clubs;
      renderApp();
      toast(`Đã xác nhận phí cho ${registrationId}.`,"success");
    } catch (error) { el.disabled = false; toast(error.message, "error"); }
  }));
  bindExcelImport();
  bindNhapDangKy();
  $("[data-preview-sheets]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Đang kiểm tra...";
    try {
      state.sheetPreview = (await api("/admin/integrations/google-sheets/preview", { method: "POST", body: "{}" })).preview;
      renderPage();
      const failed = state.sheetPreview.failed || [];
      toast(state.sheetPreview.readyToSync
        ? "Đọc được toàn bộ file nguồn, cột dữ liệu hợp lệ."
        : failed.length
          ? `Không đọc được ${failed.length} file: ${failed.map((item) => item.label).join(", ")}.`
          : "Đã đọc các file; cần rà soát cột hoặc dữ liệu nguồn.",
        state.sheetPreview.readyToSync ? "success" : "error");
    } catch (error) {
      button.disabled = false;
      button.textContent = "Kiểm tra kết nối";
      toast(error.message, "error");
    }
  });
  $("[data-sync-sheets]")?.addEventListener("click", async (event) => {
    if (!window.confirm("Đồng bộ toàn bộ học sinh và tài khoản phụ huynh từ các file Google Sheet đã cấu hình?\n\nHọc sinh không còn trong danh sách sẽ được đánh dấu nghỉ học (giữ nguyên dữ liệu, không xóa). Thao tác không sửa Google Sheet.")) return;
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Đang đồng bộ, vui lòng đợi…";
    try {
      const { result } = await api("/admin/integrations/google-sheets/sync", {
        method: "POST",
        body: JSON.stringify({ confirmation: "SYNC_STUDENT_DIRECTORY" }),
      });
      const counters = result.counters;
      const unchanged = counters.studentsUnchanged + counters.parentsUnchanged + counters.linksUnchanged;
      const parts = [
        `Đồng bộ xong sau ${(result.elapsedMs / 1000).toFixed(0)} giây`,
        `ghi ${counters.writes} bản ghi (${counters.studentsCreated} học sinh mới, ${counters.parentsCreated} tài khoản PH mới)`,
        `bỏ qua ${unchanged} bản ghi không đổi`,
      ];
      if (counters.studentsDeactivated) parts.push(`đánh dấu nghỉ học ${counters.studentsDeactivated} em`);
      // Đọc thiếu file thì phải nói rõ, vì lần đồng bộ đó cố tình không xử lý
      // phần nghỉ học — im lặng sẽ khiến người dùng tưởng danh sách đã đủ.
      if (result.allSourcesLoaded === false) {
        const failed = (result.sources || []).filter((source) => !source.ok).map((source) => source.label);
        parts.push(`CHƯA đọc được ${failed.join(", ")} nên tạm chưa xét học sinh nghỉ học`);
      }
      if (result.duplicates?.length) parts.push(`${result.duplicates.length} mã học sinh bị trùng giữa các file`);
      toast(`${parts.join(" · ")}.`, result.allSourcesLoaded === false ? "error" : "success");
      state.sheetPreview = null;
      state.accountLookup = null;
      // Nạp lại trạng thái tích hợp để bảng tình hình đồng bộ hiện kết quả vừa chạy.
      try {
        state.sheetIntegration = (await api("/admin/integrations/google-sheets")).integration;
      } catch { /* không nạp được thì giữ nguyên bảng cũ, không chặn luồng */ }
      renderPage();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Đồng bộ học sinh & tài khoản PH";
      toast(error.message, "error");
    }
  });
  bindCatalogEvents();
  bindSchoolAccountEvents();
  bindAccountSupportEvents();
  bindBackupEvents();
  $("[data-export]")?.addEventListener("click", exportCsv);
  $("[data-roster-csv-all]")?.addEventListener("click", () => exportRosterCsv("", "hieu-luc"));
  bindRosterResults();
  // Ô tìm kiếm nằm NGOÀI khối kết quả và không bao giờ được dựng lại: bộ gõ tiếng
  // Việt soạn chữ ngay trong phần tử đó, hủy nó giữa chừng là bộ gõ chèn lại cả cụm
  // vào cuối giá trị cũ. Đã đo bằng Chrome thật: gõ "mỹ thuật" ra
  // "mmymyxmỹ tththuthuathuaathuaatthuaatjthuật" và tra ra 0 kết quả.
  const oTim = $("#roster-search");
  const veLaiKetQua = () => {
    state.rosterPage = 1;
    const khung = $("#roster-results");
    if (!khung) return;
    khung.innerHTML = renderRosterResults();
    bindRosterResults();
  };
  oTim?.addEventListener("input", (event) => {
    state.rosterSearch = event.target.value;
    // Đang soạn dở một chữ thì chưa lọc: giá trị lúc đó là chuỗi trung gian của bộ
    // gõ ("thuaatj"), lọc theo nó chỉ tổ nháy bảng mấy lần rồi ra 0 kết quả.
    if (event.isComposing) return;
    veLaiKetQua();
  });
  oTim?.addEventListener("compositionend", (event) => {
    state.rosterSearch = event.target.value;
    veLaiKetQua();
  });
  $("[data-send-support]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const message = $("#support-message").value.trim();
    if (message.length < 10) return toast("Vui lòng mô tả yêu cầu tối thiểu 10 ký tự.","error");
    button.disabled = true;
    try {
      const payload = await api("/support-requests", { method: "POST", body: JSON.stringify({ registrationId: $("#support-registration").value || null, topic: $("#support-topic").value || "Hỗ trợ đăng ký", message }) });
      toast(`Đã tạo yêu cầu hỗ trợ ${payload.id}.`,"success");
      $("#support-message").value = "";
    } catch (error) { toast(error.message, "error"); }
    finally { button.disabled = false; }
  });
}

function bindDrawerEvents() {
  $$('[data-remove]').forEach(el => el.addEventListener("click", () => { state.cart = state.cart.filter(id => id !== el.dataset.remove); renderApp(); openCart(); }));
  $("#terms-check")?.addEventListener("change", e => { $("#submit-cart").disabled = !e.target.checked; });
  $("#submit-cart")?.addEventListener("click", submitRegistration);
  $("[data-drawer-go-clubs]")?.addEventListener("click", () => { closeCart(); goTo("clubs"); });
}

boot();
