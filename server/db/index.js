// ============================================================
// server/db/index.js — SQLite 数据库连接与迁移
// 使用 better-sqlite3（同步、高性能、WAL 模式）
// ============================================================

const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const config = require("../config");

let db = null;

function getDb() {
  if (db) return db;

  // 确保数据目录存在
  const dbDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(config.dbPath);

  // WAL 模式：提升并发读写性能
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  // 运行迁移
  runMigrations(db);

  return db;
}

function runMigrations(database) {
  const migrationsDir = path.join(__dirname, "migrations");

  // 首先确保迁移追踪表存在
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT (datetime('now'))
    )
  `);

  // 获取所有迁移文件
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // 获取已应用的迁移
  const appliedMigrations = new Set(
    database.prepare("SELECT version FROM schema_migrations").all().map(row => row.version)
  );

  // 只运行未应用的迁移
  for (const file of files) {
    // 跳过迁移追踪表本身
    if (file === "000_schema_migrations.sql") continue;

    if (appliedMigrations.has(file)) {
      console.log(`[DB] Migration already applied: ${file}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");

    // 在事务中执行迁移
    try {
      database.transaction(() => {
        database.exec(sql);
        database.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(file);
      })();
      console.log(`[DB] Migration applied: ${file}`);
    } catch (err) {
      // 如果迁移失败（比如列已存在），记录警告但继续
      console.log(`[DB] Migration ${file} skipped: ${err.message}`);
    }
  }

  // 确保关键列存在（兼容旧数据库）
  ensureColumnsExist(database);
}

// 确保关键列存在 - 修复旧数据库缺失列的问题
function ensureColumnsExist(database) {
  try {
    // 检查 users 表的 role 列
    const userTableInfo = database.prepare("PRAGMA table_info(users)").all();
    const userColumns = userTableInfo.map(col => col.name);

    if (!userColumns.includes("role")) {
      console.log("[DB] Adding missing 'role' column to users table...");
      database.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'");
    }

    // 检查 users 表的 is_banned 列
    if (!userColumns.includes("is_banned")) {
      console.log("[DB] Adding missing 'is_banned' column to users table...");
      database.exec("ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0");
    }
  } catch (err) {
    console.log(`[DB] Column check warning: ${err.message}`);
  }

  // 自动初始化管理员账号（如果配置了环境变量）
  initializeAdminUser(database);
}

// 根据环境变量自动创建管理员
function initializeAdminUser(database) {
  const adminUsername = config.adminUsername;
  const adminPassword = config.adminPassword;

  if (!adminUsername || !adminPassword) {
    // 没有配置管理员环境变量，跳过
    return;
  }

  try {
    // 检查是否已存在管理员
    const existingAdmin = database.prepare("SELECT id FROM users WHERE username = ? AND role = 'admin'").get(adminUsername);

    if (existingAdmin) {
      console.log(`[DB] Admin user "${adminUsername}" already exists`);
      return;
    }

    // 检查用户是否存在
    const existingUser = database.prepare("SELECT id, password_hash FROM users WHERE username = ?").get(adminUsername);

    if (existingUser) {
      // 用户存在，将现有用户升级为管理员
      database.prepare("UPDATE users SET role = 'admin' WHERE username = ?").run(adminUsername);
      // 确保已升级的管理员有额度记录
      const existingQuota = database.prepare("SELECT id FROM quotas WHERE user_id = ?").get(existingUser.id);
      if (!existingQuota) {
        database.prepare("INSERT INTO quotas (user_id, free_quota, paid_quota) VALUES (?, 999, 0)").run(existingUser.id);
      }
      console.log(`[DB] Promoted user "${adminUsername}" to admin`);
    } else {
      // 创建新的管理员账号
      const bcrypt = require("bcryptjs");
      const passwordHash = bcrypt.hashSync(adminPassword, 12);
      const info = database.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(adminUsername, passwordHash);
      // 为管理员初始化额度记录
      const adminId = info.lastInsertRowid;
      database.prepare("INSERT INTO quotas (user_id, free_quota, paid_quota) VALUES (?, 999, 0)").run(adminId);
      console.log(`[DB] Created admin user: ${adminUsername}`);
    }
  } catch (err) {
    console.log(`[DB] Admin initialization warning: ${err.message}`);
  }
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };
