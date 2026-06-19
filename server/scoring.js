// ============================================================
// scoring.js — 5维度定量评分系统 (v4.0 重构版)
//
// 核心原则：
//   利用大模型（Kimi）的客观检索能力输出严谨的枚举值或绝对数值，
//   然后在 JS 中进行纯数学的定量计算，杜绝让大模型直接拍脑袋给总分。
//
// 修复的数学建模漏洞：
//   1. 量纲不一致 → 统一 TAM 为百万人民币
//   2. 粗暴惩罚 → 废除股权结构惩罚、0.5 一刀切死刑
//   3. 数据缺失雪崩 → 中性默认值兜底
//
// v4.2 新增：S2「产品与壁垒」harness 化（见 scoringHarness.js）。
//   旧 S2 的 TRL/Rank 是两个裸 LLM 整数；harness 把它们拆成带证据分层的子因子，
//   JS 复算，并把供应链咽喉作为护城河子因子收编。通过 SCORING_HARNESS 灰度开关
//   (off/shadow/on) 控制是否生效，shadow 模式下新旧分并存供校准。
// ============================================================

const { scoreS2Harness, trlGapVerdict } = require("./scoringHarness");
const { scoreS3Harness } = require("./scoringS3Harness");
const { aggregate } = require("./scoringAggregate");
const { scorePolicyFit, isHardtechTrack } = require("./scoringPolicy");
const T = require("./config/scoringTables");
const { scoringHarnessMode, scoringS3HarnessMode, scoringAggMode } = require("./config/featureFlags");

/** 将分数钳制到 0-100 整数 */
function clampScore(score) {
  return Math.min(100, Math.max(0, Math.round(score)));
}

