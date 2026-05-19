// ============================================================
// server/utils/userPlan.js
//
// 用户 plan / VIP 状态判定 — 全仓库唯一来源。
//
// 历史上 evidenceStore / workspaceUploadLimits / workspaceQuota / adminService
// 各自重复了一份 "查 users.is_vip + 算 expires" 逻辑，任意一处改动都可能让
// 其他三处与之不一致。统一到这里。
//
// 兼容性: 老数据库可能没有 is_vip / vip_expires_at 列，hasVipColumn() 返回
// false 时调用方该走"非 VIP"分支，不要抛错。
// ============================================================

const { getDb } = require("../db");

function hasVipColumn(db = getDb()) {
  try {
    const cols = db.prepare("PRAGMA table_info(users)").all();
    return cols.some((c) => c.name === "is_vip");
  } catch {
    return false;
  }
}

// 单用户 plan 查询。失败 / 列不存在 / 用户不存在都返回 free user 默认值,
// 调用方无需处理异常。
function getUserPlan(db, userId) {
  const dbHandle = db || getDb();
  if (!userId) return { role: "user", isVip: false, vipExpiresAt: null };
  try {
    const hasVip = hasVipColumn(dbHandle);
    const fields = hasVip
      ? "role, is_vip, vip_expires_at"
      : "role, 0 as is_vip, NULL as vip_expires_at";
    const u = dbHandle.prepare(`SELECT ${fields} FROM users WHERE id = ?`).get(userId);
    const isVip = !!u?.is_vip && (!u.vip_expires_at || new Date(u.vip_expires_at) > new Date());
    return {
      role: u?.role || "user",
      isVip,
      vipExpiresAt: u?.vip_expires_at || null,
    };
  } catch {
    return { role: "user", isVip: false, vipExpiresAt: null };
  }
}

function isActiveVipRow(row) {
  if (!row) return false;
  if (row.role === "admin") return true;
  return !!row.is_vip && (!row.vip_expires_at || new Date(row.vip_expires_at) > new Date());
}

// 给 adminService 等需要动态拼 SELECT 的地方：返回 (vipSelect, hasVip) 二元组。
function buildVipSelectFragment(db = getDb(), alias = "u") {
  const hasVip = hasVipColumn(db);
  const vipSelect = hasVip
    ? `${alias}.is_vip, ${alias}.vip_expires_at,`
    : "0 as is_vip, NULL as vip_expires_at,";
  return { hasVip, vipSelect };
}

module.exports = {
  hasVipColumn,
  getUserPlan,
  isActiveVipRow,
  buildVipSelectFragment,
};
