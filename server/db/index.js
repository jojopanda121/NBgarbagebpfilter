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
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };
