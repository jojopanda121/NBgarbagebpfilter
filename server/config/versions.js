// ============================================================
// server/config/versions.js — 分析管线版本号
//
// 任何会改变分析结果语义的变更都应 bump PIPELINE_VERSION，包括：
//   - prompts.js 中的提示词调整
//   - scoring.js / scoringHarness.js 公式或默认值变更
//   - SCORING_HARNESS 默认模式切换（off/shadow/on）
//   - multiagent 输出结构变更
//   - 主力模型更换
//
// 该版本号写入每份分析结果（result.pipeline_version），
// 相同文件的缓存复用仅在版本一致时命中——版本升级后旧结果不再复用，
// 用户重新分析会按新逻辑重跑（正常消耗额度）。
// ============================================================

// v4.5.0: S5 反稀释重构（materiality 分组 + Integrity Veto 一票否决）、
//         关键声明核查接入真实联网检索、BP 原文不可信边界（注入防线）、
//         estimated 推断值打折、scoring_shadow 落库、降级报告显式警告。
// v4.6.0: S3 资本壁垒 harness（scoringS3Harness.js，默认 shadow，对照块 scoring_s3_shadow）——
//         资本壁垒溢价 / 新质生产力 / 成本曲线陡峭度 / 资本耐心，修复硬科技重资产偏见。
// v4.7.0: 投资判断内核 v3 —— 非线性聚合（方案乙：赛道加权+卓越加成+A级共振 gate）
//         替代五维算术平均（修复 70-78 天花板）；政策融入 S1/S3（不设独立维度，
//         scoringPolicy.js）；总分以分布呈现（中位+区间+置信度）+敏感性+triggered_rules。
//         默认 shadow（开关 SCORING_AGG），对照块 scoring_agg_shadow。
//         附带修复：_toScoringInput 漏传 S3_Rubric/Capital_Archetype/Scale_Mechanism。
// v4.8.0: 诚信一票否决（Integrity Veto）彻底移除——证伪/夸大只按计分表计入 S5 均值
//         拉低诚信维度，不再硬封顶分数或强制改评级（LLM 对重大类别尤其财务易误判，
//         否决误伤面太大）；multiagent 六专家深度尽调改为按需生成（multiagentService），
//         分析阶段不再自动跑、投研结论不再喂评分/估值对比。语义变更 → bump 作废旧缓存。
// v4.9.0: 主力模型切换到 DeepSeek V4（此前 b8df8e6 换了模型但漏了 bump，
//         导致 MiniMax 时代的旧结果仍被当作有效缓存复用）；
//         BP_Valuation / BP_Revenue 语义收紧——未披露必须为 null，禁止倒推，
//         估值倍数与溢价在缺自述数字时不再计算（AGENT_A_PROMPT + buildValuationComparison）；
//         多模型支持：厂商可插拔 + 用户自带 API Key（BYOK），
//         结果缓存改为按 (文件, 管线版本, 厂商/模型) 三元组复用。
const PIPELINE_VERSION = "v4.9.0";

module.exports = { PIPELINE_VERSION };
