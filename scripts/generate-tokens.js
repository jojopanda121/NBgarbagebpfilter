#!/usr/bin/env node
// ============================================================
// scripts/generate-tokens.js — 兑换码生成命令行工具
// ============================================================
// 用法:
//   cd server && node ../scripts/generate-tokens.js 10 5
// ============================================================

const path = require("path");
const crypto = require("crypto");

// 引用 server/node_modules 中的模块
const dbPath = path.join(__dirname, "..", "data", "app.db");

// 动态加载 better-sqlite3
const Database = require(path.join(__dirname, "..", "server", "node_modules", "better-sqlite3"));

const db = new Database(dbPath);

// 确保 tokens 表存在
db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    token       TEXT    NOT NULL UNIQUE,
    quota_amount INTEGER NOT NULL,
    expires_at  TEXT    NOT NULL,
    used_at     TEXT    DEFAULT NULL,
    used_by     INTEGER DEFAULT NULL,
    created_at  TEXT    DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tokens_token ON tokens(token);
  CREATE INDEX IF NOT EXISTS idx_tokens_used_by ON tokens(used_by);
`);

function generateTokens(count, quotaAmount, expireDays = 30) {
  const tokens = [];
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expireDays);

  const insert = db.prepare(`
    INSERT INTO tokens (token, quota_amount, expires_at)
    VALUES (?, ?, ?)
  `);

  console.log(`\n🎫 正在生成 ${count} 个兑换码（每次 ${quotaAmount} 额度，有效期 ${expireDays} 天）...\n`);

  for (let i = 0; i < count; i++) {
    const token = crypto.randomBytes(8).toString("hex").toUpperCase();
    insert.run(token, quotaAmount, expiresAt.toISOString());
    tokens.push(token);
  }

  return { tokens, quotaAmount, expiresAt: expiresAt.toISOString() };
}

// 解析命令行参数
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║              兑换码生成工具 v1.0                           ║
╠═══════════════════════════════════════════════════════════╣
║  用法:                                                    ║
║    cd server                                            ║
║    node ../scripts/generate-tokens.js <数量> <额度> [有效期天数]     ║
║                                                           ║
║  示例:                                                    ║
║    node ../scripts/generate-tokens.js 10 5    生成10个5次    ║
║    node ../scripts/generate-tokens.js 1 30    生成1个30次   ║
║    node ../scripts/generate-tokens.js 5 10 60 生成5个10次60天║
╚═══════════════════════════════════════════════════════════╝
  `);
  process.exit(1);
}

const count = parseInt(args[0], 10);
const quotaAmount = parseInt(args[1], 10);
const expireDays = args[2] ? parseInt(args[2], 10) : 30;

if (isNaN(count) || isNaN(quotaAmount)) {
  console.error("❌ 参数错误：数量和额度必须是数字");
  process.exit(1);
}

const result = generateTokens(count, quotaAmount, expireDays);

// 输出结果
console.log("✅ 生成成功！\n");
console.log("┌─────────────────────────────────────────────────────┐");
console.log("│  兑换码列表（可复制给用户）                         │");
console.log("├─────────────────────────────────────────────────────┤");

let displayCount = 0;
for (const token of result.tokens) {
  console.log(`│  ${token}  │`);
  displayCount++;
  if (displayCount >= 20 && result.tokens.length > 20) {
    console.log(`│  ... 还有 ${result.tokens.length - 20} 个未显示                          │`);
    break;
  }
}

console.log("├─────────────────────────────────────────────────────┤");
console.log(`│  额度: ${result.quotaAmount} 次                                    │`);
console.log(`│  有效期: ${new Date(result.expiresAt).toLocaleDateString("zh-CN")} 前有效                      │`);
console.log(`│  总计: ${result.tokens.length} 个                                    │`);
console.log("└─────────────────────────────────────────────────────┘\n");

db.close();
