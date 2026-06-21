// ============================================================
// scoringEvidence.js — 专家 agent 证据 → 评分输入（Plan A 核心）
//
// 把 orchestrator 5 专家(founder/financial/competitor/valuation)已经在产的
// **事实**，用 JS 确定性推导成评分子因子，并与 Agent B 通才输出**双路合并**
// (用户决策：取平均 + 分歧记冲突)，再交给 scoreProject。
//
// 铁律：
//   1. LLM 只产事实/闭集枚举，分数一律本模块查 scoringTables 推导。
//   2. 任一专家缺失/返回 {}/字段缺 → 该步 no-op，回退 Agent B 值，绝不 fail。
//   3. 自由文本解析失败 → 落 null/中性，不瞎猜。
//   4. 缺信息给中性及格分(不 fail)；保守低估要加分(S5 对称)。
// ============================================================

const T = require("./config/scoringTables");

// ---------------- 通用小工具 ----------------
function _num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
function _clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function _isObj(v) { return v && typeof v === "object" && !Array.isArray(v); }
function _arr(v) { return Array.isArray(v) ? v : []; }
function _str(v) { return typeof v === "string" ? v : ""; }

// 「缺数据/未披露」识别：缺失≠不诚信，不能据此判证伪（须与 scoring.js 的 ABSENCE_OF_DATA_RE 同义）
const ABSENCE_OF_DATA_RE =
  /(?:零|无(?:任何)?|没有|未(?:经?披露|提供|给出)?|缺(?:少|失|乏)?|不(?:含|包含|涉及))\s*[、,，]?\s*.{0,6}(?:财务|营收|收入|毛利|利润|烧钱|现金流|融资额?|估值|财报)(?:.{0,6}(?:数据|披露|信息|指标))?/;
function _isAbsenceOfData(text) { return ABSENCE_OF_DATA_RE.test(_str(text)); }

/** 解析 "2018-2021" / "2019-至今" / "2020-2023年" → 年数；失败返回 null */
function parseYearsSpan(span, nowYear = new Date().getFullYear()) {
  const s = _str(span);
  const m = s.match(/(\d{4})\s*[-—~至到]+\s*(\d{4}|至今|现在|present|now|今)?/i);
  if (!m) return null;
  const start = parseInt(m[1], 10);
  if (!start || start < 1950 || start > nowYear + 1) return null;
  let end;
  if (!m[2] || /至今|现在|present|now|今/i.test(m[2])) end = nowYear;
  else end = parseInt(m[2], 10);
  if (!end || end < start) return null;
  return _clamp(end - start, 0, 60);
}

/** 经验年限 → 1-10（与 scoring.js dim4 同曲线 v3：min(10, 年数/2.5)，25 年触顶） */
function _expYearsToScore(years) {
  return _clamp(Math.round(Math.min(10, Math.max(0, years) / 2.5) * 10) / 10, 1, 10);
}

/** 子串命中任一关键词 */
function _hitsAny(text, keywords) {
  const t = _str(text);
  return keywords.some((k) => t.includes(k));
}

