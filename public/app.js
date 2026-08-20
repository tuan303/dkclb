const state = {
  me: null,
  role: "parent",
  page: "home",
  studentId: null,
  cart: [],
  registrations: [],
  filters: { search: "", category: "all", availability: "all" },
  adminStatus: "all",
  dashboard: null,
  sheetIntegration: null,
  sheetPreview: null,
  catalog: null,
  catalogPeriodId: null,
  importDraft: null,
  period: null,
  demoAccounts: false,
  accountLookup: null,
  accountLookupInput: "",
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
    const error = new Error(payload?.error?.message || "Không thể kết nối tới hệ thống.");
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
  { section: "Hỗ trợ" },
  { id: "support", label: "Yêu cầu hỗ trợ", icon: "help" },
];

const adminNav = [
  { section: "Vận hành" },
  { id: "dashboard", label: "Dashboard", icon: "home" },
  { id: "campaigns", label: "Đợt đăng ký", icon: "calendar" },
  { id: "classes", label: "CLB & lịch học", icon: "grid" },
  { id: "applications", label: "Đơn đăng ký", icon: "clipboard", badge: 12 },
  { id: "finance", label: "Đối soát phí", icon: "credit" },
  { section: "Quản trị" },
  { id: "reports", label: "Báo cáo & xuất file", icon: "chart" },
  { id: "structure", label: "Cấu trúc hệ thống", icon: "file" },
  { id: "settings", label: "Cấu hình & phân quyền", icon: "settings" },
];

const pageMeta = {
  home: ["Tổng quan", "Học kỳ I · 2026–2027"], clubs: ["Khám phá câu lạc bộ", "Dành cho phụ huynh"],
  registrations: ["Đăng ký của tôi", "Theo dõi trạng thái"], schedule: ["Lịch học", "Lịch cá nhân của học sinh"],
  support: ["Yêu cầu hỗ trợ", "Trung tâm trợ giúp"], dashboard: ["Dashboard vận hành", "Cập nhật lúc 16:00 · 18/08/2026"],
  campaigns: ["Đợt đăng ký", "Học kỳ I · 2026–2027"], classes: ["CLB & lịch học", "Quản lý danh mục và quota"],
  applications: ["Đơn đăng ký", "158 bản ghi trong đợt hiện tại"], finance: ["Đối soát phí", "Dữ liệu minh họa"],
  reports: ["Báo cáo & xuất file", "Trung tâm dữ liệu vận hành"], structure: ["Cấu trúc hệ thống", "Bản đồ module MVP"],
  settings: ["Cấu hình & phân quyền", "Quản trị hệ thống"],
};

const statusMap = {
  draft: ["Bản nháp", "blue"], submitted: ["Đã gửi", "blue"], payment: ["Chờ thanh toán", "gold"],
  confirmed: ["Đã xác nhận", "green"], waitlist: ["Danh sách chờ", "purple"], conflict: ["Trùng lịch", "red"],
  cancelled: ["Đã hủy", "red"],
};

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
      api("/clubs"), api("/registrations"), api("/admin/dashboard"), api("/admin/integrations/google-sheets"),
      refreshCatalog(),
    ]);
    clubs = clubPayload.clubs;
    adminApplications = registrationPayload.registrations;
    state.dashboard = dashboardPayload.dashboard;
    state.period = clubPayload.period || null;
    state.sheetIntegration = sheetPayload.integration;
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

function showLogin(message = "") {
  showScreen("login");
  $(".login-role-tabs").classList.remove("hidden");
  $("#password-change-panel").classList.add("hidden");
  const parent = selectedLoginRole === "parent";
  $("#local-login-fields").classList.toggle("hidden", !parent);
  $("#login-submit").classList.toggle("hidden", !parent);
  $("#microsoft-login").classList.toggle("hidden", parent);
  $("#credential-box").classList.toggle("hidden", !parent || !state.demoAccounts);
  $("#login-intro").textContent = parent
    ? "Phụ huynh đăng nhập bằng số điện thoại đã đăng ký với nhà trường."
    : "Cán bộ nhà trường sử dụng tài khoản Microsoft 365 thuộc tên miền @hoangmaistarschool.edu.vn.";
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
  const nav = state.role === "parent" ? parentNav : adminNav;
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
  const period = state.role === "admin"
    ? state.catalog?.periods.find((item) => item.id === state.catalog.activePeriodId) || null
    : state.period;
  const periodLabel = period ? `${period.term} · ${period.schoolYear}` : "Chưa có đợt đăng ký đang mở";
  if (["home", "clubs", "registrations", "schedule", "dashboard", "campaigns"].includes(page)) return periodLabel;
  if (page === "classes") return `${state.catalog?.clubs.length || 0} CLB · ${state.catalog?.classes.length || 0} lớp`;
  if (page === "applications") return `${adminApplications.length} đơn trong hệ thống`;
  return fallback;
}

