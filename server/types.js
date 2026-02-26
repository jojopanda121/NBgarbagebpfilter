// ============================================================
// server/types.js — JSDoc 类型定义（核心数据结构）
// 供 IDE 智能提示和文档生成使用
// ============================================================

/**
 * 五维评分输入参数
 * @typedef {Object} ScoringInput
 * @property {number} TAM_Million_RMB - 市场规模（百万人民币）
 * @property {number} CAGR - 年复合增长率
 * @property {number} TRL - 技术成熟度等级 (1-9)
 * @property {number} Competitor_Rank_Score - 竞争力排名分 (1-10)
 * @property {number} Industry_Capital_Score - 行业资本活跃度 (1-10)
 * @property {number} Industry_Scale_Score - 行业规模分 (1-10)
 * @property {number} Founder_Exp_Years - 创始人经验年限
 * @property {number} Policy_Risk - 政策风险 (1-5)
 * @property {number} Valuation_Gap - 估值倍数偏差
 */

/**
 * 单项声明核查结论
 * @typedef {Object} ClaimVerdict
 * @property {string} category - 分类 (market/product/team/financial/other)
 * @property {string} original_claim - BP 中的原始声明
 * @property {string} [bp_claim] - BP 声明文本
 * @property {string} ai_research - AI 调研结论
 * @property {string} verdict - 核查结论 (属实/夸大/存疑/无法核实)
 * @property {string} diff - 差异描述
 * @property {string} severity - 严重程度 (严重/高/中/低)
 * @property {string} score_impact - 评分影响
 */

/**
 * 维度分析结果
 * @typedef {Object} DimensionAnalysis
 * @property {string} [finding] - 专家发现
 * @property {string} [bp_claim] - BP 中的声明
 * @property {string} [ai_finding] - AI 发现
 */

/**
 * 单维度评分结果
 * @typedef {Object} DimensionResult
 * @property {number} score - 该维度得分 (0-100)
 * @property {string} label - 标签
 * @property {string} subtitle - 副标题
 * @property {number} weight - 权重
 * @property {string} finding - 发现描述
 * @property {string} bp_claim - BP 声明
 * @property {string} ai_finding - AI 分析
 * @property {Object} inputs - 输入参数
 * @property {number} [multiplier] - 乘数（仅 external_risk）
 */

/**
 * 估值对比
 * @typedef {Object} ValuationComparison
 * @property {number} bp_multiple - BP 给出的倍数
 * @property {number} industry_avg_multiple - 行业平均倍数
 * @property {number} overvalued_pct - 高估百分比
 * @property {string} industry_name - 行业名称
 * @property {string} data_source - 数据来源
 * @property {string} analysis - 分析结论
 */

/**
 * 完整评估结果（前后端共用核心结构）
 * @typedef {Object} VerdictResult
 * @property {number} total_score - 总分 (0-100)
 * @property {string} grade - 等级代号 (A/B/C/D/F)
 * @property {string} grade_label - 等级标签
 * @property {string} grade_action - 建议行动
 * @property {string} grade_color - 等级颜色 (green/yellow/orange/red)
 * @property {string} verdict_summary - 一句话结论
 * @property {Object.<string, DimensionResult>} dimensions - 五维度评分明细
 * @property {string[]} risk_flags - 风险标记
 * @property {string[]} strengths - 优势
 * @property {string[]} conflicts - 矛盾点
 * @property {ClaimVerdict[]} claim_verdicts - 声明核查列表
 * @property {ValuationComparison} valuation_comparison - 估值对比
 */

/**
 * 分析流水线完整返回值
 * @typedef {Object} PipelineResult
 * @property {boolean} success - 是否成功
 * @property {number} elapsed_seconds - 耗时（秒）
 * @property {Object} extracted_data - Agent A 提取数据
 * @property {ScoringInput} validated_data - 评分输入
 * @property {string} industry - 行业
 * @property {string} thinking - 深度思考内容
 * @property {string} deep_research - 深度研究报告
 * @property {VerdictResult} verdict - 评估结果
 * @property {Object} search_summary - 搜索摘要
 */

module.exports = {};
