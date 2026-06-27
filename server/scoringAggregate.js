// ============================================================
// scoringAggregate.js — 非线性聚合内核（方案乙）
//
// 取代"五维算术平均"这个把分数压在 70-78 的根因。设计（与用户确认选方案乙）：
//   total = clamp( 加权算术(已覆盖维, 按 coverage 重归一) + 卓越加成, 0, 100 )
//   卓越加成 = min(上限, α × count(维 ≥ 90))         —— 奖励卓越、容忍单点短板
//   A 级共振 gate：评级 A 要求 total≥80 且 ≥2 维≥80   —— 堵单维（含政策抬高的 S1）独大
//
// 为什么不用甲（几何/低阶幂平均）：几何平均对单个低分维度惩罚极重（一个 S3=40
// 会把均值拽下去），与"容忍重资产单点短板"目标方向相反。方案乙最可解释、可控、
// 可灰度、可单测，最符合"可解释即资产"。
//
// 早期项目假精度 → 总分以**分布**呈现：中位 + 区间 + 置信度，区间宽度随覆盖度
// 反向变化。并产出敏感性（对总分影响最大的维度）。
//
// 铁律：纯函数、零 LLM、确定性。吃已算好的五维分（政策已在上游融入 S1/S3），
// 不回头碰原文、不调 LLM。Integrity Veto 由 scoring.js 在本层之后封顶。
// ============================================================

const T = require("./config/scoringTables");

const DIMS = ["S1", "S2", "S3", "S4", "S5"];

function _clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function _num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const DIM_LABELS = {
  S1: "时机与天花板", S2: "产品与壁垒", S3: "资本效率与规模",
  S4: "团队基因", S5: "BP诚信度",
};

/** 中位分 → 评级（阈值取自 scoringTables.GRADE_THRESHOLDS，与 scoring.js getGrade 同源；留共振 gate 给 aggregate） */
function _gradeFromScore(score) {
  if (score >= T.GRADE_THRESHOLDS.A) return "A";
  if (score >= T.GRADE_THRESHOLDS.B) return "B";
  if (score >= T.GRADE_THRESHOLDS.C) return "C";
  return "D";
}

/**
 * 非线性聚合。
 *
 * @param {object} p
 * @param {object} p.scores      {S1..S5}，0-100
 * @param {object} [p.coverages] {S1..S5}，0-1，缺省 1（满覆盖）
 * @param {string} [p.track]     "general" | "hardtech"
 * @returns {object} 见文件头与下方字段
 */
function aggregate({ scores = {}, coverages = {}, track } = {}) {
  const trackKey = T.AGG_TRACK_WEIGHTS[track] ? track : T.AGG_DEFAULT_TRACK;
  const weights = T.AGG_TRACK_WEIGHTS[trackKey];

  const s = {};
  const cov = {};
  for (const d of DIMS) {
    s[d] = _clamp(Math.round(_num(scores[d], 0)), 0, 100);
    cov[d] = _clamp(_num(coverages[d], 1), 0, 1);
  }

  // —— 有效权重 = 基础权重 × coverage，再归一（缺失/低覆盖维自动让权）——
  const effRaw = {};
  let sumEff = 0;
  for (const d of DIMS) {
    effRaw[d] = weights[d] * cov[d];
    sumEff += effRaw[d];
  }
  // 全维零覆盖的极端兜底：退回等权
  const effW = {};
  for (const d of DIMS) {
    effW[d] = sumEff > 0 ? effRaw[d] / sumEff : 1 / DIMS.length;
  }

  let base = 0;
  for (const d of DIMS) base += effW[d] * s[d];

  // —— 卓越加成 ——
  const excellentDims = DIMS.filter((d) => s[d] >= T.AGG_EXCELLENCE_THRESHOLD);
  const excellenceBonus = Math.min(
    T.AGG_EXCELLENCE_BONUS_CAP,
    T.AGG_EXCELLENCE_ALPHA * excellentDims.length
  );

  const median = _clamp(Math.round(base + excellenceBonus), 0, 100);

  // —— 分布：区间宽度随平均覆盖度反向变化 ——
  let covWeighted = 0;
  let wsum = 0;
  for (const d of DIMS) { covWeighted += weights[d] * cov[d]; wsum += weights[d]; }
  const avgCoverage = wsum > 0 ? covWeighted / wsum : 1;
  const delta = Math.round(
    T.AGG_RANGE_BASE_DELTA + (1 - avgCoverage) * T.AGG_RANGE_COVERAGE_SCALE
  );
  const range = [_clamp(median - delta, 0, 100), _clamp(median + delta, 0, 100)];

  const confidence =
    (T.AGG_CONFIDENCE_BANDS.find((b) => avgCoverage >= b.minCoverage) || { label: "低" }).label;

  // —— 敏感性：维度 ±10 对中位的近似影响（线性项 effW×10），取 top3 ——
  const sensitivity = DIMS.map((d) => ({
    dim: d, label: DIM_LABELS[d], score: s[d], coverage: Math.round(cov[d] * 100) / 100,
    impact: Math.round(effW[d] * 10 * 10) / 10, // 该维变动 10 分 ≈ 总分变动 impact
  }))
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 3);

  // —— A 级共振 gate：防单维独大上 A ——
  let grade = _gradeFromScore(median);
  const dimsAtResonance = DIMS.filter((d) => s[d] >= T.AGG_RESONANCE_GATE_SCORE);
  let resonanceApplied = false;
  if (grade === "A" && dimsAtResonance.length < T.AGG_RESONANCE_GATE_N) {
    grade = "B";
    resonanceApplied = true;
  }

  const triggered = [];
  if (excellentDims.length > 0) {
    triggered.push({
      tag: "agg_excellence_bonus",
      label: `卓越加成 +${excellenceBonus}`,
      logic: `${excellentDims.map((d) => DIM_LABELS[d]).join("、")} ≥ ${T.AGG_EXCELLENCE_THRESHOLD} 分`,
      effect: `基础分 ${Math.round(base)} → 中位 ${median}`,
    });
  }
  if (resonanceApplied) {
    triggered.push({
      tag: "agg_resonance_gate",
      label: "A 级共振 gate 触发：降为 B",
      logic: `中位 ${median} 达 A，但仅 ${dimsAtResonance.length} 维 ≥ ${T.AGG_RESONANCE_GATE_SCORE}（需 ≥${T.AGG_RESONANCE_GATE_N}），防单维独大`,
      effect: "评级 A → B",
    });
  }

  return {
    total_median: median,
    total_range: range,
    confidence,
    grade,
    base: Math.round(base * 10) / 10,
    excellence_bonus: excellenceBonus,
    excellence_count: excellentDims.length,
    avg_coverage: Math.round(avgCoverage * 100) / 100,
    track: trackKey,
    weights,
    effective_weights: Object.fromEntries(DIMS.map((d) => [d, Math.round(effW[d] * 1000) / 1000])),
    resonance_gate: { applied: resonanceApplied, dims_ge_threshold: dimsAtResonance.length },
    sensitivity,
    triggered_rules: triggered,
  };
}

module.exports = { aggregate, _gradeFromScore, DIMS, DIM_LABELS };