// ============================================================
// S4 团队：全部从 founder agent 的事实推导（砍掉 LLM 拍的分）
// ============================================================
function deriveTeam(founderOut) {
  if (!_isObj(founderOut)) return null;
  const founders = _arr(founderOut.founders);
  if (founders.length === 0) return null;

  // —— 完整性：角色覆盖 {CEO, 技术, 商业化} ——
  const buckets = { CEO: false, TECH: false, BIZ: false };
  for (const f of founders) {
    const role = _str(f.role);
    if (_hitsAny(role, T.TEAM_ROLES.CEO)) buckets.CEO = true;
    if (_hitsAny(role, T.TEAM_ROLES.TECH)) buckets.TECH = true;
    if (_hitsAny(role, T.TEAM_ROLES.BIZ)) buckets.BIZ = true;
  }
  const coverage = Object.values(buckets).filter(Boolean).length;
  let completeness = T.COMPLETENESS_SCORES[coverage] ?? 5;
  // 命中"团队失衡/关键岗位缺失"风险旗(sev≥3) 扣分
  const hasBalanceRisk = _arr(founderOut.risk_flags).some(
    (r) => ["团队失衡", "关键岗位缺失"].includes(_str(r.flag_type)) && (_num(r.severity) ?? 0) >= 3
  );
  if (hasBalanceRisk) completeness = _clamp(completeness - T.COMPLETENESS_RISK_PENALTY, 1, 10);

  // —— 经验：累加所有创始人 career 年限 ——
  let totalYears = 0;
  let parsedAny = false;
  for (const f of founders) {
    for (const c of _arr(f.career)) {
      const y = parseYearsSpan(c.years);
      if (y != null) { totalYears += y; parsedAny = true; }
    }
  }
  const experience = parsedAny ? _expYearsToScore(totalYears) : null; // 解析不出 → null,留给中性

  // —— 过往成绩：查表 ——
  let failCount = 0;
  let hasExit = false;
  let hasRunning = false;
  for (const f of founders) {
    for (const pv of _arr(f.past_ventures)) {
      const out = _str(pv.outcome);
      if (_hitsAny(out, T.TRACK_RECORD.EXIT_KEYWORDS)) hasExit = true;
      else if (_hitsAny(out, T.TRACK_RECORD.RUNNING_KEYWORDS)) hasRunning = true;
      if (_hitsAny(out, T.TRACK_RECORD.FAIL_KEYWORDS)) failCount++;
    }
  }
  const hasHeadExec = founders.some((f) =>
    _arr(f.career).some((c) =>
      _hitsAny(c.company, T.TRACK_RECORD.HEAD_COMPANIES) && _hitsAny(c.role, T.TRACK_RECORD.HEAD_EXEC_ROLES)
    )
  );
  let trackRecord;
  if (hasExit) trackRecord = T.TRACK_RECORD.SCORE_EXIT;
  else if (hasRunning) trackRecord = T.TRACK_RECORD.SCORE_RUNNING;
  else if (hasHeadExec) trackRecord = T.TRACK_RECORD.SCORE_HEAD_EXEC;
  else if (failCount >= 2) trackRecord = T.TRACK_RECORD.SCORE_MULTI_FAIL;
  else trackRecord = T.TRACK_RECORD.SCORE_DEFAULT;

  // —— 教育：所有创始人取最高档 ——
  let eduBest = null;
  for (const f of founders) {
    for (const e of _arr(f.education)) {
      const school = _str(e.school);
      if (!school) continue;
      for (const tier of T.EDUCATION_TIERS) {
        if (_hitsAny(school, tier.keywords)) { eduBest = Math.max(eduBest ?? 0, tier.score); break; }
      }
    }
  }
  const education = eduBest ?? T.EDUCATION_DEFAULT;

  // —— 赛道匹配：闭集枚举（LLM 三选一）——
  const dm = _str(founderOut.team_assessment?.domain_match);
  const domainMatch = T.DOMAIN_MATCH_SCORES[dm] ?? T.DOMAIN_MATCH_DEFAULT;

  return {
    Team_Completeness_Score: completeness,
    Team_Experience_Score: experience,           // 可能为 null
    Team_Track_Record_Score: trackRecord,
    Team_Education_Score: education,
    Team_Domain_Match_Score: domainMatch,
    _basis: { coverage, totalYears: parsedAny ? totalYears : null, hasExit, hasHeadExec, failCount, eduBest, domain_match: dm || null },
  };
}

// ============================================================
// S2 护城河：从 competitor agent 衍生（密度/位次/咽喉快速估计）
// ============================================================
function deriveMoatFromCompetitor(competitorOut) {
  if (!_isObj(competitorOut)) return null;
  const C = T.MOAT_FROM_COMPETITOR;
  const out = {};

  // —— 竞争密度 ——
  const comps = _arr(competitorOut.competitors).filter(
    (c) => (_num(c.knowledge_confidence) ?? 0) >= C.MIN_KNOWLEDGE_CONFIDENCE
  );
  const direct = comps.filter((c) => _str(c.type).includes("直接"));
  if (direct.length > 0) {
    const heavy = direct.filter((c) => C.HEAVY_STAGES.includes(_str(c.latest_round_stage))).length;
    const light = direct.length - heavy;
    const density = _clamp(
      100 - Math.min(C.HEAVY_PENALTY_CAP, heavy * C.HEAVY_PENALTY) - Math.min(C.LIGHT_PENALTY_CAP, light * C.LIGHT_PENALTY),
      C.DENSITY_FLOOR, 100
    );
    out.competitive_density = { score: Math.round(density), evidence_tier: "verified", note: `直接竞品${direct.length}(重量级${heavy})` };
  }

  // —— 位次 ——
  const tier = _str(competitorOut.positioning?.tier);
  if (C.TIER_SCORES[tier] != null) {
    out.traction_position = { score: C.TIER_SCORES[tier], evidence_tier: "claimed", note: tier };
  }

  // —— 咽喉快速估计（深度版由 chokepoint_analysis skill 覆盖）——
  const cp = _str(competitorOut.chokepoint_assessment);
  if (C.CHOKEPOINT_SCORES[cp] != null) {
    out.chokepoint = { score: C.CHOKEPOINT_SCORES[cp], evidence_tier: "claimed", note: cp };
  }

  return Object.keys(out).length > 0 ? out : null;
}

