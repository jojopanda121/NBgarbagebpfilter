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

// 一个项目算「高分/优质」的分数门槛
const HIGH_SCORE_MIN = 70;

// ── 徽章目录。每项 evaluate(stats) 返回 { tier, meta } 或 null ──
// rank 用于「默认帮挂最高等级 1 枚」时排序（越大越优先）。
const CATALOG = {
  // 高分家族：按「发现的 70+ 优质项目数量」分级（不是最高分）。
  high_score: {
    code: "high_score",
    icon: "🏆",
    rankBase: 300,
    tiers: {
      1: { name: "高分猎手", color: "#B87333", req: `发现 1 个 ${HIGH_SCORE_MIN}+ 优质项目` },
      2: { name: "明星猎手", color: "#9AA7B4", req: `发现 5 个 ${HIGH_SCORE_MIN}+ 优质项目` },
      3: { name: "顶尖猎手", color: "#E0A526", req: `发现 15 个 ${HIGH_SCORE_MIN}+ 优质项目` },
    },
    desc: (m) => `发现 ${m.high_count} 个 ${HIGH_SCORE_MIN} 分以上的优质项目`,
    evaluate: (s) => {
      const n = s.highCount || 0;
      const tier = n >= 15 ? 3 : n >= 5 ? 2 : n >= 1 ? 1 : 0;
      return tier ? { tier, meta: { high_count: n } } : null;
    },
  },
  volume: {
    code: "volume",
    icon: "📊",
    rankBase: 200,
    tiers: {
      1: { name: "勤勉分析", color: "#B87333", req: "累计完成 10 份分析" },
      2: { name: "资深分析", color: "#9AA7B4", req: "累计完成 30 份分析" },
      3: { name: "百战分析", color: "#E0A526", req: "累计完成 100 份分析" },
    },
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
    tiers: { 1: { name: "月度活跃", color: "#D85A30", req: "近 30 天完成 5 份分析" } },
    desc: (m) => `近 30 天完成 ${m.recent_count} 份分析`,
    evaluate: (s) => (s.recentCount >= 5 ? { tier: 1, meta: { recent_count: s.recentCount } } : null),
  },
  // 地区家族：按「主战区的项目数量」分级。展示名由地区拼接（如 华东在地 / 华东项目王）。
  region: {
    code: "region",
    icon: "📍",
    rankBase: 50,
    tiers: {
      1: { name: "在地", color: "#C9A227", req: "主战区累计 ≥ 3 个项目" },
      2: { name: "项目王", color: "#7c3aed", req: "主战区累计 ≥ 15 个项目" },
    },
    desc: (m) => (m.tier >= 2 ? `${m.region} 项目之王，已分析 ${m.count} 个` : `常分析 ${m.region} 的项目（${m.count} 个）`),
    evaluate: (s) => {
      if (!s.topRegion) return null;
      const n = s.topRegionCount || 0;
      const tier = n >= 15 ? 2 : n >= 3 ? 1 : 0;
      return tier ? { tier, meta: { region: s.topRegion, count: n, tier } } : null;
    },
  },
};

// 徽章美术图：client/public/badges/<code>_<tier>.png（运行时 /badges/<code>_<tier>.png）
function badgeImage(code, tier) {
  return `/badges/${code}_${tier}.png`;
}

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
    image: badgeImage(row.badge_code, row.tier),
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
  let highCount = 0;        // 70+ 优质项目数量
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
    if (score >= HIGH_SCORE_MIN) highCount += 1;

    const t = Date.parse(r.created_at + "Z") || Date.parse(r.created_at);
    if (t && t >= cutoff) recentCount += 1;

    const region = toRegion(r.project_location || r.ip_region);
    if (region) regionCounts[region] = (regionCounts[region] || 0) + 1;
  }

  let topRegion = null, topRegionCount = 0;
  for (const [region, n] of Object.entries(regionCounts)) {
    if (n > topRegionCount) { topRegion = region; topRegionCount = n; }
  }

  return { bestScore, totalCount, highCount, recentCount, topRegion, topRegionCount };
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

/**
 * 完整徽章目录 + 该用户的进度：每个家族的每个 tier 都返回一张「卡」，
 * 标注是否已解锁(earned)、是否当前所持等级(is_current)、是否挂出(displayed)、
 * 解锁条件(req) 与美术图(image)。供资料页「全目录 + 未解锁灰显」展示。
 */
function getCatalogProgress(userId) {
  const db = getDb();
  recompute(userId); // 先把最新该得的徽章入库
  const stats = computeStats(userId);
  const owned = {};
  for (const r of db.prepare("SELECT badge_code, tier, displayed FROM user_badges WHERE user_id = ?").all(userId)) {
    owned[r.badge_code] = { tier: r.tier, displayed: !!r.displayed };
  }

  const out = [];
  for (const def of Object.values(CATALOG)) {
    const earnedTier = def.evaluate(stats)?.tier || 0;
    const ownTier = owned[def.code]?.tier || 0;
    const tierNums = Object.keys(def.tiers).map(Number).sort((a, b) => a - b);
    for (const tier of tierNums) {
      const tierDef = def.tiers[tier];
      let name = tierDef.name;
      if (def.code === "region") name = `${stats.topRegion || "地区"}${tierDef.name}`;
      out.push({
        code: def.code,
        tier,
        name,
        image: badgeImage(def.code, tier),
        color: tierDef.color,
        req: tierDef.req || "",
        earned: tier <= earnedTier,
        is_current: tier === ownTier,                       // 当前所持等级（挂出开关作用于它）
        displayed: tier === ownTier && !!owned[def.code]?.displayed,
        family_rank: def.rankBase,
      });
    }
  }
  // 排序：家族 rank 降序，同家族 tier 升序
  return out.sort((a, b) => (b.family_rank - a.family_rank) || (a.tier - b.tier));
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
  recompute, getBadges, setDisplay, getCatalogProgress, CATALOG, computeStats,
  _internal: { toRegion, badgeView, badgeImage },
};
