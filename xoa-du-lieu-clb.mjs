#!/usr/bin/env node
// Xoá dữ liệu CLB đã cấu hình và đơn đăng ký của học sinh, để khai báo lại từ đầu.
//
// XOÁ:   registrations (đơn đăng ký) → club_classes (ca học) → clubs (CLB).
// GIỮ:   club_categories (danh mục nhóm môn đã khai báo — xoá CLB không có nghĩa là
//        phải gõ lại bốn nhóm môn), students (danh bạ học sinh), users + parent_students (tài khoản phụ huynh,
//        mật khẩu đã đặt vẫn dùng được), registration_periods (đợt đăng ký),
//        tài khoản nhà trường, audit_logs (nhật ký, kể cả nhật ký của dữ liệu vừa xoá).
//
// Vì sao là tệp chạy tay chứ không phải nút bấm trong giao diện: đây là thao tác
// một lần lúc dựng hệ thống, không hoàn lại được, và không nên tồn tại một cái nút
// trên màn hình mà bấm nhầm là mất sạch đơn của cả trường.
//
// CÁCH DÙNG — chạy trên máy chủ, trong thư mục mã nguồn:
//
//   node xoa-du-lieu-clb.mjs              # chỉ ĐẾM và ghi tệp sao lưu, KHÔNG xoá
//   node xoa-du-lieu-clb.mjs --xoa-that   # xoá thật, sau khi đã ghi tệp sao lưu
//
// Tệp sao lưu luôn được ghi TRƯỚC khi xoá, vào thư mục data/, tên có mốc thời gian.
// Nó chứa nguyên văn ba bảng bị xoá nên khôi phục lại được bằng tay nếu cần.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = join(ROOT, ".env");
if (!process.env.NSHM_IGNORE_ENV_FILE && existsSync(ENV_FILE)) loadEnvFile(ENV_FILE);

const DATA_BACKEND = String(process.env.DATA_BACKEND || "sqlite").toLowerCase();
const MYSQL_URL = process.env.MYSQL_URL || "";
const DB_FILE = process.env.DATA_FILE || join(ROOT, "data", "nshm-clubs.sqlite");
const XOA_THAT = process.argv.includes("--xoa-that");

// Thứ tự xoá đi ngược chiều khoá ngoại: đơn trỏ vào ca, ca trỏ vào CLB. Đảo thứ tự
// là MySQL chặn ngay ở bảng đầu tiên (fk_registrations_class, fk_club_classes_club).
const BANG_XOA = ["registrations", "club_classes", "clubs"];

function nowIso() {
  return new Date().toISOString();
}

function tenTepSaoLuu() {
  return join(ROOT, "data", `sao-luu-truoc-khi-xoa-clb-${nowIso().replace(/[:.]/g, "-")}.json`);
}

function ghiSaoLuu(duLieu) {
  const tep = tenTepSaoLuu();
  mkdirSync(dirname(tep), { recursive: true });
  writeFileSync(tep, JSON.stringify({ taoLuc: nowIso(), nen: DATA_BACKEND, bang: duLieu }, null, 2), "utf8");
  return tep;
}

function inBang(dem) {
  for (const bang of BANG_XOA) console.log(`   ${bang.padEnd(14)} ${String(dem[bang]).padStart(7)} dòng`);
}

