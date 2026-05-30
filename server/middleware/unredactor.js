// ============================================================
// server/middleware/unredactor.js
//
// 反脱敏 —— Hermes 返回的文本若含 redactor 写出的占位符（[PHONE_1] / [FOUNDER_2]
// 等），从 redaction_maps 查表替换回原文。
//
// 严格按 session_id 取映射，避免跨会话串扰。
// ============================================================

const { getDb } = require("../db");

const PLACEHOLDER_PATTERN = /\[([A-Z_]+_\d+)\]/g;

function loadMappings(sessionId) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT placeholder, original FROM redaction_maps WHERE session_id = ?
  `).all(sessionId);
  const map = new Map();
  for (const r of rows) {
    map.set(r.placeholder.replace(/^\[|\]$/g, ""), r.original);
  }
  return map;
}

/**
 * 把文本里的 [PHONE_1] 等占位符还原。
 * 找不到映射的占位符保持原样（兜底，不报错）。
 */
function unredact(text, sessionId) {
  if (!text || typeof text !== "string") return text;
  const map = loadMappings(sessionId);
  if (map.size === 0) return text;
  return text.replace(PLACEHOLDER_PATTERN, (match, key) => {
    return map.has(key) ? map.get(key) : match;
  });
}

/**
 * GC: 删除 24h 之前的映射（plan §7：redaction_maps TTL 24h）
 * 启动时 + workspaceGc 周期触发。
 */
function gcOlderThan(hours = 24) {
  try {
    const db = getDb();
    const r = db.prepare(`
      DELETE FROM redaction_maps
      WHERE created_at < datetime('now', '-' || ? || ' hours')
    `).run(hours);
    return r.changes;
  } catch (err) {
    console.error("[unredactor.gc] failed:", err.message);
    return 0;
  }
}

module.exports = { unredact, gcOlderThan, loadMappings };
