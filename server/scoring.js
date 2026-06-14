// ============================================================
// scoring.js — 5维度定量评分系统 (v4.0 重构版)
//
// 核心原则：
//   利用大模型（MiniMax）的客观检索能力输出严谨的枚举值或绝对数值，
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
const { scoringHarnessMode } = require("./config/featureFlags");

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
function calculateDimension1_TimingAndCeiling(TAM_Million_RMB, CAGR) {
  const rawTAM = Number(TAM_Million_RMB);
  const rawCAGR = Number(CAGR);

  // 数据缺失兜底：
  //   TAM 缺失（NaN 或 <1，含上游 `?? 0` 的占位 0）→ 中性 30 分（满分 60 的一半），
  //   与 S3 缺失=50、S4 缺失≈60 的"中性兜底"哲学对齐。
  //   旧实现 TAM 缺失按 1 计 → log10(1)=0 分，等于把"信息少"系统性判成"市场小"。
  //   CAGR 缺失默认 0（增速无证据不给分，CAGR 是加分项而非基础盘）。
  const tamMissing = isNaN(rawTAM) || rawTAM < 1;
  const cagrVal = isNaN(rawCAGR) ? 0 : Math.max(0, rawCAGR);

  // 对数压缩市场规模分（满分 60），线性增速分（满分 40）
  const tamScore = tamMissing ? 30 : Math.min(60, Math.round(17.5 * Math.log10(rawTAM)));
  const cagrScore = Math.min(40, cagrVal);

  return clampScore(tamScore + cagrScore);
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
    const expVal = isNaN(rawExp) ? 5 : Math.max(0, rawExp);
    const expScore = Math.min(10, 2.5 * Math.log(expVal + 1));
    return clampScore(expScore * 10);
  }

  const data = teamData || {};

  // Experience: 如果 LLM 直接给了 Team_Experience_Score 就用，否则从 Founder_Exp_Years 计算
  const rawTeamExp = Number(data.Team_Experience_Score);
  let experienceScore;
  if (!isNaN(rawTeamExp) && rawTeamExp >= 1 && rawTeamExp <= 10) {
    experienceScore = rawTeamExp;
  } else {
    const rawExp = Number(data.Founder_Exp_Years);
    const expVal = isNaN(rawExp) ? 5 : Math.max(0, rawExp);
    experienceScore = Math.min(10, 2.5 * Math.log(expVal + 1));
  }

  // 子因子提取（LLM 输出 1-10，缺失默认 6）。
  //
  // 为什么 dim4 缺失默认 6，而 dim3 默认 5？—— 故意不对称，不是 bug：
  //   数据源约束：本系统依赖 MiniMax search，团队背景信息（早期创始人、
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
 * 公式: S5 = round(所有声明得分的平均值 × 10)
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

function calculateDimension5_Integrity(claimVerdicts) {
  if (!Array.isArray(claimVerdicts) || claimVerdicts.length === 0) {
    return 70; // 无数据 → 中性偏上，没有声明可核查不代表不诚信
  }

  const total = claimVerdicts.reduce((sum, v) => {
    // 未知 verdict 按"存疑"处理
    const score = VERDICT_SCORE_MAP[v.verdict] ?? VERDICT_SCORE_MAP["存疑"];
    return sum + score;
  }, 0);

  return clampScore((total / claimVerdicts.length) * 10);
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
 * 组装最终结果对象（给定 5 维分 + S2 展示元数据 + 声明数）
 */
function _assemble(S1, S2, S3, S4, S5, data, s2meta) {
  const totalScore = calculateTotalScore(S1, S2, S3, S4, S5);
  const grading = getGrade(totalScore);
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
        score: S3, label: "资本效率与规模效应", subtitle: "行业资本效率 + 行业规模效应", weight: 20,
        inputs: { Industry_Capital_Score: data.Industry_Capital_Score, Industry_Scale_Score: data.Industry_Scale_Score },
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
  // modeOverride 让调用方(如 pipeline 的专家合并 A/B)显式指定 off/shadow/on，
  // 绕过全局 env，避免多层 shadow 嵌套。缺省时读全局开关。
  const mode = opts.modeOverride || scoringHarnessMode(); // off | shadow | on
  const harnessAvailable = mode !== "off" && _hasHarnessInputs(data);

  // 三维共用（不受 harness 影响）
  const S1 = calculateDimension1_TimingAndCeiling(data.TAM_Million_RMB, data.CAGR);
  const S3 = calculateDimension3_CapitalEfficiencyAndScale(data.Industry_Capital_Score, data.Industry_Scale_Score);
  const S4 = calculateDimension4_Team({
    Founder_Exp_Years: data.Founder_Exp_Years,
    Team_Experience_Score: data.Team_Experience_Score,
    Team_Domain_Match_Score: data.Team_Domain_Match_Score,
    Team_Completeness_Score: data.Team_Completeness_Score,
    Team_Track_Record_Score: data.Team_Track_Record_Score,
    Team_Education_Score: data.Team_Education_Score,
  });

  // legacy 路径（始终算，作为 shadow 基线/兜底）
  const S2legacy = calculateDimension2_ProductAndMoat(data.TRL, data.Competitor_Rank_Score);
  const S5legacy = calculateDimension5_Integrity(data.claim_verdicts);

  // 没有 harness 数据或开关 off → 纯 legacy
  if (!harnessAvailable) {
    return _assemble(S1, S2legacy, S3, S4, S5legacy, data, _S2_LEGACY_META(data));
  }

  // harness 路径
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

  if (mode === "on") {
    const result = _assemble(S1, h.S2, S3, S4, S5harness, data, _s2HarnessMeta(h));
    result.scoring_basis = "harness";
    return result;
  }

  // shadow：旧分生效，附 harness 对照块（供校准）
  const live = _assemble(S1, S2legacy, S3, S4, S5legacy, data, _S2_LEGACY_META(data));
  const shadow = _assemble(S1, h.S2, S3, S4, S5harness, data, _s2HarnessMeta(h));
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
  return live;
}

module.exports = {
  scoreProject,
  calculateDimension1_TimingAndCeiling,
  calculateDimension2_ProductAndMoat,
  calculateDimension3_CapitalEfficiencyAndScale,
  calculateDimension4_Team,
  calculateDimension5_Integrity,
  calculateTotalScore,
  getGrade,
  clampScore,
  normalizeInput,
  VERDICT_SCORE_MAP,
};
