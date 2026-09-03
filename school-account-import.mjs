// Nhập hàng loạt tài khoản nhà trường từ tệp Excel/CSV.
//
// Thuần tính toán, không chạm cơ sở dữ liệu: nhờ vậy kiểm thử được đầy đủ các ca
// dữ liệu bẩn mà không cần dựng máy chủ. Cùng khuôn với phần nhập danh mục CLB —
// xem trước rồi mới ghi, và chỉ ghi khi không còn dòng lỗi.

import { ASSIGNABLE_SCHOOL_ROLES, ROLE, ROLE_LABELS, isSchoolEmail, normalizeAccount, normalizeSchoolRole } from "./roles.mjs";

export const MAX_ACCOUNT_IMPORT_ROWS = 500;

const FIELD_ALIASES = {
  email: ["email", "e mail", "dia chi email", "thu dien tu", "tai khoan", "account"],
  displayName: ["ho va ten", "ho ten", "ten", "họ và tên", "full name", "name", "ho va ten can bo", "ho ten nhan su"],
  role: ["vai tro", "quyen", "nhom quyen", "role", "chuc nang"],
};

const REQUIRED_FIELDS = ["email", "displayName", "role"];

export function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function detectSchoolAccountMapping(headers = []) {
  const normalized = headers.map(normalizeHeader);
  const mapping = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const index = normalized.findIndex((header) => aliases.includes(header));
    if (index >= 0) mapping[field] = { index, header: String(headers[index] || "") };
  }
  return { mapping, missing: REQUIRED_FIELDS.filter((field) => !mapping[field]) };
}

// Nhận cả mã vai trò lẫn nhãn tiếng Việt, vì người nhập liệu gõ tay chứ không
// chọn từ danh sách. "Quản trị" một mình là mơ hồ giữa hai mức quyền nên bị từ chối.
export function parseRoleCell(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const direct = normalizeSchoolRole(raw);
  if (direct) return direct;
  const normalized = normalizeHeader(raw);
  for (const role of ASSIGNABLE_SCHOOL_ROLES) {
    if (normalizeHeader(ROLE_LABELS[role]) === normalized) return role;
  }
  if (normalized === "giao vu") return ROLE.giaovu;
  if (normalized === "quan tri van hanh" || normalized === "van hanh") return ROLE.admin;
  return null;
}

function cell(row, descriptor) {
  return descriptor ? String(row[descriptor.index] ?? "").trim() : "";
}

/**
 * @param rows      các dòng dữ liệu (KHÔNG gồm dòng tiêu đề)
 * @param headers   dòng tiêu đề
 * @param existing  tài khoản nhà trường đang có: [{ id, account, displayName, role, active }]
 * @param domain    miền email bắt buộc
 */
export function analyzeSchoolAccountImport({ rows = [], headers = [], existing = [], domain, firstDataRow = 2 }) {
  const { mapping, missing } = detectSchoolAccountMapping(headers);
  if (missing.length) {
    return { mapping: {}, missing, scannedRows: rows.length, issues: [], entries: [], summary: emptySummary(), readyToCommit: false };
  }

  const known = new Map(existing.map((item) => [normalizeAccount(item.account), item]));
  const seen = new Map();
  const issues = [];
  const entries = [];
  const summary = emptySummary();
  let blankRows = 0;

  rows.forEach((row, offset) => {
    const sourceRow = firstDataRow + offset;
    const email = normalizeAccount(cell(row, mapping.email));
    const displayName = cell(row, mapping.displayName);
    const roleRaw = cell(row, mapping.role);

    if (!email && !displayName && !roleRaw) {
      blankRows += 1;
      return;
    }

    const errors = [];
    if (!email) errors.push("THIEU_EMAIL");
    else if (!isSchoolEmail(email, domain)) errors.push("EMAIL_NGOAI_MIEN");
    else if (seen.has(email)) errors.push("EMAIL_TRUNG_TRONG_TEP");
    if (!displayName) errors.push("THIEU_HO_TEN");
    const role = parseRoleCell(roleRaw);
    if (!role) errors.push(roleRaw ? "VAI_TRO_KHONG_HOP_LE" : "THIEU_VAI_TRO");

    if (errors.length) {
      summary.invalid += 1;
      if (issues.length < 25) issues.push({ row: sourceRow, email: email || "", codes: errors });
      return;
    }

    seen.set(email, sourceRow);
    const current = known.get(email);
    if (!current) {
      summary.create += 1;
      entries.push({ action: "tao-moi", row: sourceRow, email, displayName, role });
      return;
    }
    // Tài khoản do biến môi trường quy định thì tệp không sửa được. Đây là một
    // hành động RIÊNG chứ không phải dòng lỗi: đánh là lỗi sẽ chặn cả tệp
    // (máy chủ từ chối khi còn dòng lỗi), ép người dùng xoá tay một dòng mỗi lần.
    if (current.lockedByEnv) {
      summary.skipped += 1;
      entries.push({ action: "bo-qua", row: sourceRow, email, displayName, role, id: current.id, lyDo: "khoa-boi-cau-hinh" });
      return;
    }
    // So sánh trên bản đã chuẩn hoá: không có gì đổi thì đừng ghi, để nhật ký
    // thao tác không đầy những dòng "đã cập nhật" mà thực ra chẳng đổi gì.
    const unchanged = current.role === role && String(current.displayName || "") === displayName;
    if (unchanged) {
      summary.unchanged += 1;
      entries.push({ action: "khong-doi", row: sourceRow, email, displayName, role, id: current.id });
      return;
    }
    summary.update += 1;
    entries.push({
      action: "cap-nhat", row: sourceRow, email, displayName, role, id: current.id,
      truoc: { role: current.role, displayName: current.displayName || "" },
    });
  });

  return {
    mapping: Object.fromEntries(Object.entries(mapping).map(([field, item]) => [field, item.header])),
    missing: [],
    scannedRows: rows.length,
    blankRows,
    issues,
    issuesTruncated: issues.length === 25,
    entries,
    summary,
    readyToCommit: summary.invalid === 0 && (summary.create > 0 || summary.update > 0),
  };
}

function emptySummary() {
  return { create: 0, update: 0, unchanged: 0, skipped: 0, invalid: 0 };
}
