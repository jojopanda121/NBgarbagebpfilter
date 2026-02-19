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
 * 
 * 开发参数建议: w_a 和 w_b 是调节系数
 * 例如, 设定 TAM 达到 100 亿且 CAGR 达到 30% 时, 该项无限接近满分 100
 */
function calculateDimension1_TimingAndCeiling(TAM, CAGR) {
  // 调节系数 (可根据实际情况调整)
  const w_a = 20;  // TAM 权重系数
  const w_b = 2;   // CAGR 权重系数
  
  // 为了防止创始人对 TAM 无脑注水, 工程师应在此处使用对数函数 (Log) 进行压制平滑
  const score = w_a * Math.log10(TAM + 1) + w_b * CAGR;
  
  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * 计算模块2: 产品与壁垒 (S2, 权重 25%)
 * 合并: 技术可行性 + 竞争壁垒
 * 
 * 输入变量:
 * - TRL: 技术就绪水平 (Technology Readiness Level, 1-9级, 9为可量产)
 * - SC: 客户转换成本评分 (Switching Cost, 由AI抓取行业常识打分, 0-100)
 * 
 * 计算公式:
 * S2 = 0.4 * (TRL / 9 * 100) + 0.6 * SC
 * 
 * 开发提示: TRL 是一个强客观指标
 * 如果 BP 只是停留在"PPT 阶段" (TRL ≤ 3), 则产品项得分将被死死压在极低水平
 */
function calculateDimension2_ProductAndMoat(TRL, SC) {
  const score = 0.4 * (TRL / 9 * 100) + 0.6 * SC;
  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * 计算模块3: 商业验证与效率 (S3, 权重 35%)
 * 合并: 商业模式 + 用户增长/留存 + 财务健康度
 * 
 * 核心指标是 LTV/CAC
 * 这是防范"第二类错误 (取伪)"的核心。哪怕是没有收入的早期项目,
 * 其预期的单位经济模型 (UE) 也必须跑通。
 * 
 * 输入变量:
 * - Ratio: LTV 与 CAC 的比值
 * - Margin: 毛利率 (%)
 * 
 * 计算公式:
 * 这里需要设定分段函数 (Piecewise function)
 * 一级市场的共识是: LTV/CAC 小于 1 是做慈善, 大于 3 才是好生意
 * 
 * f(Ratio) = {
 *   0                      if Ratio ≤ 1
 *   50 * (Ratio - 1)       if 1 < Ratio < 3
 *   100                    if Ratio ≥ 3
 * }
 * 
 * S3 = 0.7 * f(Ratio) + 0.3 * min(100, Margin * 100)
 * 
 * 开发提示: 如果 BP 缺乏数据, AI 应该自动检索该行业的"平均获客成本"和"客单价"代入计算,
 * 拆穿 BP 的水分
 */
function calculateDimension3_BusinessValidation(Ratio, Margin) {
  let f_ratio = 0;
  if (Ratio <= 1) {
    f_ratio = 0;
  } else if (Ratio > 1 && Ratio < 3) {
    f_ratio = 50 * (Ratio - 1);
  } else {
    f_ratio = 100;
  }
  
  const score = 0.7 * f_ratio + 0.3 * Math.min(100, Margin * 100);
  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * 计算模块4: 团队基因 (S4, 权重 20%)
 * 保留: 团队匹配度
 * 
 * 客观依据: 评估"人"与"事"的契合度, 同时对不良股权结构进行扣分
 * 
 * 输入变量:
 * - Exp: 核心创始人行业相关经验 (年)
 * - Equity: 最大股东持股比例 (%)
 * 
 * 计算公式:
 * S4 = min(100, Exp * 10) - Penalty(Equity)
 * 
 * 股权惩罚函数 Penalty:
 * 早期项目如果大股东持股不足 50%, 或者多人均分 (如 33/33/33),
 * 会穿越后续融资锁死。
 * 
 * Penalty(Equity) = {
 *   50     if Equity < 30%
 *   20     if 30% ≤ Equity < 50%
 *   0      if Equity ≥ 50%
 * }
 */
function calculateDimension4_Team(Exp, Equity) {
  let penalty = 0;
  if (Equity < 30) {
    penalty = 50;
  } else if (Equity >= 30 && Equity < 50) {
    penalty = 20;
  }
  
  const score = Math.min(100, Exp * 10) - penalty;
  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * 计算模块5: 外部风险与交易条件 (作为乘数 V5)
 * 合并: 政策/监管风险 + 估值合理性
 * 
 * 客观依据: 政策封杀或估值荒谬, 是"一票否决"项
 * 
 * 输入变量:
 * - Policy_Risk: AI 判定的政策违规风险等级 (0 为极高风险, 1 为无风险)
 * - Valuation_Gap: BP 叫价与行业可比公司中位数的溢价倍数
 * 
 * 计算公式:
 * V5 = Policy_Risk × Discount(Valuation_Gap)
 * 
 * Discount(x) = {
 *   1.0     if x ≤ 1.5 (溢价在合理范围内)
 *   0.5     if 1.5 < x < 3 (估值过高, 需重度砍价)
 *   0       if x ≥ 3 (离谱叫价, 直接否决)
 * }
 */
function calculateDimension5_ExternalRisk(Policy_Risk, Valuation_Gap) {
  let discount = 1.0;
  if (Valuation_Gap > 1.5 && Valuation_Gap < 3) {
    discount = 0.5;
  } else if (Valuation_Gap >= 3) {
    discount = 0;
  }
  
  const V5 = Policy_Risk * discount;
  return V5;
}

/**
 * 评分系统总体架构设计
 * 
 * 系统的最终总分 (Total_Score) 不是简单的五项相加,
 * 而是采取"基础得分 × 否决系数"的形式。
 * 
 * Total_Score = (Σ S_i * W_i) × V_5
 * 
 * - S_i: 第 i 个模块的得分 (0-100分)
 * - W_i: 第 i 个模块的权重百分比
 * - V_5: 模块五 (风险与交易条件) 的否决系数 (取值为 0 或 1, 或者一个惩罚折扣率)
 */
function calculateTotalScore(S1, S2, S3, S4, V5) {
  const W1 = 0.20;  // 时机与天花板: 20%
  const W2 = 0.25;  // 产品与壁垒: 25%
  const W3 = 0.35;  // 商业验证与效率: 35%
  const W4 = 0.20;  // 团队基因: 20%
  
  const baseScore = (S1 * W1 + S2 * W2 + S3 * W3 + S4 * W4);
  const totalScore = baseScore * V5;
  
  return Math.min(100, Math.max(0, Math.round(totalScore)));
}

/**
 * 评级标准 (参考最后一张截图)
 */
function getGrade(totalScore) {
  if (totalScore >= 85) {
    return { grade: "A", label: "推荐投资 (Fast Track)", action: "立刻推进：24小时内约见创始人，启动业务尽调和财务尽调，开始建模", color: "#10b981" };
  } else if (totalScore >= 75) {
    return { grade: "B", label: "谨慎推荐 (Proceed with DD)", action: "空甲拟议：安排面聊，核心考察团队对短期的认知，在财务数据中申请行权测试，并始佑价。", color: "#3b82f6" };
  } else if (totalScore >= 60) {
    return { grade: "C", label: "可以跟进 (Keep In View)", action: "早期留金 or 平台生高：商业逻辑穿透没准，但缺乏数据验证。建议盒金 VP 梳理 POC，关注签约，再评估天花板价值量，支支评估。", color: "#f59e0b" };
  } else {
    return { grade: "D", label: "建议放弃 (Reject / Archive)", action: "结构性死亡：伪需求，烧钱无底洞 (LTV<CAC)，股权结构混乱，严重高估，严重低估处于1万期初的人工时间。", color: "#ef4444" };
  }
}

/**
 * 主评分函数
 * 输入: 从 BP 和搜索结果中提取的原始数据
 * 输出: 5个维度的得分 + 总分 + 评级
 */
function scoreProject(data) {
  // 第一维度: 时机与天花板
  const S1 = calculateDimension1_TimingAndCeiling(data.TAM || 0, data.CAGR || 0);
  
  // 第二维度: 产品与壁垒
  const S2 = calculateDimension2_ProductAndMoat(data.TRL || 1, data.SC || 0);
  
  // 第三维度: 商业验证与效率
  const S3 = calculateDimension3_BusinessValidation(data.Ratio || 0, data.Margin || 0);
  
  // 第四维度: 团队基因
  const S4 = calculateDimension4_Team(data.Exp || 0, data.Equity || 0);
  
  // 第五维度: 外部风险与交易条件 (乘数)
  const V5 = calculateDimension5_ExternalRisk(data.Policy_Risk || 1, data.Valuation_Gap || 1);
  
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
        label: "商业验证与效率",
        subtitle: "商业模式 + 增长 + 财务",
        weight: 35,
        inputs: { Ratio: data.Ratio, Margin: data.Margin },
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
  calculateDimension3_BusinessValidation,
  calculateDimension4_Team,
  calculateDimension5_ExternalRisk,
  calculateTotalScore,
  getGrade,
};
