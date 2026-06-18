// ============================================================
// server/config/featureFlags.js
//
// 运行时灰度开关统一读取，避免代码到处 process.env 散落。
// ============================================================

// S2「产品与壁垒」harness 灰度开关（动态读取 env，便于灰度/测试切换）：
//   off    —— 完全走旧 TRL/Rank 裸分
//   shadow —— 旧分仍然生效，但同时算出 harness 分并附在 scoring_shadow 供对照（默认）
//   on     —— harness 分正式生效，替换旧 S2 并把 TRL gap 计入 S5 诚信度
function scoringHarnessMode() {
  const v = (process.env.SCORING_HARNESS || "shadow").toLowerCase();
  return ["off", "shadow", "on"].includes(v) ? v : "shadow";
}

// S3「资本效率与规模效应」harness 灰度开关（独立于 S2）：
//   off    —— 完全走旧 资本效率分×5 + 规模效应分×5 + 毛利±1
//   shadow —— 旧分仍生效，但同时算出新版 S3 并附在 scoring_s3_shadow 供对照（默认）
//   on     —— 新版 S3（CBP/新质生产力/陡峭度/资本耐心）正式生效，替换旧 S3
function scoringS3HarnessMode() {
  const v = (process.env.SCORING_S3_HARNESS || "shadow").toLowerCase();
  return ["off", "shadow", "on"].includes(v) ? v : "shadow";
}

module.exports = {
  scoringHarnessMode,
  scoringS3HarnessMode,
};