function renderHeader() {
  const [title, context] = pageMeta[state.page] || ["NSHM Clubs", "Cổng đăng ký ngoại khóa"];
  $("#page-title").textContent = title;
  $("#topbar-context").textContent = pageContext(state.page, context);
  const admin = state.role === "admin";
  $("#profile-name").textContent = state.me?.displayName || (admin ? "Nhà trường" : "Phụ huynh");
  $("#profile-role").textContent = admin ? "Vận hành CLB" : "Phụ huynh";
  $("#profile-avatar").textContent = (state.me?.displayName || "NS").split(" ").slice(-2).map((part) => part[0]).join("").toUpperCase();
  $("#cart-button").style.display = admin ? "none" : "flex";
  $("#cart-count").textContent = state.cart.length;
}

function renderPage() {
  const pages = {
    home: renderParentHome, clubs: renderClubsPage, registrations: renderRegistrations,
    schedule: renderSchedule, support: renderSupport, dashboard: renderAdminDashboard,
    campaigns: renderCampaigns, classes: renderClasses, applications: renderApplications,
    finance: renderFinance, reports: renderReports, structure: renderStructure, settings: renderSettings,
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
  const statusClass = left === 0 ? "full" : left <= 3 ? "warning" : "";
  const statusText = left === 0 ? "Đã đầy · Có DS chờ" : left <= 3 ? `Chỉ còn ${left} chỗ` : `Còn ${left} chỗ`;
  const inCart = state.cart.includes(club.id);
  return `<article class="club-card">
    <div class="club-visual visual-${club.visual}"><span class="club-status ${statusClass}">${statusText}</span><span class="club-symbol">${club.emoji}</span></div>
    <div class="club-body">
      <span class="category">${club.category}${club.className ? ` · ${escapeHtml(club.className)}` : ""}</span><h3>${escapeHtml(club.name)}</h3>
      <div class="club-meta"><span>${icon("clock")}${club.schedule}</span><span>${icon("pin")}${club.room} · ${club.teacher}</span></div>
      <div class="capacity"><div class="capacity-head"><span>Sĩ số</span><strong>${club.enrolled}/${club.capacity}</strong></div><div class="capacity-track ${statusClass}"><span style="width:${ratio}%"></span></div></div>
      <div class="club-price"><div><strong>${formatMoney(club.fee)}</strong><small>/ học kỳ</small></div><div class="club-actions"><button class="button button-secondary" data-detail="${club.id}">Chi tiết</button><button class="button button-primary" data-add="${club.id}" ${inCart ? "disabled" : ""}>${inCart ? "Đã chọn" : left === 0 ? "Vào DS chờ" : "Chọn"}</button></div></div>
    </div>
  </article>`;
}

function renderRegistrations() {
  const currentRegistrations = state.registrations.filter((registration) => registration.studentId === state.studentId);
  const rows = currentRegistrations.map((registration) => {
    // Đơn tham chiếu tới ca học (classId); danh mục cũng được đánh mã theo ca.
    const club = clubs.find(c => c.id === registration.classId);
    const [label, color] = statusMap[registration.status];
    const room = registration.room && registration.room !== "—" ? registration.room : club?.room || "";
    const teacher = registration.teacher && registration.teacher !== "—" ? registration.teacher : club?.teacher || "";
    return `<div class="application-card"><div class="application-icon">${icon("clipboard")}</div>
      <div class="application-copy"><h3>${escapeHtml(club?.name || registration.club)}${registration.classLabel ? ` · ${escapeHtml(registration.classLabel)}` : ""}</h3>
      <p>${registration.id} · ${escapeHtml(student().name)} · ${escapeHtml(registration.schedule || club?.schedule || "")}${room ? ` · ${escapeHtml(room)}` : ""}${teacher ? ` · ${escapeHtml(teacher)}` : ""}</p>
      <p class="field-hint">${escapeHtml(STATUS_GUIDE[registration.status] || "")}</p></div>
      <div class="application-meta"><span class="badge badge-${color}">${label}</span><strong>${formatMoney(registration.amount || club?.fee || 0)}</strong></div></div>`;
  }).join("");
  return `
    <div class="kpi-strip"><div class="kpi-item"><span>Tổng đăng ký</span><strong>${currentRegistrations.length}</strong></div><div class="kpi-item"><span>Đã xác nhận</span><strong>${currentRegistrations.filter(r => r.status === "confirmed").length}</strong></div><div class="kpi-item"><span>Chờ thanh toán</span><strong>${currentRegistrations.filter(r => r.status === "payment").length}</strong></div><div class="kpi-item"><span>Danh sách chờ</span><strong>${currentRegistrations.filter(r => r.status === "waitlist").length}</strong></div></div>
    <section class="section"><div class="section-head"><div><span class="eyebrow">Theo dõi theo thời gian thực</span><h2>Đăng ký của ${student().name}</h2><p>Trạng thái được cập nhật sau khi nhà trường xử lý hoặc đối soát phí.</p></div><button class="button button-primary" data-go="clubs">+ Đăng ký thêm</button></div>
    <div class="grid">${rows || `<div class="panel empty-state"><div class="empty-icon">${icon("clipboard")}</div><h3>Chưa có đăng ký</h3><p>Khám phá danh mục CLB phù hợp để bắt đầu.</p></div>`}</div></section>
    <section class="section"><div class="info-note"><strong>Quy ước trạng thái:</strong> “Đã gửi” chưa đồng nghĩa với có tên trong danh sách chính thức. Đăng ký chỉ được chốt khi đạt điều kiện xác nhận/đối soát theo quy định của nhà trường.</div></section>`;
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
  payment: "Vui lòng hoàn tất học phí theo hướng dẫn của nhà trường để được xác nhận chính thức.",
  confirmed: "Đã có tên trong danh sách chính thức của lớp.",
  waitlist: "Lớp đã đủ sĩ số. Nhà trường sẽ liên hệ nếu có chỗ trống.",
  conflict: "Lịch học bị trùng. Vui lòng gửi yêu cầu hỗ trợ để chọn ca khác.",
  cancelled: "Đơn đã hủy.",
  draft: "Đơn chưa gửi.",
};

function renderSchedule() {
  const active = state.registrations.filter((registration) =>
    registration.studentId === state.studentId && ["submitted", "payment", "confirmed", "waitlist"].includes(registration.status));
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
        const [label, color] = statusMap[entry.registration.status];
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
    <section class="section panel"><div class="panel-head"><div><h3>Đơn đăng ký gần đây</h3><p>Dữ liệu cập nhật theo thời gian thực</p></div><button class="button button-secondary" data-go="applications">Xem tất cả ${icon("arrow")}</button></div>${renderApplicationTable(adminApplications.slice(0,5))}</section>`;
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
        <td>${row.enrolled}/${row.capacity}${row.minCapacity ? `<br><span style="color:var(--muted)">tối thiểu ${row.minCapacity}</span>` : ""}</td>
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
        <div><button class="button button-secondary" data-lookup-account>Tra cứu</button></div>
      </div>
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
  if (!window.confirm(`Đặt lại mật khẩu của ${account} về chính số điện thoại? Phụ huynh sẽ phải đổi mật khẩu ngay lần đăng nhập kế tiếp.`)) return;
  button.disabled = true;
  button.textContent = "Đang đặt lại…";
  try {
    await api("/admin/accounts/reset-initial-password", {
      method: "POST",
      body: JSON.stringify({ account, confirmation: "RESET_INITIAL_PASSWORD" }),
    });
    state.accountLookup = (await api(`/admin/accounts/lookup?account=${encodeURIComponent(account)}`)).lookup;
    renderPage();
    toast(`Đã đặt lại. Mật khẩu tạm thời của ${account} chính là số điện thoại đó.`, "success");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Đặt lại về mật khẩu khởi tạo";
    toast(error.message, "error");
  }
}

function bindAccountSupportEvents() {
  $("[data-lookup-account]")?.addEventListener("click", (event) => runAccountLookup(event.currentTarget));
  $("#account-lookup-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      $("[data-lookup-account]")?.click();
    }
  });
  $("[data-reset-password]")?.addEventListener("click", (event) => runPasswordReset(event.currentTarget.dataset.resetPassword, event.currentTarget));
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
  const filtered = state.adminStatus === "all" ? adminApplications : adminApplications.filter(a => a.status === state.adminStatus);
  const tabs = [["all","Tất cả"],["submitted","Đã gửi"],["payment","Chờ phí"],["confirmed","Đã xác nhận"],["waitlist","DS chờ"],["conflict","Trùng lịch"]];
  return `<section class="section" style="margin-top:0"><div class="section-head"><div><span class="eyebrow">Quản lý tập trung</span><h2>Danh sách đăng ký</h2><p>Lọc, xử lý ngoại lệ và theo dõi lịch sử trạng thái.</p></div><button class="button button-secondary" data-export>${icon("download")} Xuất CSV</button></div>
  <div class="filters"><label class="search-field">${icon("search")}<input id="admin-search" placeholder="Tìm mã đơn, học sinh, CLB..." /></label><div class="status-tabs">${tabs.map(([id,label]) => `<button class="status-tab ${state.adminStatus === id ? "active" : ""}" data-status-tab="${id}">${label}</button>`).join("")}</div></div></section>
  <section class="section panel"><div class="panel-head"><div><h3>${filtered.length} đơn hiển thị</h3><p>${escapeHtml(pageContext("applications", ""))}</p></div></div><div id="applications-table">${renderApplicationTable(filtered)}</div></section>`;
}

function renderApplicationTable(rows) {
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Mã đơn</th><th>Học sinh</th><th>CLB</th><th>Thời gian</th><th>Trạng thái</th><th>Phí</th><th>Thao tác</th></tr></thead><tbody>${rows.map(row => {
    const [label,color] = statusMap[row.status];
    return `<tr data-row-text="${(row.id+row.student+row.club).toLowerCase()}"><td><strong>${row.id}</strong></td><td><div class="student-cell"><span class="mini-avatar">${row.student.split(" ").slice(-2).map(s=>s[0]).join("")}</span><div><strong>${row.student}</strong><span>${row.className}</span></div></div></td><td>${escapeHtml(row.club)}${row.classLabel ? `<br><span style="color:var(--muted)">${escapeHtml(row.classLabel)}</span>` : ""}</td><td>${row.date}</td><td><span class="badge badge-${color}">${label}</span></td><td>${formatMoney(row.amount)}</td><td>${row.status === "payment" ? `<button class="table-action" data-confirm-payment="${row.id}">Xác nhận phí</button>` : `<button class="table-action" data-toast="Demo: mở chi tiết ${row.id}.">Chi tiết</button>`}</td></tr>`;
  }).join("") || `<tr><td colspan="7"><div class="empty-state">Không có dữ liệu phù hợp.</div></td></tr>`}</tbody></table></div>`;
}

function renderFinance() {
  return `<section class="grid grid-4">${renderStat("credit","blue","189,6 tr","Tổng phải thu","158 đăng ký")}${renderStat("check","aqua","154,9 tr","Đã xác nhận","81,7%")}${renderStat("clock","gold","34,7 tr","Chờ đối soát","28 giao dịch")}${renderStat("clipboard","red","0 đ","Hoàn/chuyển phí","Chưa phát sinh")}</section><section class="section panel"><div class="panel-head"><div><h3>Quy trình đối soát đề xuất</h3><p>MVP hỗ trợ import hoặc xác nhận thủ công có log.</p></div><button class="button button-primary" data-toast="Demo: mở trình import giao dịch từ Excel.">Import đối soát</button></div><div class="panel-body"><div class="flow-line">${flowNodes(["Nhận giao dịch","Khớp mã đơn/SĐT","Kiểm tra số tiền","Xác nhận phí","Đưa vào DS chính thức"])}</div></div></section>`;
}

function renderReports() {
  const reports = [
    ["Tổng quan đợt đăng ký","KPI, tỷ lệ lấp đầy, lớp đầy/thiếu sĩ số"],["Danh sách theo CLB/lớp","Học sinh, lớp hành chính, lịch, phí, ghi chú"],["Danh sách chờ & gọi lại","Thứ tự chờ, lý do, phương án thay thế, người phụ trách"],["Tài chính & công nợ","Phải thu, đã thu, chờ thu, hoàn/chuyển phí"],["Vận hành lớp","Phòng, giáo viên, min/max, lớp cần mở/gộp/hủy"],["Lịch sử thay đổi","Đổi lớp, hủy, chuyển lịch, người xử lý và lý do"],
  ];
  return `<div class="demo-banner"><span><strong>Nguyên tắc bảo mật:</strong> Chỉ xuất các trường dữ liệu nằm trong phạm vi vai trò được cấp.</span><button class="button button-secondary" data-toast="Demo: mở cấu hình quyền xuất dữ liệu.">Phân quyền xuất</button></div><section class="grid grid-3">${reports.map((r,i)=>renderModuleCard(String(i+1).padStart(2,"0"),r[0],r[1],["Excel (.xlsx)","Bộ lọc theo đợt/trạng thái"])).join("")}</section>`;
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

function renderSettings() {
  const integration = state.sheetIntegration || {};
  const preview = state.sheetPreview;
  const fieldLabels = {
    studentCode: "Mã học sinh", studentName: "Họ tên", dateOfBirth: "Ngày sinh", className: "Lớp",
    educationLevel: "Cấp học", gradeBand: "Khối", fatherName: "Tên bố", fatherPhone: "SĐT bố", motherName: "Tên mẹ", motherPhone: "SĐT mẹ",
  };
  const previewHtml = preview ? `<div class="sync-preview">
    <div class="kpi-strip">
      <div class="kpi-item"><span>Dòng đã kiểm tra</span><strong>${preview.analysis?.scannedRows ?? 0}</strong></div>
      <div class="kpi-item"><span>Dòng hợp lệ</span><strong>${preview.analysis?.validRows ?? 0}</strong></div>
      <div class="kpi-item"><span>Lỗi / cảnh báo</span><strong>${preview.analysis?.invalidRows ?? 0} / ${preview.analysis?.warningRows ?? 0}</strong></div>
      <div class="kpi-item"><span>Phụ huynh duy nhất</span><strong>${preview.analysis?.uniqueGuardians ?? 0}</strong></div>
    </div>
    <div class="mapping-list">${Object.entries(preview.mapping || {}).map(([field, header]) => `<span><b>${escapeHtml(fieldLabels[field] || field)}</b>${escapeHtml(header)}</span>`).join("")}</div>
    ${preview.missing?.length ? `<div class="inline-alert">Thiếu mapping bắt buộc: ${preview.missing.map(escapeHtml).join(", ")}.</div>` : ""}
    ${preview.analysis?.issues?.length ? `<div class="info-note"><strong>Cần rà soát:</strong> ${preview.analysis.issues.slice(0, 8).map((issue) => `Dòng ${issue.row} (${issue.severity === "warning" ? "cảnh báo" : "lỗi"}): ${issue.codes.map(escapeHtml).join(", ")}`).join(" · ")}</div>` : ""}
    <div class="sync-verdict ${preview.readyToSync ? "ready" : "blocked"}">${preview.readyToSync ? "✓ Mapping và dữ liệu mẫu hợp lệ. Có thể đồng bộ tài khoản vào hệ thống." : "Chưa cho phép ghi dữ liệu: cần xử lý mapping hoặc lỗi nguồn trước."}</div>
    ${preview.readyToSync ? `<div class="sync-actions"><button class="button button-primary" data-sync-sheets>Đồng bộ học sinh & tài khoản PH</button><span>Chỉ thêm/cập nhật; không xóa tài khoản và không sửa Google Sheet.</span></div>` : ""}
  </div>` : `<div class="info-note"><strong>Chế độ an toàn:</strong> Nút kiểm tra chỉ đọc metadata, tiêu đề và tối đa 100 dòng; không ghi hoặc sửa Google Sheet.</div>`;
  return `<section class="grid grid-3">${renderModuleCard("01","Người dùng & vai trò","8 nhóm vai trò với phạm vi xem/thao tác khác nhau.",["Phụ huynh","Vận hành/Giáo vụ/Kế toán","GV/BGH/IT Admin"])}${renderModuleCard("02","Quy tắc nghiệp vụ","Cấu hình giới hạn CLB, waitlist, thời hạn đổi/hủy.",["Không hard-code theo năm","Ghi log mọi ngoại lệ"])}${renderModuleCard("03","Tích hợp","Kết nối dữ liệu học sinh, OTP, thông báo và kế toán.",["Google Sheets chỉ đọc","Mã hóa trước khi ghi Firestore"])}</section>
  <section class="section panel"><div class="panel-head"><div><span class="eyebrow">Nguồn dữ liệu học sinh</span><h3>Google Sheets</h3><p>Application Default Credentials · scope chỉ đọc</p></div><button class="button button-primary" data-preview-sheets>Kiểm tra kết nối</button></div><div class="panel-body">
    <div class="integration-source"><div><span>Spreadsheet ID</span><strong>${escapeHtml(integration.spreadsheetId || "—")}</strong></div><div><span>Tab / tiêu đề</span><strong>${escapeHtml(integration.sheetName || "—")} · dòng ${Number(integration.headerRow || 1)}</strong></div><div><span>Service account</span><strong>${escapeHtml(integration.serviceAccountEmail || "—")}</strong></div><div><span>Quyền</span><strong>Viewer · Read-only</strong></div></div>
    ${previewHtml}
  </div></section>
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
  const overlaps = (left, right) => left.dayOfWeek === right.dayOfWeek && left.startTime < right.endTime && right.startTime < left.endTime;
  const conflict = state.cart.map(id => clubs.find(c => c.id === id)).find(c => overlaps(c, target));
  if (conflict) {
    toast(`${target.name} trùng lịch với ${conflict.name}. Vui lòng chọn phương án khác.`, "error");
    return;
  }
  // Đơn đã gửi lưu theo mã lớp; một CLB có thể có nhiều ca nên phải chặn cả trùng CLB lẫn trùng giờ.
  const existing = state.registrations
    .filter((registration) => registration.studentId === state.studentId && ["submitted", "payment", "confirmed"].includes(registration.status))
    .map((registration) => clubs.find((club) => club.id === registration.classId))
    .find((club) => club && (club.id === target.id || club.clubId === target.clubId || overlaps(club, target)));
  if (existing) {
    const reason = existing.id === target.id ? `${target.name} đã có trong đăng ký hiện tại.`
      : existing.clubId === target.clubId ? `Học sinh đã đăng ký một ca khác của ${target.name}.`
      : `${target.name} trùng lịch với ${existing.name} đã đăng ký.`;
    toast(reason, "error");
    return;
  }
  const sameClubInCart = state.cart.map((id) => clubs.find((club) => club.id === id)).find((club) => club && club.clubId === target.clubId);
  if (sameClubInCart) {
    toast(`Bạn đã chọn một ca khác của ${target.name}. Vui lòng chỉ giữ một ca.`, "error");
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
  showModal(`<div class="modal-head"><div><span class="eyebrow">${club.category}</span><h2>Chi tiết câu lạc bộ</h2></div><button class="icon-button" data-close-modal>${icon("x")}</button></div><div class="modal-body"><div class="detail-hero"><span>${club.emoji}</span><div><h3>${escapeHtml(club.name)}${club.className ? ` · ${escapeHtml(club.className)}` : ""}</h3><p>${club.description}</p></div></div><div class="detail-grid"><div class="detail-cell"><span>Lịch học</span><strong>${club.schedule}</strong></div><div class="detail-cell"><span>Địa điểm</span><strong>${club.room}</strong></div><div class="detail-cell"><span>Giáo viên</span><strong>${club.teacher}</strong></div><div class="detail-cell"><span>Sĩ số</span><strong>${left > 0 ? `Còn ${left}/${club.capacity} chỗ` : "Đã đầy · nhận DS chờ"}</strong></div><div class="detail-cell"><span>Khối áp dụng</span><strong>${club.grade.join(", ")}</strong></div><div class="detail-cell"><span>Học phí</span><strong>${formatMoney(club.fee)} / học kỳ</strong></div></div></div><div class="modal-foot"><button class="button button-secondary" data-close-modal>Đóng</button><button class="button button-primary" data-modal-add="${club.id}" ${state.cart.includes(club.id)?"disabled":""}>${state.cart.includes(club.id)?"Đã chọn":left===0?"Vào DS chờ":"Chọn CLB"}</button></div>`);
}

function showModal(content, { wide = false } = {}) {
  $("#modal-root").innerHTML = `<div class="modal-backdrop"><div class="modal${wide ? " modal-wide" : ""}">${content}</div></div>`;
  $$('[data-close-modal]').forEach(el => el.addEventListener("click", closeModal));
  $(".modal-backdrop")?.addEventListener("click", e => { if (e.target.classList.contains("modal-backdrop")) closeModal(); });
  $("[data-modal-add]")?.addEventListener("click", e => { closeModal(); addToCart(e.currentTarget.dataset.modalAdd); });
}
function closeModal() { $("#modal-root").innerHTML = ""; }

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
    const parent = selectedLoginRole === "parent";
    $("#local-login-fields").classList.toggle("hidden", !parent);
    $("#login-submit").classList.toggle("hidden", !parent);
    $("#microsoft-login").classList.toggle("hidden", parent);
    $("#credential-box").classList.toggle("hidden", !parent || !state.demoAccounts);
    $("#login-intro").textContent = parent
      ? "Phụ huynh đăng nhập bằng số điện thoại đã đăng ký với nhà trường."
      : "Cán bộ nhà trường sử dụng tài khoản Microsoft 365 thuộc tên miền @hoangmaistarschool.edu.vn.";
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
  $$('[data-open-cart]').forEach(el => el.addEventListener("click", openCart));
  $$('[data-toast]').forEach(el => el.addEventListener("click", () => toast(el.dataset.toast)));
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
      const [registrationPayload, dashboardPayload] = await Promise.all([api("/registrations"), api("/admin/dashboard")]);
      adminApplications = registrationPayload.registrations;
      state.dashboard = dashboardPayload.dashboard;
      renderApp();
      toast(`Đã xác nhận phí cho ${registrationId}.`,"success");
    } catch (error) { el.disabled = false; toast(error.message, "error"); }
  }));
  $("[data-preview-sheets]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Đang kiểm tra...";
    try {
      state.sheetPreview = (await api("/admin/integrations/google-sheets/preview", { method: "POST", body: "{}" })).preview;
      renderPage();
      toast(state.sheetPreview.readyToSync ? "Kết nối và mapping Google Sheet hợp lệ." : "Đã đọc Sheet; cần rà soát mapping hoặc dữ liệu nguồn.", state.sheetPreview.readyToSync ? "success" : "");
    } catch (error) {
      button.disabled = false;
      button.textContent = "Kiểm tra kết nối";
      toast(error.message, "error");
    }
  });
  $("[data-sync-sheets]")?.addEventListener("click", async (event) => {
    if (!window.confirm("Đồng bộ toàn bộ học sinh và tài khoản phụ huynh hợp lệ từ tab dshs26-27? Thao tác không sửa Google Sheet.")) return;
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Đang đồng bộ...";
    try {
      const { result } = await api("/admin/integrations/google-sheets/sync", {
        method: "POST",
        body: JSON.stringify({ confirmation: "SYNC_STUDENT_DIRECTORY" }),
      });
      toast(`Đồng bộ hoàn tất: ${result.counters.parentsCreated} tài khoản PH mới, ${result.counters.parentsExisting} tài khoản đã có.`, "success");
      state.sheetPreview = null;
      renderPage();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Đồng bộ học sinh & tài khoản PH";
      toast(error.message, "error");
    }
  });
  bindCatalogEvents();
  bindAccountSupportEvents();
  $("[data-export]")?.addEventListener("click", exportCsv);
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
