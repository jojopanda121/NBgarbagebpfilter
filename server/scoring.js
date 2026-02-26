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
// ============================================================

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
 * 公式: S1 = min(60, round(17.5 × log10(max(1, TAM)))) + min(40, CAGR)
 *
 * @param {number} TAM_Million_RMB - 目标可触达市场规模（百万人民币）
 * @param {number} CAGR - 行业预期年复合增长率（百分比数字，如 25 表示 25%）
 * @returns {number} 0-100 的整数得分
 */
function calculateDimension1_TimingAndCeiling(TAM_Million_RMB, CAGR) {
  const rawTAM = Number(TAM_Million_RMB);
  const rawCAGR = Number(CAGR);

  // 数据缺失兜底：TAM 默认 1（对数安全），CAGR 默认 0
  const tamVal = isNaN(rawTAM) || rawTAM < 1 ? 1 : rawTAM;
  const cagrVal = isNaN(rawCAGR) ? 0 : Math.max(0, rawCAGR);

  // 对数压缩市场规模分（满分 60），线性增速分（满分 40）
  const tamScore = Math.min(60, Math.round(17.5 * Math.log10(tamVal)));
  const cagrScore = Math.min(40, cagrVal);

  const score = tamScore + cagrScore;
  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * 计算模块2: 产品与壁垒 (S2, 权重 25%, 满分 100)
 *
 * Agent Prompt 约束:
 *   大模型检索行业内真实竞品及该产品的行业排名，输出 Competitor_Rank_Score (1-10 整数)。
 *   8-10 分: 行业 Top 5 且极难复制
 *   4-7 分: 腰部或细分第一
 *   1-3 分: 红海同质化跟风者
 *
 * 公式: S2 = round(0.4 × (TRL / 9 × 100) + 0.6 × (Rank × 10))
 *
 * @param {number} TRL - 技术就绪水平 (1-9 级)
 * @param {number} Competitor_Rank_Score - 竞品排名评分 (1-10 整数)
 * @returns {number} 0-100 的整数得分
 */
function calculateDimension2_ProductAndMoat(TRL, Competitor_Rank_Score) {
  const rawTRL = (TRL === null || TRL === undefined) ? NaN : Number(TRL);
  const rawRank = (Competitor_Rank_Score === null || Competitor_Rank_Score === undefined) ? NaN : Number(Competitor_Rank_Score);

  // TRL 缺失默认 3（早期概念阶段），Rank 缺失默认 5（行业中游）
  const trlVal = (isNaN(rawTRL) || rawTRL < 1) ? 3 : Math.max(1, Math.min(9, Math.round(rawTRL)));
  const rankVal = (isNaN(rawRank) || rawRank < 1) ? 5 : Math.max(1, Math.min(10, Math.round(rawRank)));

  const trlComponent = (trlVal / 9) * 100;   // 归一化到 0-100
  const rankComponent = rankVal * 10;          // 映射到 0-100

  const score = 0.4 * trlComponent + 0.6 * rankComponent;
  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * 计算模块3: 资本效率与规模效应 (S3, 权重 35%, 满分 100)
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
  const rawCE = Number(Industry_Capital_Score);
  const rawSE = Number(Industry_Scale_Score);

  // 数据缺失时默认 5 分中性分，防止总分雪崩
  const ceVal = (!isNaN(rawCE) && rawCE >= 1 && rawCE <= 10) ? Math.round(rawCE) : 5;
  const seVal = (!isNaN(rawSE) && rawSE >= 1 && rawSE <= 10) ? Math.round(rawSE) : 5;

  const score = ceVal * 5 + seVal * 5;
  return Math.min(100, Math.max(0, Math.round(score)));
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
    const expVal = isNaN(rawExp) ? 3 : Math.max(0, rawExp);
    // 使用对数递减曲线计算经验分
    const expScore = Math.min(10, 2.5 * Math.log(expVal + 1));
    // 没有其他子因子时，经验分占100%权重，归一化到0-100
    return Math.min(100, Math.max(0, Math.round(expScore * 10)));
  }

  const data = teamData || {};

  // 子因子提取（LLM 输出 1-10）
  const clamp = (val, fallback) => {
    const n = Number(val);
    return (!isNaN(n) && n >= 1 && n <= 10) ? n : fallback;
  };

  // Experience: 如果 LLM 直接给了 Team_Experience_Score 就用，否则从 Founder_Exp_Years 计算
  let experienceScore;
  const rawTeamExp = Number(data.Team_Experience_Score);
  if (!isNaN(rawTeamExp) && rawTeamExp >= 1 && rawTeamExp <= 10) {
    experienceScore = rawTeamExp;
  } else {
    const rawExp = Number(data.Founder_Exp_Years);
    const expVal = isNaN(rawExp) ? 3 : Math.max(0, rawExp);
    experienceScore = Math.min(10, 2.5 * Math.log(expVal + 1));
  }

  const domainMatch = clamp(data.Team_Domain_Match_Score, 5);
  const completeness = clamp(data.Team_Completeness_Score, 5);
  const trackRecord = clamp(data.Team_Track_Record_Score, 5);
  const education = clamp(data.Team_Education_Score, 5);

  // 加权计算（每个因子 1-10，加权后 1-10，再 ×10 映射到 0-100）
  const weighted =
    0.30 * experienceScore +
    0.25 * domainMatch +
    0.20 * completeness +
    0.15 * trackRecord +
    0.10 * education;

  const score = Math.round(weighted * 10);
  return Math.min(100, Math.max(0, score));
}

