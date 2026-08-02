// ============================================================
// scoringS3Harness.js — S3「资本效率与规模效应」harness 化子系统
//
// 解决旧 S3（资本效率分×5 + 规模效应分×5 + 毛利±1）三个结构性缺陷：
//   1. 资本密集=护城河时 S2/S3 自相矛盾 → 资本壁垒溢价(CBP)：全球/全国同类玩家
//      越少，资本门槛越有效地构成护城河，资本密集从减分翻成加分。
//   2. 新质重资产 ≠ 产能过剩重资产 → 新质生产力加分(N)：用市场CAGR+政策目录量化，
//      让 DRAM(全球4家/CAGR15%/国家战略) 与钢铁(200家/CAGR2%/非战略) 拉开。
//   3. 资本来源/资本成本差异 → 资本耐心系数(λ)：国家大基金/政府主导的战略项目，
//      资本效率惩罚部分豁免；且仅战略赛道(Pol≥阈值)生效，避免给产能过剩SOE放水。
//   外加：规模陡峭度 → G = 规模类型分(ST) × 成本曲线陡峭度(k)，区分半导体良率驱动
//      的指数级规模与普通制造的近线性规模（同为"规模经济"类型，k 不同则分不同）。
//
// 公式：S3 = clamp( CE + G + CBP + N + ΔGM, 0, 100 )
//   CE  = CE_base + (38 − CE_base)×λ            资本效率(含耐心豁免)  0-38
//   G   = min(ST × k, 38)                        规模效应×陡峭度        0-38
//   CBP = 玩家稀缺分 × 资本密集闸门               资本壁垒溢价           0-16
//   N   = 成长性分 + 政策优先级分                 新质生产力             0-16
//   ΔGM = 毛利分档修正                            −6 … +6
//
// 与 scoringHarness(S2) 同范式：standalone 纯函数，scoring.js 按灰度开关调用；
// 输入优先用结构化 S3_Rubric，缺失时回退 Capital_Archetype / Scale_Mechanism 枚举，
// 保证向后兼容与确定性（给定输入，任何人算出来结果相同）。
// ============================================================

const T = require("../config/scoringTables");

