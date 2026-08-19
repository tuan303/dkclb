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
    state.registrations = registrationPayload.registrations;
    state.dashboard = null;
    adminApplications = [];
  } else {
    const [clubPayload, registrationPayload, dashboardPayload, sheetPayload] = await Promise.all([
      api("/clubs"), api("/registrations"), api("/admin/dashboard"), api("/admin/integrations/google-sheets"),
    ]);
    clubs = clubPayload.clubs;
    adminApplications = registrationPayload.registrations;
    state.dashboard = dashboardPayload.dashboard;
    state.sheetIntegration = sheetPayload.integration;
    state.sheetPreview = null;
    state.registrations = [];
    students = [];
    state.studentId = null;
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
  $("#credential-box").classList.toggle("hidden", !parent);
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
  try {
    const payload = await api("/me");
    if (payload.user.mustChangePassword) showInitialPasswordChange(payload.user);
    else await enterApplication(payload.user);
  } catch {
    showLogin();
  }
}

function renderApp() {
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

function renderHeader() {
  const [title, context] = pageMeta[state.page] || ["NSHM Clubs", "Demo cấu trúc phần mềm"];
  $("#page-title").textContent = title;
  $("#topbar-context").textContent = context;
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
  return `
    <section class="hero">
      <div class="hero-content">
        <span class="eyebrow">Đợt đăng ký đang mở</span>
        <h2>Khám phá điều con yêu thích ngoài giờ học.</h2>
        <p>Chọn học sinh, xem CLB phù hợp và hoàn tất đăng ký trong một quy trình có kiểm tra lịch, sĩ số và điều kiện.</p>
        <div class="hero-actions">
          <button class="button button-light" data-go="clubs">Khám phá CLB ${icon("arrow")}</button>
          <button class="button button-ghost-light" data-go="registrations">Xem đăng ký của tôi</button>
        </div>
      </div>
      <div class="hero-side">
        <div class="period-line"><span>Thời gian đăng ký</span><strong>12–24/08/2026</strong></div>
        <div class="progress-track"><span></span></div>
        <div class="period-foot"><span>Đã qua 8 ngày</span><strong>Còn 6 ngày</strong></div>
      </div>
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
        <button class="text-button" data-go="clubs">Xem tất cả ${icon("arrow")}</button>
      </div>
      <div class="grid grid-3">${recommendations.map(renderClubCard).join("")}</div>
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
      ${list.length ? `<div class="grid grid-3">${list.map(renderClubCard).join("")}</div>` : `<div class="panel empty-state"><div class="empty-icon">${icon("search")}</div><h3>Không tìm thấy CLB</h3><p>Hãy thử thay đổi từ khóa hoặc bộ lọc sĩ số.</p><button class="button button-secondary" data-clear-filters>Xóa bộ lọc</button></div>`}
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
      <span class="category">${club.category}</span><h3>${club.name}</h3>
      <div class="club-meta"><span>${icon("clock")}${club.schedule}</span><span>${icon("pin")}${club.room} · ${club.teacher}</span></div>
      <div class="capacity"><div class="capacity-head"><span>Sĩ số</span><strong>${club.enrolled}/${club.capacity}</strong></div><div class="capacity-track ${statusClass}"><span style="width:${ratio}%"></span></div></div>
      <div class="club-price"><div><strong>${formatMoney(club.fee)}</strong><small>/ học kỳ</small></div><div class="club-actions"><button class="button button-secondary" data-detail="${club.id}">Chi tiết</button><button class="button button-primary" data-add="${club.id}" ${inCart ? "disabled" : ""}>${inCart ? "Đã chọn" : left === 0 ? "Vào DS chờ" : "Chọn"}</button></div></div>
    </div>
  </article>`;
}

function renderRegistrations() {
  const currentRegistrations = state.registrations.filter((registration) => registration.studentId === state.studentId);
  const rows = currentRegistrations.map((registration) => {
    const club = clubs.find(c => c.id === registration.clubId);
    const [label, color] = statusMap[registration.status];
    return `<div class="application-card"><div class="application-icon">${icon("clipboard")}</div><div class="application-copy"><h3>${club?.name || registration.club}</h3><p>${registration.id} · ${student().name} · ${registration.schedule || club?.schedule}</p></div><div class="application-meta"><span class="badge badge-${color}">${label}</span><strong>${formatMoney(registration.amount || club?.fee || 0)}</strong></div></div>`;
  }).join("");
  return `
    <div class="kpi-strip"><div class="kpi-item"><span>Tổng đăng ký</span><strong>${currentRegistrations.length}</strong></div><div class="kpi-item"><span>Đã xác nhận</span><strong>${currentRegistrations.filter(r => r.status === "confirmed").length}</strong></div><div class="kpi-item"><span>Chờ thanh toán</span><strong>${currentRegistrations.filter(r => r.status === "payment").length}</strong></div><div class="kpi-item"><span>Danh sách chờ</span><strong>${currentRegistrations.filter(r => r.status === "waitlist").length}</strong></div></div>
    <section class="section"><div class="section-head"><div><span class="eyebrow">Theo dõi theo thời gian thực</span><h2>Đăng ký của ${student().name}</h2><p>Trạng thái được cập nhật sau khi nhà trường xử lý hoặc đối soát phí.</p></div><button class="button button-primary" data-go="clubs">+ Đăng ký thêm</button></div>
    <div class="grid">${rows || `<div class="panel empty-state"><div class="empty-icon">${icon("clipboard")}</div><h3>Chưa có đăng ký</h3><p>Khám phá danh mục CLB phù hợp để bắt đầu.</p></div>`}</div></section>
    <section class="section"><div class="info-note"><strong>Quy ước trạng thái:</strong> “Đã gửi” chưa đồng nghĩa với có tên trong danh sách chính thức. Đăng ký chỉ được chốt khi đạt điều kiện xác nhận/đối soát theo quy định của nhà trường.</div></section>`;
}

function renderSchedule() {
  const active = state.registrations.filter(r => r.studentId === state.studentId && r.status !== "cancelled");
  return `<section class="panel"><div class="panel-head"><div><h3>Lịch ngoại khóa của ${student().name}</h3><p>Tuần minh họa 24–30/08/2026</p></div><button class="button button-secondary">${icon("calendar")} Đồng bộ lịch</button></div><div class="panel-body">
    ${active.length ? `<div class="grid">${active.map(r => { const c = clubs.find(x => x.id === r.clubId); return `<div class="application-card"><div class="cart-emoji">${c?.emoji || "★"}</div><div class="application-copy"><h3>${c?.name || r.club}</h3><p>${r.schedule || c?.schedule} · ${r.room || c?.room}</p></div><div class="application-meta"><span class="badge badge-${statusMap[r.status][1]}">${statusMap[r.status][0]}</span></div></div>`}).join("")}</div>` : `<div class="empty-state"><div class="empty-icon">${icon("calendar")}</div><h3>Chưa có lịch CLB</h3></div>`}
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
    <div class="demo-banner"><span><strong>Đợt Học kỳ I đang mở</strong> · 12/08–24/08/2026 · Tự động khóa đăng ký sau 23:59 ngày kết thúc.</span><button class="button button-secondary" data-go="campaigns">Xem cấu hình</button></div>
    <section class="grid grid-4">
      ${renderStat("clipboard","blue",dashboard.total,"Tổng đơn đăng ký","Dữ liệu trực tiếp")}
      ${renderStat("users","aqua",dashboard.students,"Học sinh tham gia",`${dashboard.total ? Math.round(dashboard.students / dashboard.total * 100) : 0}% đơn duy nhất`)}
      ${renderStat("clock","gold",dashboard.needAction,"Đơn cần xử lý","Ngoại lệ & chờ duyệt")}
      ${renderStat("credit","red",dashboard.pendingPayment,"Chờ đối soát phí",formatMoney(dashboard.pendingAmount))}
    </section>
    <section class="section dashboard-layout">
      <div class="panel"><div class="panel-head"><div><h3>Tỷ lệ lấp đầy theo nhóm CLB</h3><p>Đăng ký giữ chỗ so với tổng quota</p></div><select class="select-field"><option>Theo nhóm môn</option><option>Theo khối</option></select></div><div class="panel-body">${renderBarChart(dashboard.categories)}</div></div>
      <div class="panel"><div class="panel-head"><div><h3>Cần chú ý</h3><p>Các ngoại lệ ưu tiên xử lý</p></div><button class="text-button" data-go="applications">Xem đơn</button></div><div class="panel-body"><div class="attention-list">
        ${attention("var(--red)","Trùng lịch","Cần phụ huynh chọn lại",4)}
        ${attention("var(--purple)","Danh sách chờ","3 lớp đã đầy",9)}
        ${attention("var(--gold)","Chờ thanh toán","Quá 48 giờ",7)}
        ${attention("var(--blue)","Yêu cầu thay đổi","Đổi lịch / hủy",5)}
      </div></div></div>
    </section>
    <section class="section panel"><div class="panel-head"><div><h3>Đơn đăng ký gần đây</h3><p>Dữ liệu cập nhật theo thời gian thực</p></div><button class="button button-secondary" data-go="applications">Xem tất cả ${icon("arrow")}</button></div>${renderApplicationTable(adminApplications.slice(0,5))}</section>`;
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

function renderCampaigns() {
  return `<section class="hero"><div class="hero-content"><span class="eyebrow">Đợt đang hoạt động</span><h2>Đăng ký CLB · Học kỳ I</h2><p>12/08/2026 08:00 → 24/08/2026 23:59 · Áp dụng Tiểu học và THCS</p><div class="hero-actions"><button class="button button-light" data-toast="Demo: đã mở biểu mẫu cấu hình đợt đăng ký.">Chỉnh sửa cấu hình</button><button class="button button-ghost-light" data-toast="Demo: xem trước giao diện phụ huynh.">Xem trước</button></div></div><div class="hero-side"><div class="period-line"><span>Trạng thái</span><strong>Đang mở đăng ký</strong></div><div class="progress-track"><span></span></div><div class="period-foot"><span>158 đơn</span><strong>18 CLB · 26 lớp</strong></div></div></section>
  <section class="section grid grid-3">${renderModuleCard("01","Thời gian & phạm vi","Cấu hình năm học, học kỳ, thời gian mở/đóng và khối áp dụng.",["Lịch mở/đóng tự động","Giới hạn số CLB/học sinh"])}${renderModuleCard("02","Danh mục áp dụng","Chọn CLB/lớp được đưa vào đợt và thứ tự hiển thị.",["18 CLB đang hiển thị","2 CLB đang ẩn"])}${renderModuleCard("03","Quy tắc xác nhận","Chọn luồng phí, cam kết và thông báo sau khi gửi.",["Chờ phí trước xác nhận","Email xác nhận đang bật"])}</section>`;
}

function renderClasses() {
  return `<div class="kpi-strip"><div class="kpi-item"><span>CLB</span><strong>18</strong></div><div class="kpi-item"><span>Lớp/lịch</span><strong>26</strong></div><div class="kpi-item"><span>Đã đầy</span><strong>3</strong></div><div class="kpi-item"><span>Dưới sĩ số tối thiểu</span><strong>4</strong></div></div>
  <section class="section"><div class="section-head"><div><span class="eyebrow">Danh mục đang mở</span><h2>CLB & lớp học</h2><p>Cấu hình lịch, giáo viên, phòng, phí và sĩ số.</p></div><button class="button button-primary" data-toast="Demo: mở biểu mẫu tạo CLB mới.">+ Tạo CLB</button></div><div class="grid grid-3">${clubs.map(renderAdminClubCard).join("")}</div></section>`;
}

function renderAdminClubCard(club) {
  const left = club.capacity - club.enrolled;
  const ratio = Math.round(club.enrolled / club.capacity * 100);
  return `<article class="module-card"><div style="display:flex;align-items:center;justify-content:space-between"><span class="cart-emoji">${club.emoji}</span><span class="badge badge-${left === 0 ? "red" : left <= 3 ? "gold" : "green"}">${left === 0 ? "Đã đầy" : `Còn ${left} chỗ`}</span></div><h3>${club.name}</h3><p>${club.schedule}<br>${club.room} · ${club.teacher}</p><div class="capacity"><div class="capacity-head"><span>Lấp đầy</span><strong>${ratio}%</strong></div><div class="capacity-track ${left===0?"full":left<=3?"warning":""}"><span style="width:${ratio}%"></span></div></div><div style="display:flex;gap:7px;margin-top:13px"><button class="button button-secondary" data-toast="Demo: mở cấu hình lớp ${club.name}.">Cấu hình</button><button class="button button-secondary" data-toast="Demo: xem danh sách học sinh của ${club.name}.">Danh sách</button></div></article>`;
}

function renderApplications() {
  const filtered = state.adminStatus === "all" ? adminApplications : adminApplications.filter(a => a.status === state.adminStatus);
  const tabs = [["all","Tất cả"],["submitted","Đã gửi"],["payment","Chờ phí"],["confirmed","Đã xác nhận"],["waitlist","DS chờ"],["conflict","Trùng lịch"]];
  return `<section class="section" style="margin-top:0"><div class="section-head"><div><span class="eyebrow">Quản lý tập trung</span><h2>Danh sách đăng ký</h2><p>Lọc, xử lý ngoại lệ và theo dõi lịch sử trạng thái.</p></div><button class="button button-secondary" data-export>${icon("download")} Xuất CSV demo</button></div>
  <div class="filters"><label class="search-field">${icon("search")}<input id="admin-search" placeholder="Tìm mã đơn, học sinh, CLB..." /></label><div class="status-tabs">${tabs.map(([id,label]) => `<button class="status-tab ${state.adminStatus === id ? "active" : ""}" data-status-tab="${id}">${label}</button>`).join("")}</div></div></section>
  <section class="section panel"><div class="panel-head"><div><h3>${filtered.length} đơn hiển thị</h3><p>Đợt Học kỳ I · 2026–2027</p></div></div><div id="applications-table">${renderApplicationTable(filtered)}</div></section>`;
}

function renderApplicationTable(rows) {
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Mã đơn</th><th>Học sinh</th><th>CLB</th><th>Thời gian</th><th>Trạng thái</th><th>Phí</th><th>Thao tác</th></tr></thead><tbody>${rows.map(row => {
    const [label,color] = statusMap[row.status];
    return `<tr data-row-text="${(row.id+row.student+row.club).toLowerCase()}"><td><strong>${row.id}</strong></td><td><div class="student-cell"><span class="mini-avatar">${row.student.split(" ").slice(-2).map(s=>s[0]).join("")}</span><div><strong>${row.student}</strong><span>${row.className}</span></div></div></td><td>${row.club}</td><td>${row.date}</td><td><span class="badge badge-${color}">${label}</span></td><td>${formatMoney(row.amount)}</td><td>${row.status === "payment" ? `<button class="table-action" data-confirm-payment="${row.id}">Xác nhận phí</button>` : `<button class="table-action" data-toast="Demo: mở chi tiết ${row.id}.">Chi tiết</button>`}</td></tr>`;
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
  const existing = state.registrations
    .filter((registration) => registration.studentId === state.studentId && ["submitted", "payment", "confirmed"].includes(registration.status))
    .map((registration) => clubs.find((club) => club.id === registration.clubId))
    .find((club) => club && (club.id === target.id || overlaps(club, target)));
  if (existing) {
    toast(existing.id === target.id ? `${target.name} đã có trong đăng ký hiện tại.` : `${target.name} trùng lịch với ${existing.name} đã đăng ký.`, "error");
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
    $("#cart-body").innerHTML = `<div class="inline-alert">${icon("spark")}<span>Hệ thống đã kiểm tra khối/lứa tuổi. Trùng lịch và quota sẽ được kiểm tra lại khi gửi.</span></div>${items.map(club => `<div class="cart-item"><span class="cart-emoji">${club.emoji}</span><div class="cart-copy"><h3>${club.name}</h3><p>${club.schedule}<br>${club.room}</p><strong>${club.enrolled >= club.capacity ? "Danh sách chờ" : formatMoney(club.fee)}</strong></div><button class="remove-item" data-remove="${club.id}" aria-label="Xóa">${icon("x")}</button></div>`).join("")}`;
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
  showModal(`<div class="modal-head"><div><span class="eyebrow">${club.category}</span><h2>Chi tiết câu lạc bộ</h2></div><button class="icon-button" data-close-modal>${icon("x")}</button></div><div class="modal-body"><div class="detail-hero"><span>${club.emoji}</span><div><h3>${club.name}</h3><p>${club.description}</p></div></div><div class="detail-grid"><div class="detail-cell"><span>Lịch học</span><strong>${club.schedule}</strong></div><div class="detail-cell"><span>Địa điểm</span><strong>${club.room}</strong></div><div class="detail-cell"><span>Giáo viên</span><strong>${club.teacher}</strong></div><div class="detail-cell"><span>Sĩ số</span><strong>${left > 0 ? `Còn ${left}/${club.capacity} chỗ` : "Đã đầy · nhận DS chờ"}</strong></div><div class="detail-cell"><span>Khối áp dụng</span><strong>${club.grade.join(", ")}</strong></div><div class="detail-cell"><span>Học phí</span><strong>${formatMoney(club.fee)} / học kỳ</strong></div></div></div><div class="modal-foot"><button class="button button-secondary" data-close-modal>Đóng</button><button class="button button-primary" data-modal-add="${club.id}" ${state.cart.includes(club.id)?"disabled":""}>${state.cart.includes(club.id)?"Đã chọn":left===0?"Vào DS chờ":"Chọn CLB"}</button></div>`);
}

function showModal(content) {
  $("#modal-root").innerHTML = `<div class="modal-backdrop"><div class="modal">${content}</div></div>`;
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
    $("#credential-box").classList.toggle("hidden", !parent);
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