/**
 * 计算模块5: 外部风险 (V5, 乘数, 不占加权权重)
 *
 * 重要变更: 废除之前 0.5 的一刀切死刑逻辑，改为软着陆折扣。
 *
 * 估值溢价乘数规则:
 *   - Valuation_Gap ≤ 1.0 或无数据:  乘数 = 1.0（无罪推定）
 *   - 1.0 < Valuation_Gap ≤ 3.0:     乘数 = 0.9（轻度折扣）
 *   - Valuation_Gap > 3.0 或政策风险极高: 乘数 = 0.8（软着陆折扣）
 *
 * @param {number} Policy_Risk - 政策违规风险 (0 = 极高风险, 1 = 无风险)
 * @param {number} Valuation_Gap - BP 叫价与行业可比公司中位数的溢价倍数
 * @returns {number} 0-1 的乘数
 */
function calculateDimension5_ExternalRisk(Policy_Risk, Valuation_Gap) {
  const rawRisk = Number(Policy_Risk);
  // 政策风险：缺失时无罪推定，默认 1.0（无风险）
  const policyMultiplier = isNaN(rawRisk) ? 1 : Math.max(0, Math.min(1, rawRisk));

  const rawGap = Number(Valuation_Gap);

  // 估值折扣：软着陆逻辑
  let valuationDiscount;
  if (Valuation_Gap === null || Valuation_Gap === undefined || isNaN(rawGap) || rawGap <= 0) {
    // 无估值数据 → 无罪推定，不予惩罚
    valuationDiscount = 1.0;
  } else if (rawGap <= 1.0) {
    // 估值合理或低估
    valuationDiscount = 1.0;
  } else if (rawGap <= 3.0) {
    // 中度溢价：轻度折扣
    valuationDiscount = 0.9;
  } else {
    // 严重溢价或政策风险极高：软着陆折扣（不再是 0.5 死刑）
    valuationDiscount = 0.8;
  }

  // 政策风险极高（< 0.5）直接触发最低乘数
  if (policyMultiplier < 0.5) {
    valuationDiscount = Math.min(valuationDiscount, 0.8);
  }

  return policyMultiplier * valuationDiscount;
}

/**
 * 五维简单平均总分
 *
 * Total_Score = (S1 + S2 + S3 + S4 + S5) / 5
 * 其中 S5 = V5 × 100（将 0-1 乘数转为 0-100 分）
 */
function calculateTotalScore(S1, S2, S3, S4, V5) {
  const s1 = Number(S1) || 0;
  const s2 = Number(S2) || 0;
  const s3 = Number(S3) || 0;
  const s4 = Number(S4) || 0;
  const s5 = Math.round((Number(V5) || 1) * 100);
  return Math.min(100, Math.max(0, Math.round((s1 + s2 + s3 + s4 + s5) / 5)));
}

/**
 * 纯分数评级 A/B/C/D
 *
 * A ≥ 85 | B ≥ 70 | C ≥ 60 | D < 60
 *
 * @param {number} totalScore - 总分 (0-100)
 * @returns {{ grade, label, action, color }}
 */
