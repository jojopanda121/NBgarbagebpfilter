// ============================================================
// scoringHarness.js — S2「产品与壁垒」的 harness 化子系统
//
// 解决的问题：旧 S2 的 TRL 和 Competitor_Rank 是 Agent B 直接拍出来的两个
// 裸整数，没有接地、没有证据分层、没有 JS 复算 —— 模型可能照抄 BP 自报往高报。
//
// harness 范式（与 chokepoint skill 一致）：
//   拆因子 → 强制证据分层(evidence_tier) → 按证据封顶/折扣 → JS 确定性聚合。
//
// 注意主管线与 workspace skill 是两套证据系统：Agent B 不产 F 编号事实，
// 所以这里的接地机制是 evidence_tier（verified=检索/上传证实 / claimed=仅BP自报 /
// absent=无），JS 只对 verified 给满额信任、对 claimed 打折、对 absent 不计。
//
// 三个产物：
//   1. computeTrl     —— TRL 证据阶梯 → 实证 TRL + 诚信 gap
//   2. computeMoat    —— 护城河子因子(含咽喉) → moat 分(0-100)
//   3. scoreS2Harness —— 合成 S2(0-100)，与旧 S2 同口径(40%技术 + 60%竞争/护城河)
//  附：trlGapVerdict —— 把"TRL 自报 vs 实证"的差距转成一条 claim_verdict 喂 S5 反注水
// ============================================================

