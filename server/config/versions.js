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

const PIPELINE_VERSION = "v4.4.0";

module.exports = { PIPELINE_VERSION };
