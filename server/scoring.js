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
 * Agent Prompt 约束:
 *   仅提取核心创始人在该赛道的直接相关从业经验年数，输出 Founder_Exp_Years (数字)。
 *
 * 公式: S4 = min(100, round(Exp × 10))
 *   即 10 年经验即可拿满分，不设上限惩罚。
 *
 * 重要变更: 废除原有的股权结构惩罚（Equity Penalty），
 *   因为股权结构属于交易条款而非团队能力指标，且早期项目股权结构多变，
 *   硬性惩罚会误杀连续创业者或学术背景创始人。
 *
 * @param {number} Founder_Exp_Years - 核心创始人赛道相关经验年数
 * @returns {number} 0-100 的整数得分
 */
function calculateDimension4_Team(Founder_Exp_Years) {
  const rawExp = (Founder_Exp_Years === null || Founder_Exp_Years === undefined) ? NaN : Number(Founder_Exp_Years);

  // 数据缺失默认 3 年（不至于归零，但也不给高分）
  const expVal = isNaN(rawExp) ? 3 : Math.max(0, rawExp);

  const score = Math.min(100, Math.round(expVal * 10));
  return Math.max(0, score);
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
 * 加权总分计算
 *
 * Total_Score = (S1 × W1 + S2 × W2 + S3 × W3 + S4 × W4) × V5
 */
function calculateTotalScore(S1, S2, S3, S4, V5) {
  const W1 = 0.20;  // 时机与天花板: 20%
  const W2 = 0.25;  // 产品与壁垒: 25%
  const W3 = 0.35;  // 资本效率与规模效应: 35%
  const W4 = 0.20;  // 团队基因: 20%

  const s1 = Number(S1) || 0;
  const s2 = Number(S2) || 0;
  const s3 = Number(S3) || 0;
  const s4 = Number(S4) || 0;
  const v5 = Number(V5);
  const safeV5 = isNaN(v5) ? 1 : Math.max(0, Math.min(1, v5));

  const baseScore = s1 * W1 + s2 * W2 + s3 * W3 + s4 * W4;
  const totalScore = baseScore * safeV5;

  return Math.min(100, Math.max(0, Math.round(totalScore)));
}

/**
 * 二维评级系统 (分数 × 风险)
 *
 * 基于总分和外部风险乘数的二维矩阵评级，提供语义通顺、严谨的结构化 VC 尽调行动建议。
 * 剔除一切可能由 LLM 幻觉产生的乱码短语。
 *
 * @param {number} totalScore - 加权总分 (0-100)
 * @param {number} riskMultiplier - 外部风险乘数 (0-1)
 * @returns {{ grade, label, action, color }}
 */
function getGrade(totalScore, riskMultiplier) {
  const score = Number(totalScore) || 0;
  const risk = Number(riskMultiplier);
  const safeRisk = isNaN(risk) ? 1 : risk;

  // 高风险标志：乘数 < 0.85 表示估值严重溢价或政策风险显著
  const highRisk = safeRisk < 0.85;

  if (score >= 85 && !highRisk) {
    return {
      grade: "A",
      label: "强烈推荐投资 (Fast Track)",
      action: "立刻推进：建议 24 小时内约见创始人，同步启动业务尽调（客户访谈、竞品验证）和财务尽调（审计底稿、银行流水），并行开始估值建模。优先关注收入确认方式与客户集中度。",
      color: "#10b981",
    };
  } else if (score >= 85 && highRisk) {
    // 分数高但风险高 → 降级为 B
    return {
      grade: "B",
      label: "有条件推荐 (Conditional Proceed)",
      action: "项目基本面优秀但存在估值溢价或政策合规风险。建议约见创始人深入沟通估值逻辑，要求提供经审计的财务数据和合规证明文件。在估值谈判取得实质进展前，暂缓出具投资意向书。",
      color: "#3b82f6",
    };
  } else if (score >= 70 && !highRisk) {
    return {
      grade: "B",
      label: "谨慎推荐 (Proceed with DD)",
      action: "安排创始人面谈，重点考察团队对行业周期的认知深度与战略定力。要求提供近 12 个月的月度财务明细，验证单位经济模型（LTV/CAC、毛利率、回款周期），同步启动竞品客户交叉验证。",
      color: "#3b82f6",
    };
  } else if (score >= 70 && highRisk) {
    return {
      grade: "C",
      label: "观望跟踪 (Keep In View)",
      action: "商业逻辑有一定吸引力但风险敞口较大。建议将项目纳入跟踪池，与投后团队协商安排一次轻度业务尽调（POC 验证或客户回访），关注下一季度的签约转化率和现金流变化，待风险因素明朗化后再评估。",
      color: "#f59e0b",
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

  // 第四维度: 团队基因（废除股权惩罚，仅看经验）
  const S4 = calculateDimension4_Team(data.Founder_Exp_Years);

  // 第五维度: 外部风险（乘数，软着陆折扣）
  const policyRisk = (data.Policy_Risk !== undefined && data.Policy_Risk !== null)
    ? data.Policy_Risk
    : 1;
  const V5 = calculateDimension5_ExternalRisk(policyRisk, data.Valuation_Gap);

  // 计算总分
  const totalScore = calculateTotalScore(S1, S2, S3, S4, V5);

  // 获取二维评级（分数 × 风险）
  const grading = getGrade(totalScore, V5);

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
        weight: 25,
        inputs: { TRL: data.TRL, Competitor_Rank_Score: data.Competitor_Rank_Score },
      },
      business_validation: {
        score: S3,
        label: "资本效率与规模效应",
        subtitle: "行业资本效率 + 行业规模效应",
        weight: 35,
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
        weight: 0, // 作为乘数，不是加权项
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