async function chayMysql() {
  if (!MYSQL_URL) throw new Error("Thiếu MYSQL_URL trong .env khi DATA_BACKEND=mysql.");
  const { createPool } = await import("mysql2/promise");
  const pool = createPool(MYSQL_URL);
  try {
    const duLieu = {};
    const dem = {};
    for (const bang of BANG_XOA) {
      const [rows] = await pool.query(`SELECT * FROM \`${bang}\``);
      duLieu[bang] = rows;
      dem[bang] = rows.length;
    }
    console.log(`Nền dữ liệu: MySQL\nSắp xoá:`);
    inBang(dem);

    const tep = ghiSaoLuu(duLieu);
    console.log(`\nĐã ghi sao lưu: ${tep}`);

    if (!XOA_THAT) {
      console.log("\nChế độ xem trước — CHƯA xoá gì cả.");
      console.log("Chạy lại với  --xoa-that  để xoá thật.");
      return;
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const bang of BANG_XOA) await connection.query(`DELETE FROM \`${bang}\``);
      // Ghi nhật ký ngay trong cùng giao dịch: xoá xong mà nhật ký ghi hụt thì
      // về sau không ai biết dữ liệu biến mất lúc nào và do lệnh gì.
      await connection.query(
        `INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, before_json, after_json, reason, created_at)
         VALUES (?, NULL, 'WIPE_CATALOG', 'catalog', 'all', ?, NULL, ?, ?)`,
        [`audit_wipe_${Date.now()}`, JSON.stringify(dem), `xoa-du-lieu-clb.mjs · sao lưu: ${tep}`, nowIso()],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const conLai = {};
    for (const bang of BANG_XOA) {
      const [rows] = await pool.query(`SELECT COUNT(*) AS n FROM \`${bang}\``);
      conLai[bang] = Number(rows[0]?.n || 0);
    }
    console.log("\nĐã xoá xong. Còn lại:");
    inBang(conLai);
    const sot = BANG_XOA.filter((bang) => conLai[bang] > 0);
    if (sot.length) throw new Error(`Còn sót dữ liệu ở: ${sot.join(", ")}.`);
  } finally {
    await pool.end();
  }
}

async function chaySqlite() {
  const { DatabaseSync } = await import("node:sqlite");
  if (!existsSync(DB_FILE)) throw new Error(`Không tìm thấy tệp cơ sở dữ liệu: ${DB_FILE}`);
  const db = new DatabaseSync(DB_FILE);
  try {
    const duLieu = {};
    const dem = {};
    for (const bang of BANG_XOA) {
      const rows = db.prepare(`SELECT * FROM ${bang}`).all();
      duLieu[bang] = rows;
      dem[bang] = rows.length;
    }
    console.log(`Nền dữ liệu: SQLite (${DB_FILE})\nSắp xoá:`);
    inBang(dem);

    const tep = ghiSaoLuu(duLieu);
    console.log(`\nĐã ghi sao lưu: ${tep}`);

    if (!XOA_THAT) {
      console.log("\nChế độ xem trước — CHƯA xoá gì cả.");
      console.log("Chạy lại với  --xoa-that  để xoá thật.");
      return;
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      for (const bang of BANG_XOA) db.exec(`DELETE FROM ${bang}`);
      db.prepare(`INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, before_json, after_json, reason, created_at)
        VALUES (?, NULL, 'WIPE_CATALOG', 'catalog', 'all', ?, NULL, ?, ?)`)
        .run(`audit_wipe_${Date.now()}`, JSON.stringify(dem), `xoa-du-lieu-clb.mjs · sao lưu: ${tep}`, nowIso());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const conLai = {};
    for (const bang of BANG_XOA) conLai[bang] = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${bang}`).get().n || 0);
    console.log("\nĐã xoá xong. Còn lại:");
    inBang(conLai);
  } finally {
    db.close();
  }
}

console.log(`\n=== Xoá dữ liệu CLB và đơn đăng ký ===`);
console.log("GIỮ LẠI: danh bạ học sinh, tài khoản phụ huynh, đợt đăng ký, tài khoản nhà trường, nhật ký.\n");

try {
  if (DATA_BACKEND === "mysql") await chayMysql();
  else if (DATA_BACKEND === "sqlite") await chaySqlite();
  else throw new Error(`Chưa hỗ trợ DATA_BACKEND=${DATA_BACKEND}. Công cụ này chỉ chạy với mysql hoặc sqlite.`);
} catch (error) {
  console.error(`\nLỖI: ${error.message}`);
  process.exitCode = 1;
}