function getGrade(totalScore) {
  const score = Number(totalScore) || 0;

  if (score >= 85) {
    return {
      grade: "A",
      label: "强烈推荐投资 (Fast Track)",
      action: "立刻推进：建议 24 小时内约见创始人，同步启动业务尽调（客户访谈、竞品验证）和财务尽调（审计底稿、银行流水），并行开始估值建模。优先关注收入确认方式与客户集中度。",
      color: "#10b981",
    };
  } else if (score >= 70) {
    return {
      grade: "B",
      label: "谨慎推荐 (Proceed with DD)",
      action: "安排创始人面谈，重点考察团队对行业周期的认知深度与战略定力。要求提供近 12 个月的月度财务明细，验证单位经济模型（LTV/CAC、毛利率、回款周期），同步启动竞品客户交叉验证。",
      color: "#3b82f6",
    };
  } else if (score >= 60) {
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
 * 主评分函数
 *
 * 输入: 从 Agent B 验证后的结构化数据
 * 输出: 5 个维度的得分 + 总分 + 评级
 *
 * 字段映射 (新 Schema):
 *   TAM_Million_RMB      → S1 (百万人民币)
 *   CAGR                 → S1
 *   TRL                  → S2
 *   Competitor_Rank_Score → S2
 *   Industry_Capital_Score → S3
 *   Industry_Scale_Score   → S3
 *   Founder_Exp_Years     → S4
 *   Policy_Risk           → V5
 *   Valuation_Gap         → V5
 */
function scoreProject(data) {
  // 第一维度: 时机与天花板
  const S1 = calculateDimension1_TimingAndCeiling(data.TAM_Million_RMB, data.CAGR);

  // 第二维度: 产品与壁垒
  const S2 = calculateDimension2_ProductAndMoat(data.TRL, data.Competitor_Rank_Score);

  // 第三维度: 资本效率与规模效应
  const S3 = calculateDimension3_CapitalEfficiencyAndScale(
    data.Industry_Capital_Score,
    data.Industry_Scale_Score
  );

  // 第四维度: 团队基因（多因子评分模型）
  const S4 = calculateDimension4_Team({
    Founder_Exp_Years: data.Founder_Exp_Years,
    Team_Experience_Score: data.Team_Experience_Score,
    Team_Domain_Match_Score: data.Team_Domain_Match_Score,
    Team_Completeness_Score: data.Team_Completeness_Score,
    Team_Track_Record_Score: data.Team_Track_Record_Score,
    Team_Education_Score: data.Team_Education_Score,
  });

  // 第五维度: 外部风险（乘数，软着陆折扣）
  const policyRisk = (data.Policy_Risk !== undefined && data.Policy_Risk !== null)
    ? data.Policy_Risk
    : 1;
  const V5 = calculateDimension5_ExternalRisk(policyRisk, data.Valuation_Gap);

  // 计算总分（五维简单平均）
  const totalScore = calculateTotalScore(S1, S2, S3, S4, V5);

  // 获取纯分数评级
  const grading = getGrade(totalScore);

  return {
    dimensions: {
      timing_ceiling: {
        score: S1,
        label: "时机与天花板",
        subtitle: "TAM（百万人民币） + CAGR",
        weight: 20,
        inputs: { TAM_Million_RMB: data.TAM_Million_RMB, CAGR: data.CAGR },
      },
      product_moat: {
        score: S2,
        label: "产品与壁垒",
        subtitle: "TRL + 竞品排名",
        weight: 20,
        inputs: { TRL: data.TRL, Competitor_Rank_Score: data.Competitor_Rank_Score },
      },
      business_validation: {
        score: S3,
        label: "资本效率与规模效应",
        subtitle: "行业资本效率 + 行业规模效应",
        weight: 20,
        inputs: { Industry_Capital_Score: data.Industry_Capital_Score, Industry_Scale_Score: data.Industry_Scale_Score },
      },
      team: {
        score: S4,
        label: "团队基因",
        subtitle: "创始人赛道经验年数",
        weight: 20,
        inputs: { Founder_Exp_Years: data.Founder_Exp_Years },
      },
      external_risk: {
        score: Math.round(V5 * 100),
        label: "外部风险",
        subtitle: "政策风险 + 估值溢价折扣",
        weight: 20,
        multiplier: V5,
        inputs: { Policy_Risk: data.Policy_Risk, Valuation_Gap: data.Valuation_Gap },
      },
    },
    total_score: totalScore,
    grade: grading.grade,
    grade_label: grading.label,
    grade_action: grading.action,
    grade_color: grading.color,
  };
}

module.exports = {
  scoreProject,
  calculateDimension1_TimingAndCeiling,
  calculateDimension2_ProductAndMoat,
  calculateDimension3_CapitalEfficiencyAndScale,
  calculateDimension4_Team,
  calculateDimension5_ExternalRisk,
  calculateTotalScore,
  getGrade,
};