function _clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function _num(v) {
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// 玩家稀缺分：玩家数缺失 → 0（无证据不给溢价，保守）
function _scarcityScore(playerCount) {
  if (playerCount == null) return 0;
  for (const b of T.S3H_SCARCITY_BRACKETS) {
    if (playerCount <= b.maxPlayers) return b.score;
  }
  return 0;
}

// 成长性分：CAGR 缺失 → 中性默认（低置信）
function _growthScore(cagr) {
  if (cagr == null) return T.S3H_GROWTH_DEFAULT;
  for (const b of T.S3H_GROWTH_BRACKETS) {
    if (cagr >= b.minCagr) return b.score;
  }
  return 0;
}

// 毛利修正：毛利缺失 → 0（不修正，与原逻辑一致）
function _gmAdjust(gm) {
  if (gm == null) return 0;
  for (const b of T.S3H_GM_BRACKETS) {
    if (gm >= b.minGm) return b.adj;
  }
  return 0;
}

/**
 * 计算 S3 harness 分。
 *
 * @param {object}  p
 * @param {object} [p.s3Rubric]        结构化新输入（Agent B 产出），字段见下；可选
 * @param {string} [p.archetype]       回退用 Capital_Archetype 枚举
 * @param {string} [p.scaleMechanism]  回退用 Scale_Mechanism 枚举
 * @param {number} [p.grossMargin]     毛利率(小数 0-1)，来自 financial agent
 * @param {number} [p.fallbackCagr]    S1 已算出的 CAGR(%)，market_cagr 缺失时回退
 * @returns {{ S3:number, basis:"harness"|"legacy", detail:object }}
 *
 * s3Rubric 字段（全部可选，缺失走默认）：
 *   capital_archetype     资产模式（同 Capital_Archetype 枚举）
 *   scale_type            规模效应类型（同 Scale_Mechanism 枚举）
 *   cost_curve_steepness  成本曲线陡峭度枚举（指数级/强学习曲线/中等学习曲线/普通规模经济/近线性）
 *   global_player_count   全球/全国同类玩家数（整数）
 *   market_cagr           市场 CAGR(%)
 *   policy_tier           政策优先级（国家级/省级/无）
 *   capital_source        资本来源（大基金主导/国资参与/市场化）
 *   gross_margin          毛利率(小数 0-1)，scoring 端注入兜底
 */
function scoreS3Harness({ s3Rubric, archetype, scaleMechanism, grossMargin, fallbackCagr } = {}) {
  const r = s3Rubric && typeof s3Rubric === "object" ? s3Rubric : {};

  // 资产模式 / 规模类型：优先 rubric，回退 legacy 枚举
  const arche = r.capital_archetype || archetype || null;
  const scaleType = r.scale_type || scaleMechanism || null;

  // —— 政策优先级（先算，资本耐心 gating 要用）——
  const policyTier = r.policy_tier || "无";
  const Pol = T.S3H_POLICY_TIER[policyTier] ?? T.S3H_POLICY_DEFAULT;

  // —— CE：资本效率基础分 + 资本耐心豁免（仅战略赛道生效）——
  const ceBase = arche != null && T.S3H_CE_BASE[arche] != null
    ? T.S3H_CE_BASE[arche]
    : T.S3H_CE_BASE_DEFAULT;
  const capSource = r.capital_source || "市场化";
  const lambdaRaw = T.S3H_CAPITAL_SOURCE_LAMBDA[capSource] ?? T.S3H_CAPITAL_SOURCE_DEFAULT;
  const lambda = Pol >= T.S3H_PATIENCE_POLICY_GATE ? lambdaRaw : 0;
  const CE = _clamp(ceBase + (T.S3H_CE_MAX - ceBase) * lambda, 0, T.S3H_CE_MAX);

  // —— G：规模效应类型 × 成本曲线陡峭度 ——
  const ST = scaleType != null && T.S3H_SCALE_TYPE[scaleType] != null
    ? T.S3H_SCALE_TYPE[scaleType]
    : T.S3H_SCALE_TYPE_DEFAULT;
  let k;
  if (r.cost_curve_steepness != null && T.S3H_STEEPNESS_K[r.cost_curve_steepness] != null) {
    k = T.S3H_STEEPNESS_K[r.cost_curve_steepness];
  } else {
    k = T.S3H_STEEPNESS_DEFAULT_BY_SCALE[scaleType] ?? T.S3H_STEEPNESS_DEFAULT;
  }
  const G = _clamp(ST * k, 0, T.S3H_G_MAX);

  // —— CBP：资本壁垒溢价（玩家稀缺分 × 资本密集闸门）——
  const playerCount = _num(r.global_player_count);
  const gate = T.S3H_CAPITAL_GATE_ARCHETYPES.includes(arche) ? 1 : 0;
  const scarcity = _scarcityScore(playerCount);
  const CBP = scarcity * gate;

  // —— N：新质生产力（成长性 + 政策优先级）——
  const cagr = _num(r.market_cagr) ?? _num(fallbackCagr);
  const Gr = _growthScore(cagr);
  const N = Gr + Pol;

  // —— ΔGM：毛利修正 ——
  const gm = _num(grossMargin) ?? _num(r.gross_margin);
  const GM_adj = _gmAdjust(gm);

  const S3 = _clamp(Math.round(CE + G + CBP + N + GM_adj), 0, 100);

  // basis：有任一"新维度"输入才算 harness 真正生效，否则等价旧逻辑（仅枚举换算）
  const hasNewInputs = !!(
    s3Rubric &&
    (r.global_player_count != null ||
      r.policy_tier != null ||
      r.cost_curve_steepness != null ||
      r.capital_source != null)
  );

  return {
    S3,
    basis: hasNewInputs ? "harness" : "legacy",
    detail: {
      // 五桶最终分（供审计/校准）
      CE: Math.round(CE * 10) / 10,
      G: Math.round(G * 10) / 10,
      CBP,
      N,
      GM_adj,
      // 中间量（解释性）
      archetype: arche,
      ce_base: ceBase,
      lambda,
      scale_type: scaleType,
      ST,
      k,
      player_count: playerCount,
      scarcity,
      gate,
      cagr,
      growth_score: Gr,
      policy_tier: policyTier,
      Pol,
      capital_source: capSource,
      gross_margin: gm,
    },
  };
}

module.exports = {
  scoreS3Harness,
};
