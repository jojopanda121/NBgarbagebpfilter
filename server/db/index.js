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
    database.transaction(() => {
      database.exec(sql);
      database.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(file);
    })();

    console.log(`[DB] Migration applied: ${file}`);
  }
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };
