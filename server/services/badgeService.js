// ============================================================
// server/services/badgeService.js — BP 自动徽章
//
// 徽章由平台数据(tasks)自动算出，用户只能选择是否「挂出」(displayed)，
// 不能伪造 tier —— 与「评分快照只用平台实测」的 Integrity 红线一致。
//
// 徽章「定义」(名称/图标/各 tier 阈值) 写死在本文件 CATALOG；
// DB 表 user_badges 只存已授予徽章 + 展示偏好（迁移 062）。
// ============================================================

const { getDb } = require("../db");

function safeParse(str, fallback = null) {
  if (str == null) return fallback;
  if (typeof str === "object") return str;
  try { return JSON.parse(str); } catch { return fallback; }
}

// 省份 → 大区，用于「所在地」徽章；未命中则回退原始值。
const PROVINCE_REGION = {
  北京: "华北", 天津: "华北", 河北: "华北", 山西: "华北", 内蒙古: "华北",
  上海: "华东", 江苏: "华东", 浙江: "华东", 安徽: "华东", 福建: "华东", 江西: "华东", 山东: "华东",
  广东: "华南", 广西: "华南", 海南: "华南",
  河南: "华中", 湖北: "华中", 湖南: "华中",
  重庆: "西南", 四川: "西南", 贵州: "西南", 云南: "西南", 西藏: "西南",
  陕西: "西北", 甘肃: "西北", 青海: "西北", 宁夏: "西北", 新疆: "西北",
  辽宁: "东北", 吉林: "东北", 黑龙江: "东北",
  香港: "港澳台", 澳门: "港澳台", 台湾: "港澳台",
};

function toRegion(loc) {
  if (!loc) return null;
  const s = String(loc).trim();
  if (!s) return null;
  for (const [prov, region] of Object.entries(PROVINCE_REGION)) {
    if (s.includes(prov)) return region;
  }
  return s; // 回退：直接用原始地名
}

// ── 徽章目录。每项 evaluate(stats) 返回 { tier, meta } 或 null ──
// rank 用于「默认帮挂最高等级 1 枚」时排序（越大越优先）。
const CATALOG = {
  high_score: {
    code: "high_score",
    icon: "🏆",
    rankBase: 300,
    tiers: { 1: { name: "高分猎手", color: "#3b82f6" }, 2: { name: "明星猎手", color: "#8b5cf6" }, 3: { name: "顶尖猎手", color: "#f59e0b" } },
    desc: (m) => `分析出过最高分 ${Math.round(m.best_score)} 的优质项目`,
    evaluate: (s) => {
      if (s.bestScore == null) return null;
      const tier = s.bestScore >= 93 ? 3 : s.bestScore >= 88 ? 2 : s.bestScore >= 80 ? 1 : 0;
      return tier ? { tier, meta: { best_score: s.bestScore } } : null;
    },
  },
  volume: {
    code: "volume",
    icon: "📊",
    rankBase: 200,
    tiers: { 1: { name: "勤勉分析", color: "#10b981" }, 2: { name: "资深分析", color: "#0ea5e9" }, 3: { name: "百战分析", color: "#f43f5e" } },
    desc: (m) => `累计完成 ${m.count} 份 BP 分析`,
    evaluate: (s) => {
      const tier = s.totalCount >= 100 ? 3 : s.totalCount >= 30 ? 2 : s.totalCount >= 10 ? 1 : 0;
      return tier ? { tier, meta: { count: s.totalCount } } : null;
    },
  },
  active: {
    code: "active",
    icon: "🔥",
    rankBase: 100,
    tiers: { 1: { name: "月度活跃", color: "#ef4444" } },
    desc: (m) => `近 30 天完成 ${m.recent_count} 份分析`,
    evaluate: (s) => (s.recentCount >= 5 ? { tier: 1, meta: { recent_count: s.recentCount } } : null),
  },
  region: {
    code: "region",
    icon: "📍",
    rankBase: 50,
    tiers: { 1: { name: "在地", color: "#6366f1" } }, // 展示名由 region 拼接
    desc: (m) => `常分析 ${m.region} 的项目`,
    evaluate: (s) => (s.topRegion ? { tier: 1, meta: { region: s.topRegion } } : null),
  },
};

// 把一条 DB 行 + 目录定义合成对外视图
function badgeView(row) {
  const def = CATALOG[row.badge_code];
  if (!def) return null;
  const meta = safeParse(row.meta, {});
  const tierDef = def.tiers[row.tier] || def.tiers[1] || {};
  let name = tierDef.name || row.badge_code;
  if (row.badge_code === "region" && meta.region) name = `${meta.region}${tierDef.name}`;
  return {
    code: row.badge_code,
    tier: row.tier,
    name,
    icon: def.icon,
    color: tierDef.color || "#64748b",
    desc: def.desc ? def.desc(meta) : "",
    meta,
    displayed: !!row.displayed,
    awarded_at: row.awarded_at,
  };
}

// 计算某用户的统计量（仅 complete 且未删除的任务）
function computeStats(userId) {
  const db = getDb();
  const rows = db.prepare(
    `SELECT total_score, result, project_location, ip_region, created_at
     FROM tasks
     WHERE user_id = ? AND status = 'complete' AND deleted_at IS NULL`
  ).all(userId);

  let bestScore = null;
  let totalCount = 0;
  let recentCount = 0;
  const regionCounts = {};
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;

  for (const r of rows) {
    let score = r.total_score;
    if (score == null) {
      const v = safeParse(r.result, null)?.verdict;
      score = v?.total_score ?? null;
    }
    // 只把有有效评分的任务计入「分析总量」
    if (score == null) continue;
    totalCount += 1;
    if (bestScore == null || score > bestScore) bestScore = score;

    const t = Date.parse(r.created_at + "Z") || Date.parse(r.created_at);
    if (t && t >= cutoff) recentCount += 1;

    const region = toRegion(r.project_location || r.ip_region);
    if (region) regionCounts[region] = (regionCounts[region] || 0) + 1;
  }

  let topRegion = null, topN = 0;
  for (const [region, n] of Object.entries(regionCounts)) {
    if (n > topN) { topRegion = region; topN = n; }
  }

  return { bestScore, totalCount, recentCount, topRegion };
}

/**
 * 重算并幂等 upsert 某用户的徽章。保留用户已有的 displayed 选择。
 * 若该用户当前没有任何挂出的徽章，则默认帮其挂上 rank 最高的 1 枚。
 */
function recompute(userId) {
  const db = getDb();
  const stats = computeStats(userId);

  const earned = [];
  for (const def of Object.values(CATALOG)) {
    const res = def.evaluate(stats);
    if (res) earned.push({ code: def.code, tier: res.tier, meta: res.meta, rank: def.rankBase + res.tier });
  }

  const upsert = db.prepare(
    `INSERT INTO user_badges (user_id, badge_code, tier, meta)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, badge_code)
     DO UPDATE SET tier = excluded.tier, meta = excluded.meta`
  );
  db.transaction(() => {
    for (const b of earned) {
      upsert.run(userId, b.code, b.tier, JSON.stringify(b.meta));
    }
    // 默认帮挂：若一枚都没挂，挂 rank 最高的已获得徽章
    const shown = db.prepare("SELECT COUNT(*) AS n FROM user_badges WHERE user_id = ? AND displayed = 1").get(userId);
    if ((shown?.n || 0) === 0 && earned.length) {
      const top = earned.reduce((a, b) => (b.rank > a.rank ? b : a));
      db.prepare("UPDATE user_badges SET displayed = 1 WHERE user_id = ? AND badge_code = ?").run(userId, top.code);
    }
  })();

  return getBadges(userId);
}

/** 取某用户徽章。onlyDisplayed=true 仅返回挂出的（用于对外展示）。 */
function getBadges(userId, { onlyDisplayed = false } = {}) {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM user_badges WHERE user_id = ?${onlyDisplayed ? " AND displayed = 1" : ""}`
  ).all(userId);
  return rows.map(badgeView).filter(Boolean)
    .sort((a, b) => (CATALOG[b.code].rankBase + b.tier) - (CATALOG[a.code].rankBase + a.tier));
}

/** 设置某枚徽章是否挂出。只能改自己已获得的徽章。 */
function setDisplay(userId, badgeCode, displayed) {
  const db = getDb();
  const exists = db.prepare("SELECT 1 FROM user_badges WHERE user_id = ? AND badge_code = ?").get(userId, badgeCode);
  if (!exists) { const e = new Error("徽章不存在或尚未获得"); e.status = 404; throw e; }
  db.prepare("UPDATE user_badges SET displayed = ? WHERE user_id = ? AND badge_code = ?")
    .run(displayed ? 1 : 0, userId, badgeCode);
  return getBadges(userId);
}

module.exports = {
  recompute, getBadges, setDisplay, CATALOG, computeStats,
  _internal: { toRegion, badgeView },
};
