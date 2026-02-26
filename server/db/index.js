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
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    database.exec(sql);
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
