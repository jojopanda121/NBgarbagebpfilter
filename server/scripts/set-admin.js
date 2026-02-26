#!/usr/bin/env node
// ============================================================
// set-admin.js — 命令行工具：设置管理员账号
// 
// 使用方法：
//   node scripts/set-admin.js <username>
//   node scripts/set-admin.js <username> --remove  (取消管理员)
// ============================================================

const Database = require("better-sqlite3");
const path = require("path");

// 读取数据库路径
const dbPath = process.env.DB_PATH || path.join(__dirname, "..", "data", "app.db");

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log(`
用法:
  node scripts/set-admin.js <username>        # 将用户设为管理员
  node scripts/set-admin.js <username> --remove  # 取消管理员权限
  node scripts/set-admin.js --list            # 列出所有用户及其角色

示例:
  node scripts/set-admin.js admin
  node scripts/set-admin.js john --remove
  node scripts/set-admin.js --list
`);
  process.exit(1);
}

const db = new Database(dbPath);

// 检查 users 表是否有 role 列
const tableInfo = db.prepare("PRAGMA table_info(users)").all();
const hasRoleColumn = tableInfo.some(col => col.name === "role");

if (!hasRoleColumn) {
  console.log("[DB] Adding 'role' column to users table...");
  db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'");
}

const username = args[0];
const isRemove = args.includes("--remove");
const isList = args[0] === "--list";

if (isList) {
  // 列出所有用户
  const users = db.prepare("SELECT id, username, role, created_at FROM users ORDER BY id").all();
  console.log("\n用户列表:");
  console.log("-" .repeat(50));
  users.forEach(u => {
    console.log(`ID: ${u.id} | 用户名: ${u.username} | 角色: ${u.role || 'user'} | 注册时间: ${u.created_at}`);
  });
  console.log("-" .repeat(50));
  console.log(`总计: ${users.length} 个用户\n`);
  db.close();
  process.exit(0);
}

const user = db.prepare("SELECT id, username, role FROM users WHERE username = ?").get(username);

if (!user) {
  console.error(`错误: 用户 "${username}" 不存在！`);
  db.close();
  process.exit(1);
}

if (isRemove) {
  // 取消管理员权限
  db.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(user.id);
  console.log(`✓ 已取消用户 "${username}" 的管理员权限`);
} else {
  // 设置为管理员
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
  console.log(`✓ 已将用户 "${username}" 设为管理员`);
}

// 验证设置结果
const updatedUser = db.prepare("SELECT id, username, role FROM users WHERE username = ?").get(username);
console.log(`\n当前状态: 用户名=${updatedUser.username}, 角色=${updatedUser.role}\n`);

db.close();