// ============================================================
// S1：CAGR 上限 + TAM 自下而上复算
// ============================================================
function deriveS1(agentBData, competitorOut) {
  const out = { conflicts: [] };

  // —— TAM 自下而上复算（可复算优先）——
  const src = agentBData?.TAM_Source;
  if (_isObj(src) && _str(src.type) === "自下而上") {
    const cc = _num(src.customer_count);
    const arpu = _num(src.arpu);
    if (cc != null && arpu != null) {
      // arpu 单位约定为元/年，TAM 统一百万人民币
      out.TAM_Million_RMB = _clamp(Math.round((cc * arpu) / 1e6), 0, 1e9);
      out.tam_basis = "bottom_up_recompute";
    }
  }

  // —— CAGR 上限：competitor agent 的赛道成熟度锁死 ——
  const maturity = _str(competitorOut?.track_definition?.track_maturity);
  const cap = T.CAGR_CAP_BY_MATURITY[maturity];
  const rawCagr = _num(agentBData?.CAGR);
  if (cap != null && rawCagr != null && rawCagr > cap) {
    out.CAGR = cap;
    out.conflicts.push(`赛道成熟度「${maturity}」上限 ${cap}%，BP 自报增速 ${rawCagr}% 被下调至上限`);
  }

  return out;
}

