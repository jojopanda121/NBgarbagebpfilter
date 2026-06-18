// ============================================================
// server/config/versions.js — 分析管线版本号
//
// 任何会改变分析结果语义的变更都应 bump PIPELINE_VERSION，包括：
//   - prompts.js 中的提示词调整
//   - scoring.js / scoringHarness.js / scoringEvidence.js 公式或默认值变更
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
const PIPELINE_VERSION = "v4.6.0";

module.exports = { PIPELINE_VERSION };