function _clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function _num(v) {
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// ------------------------------------------------------------
// 1. TRL 证据阶梯
// ------------------------------------------------------------
//
// 输入 trlEvidence（LLM 输出，可选）:
//   {
//     bp_claimed_trl: <1-9 | null>,            // BP 自报的 TRL
//     ladder: [ { level: 1-9, status: "verified"|"claimed"|"absent", evidence: "..." }, ... ]
//   }
//
// 折扣逻辑（核心 harness）：
//   trl_verified  = 有 verified 证据支撑的最高级（高级 verified 自动覆盖低级）
//   trl_claimed   = max(bp_claimed_trl, 任何 verified/claimed 的最高级)
//   effective_trl = trl_verified + 0.5 ×(trl_claimed − trl_verified)
//                   —— 实证级给满信任，仅自报的部分只给半额，注水被腰斩
//   gap           = trl_claimed − trl_verified   //（诚信信号，喂 S5）
//
// 无有效阶梯时退回 legacyTrl（向后兼容），basis="legacy"。
function computeTrl(trlEvidence, legacyTrl) {
  const fallback = _clamp(_num(legacyTrl) ?? 3, 1, 9);
  const ladder = Array.isArray(trlEvidence?.ladder) ? trlEvidence.ladder : null;
  if (!ladder || ladder.length === 0) {
    return { effective_trl: fallback, trl_verified: null, trl_claimed: fallback, gap: 0, basis: "legacy" };
  }

  let trlVerified = 0;
  let trlClaimedFromLadder = 0;
  for (const rung of ladder) {
    const lvl = _num(rung?.level);
    if (lvl == null || lvl < 1 || lvl > 9) continue;
    if (rung.status === "verified") {
      trlVerified = Math.max(trlVerified, lvl);
      trlClaimedFromLadder = Math.max(trlClaimedFromLadder, lvl);
    } else if (rung.status === "claimed") {
      trlClaimedFromLadder = Math.max(trlClaimedFromLadder, lvl);
    }
    // absent 不计
  }

  const bpClaimed = _clamp(_num(trlEvidence?.bp_claimed_trl) ?? 0, 0, 9);
  const trlClaimed = Math.max(trlClaimedFromLadder, bpClaimed);

  // 阶梯里啥都没有(全 absent 且无自报) → 保守退回 legacy
  if (trlVerified === 0 && trlClaimed === 0) {
    return { effective_trl: fallback, trl_verified: 0, trl_claimed: fallback, gap: 0, basis: "legacy" };
  }

  const effective = trlVerified + 0.5 * Math.max(0, trlClaimed - trlVerified);
  return {
    effective_trl: _clamp(Math.round(effective), 1, 9),
    trl_verified: trlVerified,
    trl_claimed: trlClaimed,
    gap: Math.max(0, trlClaimed - trlVerified),
    basis: "harness",
  };
}

// ------------------------------------------------------------
// 2. 护城河子因子（咽喉只是其中一种形状，解决跨赛道偏差）
// ------------------------------------------------------------
//
// 输入 moatRubric（LLM 输出，可选），每个子因子 { score:0-100, evidence_tier, note }:
//   differentiation     差异化 / IP / 独家数据
//   switching_cost      转换成本 / 客户锁定
//   traction_position   已验证的客户/落地相对竞品的位置
//   competitive_density  竞争密度(越不拥挤=越高分)
// 咽喉子因子：优先用 chokepointScore(来自 chokepoint_analysis skill)，
//            否则用 moatRubric.chokepoint.score，再否则中性 50。
//
// evidence_tier 折扣：verified=×1.0，claimed=×0.85，absent/缺失=按中性 50 兜底。
const MOAT_WEIGHTS = {
  differentiation: 0.30,
  switching_cost: 0.20,
  traction_position: 0.20,
  competitive_density: 0.15,
  chokepoint: 0.15,
};

const _TIER_FACTOR = { verified: 1.0, claimed: 0.85, absent: 1.0 };

function _subScore(sub) {
  if (!sub || _num(sub.score) == null) return { value: 50, covered: false };
  const raw = _clamp(_num(sub.score), 0, 100);
  const factor = _TIER_FACTOR[sub.evidence_tier] ?? 1.0;
  // 折扣只向中性 50 收敛(不是直接乘)，避免把一个有理有据但仅 claimed 的高分打到地板
  const adjusted = 50 + (raw - 50) * factor;
  return { value: _clamp(Math.round(adjusted), 0, 100), covered: true };
}

function computeMoat(moatRubric, chokepointScore, legacyRank) {
  const rubric = moatRubric && typeof moatRubric === "object" ? moatRubric : null;
  const cp = _num(chokepointScore);
  const hasChokepoint = cp != null;

  // 既无 rubric 也无咽喉分 → 退回 legacy Rank
  if (!rubric && !hasChokepoint) {
    const rankVal = _clamp(_num(legacyRank) ?? 5, 1, 10);
    return { moat_score: _clamp(Math.round(rankVal * 10), 0, 100), basis: "legacy", subfactors: {}, coverage: 0 };
  }

  const subfactors = {};
  let covered = 0;
  let weighted = 0;
  for (const key of Object.keys(MOAT_WEIGHTS)) {
    let s;
    if (key === "chokepoint") {
      if (hasChokepoint) {
        s = { value: _clamp(Math.round(cp), 0, 100), covered: true };
      } else {
        s = _subScore(rubric?.chokepoint);
      }
    } else {
      s = _subScore(rubric?.[key]);
    }
    subfactors[key] = s.value;
    if (s.covered) covered++;
    weighted += s.value * MOAT_WEIGHTS[key];
  }

  return {
    moat_score: _clamp(Math.round(weighted), 0, 100),
    basis: "harness",
    subfactors,
    coverage: covered, // 被真实覆盖的子因子数(0-5)，供审计/灰度判断
  };
}

// ------------------------------------------------------------
// 3. 合成 S2 —— 与旧 S2 同口径：40% 技术(TRL) + 60% 竞争/护城河
// ------------------------------------------------------------
function scoreS2Harness({ trlEvidence, moatRubric, chokepointScore, legacyTrl, legacyRank } = {}) {
  const trl = computeTrl(trlEvidence, legacyTrl);
  const moat = computeMoat(moatRubric, chokepointScore, legacyRank);

  const trlComponent = (trl.effective_trl / 9) * 100;
  const S2 = _clamp(Math.round(0.4 * trlComponent + 0.6 * moat.moat_score), 0, 100);

  return {
    S2,
    trl_detail: trl,
    moat_detail: moat,
    // 只要有一边走了 harness，就算 harness 生效；两边都 legacy 则等价旧逻辑
    basis: trl.basis === "harness" || moat.basis === "harness" ? "harness" : "legacy",
  };
}

// ------------------------------------------------------------
// 附：TRL 自报 vs 实证 gap → claim_verdict（喂 S5 诚信度，反注水）
// 只在 TRL 走了 harness(有真实证据分层)时产出，避免给 legacy 项目凭空扣诚信。
// ------------------------------------------------------------
function trlGapVerdict(trlDetail) {
  if (!trlDetail || trlDetail.basis !== "harness") return null;
  const gap = trlDetail.gap || 0;
  let verdict;
  if (gap >= 5) verdict = "严重夸大";
  else if (gap >= 3) verdict = "夸大";
  else if (gap >= 1) verdict = "存疑";
  else return null; // gap=0 不必产出冗余 verdict
  return {
    category: "product",
    claim: `BP 自报 TRL ${trlDetail.trl_claimed} 级`,
    verdict,
    evidence: `实证仅支撑到 TRL ${trlDetail.trl_verified} 级，自报与实证差 ${gap} 级`,
    source: "TRL harness",
  };
}

module.exports = {
  computeTrl,
  computeMoat,
  scoreS2Harness,
  trlGapVerdict,
  MOAT_WEIGHTS,
};
