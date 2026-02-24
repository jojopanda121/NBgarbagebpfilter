// ============================================================
// scoring.js — 5维度评分系统
// 基于投资机构的标准化评分框架
// ============================================================

/**
 * 计算模块1: 时机与天花板 (S1, 权重 20%)
 * 合并: 市场规模 + 入场时机
 *
 * 输入变量:
 * - TAM: 目标可触达市场规模 (单位: 十亿人民币或亿美元)
 * - CAGR: 行业预期年复合增长率 (%)
 *
 * 计算公式:
 * S1 = min[100, (w_a * log10(TAM + 1) + w_b * CAGR)]
 */
function calculateDimension1_TimingAndCeiling(TAM, CAGR) {
  const w_a = 20;
  const w_b = 2;

  const safeTAM = Number(TAM);
  const safeCGAR = Number(CAGR);
  const tamVal = isNaN(safeTAM) ? 0 : Math.max(0, safeTAM);
  const cgrVal = isNaN(safeCGAR) ? 0 : safeCGAR;

  const score = w_a * Math.log10(tamVal + 1) + w_b * cgrVal;
  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * 计算模块2: 产品与壁垒 (S2, 权重 25%)
 * 合并: 技术可行性 + 竞争壁垒
 *
 * 输入变量:
 * - TRL: 技术就绪水平 (Technology Readiness Level, 1-9级, 9为可量产)
 * - SC: 客户转换成本评分 (Switching Cost, 由AI打分, 0-100)
 *
 * 修改(Req 5): 软化早期项目惩罚
 * - TRL >= 4（原型/小试阶段及以上）保证TRL分不低于50，避免误杀早期项目
 * - TRL 1-3 仍有惩罚但保留最低30，不至于完全归零
 * - SC 数据缺失时使用行业中性分50，而非0
 */
function calculateDimension2_ProductAndMoat(TRL, SC) {
  const safeTRL = Number(TRL);
  const trlVal = isNaN(safeTRL) ? 1 : Math.max(1, Math.min(9, safeTRL));

  const safeSC = Number(SC);
  // 数据缺失时使用行业中性分50，而非0
  const scVal = isNaN(safeSC) || SC === null || SC === undefined
    ? 50
    : Math.max(0, Math.min(100, safeSC));

  const rawTrlScore = (trlVal / 9) * 100;
  // 早期项目保护：TRL>=4（原型/小试阶段及以上）保证最低TRL分=50
  const trlScore = trlVal >= 4
    ? Math.max(50, rawTrlScore)
    : Math.max(30, rawTrlScore);

  const score = 0.4 * trlScore + 0.6 * scVal;
  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * 计算模块3: 资本效率与规模效应 (S3, 权重 35%)
 * 重构(Req 6): 取代原"商业验证与效率"（LTV/CAC模型）
 *
 * 核心逻辑: 判断一个商业模式是否具备"越跑越轻"的内在特征
 *
 * 输入变量:
 * - Capital_Efficiency: 资本效率评分，由 Agent B 给出 (1-10分)
 *   - [10-8] 极高(负营运资本): 客户预付资金扩张，不依赖融资内生增长
 *   - [7-5]  中等(合理投入): LTV/CAC在3-5x，周转健康
 *   - [4-1]  极低(资本绞肉机): 增长依赖垫资堆人，停止输血即休克
 * - Scale_Effect: 规模效应评分，由 Agent B 给出 (1-10分)
 *   - [10-8] 赢家通吃: 双边网络效应或绝对规模经济
 *   - [7-5]  强者恒强: 单边网络效应、数据飞轮、品牌壁垒
 *   - [4-1]  规模不经济: 收入与人力/履约成本呈线性关系
 *
 * 公式: S3 = Capital_Efficiency * 5 + Scale_Effect * 5
 *
 * 缺失数据处理(Req 5): 数据缺失时默认5.5（中立基准），防止总分雪崩
 */
function calculateDimension3_CapitalEfficiencyAndScale(Capital_Efficiency, Scale_Effect) {
  const ce = Number(Capital_Efficiency);
  const se = Number(Scale_Effect);

  // 数据缺失时采用行业中立基准分5.5（满分10分的55%）
  const safeCE = (!isNaN(ce) && ce >= 1 && ce <= 10) ? ce : 5.5;
  const safeSE = (!isNaN(se) && se >= 1 && se <= 10) ? se : 5.5;

  const score = safeCE * 5 + safeSE * 5;
  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * 计算模块4: 团队基因 (S4, 权重 20%)
 * 保留: 团队匹配度
 *
 * 输入变量:
 * - Exp: 核心创始人行业相关经验 (年)
 * - Equity: 最大股东持股比例 (%)
 *
 * 计算公式:
 * S4 = min(100, Exp * 10) - Penalty(Equity)
 */
function calculateDimension4_Team(Exp, Equity) {
  const safeExp = Number(Exp);
  const safeEquity = Number(Equity);

  const expVal = isNaN(safeExp) ? 0 : Math.max(0, safeExp);
  const equityVal = isNaN(safeEquity) ? 50 : Math.max(0, Math.min(100, safeEquity));

  let penalty = 0;
  if (equityVal < 30) {
    penalty = 50;
  } else if (equityVal >= 30 && equityVal < 50) {
    penalty = 20;
  }

  const score = Math.min(100, expVal * 10) - penalty;
  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * 计算模块5: 外部风险与交易条件 (作为乘数 V5)
 * 合并: 政策/监管风险 + 估值合理性
 *
 * 修改(Req 5): 取消"直接归零"逻辑，改为平滑降权
 * - Gap <= 1:            V5_discount = 1.0（无估值泡沫，不降权）
 * - 1 < Gap <= 3:        V5_discount = 0.8（中度泡沫，打8折）
 * - Gap > 3:             V5_discount = 0.5（严重高估，打5折，保留底分，不判死刑）
 * - 无估值数据/未披露:   V5_discount = 1.0（无罪推定原则，不予惩罚）
 *
 * 输入变量:
 * - Policy_Risk: AI 判定的政策违规风险等级 (0 为极高风险, 1 为无风险)
 * - Valuation_Gap: BP 叫价与行业可比公司中位数的溢价倍数
 */
function calculateDimension5_ExternalRisk(Policy_Risk, Valuation_Gap) {
  const risk = Number(Policy_Risk);
  const safeRisk = isNaN(risk) ? 1 : Math.max(0, Math.min(1, risk));

  const gap = Number(Valuation_Gap);

  // 无估值数据时无罪推定，不予惩罚
  let discount;
  if (Valuation_Gap === null || Valuation_Gap === undefined || isNaN(gap) || gap <= 0) {
    discount = 1.0;
  } else if (gap <= 1) {
    discount = 1.0;
  } else if (gap <= 3) {
    discount = 0.8;
  } else {
    discount = 0.5;
  }

  return safeRisk * discount;
}

/**
 * 评分系统总体架构设计
 *
 * Total_Score = (Σ S_i * W_i) × V_5
 *
 * 修改(Req 5): 严格使用 Number() 转换，NaN/null/undefined 时有 Fallback 逻辑
 */
function calculateTotalScore(S1, S2, S3, S4, V5) {
  const W1 = 0.20;  // 时机与天花板: 20%
  const W2 = 0.25;  // 产品与壁垒: 25%
  const W3 = 0.35;  // 资本效率与规模效应: 35%
  const W4 = 0.20;  // 团队基因: 20%

  // 严格使用 Number() 转换，NaN 时 fallback 为 0
  const s1 = Number(S1) || 0;
  const s2 = Number(S2) || 0;
  const s3 = Number(S3) || 0;
  const s4 = Number(S4) || 0;
  const v5 = Number(V5);
  const safeV5 = isNaN(v5) ? 1 : v5;

  const baseScore = s1 * W1 + s2 * W2 + s3 * W3 + s4 * W4;
  const totalScore = baseScore * safeV5;

  return Math.min(100, Math.max(0, Math.round(totalScore)));
}

/**
 * 评级标准
 */
function getGrade(totalScore) {
  if (totalScore >= 85) {
    return { grade: "A", label: "推荐投资 (Fast Track)", action: "立刻推进：24小时内约见创始人，启动业务尽调和财务尽调，开始建模", color: "#10b981" };
  } else if (totalScore >= 75) {
    return { grade: "B", label: "谨慎推荐 (Proceed with DD)", action: "空甲拟议：安排面聊，核心考察团队对短期的认知，在财务数据中申请行权测试，并始佑价。", color: "#3b82f6" };
  } else if (totalScore >= 60) {
    return { grade: "C", label: "可以跟进 (Keep In View)", action: "早期留金 or 平台生高：商业逻辑穿透没准，但缺乏数据验证。建议盒金 VP 梳理 POC，关注签约，再评估天花板价值量，支支评估。", color: "#f59e0b" };
  } else {
    return { grade: "D", label: "建议放弃 (Reject / Archive)", action: "项目风险过高：商业模式未经验证，市场天花板受限或竞争壁垒不足。建议暂停推进，除非创始人有重大战略调整或新数据验证。", color: "#ef4444" };
  }
}

/**
 * 主评分函数
 * 输入: 从 Agent B 验证后的结构化数据
 * 输出: 5个维度的得分 + 总分 + 评级
 */
function scoreProject(data) {
  // 第一维度: 时机与天花板
  const S1 = calculateDimension1_TimingAndCeiling(data.TAM, data.CAGR);

  // 第二维度: 产品与壁垒（含早期项目保护）
  const S2 = calculateDimension2_ProductAndMoat(data.TRL, data.SC);

  // 第三维度: 资本效率与规模效应（Req 6 重构）
  const S3 = calculateDimension3_CapitalEfficiencyAndScale(
    data.Capital_Efficiency,
    data.Scale_Effect
  );

  // 第四维度: 团队基因
  const S4 = calculateDimension4_Team(data.Exp, data.Equity);

  // 第五维度: 外部风险与交易条件（乘数，含平滑降权）
  // Policy_Risk 缺失时默认1（无明显政策风险）
  const policyRisk = (data.Policy_Risk !== undefined && data.Policy_Risk !== null)
    ? data.Policy_Risk
    : 1;
  const V5 = calculateDimension5_ExternalRisk(policyRisk, data.Valuation_Gap);

  // 计算总分
  const totalScore = calculateTotalScore(S1, S2, S3, S4, V5);

  // 获取评级
  const grading = getGrade(totalScore);

  return {
    dimensions: {
      timing_ceiling: {
        score: S1,
        label: "时机与天花板",
        subtitle: "市场规模 + 入场时机",
        weight: 20,
        inputs: { TAM: data.TAM, CAGR: data.CAGR },
      },
      product_moat: {
        score: S2,
        label: "产品与壁垒",
        subtitle: "技术可行性 + 竞争壁垒",
        weight: 25,
        inputs: { TRL: data.TRL, SC: data.SC },
      },
      business_validation: {
        score: S3,
        label: "资本效率与规模效应",
        subtitle: "资本效率 + 规模效应",
        weight: 35,
        inputs: { Capital_Efficiency: data.Capital_Efficiency, Scale_Effect: data.Scale_Effect },
      },
      team: {
        score: S4,
        label: "团队基因",
        subtitle: "团队匹配度 + 股权结构",
        weight: 20,
        inputs: { Exp: data.Exp, Equity: data.Equity },
      },
      external_risk: {
        score: Math.round(V5 * 100),
        label: "外部风险与交易条件",
        subtitle: "政策风险 + 估值合理性",
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
