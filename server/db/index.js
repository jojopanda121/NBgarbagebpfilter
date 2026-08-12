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
      // M22: ALTER TABLE ADD COLUMN 在某些旧库可能因列已存在而冲突，这类幂等错误才允许跳过；
      //      其他错误（语法、约束、磁盘 IO）必须 fail-fast，避免半执行状态进入生产。
      //
      // P0-1 修复：整体事务失败时所有语句都已回滚，此时直接把迁移标记为 applied
      // 会把"实际一条都没执行"的迁移永久跳过（schema 静默漂移）。
      // 正确做法：遇到幂等错误时降级为逐语句重放——真正幂等冲突的语句跳过，
      // 其余语句必须成功执行，任何非幂等错误仍然 fail-fast。
      const idempotentRe = /duplicate column name|already exists|index already exists/i;
      if (idempotentRe.test(err.message)) {
        console.warn(`[DB] Migration ${file} hit idempotent conflict, replaying statement-by-statement: ${err.message}`);
        applyMigrationStatementwise(database, file, sql, idempotentRe);
      } else {
        console.error(`[DB][FATAL] Migration ${file} failed: ${err.message}`);
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }
  }

  // 确保关键列存在（兼容旧数据库）
  ensureColumnsExist(database);
}

/**
 * P0-1: 迁移整体事务因幂等冲突回滚后的降级路径。
 * 在单个事务中逐语句重放：仅跳过"本身就是幂等冲突"的语句
 * （duplicate column / already exists），其余语句必须全部成功，
 * 否则整个迁移回滚并 fail-fast——绝不把未执行的迁移标记为 applied。
 *
 * 注意：按"行尾分号"切分语句。当前所有迁移均为普通 DDL/DML，
 * 不含 TRIGGER 等 BEGIN...END 复合语句；如未来引入，请将该迁移
 * 写成单语句文件或在此扩展解析器。
 */
function applyMigrationStatementwise(database, file, sql, idempotentRe) {
  if (/CREATE\s+TRIGGER/i.test(sql)) {
    throw new Error(
      `Migration ${file} failed: 含 TRIGGER 的迁移不支持逐语句重放，请人工处理幂等冲突`
    );
  }
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s && !/^--/.test(s));

  try {
    database.transaction(() => {
      for (const stmt of statements) {
        try {
          database.exec(`${stmt};`);
        } catch (err) {
          if (idempotentRe.test(err.message)) {
            console.warn(`[DB] Migration ${file} skip idempotent statement: ${err.message}`);
            continue;
          }
          throw err;
        }
      }
      database.prepare("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)").run(file);
    })();
    console.log(`[DB] Migration applied (statement-wise): ${file}`);
  } catch (err) {
    console.error(`[DB][FATAL] Migration ${file} failed during statement-wise replay: ${err.message}`);
    throw new Error(`Migration ${file} failed: ${err.message}`);
  }
}

// 确保关键列存在 - 修复旧数据库缺失列的问题
//
// ⚠️ 已冻结（P2-4）：本函数只为兼容 2024 年迁移体系建立之前的历史库存在。
// 新增任何表/列一律写迁移文件（server/db/migrations/NNN_*.sql），
// 不要再往这里加 ALTER —— 双轨修 schema 会导致迁移与兜底互相掩盖漂移。
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

  ensureAgentRunColumns(database);

  // 自动初始化管理员账号（如果配置了环境变量）
  initializeAdminUser(database);
}

function ensureAgentRunColumns(database) {
  try {
    const table = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_runs'").get();
    if (!table) return;

    const columns = new Set(database.prepare("PRAGMA table_info(agent_runs)").all().map(col => col.name));
    const addColumn = (name, definition) => {
      if (columns.has(name)) return;
      console.log(`[DB] Adding missing 'agent_runs.${name}' column...`);
      database.exec(`ALTER TABLE agent_runs ADD COLUMN ${name} ${definition}`);
      columns.add(name);
    };

    addColumn("user_id", "INTEGER");
    addColumn("total_agents", "INTEGER DEFAULT 6");
    addColumn("finished_agents", "INTEGER DEFAULT 0");
    addColumn("failed_agents", "INTEGER DEFAULT 0");
    addColumn("finished_at", "DATETIME");

    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON agent_runs(user_id);
      CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
    `);
  } catch (err) {
    console.log(`[DB] Agent run column check warning: ${err.message}`);
  }
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
