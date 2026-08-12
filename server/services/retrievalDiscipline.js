// ============================================================
// retrievalDiscipline.js — 检索纪律（任务书第7部分）
//
// 把搜索供应商当"听话但不聪明的搜索工人"来管：
//   1) 来源可信度分层（官方/监管 > 一线财经媒体 > 行研机构 > 其他），
//      命理/玄学/SEO 内容农场一律丢弃（7.3.1）。
//   2) 调用硬上限：每条声明 ≤2 次、单项目 ≤14 次（7.2）。
//   3) search_log：逐条记录核查点/query/命中来源/采用或丢弃/填入字段（7.4）。
//   "搜不到 ≠ 中性分" 的纪律由上层评分的 coverage 逻辑承接（本模块只负责
//   不编造、可追溯、来源分层）。
//
// 纯函数 + 轻状态对象，可单测，不直接联网。
// ============================================================

// —— 来源可信度分层（子串匹配 URL/标题/来源名）——
const SOURCE_TIERS = [
  {
    tier: 1, label: "官方/监管", score: 100,
    patterns: [
      "gov.cn", "miit", "ndrc", "stats.gov", "pbc.gov", "csrc", "samr",
      "发改委", "工信部", "国家统计局", "证监会", "央行", "国资委", "科技部",
      "招股书", "招股说明书", "公司公告", "年度报告", "年报", "交易所",
      "sse.com", "szse.cn", "cninfo", "hkex", "sec.gov", "白皮书", "规划纲要",
    ],
  },
  {
    tier: 2, label: "一线财经媒体", score: 75,
    patterns: [
      "财新", "caixin", "第一财经", "yicai", "21世纪经济", "界面新闻", "jiemian",
      "证券时报", "上海证券报", "中国证券报", "经济观察", "36kr", "36氪",
      "路透", "reuters", "彭博", "bloomberg", "财联社", "新华社", "xinhua", "人民网",
    ],
  },
  {
    tier: 3, label: "行研机构", score: 55,
    patterns: [
      "艾瑞", "iresearch", "灼识", "cic", "弗若斯特", "frost", "沙利文", "sullivan",
      "头豹", "leadleo", "idc", "gartner", "中金", "中信证券", "招商证券", "国泰君安",
      "德勤", "deloitte", "麦肯锡", "mckinsey", "research", "白名单",
    ],
  },
];
const SOURCE_DEFAULT = { tier: 4, label: "其他", score: 30 };

// 无关/低可信内容 → 直接丢弃（命理/玄学/SEO 农场等）
const JUNK_PATTERNS = [
  "命理", "玄学", "风水", "星座", "算命", "八字", "生辰", "运势", "占卜", "塔罗",
  "百家号", "seo", "内容农场", "网赚", "赌博", "彩票",
];

function _hay(result) {
  return [result.url, result.title, result.snippet, result.source, result.link]
    .filter(Boolean).join(" ").toLowerCase();
}

/** 判定单条结果来源档位；命中 junk → {drop:true} */
function classifySource(result = {}) {
  const hay = _hay(result);
  if (JUNK_PATTERNS.some((p) => hay.includes(p.toLowerCase()))) {
    return { drop: true, tier: 5, label: "无关/低可信", score: 0 };
  }
  for (const t of SOURCE_TIERS) {
    if (t.patterns.some((p) => hay.includes(p.toLowerCase()))) {
      return { drop: false, tier: t.tier, label: t.label, score: t.score };
    }
  }
  return { drop: false, ...SOURCE_DEFAULT };
}

/** 丢弃 junk、按可信度排序、按 url 去重；每条挂 _source 元数据 */
function filterAndRankResults(results = []) {
  const seen = new Set();
  const out = [];
  for (const r of results) {
    const src = classifySource(r);
    if (src.drop) continue;
    const key = (r.url || r.link || r.title || "").trim();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push({ ...r, _source: { tier: src.tier, label: src.label, score: src.score } });
  }
  out.sort((a, b) => (b._source.score - a._source.score));
  return out;
}

/** 冲突取保守值：多个数字打架时取偏保守一侧（7.3.2） */
function pickConservative(values = []) {
  const nums = values
    .filter((v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)))
    .map(Number);
  if (!nums.length) return null;
  return Math.min(...nums); // 市场规模/增速类，保守=偏小
}

// —— 调用预算（每条声明 ≤2、单项目 ≤14）——
function createRetrievalBudget({ perClaim = 2, perProject = 14 } = {}) {
  const counts = {};
  let total = 0;
  return {
    /** 是否还能为某条声明发起检索 */
    canSearch(claimId = "_") {
      return total < perProject && (counts[claimId] || 0) < perClaim;
    },
    /** 记一次检索调用 */
    record(claimId = "_") {
      counts[claimId] = (counts[claimId] || 0) + 1;
      total += 1;
      return { claimId, claim_calls: counts[claimId], project_calls: total };
    },
    snapshot() {
      return { total, perClaim, perProject, remaining: Math.max(0, perProject - total), by_claim: { ...counts } };
    },
  };
}

// —— search_log（7.4）：每条核查点一行 ——
function makeSearchLog() {
  const entries = [];
  return {
    add({ check_point, query, calls = 1, source_type = null, used = false, filled_field = null, note = null }) {
      entries.push({ check_point, query, calls, source_type, used: !!used, filled_field, note });
    },
    get() { return entries.slice(); },
  };
}

module.exports = {
  SOURCE_TIERS, SOURCE_DEFAULT, JUNK_PATTERNS,
  classifySource, filterAndRankResults, pickConservative,
  createRetrievalBudget, makeSearchLog,
};
