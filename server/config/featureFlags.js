// ============================================================
// server/config/featureFlags.js
//
// Hermes-first Runtime with Legacy Backup —— 统一读取运行时开关。
//
// 所有 Hermes 相关环境变量都从这里读，避免代码到处 process.env 散落。
// ============================================================

function bool(name, defaultValue) {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultValue;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "on";
}

function int(name, defaultValue) {
  const v = process.env[name];
  if (v === undefined || v === "") return defaultValue;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : defaultValue;
}

function str(name, defaultValue) {
  const v = process.env[name];
  return v === undefined || v === "" ? defaultValue : v;
}

const flags = {
  // Runtime 主开关
  // 默认 legacy + disabled，因为 hermes 端点是可选的运维资源。
  // 生产 .env 显式 opt-in：AGENT_RUNTIME=hermes / HERMES_ENABLED=1 / 配上 HERMES_BASE_URL+HERMES_API_KEY。
  agentRuntime: str("AGENT_RUNTIME", "legacy"),         // 'hermes' | 'legacy'
  hermesEnabled: bool("HERMES_ENABLED", false),
  hermesFallbackToLegacy: bool("HERMES_FALLBACK_TO_LEGACY", true),

  // Hermes 接入
  hermesBaseUrl: str("HERMES_BASE_URL", "http://127.0.0.1:8642"),
  hermesApiKey: str("HERMES_API_KEY", ""),
  hermesModel: str("HERMES_MODEL", "hermes-agent"),
  hermesTimeoutMs: int("HERMES_TIMEOUT_MS", 120000),
  hermesStreaming: bool("HERMES_STREAMING", true),

  // Healthcheck
  hermesHealthCheckIntervalMs: int("HERMES_HEALTH_CHECK_INTERVAL_MS", 30000),
  hermesHealthCacheMs: int("HERMES_HEALTH_CACHE_MS", 10000),

  // 学习闭环（MVP 默认关）
  hermesSharedLearning: bool("HERMES_SHARED_LEARNING", false),
};

// S2「产品与壁垒」harness 灰度开关（动态读取 env，便于灰度/测试切换）：
//   off    —— 完全走旧 TRL/Rank 裸分
//   shadow —— 旧分仍然生效，但同时算出 harness 分并附在 scoring_shadow 供对照（默认）
//   on     —— harness 分正式生效，替换旧 S2 并把 TRL gap 计入 S5 诚信度
function scoringHarnessMode() {
  const v = (process.env.SCORING_HARNESS || "shadow").toLowerCase();
  return ["off", "shadow", "on"].includes(v) ? v : "shadow";
}

function useHermes() {
  return flags.hermesEnabled && flags.agentRuntime === "hermes";
}

function canFallback() {
  return flags.hermesFallbackToLegacy;
}

module.exports = {
  flags,
  useHermes,
  canFallback,
  scoringHarnessMode,
};
