// ============================================================
// scoringPolicy.js — 国家政策契合度（融入 S1/S3，不设独立维度）
//
// 设计决策（与用户确认）：政策不是公司内在的第六根质量轴，而是通过市场和
// 资本起作用的环境顺风。因此不新增被平均的 S6，而是融入两条**不重叠**通道：
//   • 需求侧 → S1：政策保障/抑制需求 → 抬高/压低时机天花板（s1_demand）
//   • 资本侧 → S3：廉价耐心资本 + 资本壁垒（现有 scoringS3Harness 已含 λ/CBP/Pol），
//     本模块仅追加 S3 harness 未覆盖的资本侧修正（地缘/出口管制敞口，s3_capital）
// 两通道量不同机制 → 无双计。
//
// 同时产出**显式 readout**（政策契合度 0-100 + 触发的规则），供判断卡展示与
// Phase 4 回测，但 readout **不进**加权平均（防 PPT 概念股靠政策单高上 A）。
//
// 铁律：纯函数、零 LLM、确定性、可单测。无法归类 → coverage=0，不默认中性、
// 不做任何调整（搜不到≠中性分）。
// ============================================================

const T = require("../config/scoringTables");

function _clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * 计算政策契合度及其对 S1/S3 的注入。
 *
 * @param {object} p
 * @param {string} [p.tier]                 政策档位："第一档".."第五档"（显式归类优先）
 * @param {string} [p.industryCategory]     赛道大类（tier 缺失时据 INDUSTRY_POLICY_TIER 派生）
 * @param {boolean}[p.chokepointSubstitution] 卡脖子/国产替代刚需（进口依赖高/外资垄断）
 * @param {boolean}[p.stateCapital]         已进入国家级/省级产业基金、大基金、国资 LP
 * @param {string} [p.geoExposure]          地缘/出口管制敞口："high"|"medium"|"low"|null
 * @param {boolean}[p.industrialization]    是否有产业化路径（false=纯概念，取档下沿）
 * @returns {{
 *   coverage:number, tier:string|null, tier_label:string|null,
 *   readout_score:number|null,            政策契合度 0-100（展示/回测，不进平均）
 *   s1_demand_adj:number,                 注入 S1 的需求侧加成（已钳制）
 *   s3_capital_adj:number,                注入 S3 的资本侧修正（地缘扣分等）
 *   triggered_rules:Array<{tag,label,logic,effect}>,
 * }}
 */
function scorePolicyFit(p = {}) {
  const tier =
    p.tier && T.POLICY_TIERS[p.tier]
      ? p.tier
      : (p.industryCategory != null
          ? (T.INDUSTRY_POLICY_TIER[p.industryCategory] ?? T.POLICY_TIER_DEFAULT)
          : T.POLICY_TIER_DEFAULT);

  // 无法归类 → 不归类：coverage=0，零注入（不默认中性）
  if (!tier || !T.POLICY_TIERS[tier]) {
    return {
      coverage: 0, tier: null, tier_label: null, readout_score: null,
      s1_demand_adj: 0, s3_capital_adj: 0, triggered_rules: [],
    };
  }

  const base = T.POLICY_TIERS[tier];
  const rules = [];
  let readout = base.tier_base;
  let s1 = base.s1_demand;
  let s3 = 0;

  rules.push({
    tag: `policy_tier_${tier}`,
    label: `政策档位：${tier}（${base.label}）`,
    logic: "压中国家战略方向程度 → 需求侧抬高时机天花板",
    effect: `政策契合 readout 基础 ${base.tier_base}；S1 需求 ${s1 >= 0 ? "+" : ""}${s1}`,
  });

  // 卡脖子/国产替代刚需 → 需求有保障
  if (p.chokepointSubstitution) {
    const m = T.POLICY_MODIFIERS.chokepoint_substitution;
    readout += m.readout; s1 += m.s1_demand;
    rules.push({ tag: "policy_chokepoint_substitution", label: m.label, logic: "进口依赖高/外资垄断 → 国产替代需求刚性", effect: `readout +${m.readout}；S1 需求 +${m.s1_demand}` });
  }
  // 国资/大基金布局（资本侧主体已由 S3 λ 捕捉，此处仅 readout 信号）
  if (p.stateCapital) {
    const m = T.POLICY_MODIFIERS.state_capital;
    readout += m.readout;
    rules.push({ tag: "policy_state_capital", label: m.label, logic: "国家队资本进入 → 政策背书强（资本效率已在 S3 体现）", effect: `readout +${m.readout}` });
  }
  // 地缘/出口管制敞口 → 资本侧诚实扣分（政策利好但执行风险高）
  if (p.geoExposure === "high" || p.geoExposure === "medium") {
    const m = p.geoExposure === "high" ? T.POLICY_MODIFIERS.geopolitical_high : T.POLICY_MODIFIERS.geopolitical_medium;
    readout += m.readout; s3 += m.s3_capital;
    rules.push({ tag: `policy_geo_${p.geoExposure}`, label: m.label, logic: "先进制程依赖海外设备/出口管制 → 资本侧执行风险", effect: `readout ${m.readout}；S3 资本 ${m.s3_capital}` });
  }
  // 纯概念无产业化路径 → 取档下沿
  if (p.industrialization === false) {
    s1 = Math.round(s1 * T.POLICY_NO_INDUSTRIALIZATION_FACTOR);
    readout = Math.round(base.tier_base * T.POLICY_NO_INDUSTRIALIZATION_FACTOR + (readout - base.tier_base));
    rules.push({ tag: "policy_no_industrialization", label: "纯概念无产业化路径", logic: "政策方向对但无落地 → 取该档下沿", effect: `S1 需求与 readout 打 ${T.POLICY_NO_INDUSTRIALIZATION_FACTOR}` });
  }

  return {
    coverage: 1,
    tier,
    tier_label: base.label,
    readout_score: _clamp(Math.round(readout), 0, 100),
    s1_demand_adj: _clamp(Math.round(s1), T.POLICY_S1_DEMAND_CLAMP.min, T.POLICY_S1_DEMAND_CLAMP.max),
    s3_capital_adj: Math.round(s3),
    triggered_rules: rules,
  };
}

/** 是否走硬科技权重档（据政策档位判定） */
function isHardtechTrack(tier) {
  return tier != null && T.HARDTECH_POLICY_TIERS.has(tier);
}

module.exports = { scorePolicyFit, isHardtechTrack };
