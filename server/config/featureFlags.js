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

module.exports = {
  scoringHarnessMode,
};