/** 将原始值归一化到 [min, max] 整数范围，缺失/越界用 fallback */
function normalizeInput(val, fallback, min, max) {
  const n = Number(val);
  if (isNaN(n) || n < min) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * 计算模块1: 时机与天花板 (S1, 权重 20%, 满分 100)
 *
 * Agent Prompt 约束:
 *   大模型不依赖 BP 声称，客观检索细分赛道真实市场规模（TAM）和 CAGR。
 *   TAM 统一转换为百万人民币（如 1 亿 = 100），CAGR 输出百分比数字部分（如 25）。
 *
 * 业务逻辑说明:
 *   当前中国"专精特新"与硬科技环境下的 VC 退出门槛为企业年营收 3-5 亿人民币。
 *   按 10%-15% 的合理市占率倒推，一个赛道只要具备 30 亿人民币（即 TAM = 3000 百万）
 *   的 TAM，即足以支撑一家科创板/创业板 IPO 公司。
 *   因此对数函数设定在 TAM = 3000 时即可拿满 60 分（17.5 × log10(3000) ≈ 60.8），
 *   避免用百亿大市场的旧 TMT 时代标准误杀垂直赛道的优质项目。
 *
 * 公式: S1 = TAM分 + min(40, CAGR)
 *   TAM分 = TAM 缺失时取中性 30，否则 min(60, round(17.5 × log10(TAM)))
 *
 * @param {number} TAM_Million_RMB - 目标可触达市场规模（百万人民币）
 * @param {number} CAGR - 行业预期年复合增长率（百分比数字，如 25 表示 25%）
 * @returns {number} 0-100 的整数得分
 */
function calculateDimension1_TimingAndCeiling(TAM_Million_RMB, CAGR, revenueGrowthYoY) {
  const rawTAM = Number(TAM_Million_RMB);
  const rawCAGR = Number(CAGR);

  // 数据缺失兜底：
  //   TAM 缺失（NaN 或 <1，含上游 `?? 0` 的占位 0）→ 中性 30 分（满分 60 的一半），
  //   与 S3 缺失=50、S4 缺失≈60 的"中性兜底"哲学对齐。
  //   旧实现 TAM 缺失按 1 计 → log10(1)=0 分，等于把"信息少"系统性判成"市场小"。
  const tamMissing = isNaN(rawTAM) || rawTAM < 1;
  const cagrVal = isNaN(rawCAGR) ? 0 : Math.max(0, rawCAGR);

  // 对数压缩市场规模分（满分 60）
  const tamScore = tamMissing ? 30 : Math.min(60, Math.round(17.5 * Math.log10(rawTAM)));

  // 增速分（满分 40）—— 二阶加速（基因⑤）：
  //   优先公司营收同比增速（奖励小基数高斜率），市场 CAGR 退为天花板辅助；
  //   无公司增速时回退用市场 CAGR（向后兼容旧 2 参调用与旧数据）。
  const revYoY = Number(revenueGrowthYoY);
  let growthScore;
  if (!isNaN(revYoY)) {
    growthScore = 0;
    for (const b of T.S1_REVENUE_GROWTH_BRACKETS) {
      if (revYoY >= b.minYoY) { growthScore = b.score; break; }
    }
    // 停滞/衰退赛道里公司爆发增速可疑 → 用市场 CAGR 作天花板封顶
    if (!isNaN(rawCAGR) && rawCAGR < T.S1_STAGNANT_MARKET_CAGR) {
      growthScore = Math.min(growthScore, T.S1_STAGNANT_GROWTH_CAP);
    }
  } else {
    growthScore = Math.min(40, cagrVal);
  }

  return clampScore(tamScore + growthScore);
}

/** TAM 是否缺失（与 calculateDimension1 的判定保持一致，用于结果标记） */
function isTamMissing(TAM_Million_RMB) {
  const n = Number(TAM_Million_RMB);
  return isNaN(n) || n < 1;
}

/**
 * 计算模块2: 产品与壁垒 (S2, 权重 20%, 满分 100) —— legacy 路径
 *
 * Agent Prompt 约束:
 *   大模型检索行业内真实竞品及该产品的行业排名，输出 Competitor_Rank_Score (1-10 整数)。
 *   8-10 分: 行业 Top 5 且极难复制
 *   4-7 分: 腰部或细分第一
 *   1-3 分: 红海同质化跟风者
 *
 * 公式: S2 = round(0.4 × (TRL / 9 × 100) + 0.6 × (Rank × 10))
 *
 * 注：这是 TRL/Rank 两个裸 LLM 整数的旧打分法，作为 harness 路径的兜底与
 * shadow 对照基线保留。harness 路径见 scoringHarness.js（拆因子+证据分层+
 * JS 复算，咽喉作为护城河子因子收编于此，不再外挂混入）。
 *
 * @param {number} TRL - 技术就绪水平 (1-9 级)
 * @param {number} Competitor_Rank_Score - 竞品排名评分 (1-10 整数)
 * @returns {number} 0-100 的整数得分
 */
function calculateDimension2_ProductAndMoat(TRL, Competitor_Rank_Score) {
  // TRL 缺失默认 3（早期概念阶段），Rank 缺失默认 5（行业中游）
  const trlVal = normalizeInput(TRL, 3, 1, 9);
  const rankVal = normalizeInput(Competitor_Rank_Score, 5, 1, 10);

  const trlComponent = (trlVal / 9) * 100;   // 归一化到 0-100
  const rankComponent = rankVal * 10;          // 映射到 0-100

  return clampScore(0.4 * trlComponent + 0.6 * rankComponent);
}

/**
 * 计算模块3: 资本效率与规模效应 (S3, 权重 20%, 满分 100)
 *
 * Agent Prompt 约束:
 *   针对早期项目缺乏财务数据的问题，改由模型基于顶级 VC 框架评估该"赛道/行业"的宏观属性。
 *   输出两个 1-10 分的整数：
 *   - Industry_Capital_Score: 10 = 纯软件/SaaS 等轻资产，1 = 重资产制造
 *   - Industry_Scale_Score:   10 = 双边网络效应，1 = 人力密集型无规模效应
 *
 * 公式: S3 = round(Capital_Score × 5 + Scale_Score × 5)
 * 缺失数据处理: 默认给 5 分中性分（即 S3 = 50）
 *
 * @param {number} Industry_Capital_Score - 行业资本效率评分 (1-10)
 * @param {number} Industry_Scale_Score - 行业规模效应评分 (1-10)
 * @returns {number} 0-100 的整数得分
 */
function calculateDimension3_CapitalEfficiencyAndScale(Industry_Capital_Score, Industry_Scale_Score) {
  // 数据缺失时默认 5 分中性分（行业属性 LLM 可查；查不到 = 赛道太冷门或不存在
  // → 客观中性 5）。与 dim4 的 6 故意不对称，详见 dim4 注释。
  const ceVal = normalizeInput(Industry_Capital_Score, 5, 1, 10);
  const seVal = normalizeInput(Industry_Scale_Score, 5, 1, 10);

  return clampScore(ceVal * 5 + seVal * 5);
}

/**
 * 计算模块4: 团队基因 (S4, 权重 20%, 满分 100)
 *
 * 多因子团队评分模型（v4.1 重构）：
 *
 * S4 = round(
 *   0.30 × Experience_Score +      // 经验深度（对数递减曲线）
 *   0.25 × Domain_Match_Score +    // 行业匹配度
 *   0.20 × Team_Completeness +     // 团队完整性
 *   0.15 × Track_Record_Score +    // 过往成绩
 *   0.10 × Education_Score         // 教育背景
 * )
 *
 * 每个子因子由 LLM 输出 1-10 分，JS 端做加权计算。
 * Experience_Score 使用递减曲线 min(10, 2.5 × ln(years + 1))，避免线性满分。
 *
 * @param {object} teamData - 团队评分数据
 * @param {number} teamData.Founder_Exp_Years - 核心创始人赛道相关经验年数（兼容旧接口）
 * @param {number} teamData.Team_Experience_Score - 经验深度评分（1-10，LLM输出）
 * @param {number} teamData.Team_Domain_Match_Score - 行业匹配度（1-10）
 * @param {number} teamData.Team_Completeness_Score - 团队完整性（1-10）
 * @param {number} teamData.Team_Track_Record_Score - 过往成绩（1-10）
 * @param {number} teamData.Team_Education_Score - 教育背景（1-10）
 * @returns {number} 0-100 的整数得分
 */
function calculateDimension4_Team(teamData) {
  // 兼容旧接口：如果传入的是数字，按旧逻辑处理
  if (typeof teamData === "number" || teamData === null || teamData === undefined) {
    const rawExp = (teamData === null || teamData === undefined) ? NaN : Number(teamData);
    // v3：经验曲线改 min(10, 年数/2.5)，~25 年触顶（旧 ln 曲线要 53 年才满分，子量表满分够不到）
    const expVal = isNaN(rawExp) ? 6 : Math.min(10, Math.max(0, rawExp) / 2.5);
    return clampScore(expVal * 10);
  }

  const data = teamData || {};

  // Experience: 如果 LLM 直接给了 Team_Experience_Score 就用，否则从 Founder_Exp_Years 计算
  const rawTeamExp = Number(data.Team_Experience_Score);
  let experienceScore;
  if (!isNaN(rawTeamExp) && rawTeamExp >= 1 && rawTeamExp <= 10) {
    experienceScore = rawTeamExp;
  } else {
    const rawExp = Number(data.Founder_Exp_Years);
    // v3：年数→分用 min(10, 年数/2.5)（25 年触顶）；经验完全缺失 → 中性 6
    //（与其他子因子缺失默认 6 一致，不再用假设的 5 年线性算低分）
    experienceScore = isNaN(rawExp) ? 6 : Math.min(10, Math.max(0, rawExp) / 2.5);
  }

  // 子因子提取（LLM 输出 1-10，缺失默认 6）。
  //
  // 为什么 dim4 缺失默认 6，而 dim3 默认 5？—— 故意不对称，不是 bug：
  //   数据源约束：本系统依赖 Kimi search，团队背景信息（早期创始人、
  //   非 LinkedIn 用户、国内民营企业）大概率检索不到——这是常态，不代表团队差。
  //   因此 dim4 fallback = 6（中性偏上的诚实补偿），刻意高于 dim3 的客观中性 5。
  //   修改前请先评估是否会让现有分布（多 C/D、少 A/B）进一步下移。
  const domainMatch = normalizeInput(data.Team_Domain_Match_Score, 6, 1, 10);
  const completeness = normalizeInput(data.Team_Completeness_Score, 6, 1, 10);
  const trackRecord = normalizeInput(data.Team_Track_Record_Score, 6, 1, 10);
  const education = normalizeInput(data.Team_Education_Score, 6, 1, 10);

  // 加权计算（每个因子 1-10，加权后 1-10，再 ×10 映射到 0-100）
  const weighted =
    0.30 * experienceScore +
    0.25 * domainMatch +
    0.20 * completeness +
    0.15 * trackRecord +
    0.10 * education;

  return clampScore(weighted * 10);
}

/**
 * 计算模块5: BP诚信度 (S5, 0-100, 权重 20%)
 *
 * 基于 Agent B 对 BP 所有关键声明的逐条核查结果，量化计算这份 BP 的
 * 信息质量与可信程度。
 *
 * 设计原则：
 *   "存疑" 是 LLM 知识库覆盖不足的结果，不是项目的问题，给及格分（6分）。
 *   只有可被证伪或有明确夸大证据的声明才拉低分数。
 *
 * verdict 映射规则（满分10）:
 *   诚实 / 保守低估  → 10    （正面信号）
 *   存疑             →  6    （及格分，无罪推定但不再偏上——LLM 知识盲区不奖励）
 *   夸大             →  3    （有证据的负面信号）
 *   信息不对称       →  2    （故意隐瞒）
 *   严重夸大         →  1    （严重负面）
 *   证伪             →  0    （声明明显错误）
 *
 * v4.5 反稀释重构（修复"造假项目堆诚实声明洗分"漏洞）：
 *   1. 声明按 materiality 分组：financial / valuation / legal_compliance 为
 *      "重大组"（直接影响投资决策与资金安全），其余为"一般组"。
 *      S5 = 0.7 × 重大组均值 + 0.3 × 一般组均值（缺一组则用另一组）。
 *      → 核心财务声明的问题不再被 20 条"公司成立于某年"式真话摊薄。
 *   2. Integrity Veto（hard cap）：重大组出现"证伪"，或"严重夸大"且
 *      severity ∈ {严重, 高} → S5 封顶 INTEGRITY_VETO_CAP(25)，
 *      且评级封顶 C（见 scoreProject）。一票否决不可被任何数量的
 *      正面声明稀释——这是真实投委会的工作方式。
 *   3. 无 category 的旧数据全部落入一般组，行为与 v4.4 简单平均一致，向后兼容。
 *
 * 无数据兜底: 70（中性偏上，不误杀——没有声明可核查不代表不诚信）
 *
 * @param {Array} claimVerdicts - Agent B 输出的声明核查结果数组
 * @returns {number} 0-100 的整数得分
 */
const VERDICT_SCORE_MAP = {
  "诚实": 10,
  "保守低估": 10,
  "存疑": 6,
  "夸大": 3,
  "信息不对称": 2,
  "严重夸大": 1,
  "证伪": 0,
};

// 重大声明类别：造假直接威胁资金安全（财务/估值/合规）
const MATERIAL_CLAIM_CATEGORIES = new Set(["financial", "valuation", "legal_compliance"]);
const MATERIAL_GROUP_WEIGHT = 0.7;
const INTEGRITY_VETO_CAP = 25;
// veto 触发的 verdict：证伪无条件触发；严重夸大需 severity 佐证（避免误杀）
const VETO_SEVERITIES = new Set(["严重", "高"]);

function _isMaterialClaim(v) {
  return MATERIAL_CLAIM_CATEGORIES.has(String(v?.category || "").toLowerCase());
}

function _verdictScore(v) {
  return VERDICT_SCORE_MAP[v?.verdict] ?? VERDICT_SCORE_MAP["存疑"];
}

/**
 * Integrity Veto 判定：重大类别声明被证伪/严重夸大（高严重度）→ 一票否决。
 * @returns {{ triggered: boolean, reasons: string[] }}
 */
function assessIntegrityVeto(claimVerdicts) {
  if (!Array.isArray(claimVerdicts)) return { triggered: false, reasons: [] };
  const reasons = [];
  for (const v of claimVerdicts) {
    if (!v || !_isMaterialClaim(v)) continue;
    const isVeto =
      v.verdict === "证伪" ||
      (v.verdict === "严重夸大" && VETO_SEVERITIES.has(String(v.severity || "")));
    if (isVeto) {
      const claimText = String(v.original_claim || v.claim || v.bp_claim || "").slice(0, 80);
      reasons.push(`[${v.category}] ${v.verdict}：${claimText}`);
    }
  }
  return { triggered: reasons.length > 0, reasons: reasons.slice(0, 5) };
}

function calculateDimension5_Integrity(claimVerdicts) {
  if (!Array.isArray(claimVerdicts) || claimVerdicts.length === 0) {
    return 70; // 无数据 → 中性偏上，没有声明可核查不代表不诚信
  }

  const material = [];
  const general = [];
  for (const v of claimVerdicts) {
    (_isMaterialClaim(v) ? material : general).push(v);
  }
  const groupAvg = (list) =>
    list.length === 0
      ? null
      : (list.reduce((sum, v) => sum + _verdictScore(v), 0) / list.length) * 10;

  const m = groupAvg(material);
  const g = groupAvg(general);
  let s5;
  if (m == null) s5 = g;
  else if (g == null) s5 = m;
  else s5 = MATERIAL_GROUP_WEIGHT * m + (1 - MATERIAL_GROUP_WEIGHT) * g;

  // hard cap：重大造假不可被正面声明数量稀释
  if (assessIntegrityVeto(claimVerdicts).triggered) {
    s5 = Math.min(s5, INTEGRITY_VETO_CAP);
  }

  return clampScore(s5);
}

/**
 * 五维简单平均总分（等权，每个维度 20%）
 *
 * Total_Score = (S1 + S2 + S3 + S4 + S5) / 5
 */
function calculateTotalScore(S1, S2, S3, S4, S5) {
  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const s1 = num(S1, 0);
  const s2 = num(S2, 0);
  const s3 = num(S3, 0);
  const s4 = num(S4, 0);
  // 注意：必须用 isFinite 判断而非 `|| 70`——S5 合法得 0 分（所有声明被证伪）
  // 时绝不能被顶成 70。仅在 S5 缺失（undefined/NaN）时才取中性默认 70。
  const s5 = num(S5, 70);
  return clampScore((s1 + s2 + s3 + s4 + s5) / 5);
}

/**
 * 纯分数评级 A/B/C/D
 *
 * A ≥ 80 | B ≥ 65 | C ≥ 50 | D < 50
 *
 * v4.1 调整：旧阈值 (A≥85) 导致现实中几乎没有项目能进入 Fast Track，
 * 不符合 VC 实际工作流。新阈值让优秀项目能进 A 级，同时 D 级下限降至 50，
 * 让评级分布更合理。
 *
 * @param {number} totalScore - 总分 (0-100)
 * @returns {{ grade, label, action, color }}
 */
function getGrade(totalScore) {
  const score = Number(totalScore) || 0;

  if (score >= 80) {
    return {
      grade: "A",
      label: "强烈推荐投资 (Fast Track)",
      action: "立刻推进：建议 24 小时内约见创始人，同步启动业务尽调（客户访谈、竞品验证）和财务尽调（审计底稿、银行流水），并行开始估值建模。优先关注收入确认方式与客户集中度。",
      color: "#10b981",
    };
  } else if (score >= 65) {
    return {
      grade: "B",
      label: "谨慎推荐 (Proceed with DD)",
      action: "安排创始人面谈，重点考察团队对行业周期的认知深度与战略定力。要求提供近 12 个月的月度财务明细，验证单位经济模型（LTV/CAC、毛利率、回款周期），同步启动竞品客户交叉验证。",
      color: "#3b82f6",
    };
  } else if (score >= 50) {
    return {
      grade: "C",
      label: "观望跟踪 (Keep In View)",
      action: "项目处于早期验证阶段，商业模式尚未完全跑通。建议保持季度跟踪频率，关注关键里程碑达成情况（首个标杆客户、产品 PMF 验证、单月盈亏平衡），如有显著进展可重新进入评审流程。",
      color: "#f59e0b",
    };
  } else {
    return {
      grade: "D",
      label: "建议放弃 (Reject / Archive)",
      action: "项目存在结构性硬伤：可能涉及伪需求（缺乏付费意愿验证）、商业模式不可持续（边际成本不收敛）、核心团队与赛道严重不匹配、或估值脱离基本面。建议归档并标注具体否决原因，供投委会复盘参考。",
      color: "#ef4444",
    };
  }
}

/**
 * 是否具备 harness 输入（任一存在即可触发 harness 计算）
 */
function _hasHarnessInputs(data) {
  return !!(
    (data.TRL_Evidence && typeof data.TRL_Evidence === "object") ||
    (data.Moat_Rubric && typeof data.Moat_Rubric === "object") ||
    (data.Chokepoint_Score != null && data.Chokepoint_Score !== "" && !isNaN(Number(data.Chokepoint_Score)))
  );
}

/**
 * Integrity Veto → 评级封顶。
 * 总分照实输出（保持分数可解释），但 A/B 的"推进"建议在重大造假面前必须收回：
 * 投资人最不能接受的是系统对一个已证伪核心财务声明的项目说"立刻推进尽调"。
 */
function _applyIntegrityVeto(result, vetoInfo) {
  if (!vetoInfo || !vetoInfo.triggered) return result;
  result.integrity_veto = { triggered: true, reasons: vetoInfo.reasons };
  if (result.grade === "A" || result.grade === "B") {
    result.grade_overridden_from = result.grade;
    result.grade = "C";
    result.grade_label = "重大诚信红旗 (Integrity Veto)";
    result.grade_action =
      "核查发现重大类别声明（财务/估值/合规）被证伪或严重夸大，已触发一票否决：" +
      "评级强制降至 C，禁止按原始分数推进。建议优先要求公司就被证伪声明提供原始凭证" +
      "（审计报告、银行流水、合同原件），核实清楚前不进入投资流程。" +
      (vetoInfo.reasons.length ? ` 触发依据：${vetoInfo.reasons.join("；")}` : "");
    result.grade_color = "#f59e0b";
  }
  return result;
}

// ============================================================
// 聚合层（方案乙）+ 政策融入 —— 在五维分算好后叠加
// ============================================================

const GRADE_REP = { A: 85, B: 70, C: 55, D: 40 };

/** 由政策档位 + 赛道大类组装政策输入 */
function _policyInputs(data) {
  const r = (data.Policy_Rubric && typeof data.Policy_Rubric === "object") ? data.Policy_Rubric : {};
  // 资本来源是 S3 的输入，但"国资/大基金"同时是政策背书信号（仅作 readout，不重复加资本分）
  const capSource = r.capital_source || (data.S3_Rubric && data.S3_Rubric.capital_source);
  const stateCapital = r.state_capital != null
    ? !!r.state_capital
    : ["大基金主导", "国资参与"].includes(String(capSource || ""));
  return {
    tier: r.tier || null,
    industryCategory: data.industry_category || null,
    chokepointSubstitution: !!r.chokepoint_substitution,
    stateCapital,
    geoExposure: r.geo_exposure || null,
    industrialization: r.industrialization,
  };
}

/**
 * 各维真实覆盖度（Phase 3）：按"该维有多少输入是真证据、多少是中性默认"打分。
 * coverage 越低 → 该维在聚合中让权、置信度下降、区间变宽 —— 这样缺信息的项目
 * 显示成"X 分 / 低置信"，而不是被中性默认分把总分往中心拽（修复根因②）。
 * 返回 {S1..S5} 覆盖度 0-1。
 */
function _deriveCoverages(data) {
  // S1：TAM 与 增速（公司同比或市场 CAGR）两块证据
  const tamOk = !isTamMissing(data.TAM_Million_RMB);
  const growthOk = Number.isFinite(Number(data.Company_Revenue_Growth_YoY)) ||
    (Number.isFinite(Number(data.CAGR)) && Number(data.CAGR) > 0);
  const s1 = tamOk && growthOk ? 1.0 : tamOk || growthOk ? 0.6 : 0.3;

  // S2：harness moat 子因子覆盖(0-5)/5；仅 TRL/咽喉 → 中等；纯 legacy 裸分 → 低
  let s2 = 0.5;
  const mc = data.Moat_Rubric && typeof data.Moat_Rubric === "object"
    ? Object.values(data.Moat_Rubric).filter((v) => v && Number.isFinite(Number(v.score))).length
    : 0;
  if (mc > 0) s2 = Math.max(0.4, Math.min(1, (mc + (data.Chokepoint_Score != null ? 1 : 0)) / 5));
  else if (data.TRL_Evidence || data.Chokepoint_Score != null) s2 = 0.6;

  // S3：有结构化 S3_Rubric 实质字段 → 高覆盖；只有 legacy 枚举 → 中
  const s3 = _hasS3HarnessInputs(data) ? 1.0 : (data.Capital_Archetype || data.Scale_Mechanism ? 0.6 : 0.4);

  // S4：团队子分中"真给了"的比例（Founder_Exp_Years 也算一块）
  const teamFields = ["Team_Experience_Score", "Team_Domain_Match_Score", "Team_Completeness_Score",
    "Team_Track_Record_Score", "Team_Education_Score"];
  let teamGiven = teamFields.filter((f) => Number.isFinite(Number(data[f]))).length;
  if (Number.isFinite(Number(data.Founder_Exp_Years))) teamGiven = Math.min(teamFields.length, teamGiven + 1);
  const s4 = teamGiven > 0 ? Math.max(0.3, teamGiven / teamFields.length) : 0.3;

  // S5：可核查声明条数（无声明 ≠ 诚信问题，但确实是低覆盖/低置信）
  const claimN = Array.isArray(data.claim_verdicts) ? data.claim_verdicts.length : 0;
  const s5 = claimN === 0 ? 0.3 : claimN < 3 ? 0.6 : claimN < 6 ? 0.85 : 1.0;

  return { S1: s1, S2: s2, S3: s3, S4: s4, S5: s5 };
}

const _DIM_KEY_BY_S = {
  S1: "timing_ceiling", S2: "product_moat", S3: "business_validation", S4: "team", S5: "external_risk",
};

/**
 * 把非线性聚合 + 政策融入叠加到已组装结果上。
 *   off    → 原样返回
 *   shadow → 附 scoring_agg_shadow 对照块，live（算术平均）不变
 *   on     → 用聚合结果替换 total/grade，写入分布/政策/敏感性/triggered_rules，
 *            并重新套用 Integrity Veto 封顶
 */
function _applyAggregation(result, data, aggMode, vetoInfo) {
  if (aggMode === "off") return result;

  const d = result.dimensions;
  const policy = scorePolicyFit(_policyInputs(data));

  // 政策融入两条不重叠通道：需求侧→S1，资本侧→S3（地缘等 harness 未覆盖的修正）
  const S1base = d.timing_ceiling.score;
  const S3base = d.business_validation.score;
  const S1adj = clampScore(S1base + policy.s1_demand_adj);
  const S3adj = clampScore(S3base + policy.s3_capital_adj);

  const coverages = _deriveCoverages(data);
  const track = isHardtechTrack(policy.tier) ? "hardtech" : "general";
  const agg = aggregate({
    scores: { S1: S1adj, S2: d.product_moat.score, S3: S3adj, S4: d.team.score, S5: d.external_risk.score },
    coverages,
    track,
  });

  const policyFit = {
    tier: policy.tier,
    tier_label: policy.tier_label,
    readout_score: policy.readout_score,
    coverage: policy.coverage,
    s1_demand_adj: policy.s1_demand_adj,
    s3_capital_adj: policy.s3_capital_adj,
    note: "政策不设独立维度，融入 S1（需求侧）/S3（资本侧）；readout 仅展示与回测，不进加权平均",
  };
  const triggeredRules = [...policy.triggered_rules, ...agg.triggered_rules];

  const aggBlock = {
    total_median: agg.total_median,
    total_range: agg.total_range,
    confidence: agg.confidence,
    grade: agg.grade,
    base: agg.base,
    excellence_bonus: agg.excellence_bonus,
    excellence_count: agg.excellence_count,
    avg_coverage: agg.avg_coverage,
    coverages,
    track: agg.track,
    weights: agg.weights,
    sensitivity: agg.sensitivity,
    resonance_gate: agg.resonance_gate,
    policy_fit: policyFit,
    triggered_rules: triggeredRules,
    dims_adjusted: { S1: { from: S1base, to: S1adj }, S3: { from: S3base, to: S3adj } },
    delta_total: agg.total_median - result.total_score,
  };

  if (aggMode === "shadow") {
    result.scoring_agg_shadow = aggBlock;
    return result;
  }

  // on：聚合正式生效
  result.total_score = agg.total_median;
  result.total_distribution = {
    median: agg.total_median, range: agg.total_range, confidence: agg.confidence,
  };
  // S1/S3 展示分反映政策融入（可解释、与敏感性一致）
  if (policy.s1_demand_adj !== 0) {
    d.timing_ceiling.score = S1adj;
    d.timing_ceiling.inputs = { ...d.timing_ceiling.inputs, policy_demand_adj: policy.s1_demand_adj };
  }
  if (policy.s3_capital_adj !== 0) {
    d.business_validation.score = S3adj;
    d.business_validation.inputs = { ...d.business_validation.inputs, policy_capital_adj: policy.s3_capital_adj };
  }
  const meta = getGrade(GRADE_REP[agg.grade] ?? 40);
  result.grade = agg.grade;
  result.grade_label = meta.label;
  result.grade_action = meta.action;
  result.grade_color = meta.color;
  result.scoring_agg_basis = "aggregate_v3";
  // 每维标注覆盖度与低置信旗（缺信息 → "X分/低置信"，不再用中性默认硬撑总分）
  for (const sKey of Object.keys(coverages)) {
    const dimObj = d[_DIM_KEY_BY_S[sKey]];
    if (dimObj) {
      dimObj.coverage = Math.round(coverages[sKey] * 100) / 100;
      dimObj.low_confidence = coverages[sKey] < 0.5;
    }
  }
  result.policy_fit = policyFit;
  result.sensitivity = agg.sensitivity;
  result.triggered_rules = triggeredRules;
  result.aggregation = {
    base: agg.base, excellence_bonus: agg.excellence_bonus, track: agg.track,
    weights: agg.weights, resonance_gate: agg.resonance_gate, avg_coverage: agg.avg_coverage,
  };
  // 重新套 Integrity Veto：聚合可能把评级抬回 A/B，重大造假必须仍封顶 C
  return _applyIntegrityVeto(result, vetoInfo);
}

/**
 * 组装最终结果对象（给定 5 维分 + S2 展示元数据 + 声明数）
 */
function _assemble(S1, S2, S3, S4, S5, data, s2meta, s3meta) {
  const totalScore = calculateTotalScore(S1, S2, S3, S4, S5);
  const grading = getGrade(totalScore);
  const s3m = s3meta || _S3_LEGACY_META(data);
  return {
    dimensions: {
      timing_ceiling: {
        score: S1, label: "时机与天花板", subtitle: "TAM（百万人民币） + CAGR", weight: 20,
        inputs: {
          TAM_Million_RMB: data.TAM_Million_RMB, CAGR: data.CAGR,
          ...(isTamMissing(data.TAM_Million_RMB) ? { TAM_missing: true } : {}),
        },
      },
      product_moat: {
        score: S2, label: "产品与壁垒", weight: 20,
        subtitle: s2meta.subtitle, inputs: s2meta.inputs,
      },
      business_validation: {
        score: S3, label: "资本效率与规模效应", weight: 20,
        subtitle: s3m.subtitle, inputs: s3m.inputs,
      },
      team: {
        score: S4, label: "团队基因", subtitle: "创始人赛道经验年数", weight: 20,
        inputs: { Founder_Exp_Years: data.Founder_Exp_Years },
      },
      external_risk: {
        score: S5, label: "BP诚信度", subtitle: "声明核查结果", weight: 20,
        inputs: { claim_count: Array.isArray(data.claim_verdicts) ? data.claim_verdicts.length : 0 },
      },
    },
    total_score: totalScore,
    grade: grading.grade,
    grade_label: grading.label,
    grade_action: grading.action,
    grade_color: grading.color,
  };
}

const _S2_LEGACY_META = (data) => ({
  subtitle: "TRL + 竞品排名",
  inputs: { TRL: data.TRL, Competitor_Rank_Score: data.Competitor_Rank_Score },
});

function _s2HarnessMeta(detail) {
  const t = detail.trl_detail || {};
  const m = detail.moat_detail || {};
  return {
    subtitle: "TRL实证 + 护城河(差异化/转换成本/落地/竞争密度/咽喉)",
    inputs: {
      effective_trl: t.effective_trl,
      trl_verified: t.trl_verified,
      trl_claimed: t.trl_claimed,
      moat_score: m.moat_score,
      moat_subfactors: m.subfactors,
      moat_coverage: m.coverage,
    },
  };
}

const _S3_LEGACY_META = (data) => ({
  subtitle: "行业资本效率 + 行业规模效应",
  inputs: { Industry_Capital_Score: data.Industry_Capital_Score, Industry_Scale_Score: data.Industry_Scale_Score },
});

function _s3HarnessMeta(h3) {
  const d = h3.detail || {};
  return {
    subtitle: "资本效率(含耐心) + 规模×陡峭度 + 资本壁垒溢价 + 新质生产力 + 毛利修正",
    inputs: {
      CE: d.CE, G: d.G, CBP: d.CBP, N: d.N, GM_adj: d.GM_adj,
      archetype: d.archetype, scale_type: d.scale_type, steepness_k: d.k,
      player_count: d.player_count, policy_tier: d.policy_tier, capital_source: d.capital_source,
    },
  };
}

/** S3 harness 输入门槛：S3_Rubric 含至少一个非毛利的实质字段才视为可用 */
function _hasS3HarnessInputs(data) {
  const r = data.S3_Rubric;
  if (!r || typeof r !== "object") return false;
  return Object.keys(r).some((key) => key !== "gross_margin" && r[key] != null);
}

/**
 * 主评分函数
 *
 * 输入: 从 Agent B 验证后的结构化数据
 * 输出: 5 个维度的得分 + 总分 + 评级（shadow 模式下附 scoring_shadow 对照块）
 *
 * 字段映射:
 *   TAM_Million_RMB        → S1 (百万人民币)
 *   CAGR                   → S1
 *   TRL / Competitor_Rank_Score        → S2 (legacy 裸分路径 / harness 兜底)
 *   TRL_Evidence / Moat_Rubric / Chokepoint_Score → S2 (harness 路径，见 scoringHarness.js)
 *   Industry_Capital_Score / Industry_Scale_Score → S3
 *   Founder_Exp_Years + Team_*          → S4
 *   claim_verdicts                      → S5 (BP诚信度；harness on 时叠加 TRL gap verdict)
 */
function scoreProject(data, opts = {}) {
  // modeOverride / s3ModeOverride 让调用方(如 pipeline 的专家合并 A/B)显式指定
  // off/shadow/on，绕过全局 env，避免多层 shadow 嵌套。缺省时读全局开关。
  const mode = opts.modeOverride || scoringHarnessMode();       // S2: off | shadow | on
  const s3mode = opts.s3ModeOverride || scoringS3HarnessMode(); // S3: off | shadow | on
  const aggMode = opts.aggModeOverride || scoringAggMode();     // 聚合: off | shadow | on
  const harnessAvailable = mode !== "off" && _hasHarnessInputs(data);

  // 两维共用（不受 S2 harness 影响）
  const S1 = calculateDimension1_TimingAndCeiling(
    data.TAM_Million_RMB, data.CAGR, data.Company_Revenue_Growth_YoY);
  const S4 = calculateDimension4_Team({
    Founder_Exp_Years: data.Founder_Exp_Years,
    Team_Experience_Score: data.Team_Experience_Score,
    Team_Domain_Match_Score: data.Team_Domain_Match_Score,
    Team_Completeness_Score: data.Team_Completeness_Score,
    Team_Track_Record_Score: data.Team_Track_Record_Score,
    Team_Education_Score: data.Team_Education_Score,
  });

  // —— S3：legacy + harness（与 S2 同范式，独立灰度开关）——
  const S3legacy = calculateDimension3_CapitalEfficiencyAndScale(
    data.Industry_Capital_Score, data.Industry_Scale_Score);
  const s3Available = s3mode !== "off" && _hasS3HarnessInputs(data);
  const h3 = s3Available
    ? scoreS3Harness({
        s3Rubric: data.S3_Rubric,
        archetype: data.Capital_Archetype,
        scaleMechanism: data.Scale_Mechanism,
        grossMargin: data.S3_Rubric ? data.S3_Rubric.gross_margin : undefined,
        fallbackCagr: data.CAGR,
      })
    : null;
  const S3live = s3mode === "on" && h3 ? h3.S3 : S3legacy;
  const s3meta = s3mode === "on" && h3 ? _s3HarnessMeta(h3) : undefined;
  // shadow：把新版 S3 对照块附到任何返回结果上（独立于 S2 路径，供校准）
  const attachS3Shadow = (result) => {
    if (h3 && s3mode === "shadow") {
      const d = result.dimensions;
      const totalWithHarnessS3 = calculateTotalScore(
        d.timing_ceiling.score, d.product_moat.score, h3.S3, d.team.score, d.external_risk.score);
      result.scoring_s3_shadow = {
        S3: h3.S3,
        basis: h3.basis,
        detail: h3.detail,
        delta_S3: h3.S3 - S3legacy,
        delta_total: totalWithHarnessS3 - result.total_score,
      };
    }
    return result;
  };

  // legacy 路径（始终算，作为 shadow 基线/兜底）
  const S2legacy = calculateDimension2_ProductAndMoat(data.TRL, data.Competitor_Rank_Score);
  const S5legacy = calculateDimension5_Integrity(data.claim_verdicts);

  // 没有 S2 harness 数据或 S2 开关 off → 纯 legacy（S3 仍可独立走 on/shadow）
  if (!harnessAvailable) {
    const legacyVeto = assessIntegrityVeto(data.claim_verdicts);
    return _applyAggregation(
      attachS3Shadow(
        _applyIntegrityVeto(
          _assemble(S1, S2legacy, S3live, S4, S5legacy, data, _S2_LEGACY_META(data), s3meta),
          legacyVeto
        )
      ),
      data, aggMode, legacyVeto
    );
  }

  // S2 harness 路径
  const h = scoreS2Harness({
    trlEvidence: data.TRL_Evidence,
    moatRubric: data.Moat_Rubric,
    chokepointScore: data.Chokepoint_Score,
    legacyTrl: data.TRL,
    legacyRank: data.Competitor_Rank_Score,
  });
  // TRL 自报 vs 实证 gap → 追加一条 claim_verdict 喂 S5（反注水）
  const gapVerdict = trlGapVerdict(h.trl_detail);
  const harnessVerdicts = gapVerdict
    ? [...(Array.isArray(data.claim_verdicts) ? data.claim_verdicts : []), gapVerdict]
    : data.claim_verdicts;
  const S5harness = calculateDimension5_Integrity(harnessVerdicts);

  const harnessVeto = assessIntegrityVeto(harnessVerdicts);

  if (mode === "on") {
    const result = _applyIntegrityVeto(
      _assemble(S1, h.S2, S3live, S4, S5harness, data, _s2HarnessMeta(h), s3meta),
      harnessVeto
    );
    result.scoring_basis = "harness";
    return _applyAggregation(attachS3Shadow(result), data, aggMode, harnessVeto);
  }

  // S2 shadow：旧分生效，附 S2 harness 对照块（供校准）；live 仍受 Integrity Veto 封顶
  const live = _applyIntegrityVeto(
    _assemble(S1, S2legacy, S3live, S4, S5legacy, data, _S2_LEGACY_META(data), s3meta),
    assessIntegrityVeto(data.claim_verdicts)
  );
  const shadow = _assemble(S1, h.S2, S3live, S4, S5harness, data, _s2HarnessMeta(h), s3meta);
  live.scoring_basis = "legacy";
  live.scoring_shadow = {
    S2: h.S2,
    S5: S5harness,
    total_score: shadow.total_score,
    grade: shadow.grade,
    trl_gap_verdict: gapVerdict || null,
    trl_detail: h.trl_detail,
    moat_detail: h.moat_detail,
    delta_total: shadow.total_score - live.total_score,
    delta_S2: h.S2 - S2legacy,
  };
  return _applyAggregation(
    attachS3Shadow(live), data, aggMode, assessIntegrityVeto(data.claim_verdicts)
  );
}

module.exports = {
  scoreProject,
  calculateDimension1_TimingAndCeiling,
  calculateDimension2_ProductAndMoat,
  calculateDimension3_CapitalEfficiencyAndScale,
  calculateDimension4_Team,
  calculateDimension5_Integrity,
  assessIntegrityVeto,
  calculateTotalScore,
  getGrade,
  clampScore,
  normalizeInput,
  VERDICT_SCORE_MAP,
  MATERIAL_CLAIM_CATEGORIES,
  INTEGRITY_VETO_CAP,
};