// ============================================================
// S3：生意类型/规模机制 闭集枚举 → 分 + 公司级实数修正
// ============================================================
function deriveS3(agentBData, financialOut) {
  const out = {};
  const arche = _str(agentBData?.Capital_Archetype);
  const scale = _str(agentBData?.Scale_Mechanism);
  const gm = _num(financialOut?.financial_snapshot?.gross_margin); // 小数 0-1

  if (T.BUSINESS_ARCHETYPE_SCORES[arche] != null) {
    let s = T.BUSINESS_ARCHETYPE_SCORES[arche];
    if (gm != null && gm >= T.S3_GM_BONUS_THRESHOLD) s += 1;
    else if (gm != null && gm < T.S3_GM_PENALTY_THRESHOLD) s -= 1;
    out.Industry_Capital_Score = _clamp(s, 1, 10);
  }
  if (T.SCALE_MECHANISM_SCORES[scale] != null) {
    out.Industry_Scale_Score = _clamp(T.SCALE_MECHANISM_SCORES[scale], 1, 10);
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ============================================================
// S5：财务/估值异常 → claim_verdict（对称：奖保守、罚有证据隐瞒、缺失给及格）
// ============================================================
function _anomalyToVerdict(type, severity) {
  const table = T.ANOMALY_VERDICT_MAP[type] || T.ANOMALY_VERDICT_MAP["其他"];
  const sev = _num(severity) ?? 0;
  // 取 ≤sev 的最高门槛档
  const thresholds = Object.keys(table).map(Number).sort((a, b) => b - a);
  for (const th of thresholds) {
    if (sev >= th) return table[th];
  }
  return "存疑";
}

function financialToVerdicts(financialOut) {
  if (!_isObj(financialOut)) return [];
  const verdicts = [];

  // 数学矛盾（consistency_check.math_errors）—— 真矛盾（引用了冲突的 BP 原文数字）才判证伪。
  // "BP 零财务数据/未披露" 不是矛盾，也无独立证据 → 降为存疑（只降覆盖率，不触发否决）。
  for (const me of _arr(financialOut.consistency_check?.math_errors)) {
    const desc = _str(me.description);
    const ev = _str(me.evidence);
    const realContradiction = ev.trim() !== "" && !_isAbsenceOfData(`${desc} ${ev}`);
    verdicts.push({
      category: "financial", claim: desc.slice(0, 120),
      verdict: realContradiction ? "证伪" : "存疑",
      evidence: ev.slice(0, 200), source: "financial agent",
    });
  }
  // 一般异常
  for (const a of _arr(financialOut.anomalies)) {
    verdicts.push({
      category: "financial", claim: _str(a.description).slice(0, 120),
      verdict: _anomalyToVerdict(_str(a.anomaly_type), a.severity),
      evidence: _str(a.evidence).slice(0, 200), source: "financial agent",
    });
  }
  // 选择性披露：仅带证据且 sev≥阈值 → 信息不对称；否则不入(避免把"没写"当隐瞒)
  for (const h of _arr(financialOut.hidden_signals)) {
    const sev = _num(h.severity) ?? 0;
    const ev = _str(h.evidence);
    if (sev >= T.HIDDEN_SIGNAL_SEVERITY_FLOOR && ev) {
      verdicts.push({
        category: "financial", claim: _str(h.signal).slice(0, 120),
        verdict: "信息不对称", evidence: ev.slice(0, 200), source: "financial agent",
      });
    }
  }
  // 保守低估加分（对称）
  for (const cs of _arr(financialOut.conservative_signals)) {
    verdicts.push({
      category: "financial", claim: _str(cs.signal || cs.description).slice(0, 120),
      verdict: "保守低估", evidence: _str(cs.evidence).slice(0, 200), source: "financial agent",
    });
  }
  return _capVerdicts(verdicts);
}

function valuationToVerdicts(valuationOut) {
  if (!_isObj(valuationOut)) return [];
  const pos = _str(valuationOut.verdict?.position);
  const v = T.VALUATION_POSITION_VERDICTS[pos];
  if (!v) return [];
  return [{
    category: "valuation",
    claim: `本轮估值相对合理区间：${pos}`,
    verdict: v,
    evidence: _str(valuationOut.verdict?.summary).slice(0, 200),
    source: "valuation agent",
  }];
}

/** 自动 verdict 封顶：负面≤5、正面≤3，防淹没正常声明 */
function _capVerdicts(list) {
  const POSITIVE = new Set(["诚实", "保守低估"]);
  const positives = list.filter((v) => POSITIVE.has(v.verdict)).slice(0, T.SPECIALIST_VERDICT_CAPS.positive);
  const negatives = list.filter((v) => !POSITIVE.has(v.verdict)).slice(0, T.SPECIALIST_VERDICT_CAPS.negative);
  return [...negatives, ...positives];
}

// ============================================================
// 双路合并：取平均 + 分歧记冲突（用户决策）
// ============================================================
/** 合并两路同一分数：都在→平均；只有一边→用那边；都无→null。返回 {value, agree, conflict} */
function _mergeAvg(a, b, threshold, label) {
  const na = _num(a), nb = _num(b);
  if (na == null && nb == null) return { value: null, agree: null, conflict: null };
  if (na == null) return { value: nb, agree: null, conflict: null, sole: "specialist" };
  if (nb == null) return { value: na, agree: null, conflict: null, sole: "agentB" };
  const value = Math.round(((na + nb) / 2) * 10) / 10;
  const diff = Math.abs(na - nb);
  const agree = diff <= threshold;
  return {
    value, agree,
    conflict: agree ? null : `${label}: Agent B=${na} vs 专家=${nb}，差 ${diff}，取平均 ${value}`,
  };
}

/**
 * 合并器：把专家证据并入 Agent B 的 validated_data。
 * 任一专家缺失/{} → 该步 no-op，回退 Agent B。
 *
 * @param {object} p
 * @param {object} p.agentBData       Agent B validated_data
 * @param {Array}  p.claimVerdicts    已有声明核查结果
 * @param {object} p.specialists      { founder_profile, competitor_analysis, financial_analysis, valuation_analysis }
 * @param {number} [p.chokepointScore] chokepoint_analysis skill 的高保真分(存在则覆盖快速估计)
 * @returns {{ enrichedInput, specialist_audit }}
 */
function mergeSpecialistEvidence({ agentBData = {}, claimVerdicts = [], specialists = {}, chokepointScore } = {}) {
  const enriched = { ...agentBData };
  const audit = { team: {}, moat: {}, s1: {}, s3: {}, verdicts: {}, conflicts: [] };

  const founder = specialists.founder_profile;
  const competitor = specialists.competitor_analysis;
  const financial = specialists.financial_analysis;
  const valuation = specialists.valuation_analysis;

  // —— S4 团队：founder 推导 × Agent B Team_*，取平均 ——
  const teamDerived = deriveTeam(founder);
  if (teamDerived) {
    const fields = [
      "Team_Completeness_Score", "Team_Experience_Score", "Team_Track_Record_Score",
      "Team_Education_Score", "Team_Domain_Match_Score",
    ];
    for (const fld of fields) {
      const m = _mergeAvg(agentBData[fld], teamDerived[fld], T.TEAM_AGREEMENT_THRESHOLD, fld);
      if (m.value != null) enriched[fld] = m.value;
      audit.team[fld] = { agentB: _num(agentBData[fld]), specialist: teamDerived[fld], merged: m.value, agree: m.agree };
      if (m.conflict) audit.conflicts.push(m.conflict);
    }
    audit.team._basis = teamDerived._basis;
  }

  // —— S2 护城河：合并 Agent B Moat_Rubric × competitor 衍生，注入咽喉 ——
  const moatFromComp = deriveMoatFromCompetitor(competitor);
  const baseMoat = _isObj(agentBData.Moat_Rubric) ? { ...agentBData.Moat_Rubric } : {};
  if (moatFromComp || chokepointScore != null) {
    const mergedMoat = { ...baseMoat };
    for (const key of ["competitive_density", "traction_position", "chokepoint"]) {
      const aScore = baseMoat[key]?.score;
      const bScore = moatFromComp?.[key]?.score;
      const m = _mergeAvg(aScore, bScore, T.MOAT_AGREEMENT_THRESHOLD, `moat.${key}`);
      if (m.value != null) {
        mergedMoat[key] = {
          score: m.value,
          evidence_tier: m.agree ? "verified" : (moatFromComp?.[key]?.evidence_tier || baseMoat[key]?.evidence_tier || "claimed"),
          note: moatFromComp?.[key]?.note || baseMoat[key]?.note || "",
        };
      }
      audit.moat[key] = { agentB: _num(aScore), specialist: _num(bScore), merged: m.value, agree: m.agree };
      if (m.conflict) audit.conflicts.push(m.conflict);
    }
    enriched.Moat_Rubric = mergedMoat;
  }
  // 咽喉高保真分：skill 存在则作为权威 Chokepoint_Score 传下去（computeMoat 优先用它）
  if (chokepointScore != null) {
    enriched.Chokepoint_Score = chokepointScore;
    audit.moat.chokepoint_source = "skill";
  } else if (moatFromComp?.chokepoint) {
    audit.moat.chokepoint_source = "competitor_estimate";
  }

  // —— S1：CAGR 上限 + TAM 复算 ——
  const s1 = deriveS1(agentBData, competitor);
  if (s1.TAM_Million_RMB != null) { enriched.TAM_Million_RMB = s1.TAM_Million_RMB; audit.s1.tam = s1.tam_basis; }
  if (s1.CAGR != null) { enriched.CAGR = s1.CAGR; audit.s1.cagr_capped = true; }
  if (s1.conflicts.length) audit.conflicts.push(...s1.conflicts);

  // —— S3：枚举 → 分 + 毛利修正（legacy）——
  const s3 = deriveS3(agentBData, financial);
  if (s3) {
    if (s3.Industry_Capital_Score != null) enriched.Industry_Capital_Score = s3.Industry_Capital_Score;
    if (s3.Industry_Scale_Score != null) enriched.Industry_Scale_Score = s3.Industry_Scale_Score;
    audit.s3 = s3;
  }
  // S3 harness：把 financial 实抽毛利率注入 S3_Rubric（毛利不在 Agent B 视野内，
  // 与咽喉分注入 Moat_Rubric 同理）。harness 关时该字段无副作用。
  const gmForS3 = _num(financial?.financial_snapshot?.gross_margin);
  if (gmForS3 != null) {
    enriched.S3_Rubric = {
      ...(_isObj(agentBData.S3_Rubric) ? agentBData.S3_Rubric : {}),
      gross_margin: gmForS3,
    };
  }

  // —— S5：追加财务/估值 verdict ——
  const finV = financialToVerdicts(financial);
  const valV = valuationToVerdicts(valuation);
  const mergedVerdicts = [...(_arr(claimVerdicts)), ...finV, ...valV];
  enriched.claim_verdicts = mergedVerdicts;
  audit.verdicts = { financial_added: finV.length, valuation_added: valV.length, total: mergedVerdicts.length };

  return { enrichedInput: enriched, specialist_audit: audit };
}

module.exports = {
  parseYearsSpan,
  deriveTeam,
  deriveMoatFromCompetitor,
  deriveS1,
  deriveS3,
  financialToVerdicts,
  valuationToVerdicts,
  mergeSpecialistEvidence,
  _internal: { _expYearsToScore, _mergeAvg, _anomalyToVerdict, _capVerdicts },
};
