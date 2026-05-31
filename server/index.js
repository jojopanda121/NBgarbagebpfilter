const config = require("./config");
const { createApp } = require("./app");
const { closeDb } = require("./db");
const { getModelName } = require("./services/llmService");
const { checkPythonDeps, bootDocServiceIfLocal } = require("./runtime/docService");
const { startWorkspaceGc } = require("./runtime/workspaceGc");
const hermesHealth = require("./services/hermesHealth");
const { flags, useHermes } = require("./config/featureFlags");

let shuttingDown = false;

function isShuttingDown() {
  return shuttingDown;
}

checkPythonDeps();

const docService = bootDocServiceIfLocal({ isShuttingDown });
const app = createApp({ getShutdownState: isShuttingDown });
const PORT = config.port;

const server = app.listen(PORT, () => {
  console.log(`\n  GarbageBPFilter v3.0 后端已启动: http://localhost:${PORT}`);
  console.log(`  模型: ${getModelName()}`);
  console.log(`  数据库: ${config.dbPath}`);
  console.log(`  环境: ${config.env}`);
  console.log(`  Agent runtime: ${flags.agentRuntime} (Hermes ${flags.hermesEnabled ? "enabled" : "disabled"}, fallback ${flags.hermesFallbackToLegacy ? "on" : "off"})`);
  if (useHermes()) {
    console.log(`  Hermes endpoint: ${flags.hermesBaseUrl}`);
  }
  console.log("  通信模式: 异步任务轮询\n");
});

// Hermes 后台心跳（仅在启用时）
if (flags.hermesEnabled) {
  hermesHealth.start();
}

const HTTP_TIMEOUT = 2 * 60 * 1000;
server.timeout = HTTP_TIMEOUT;
server.requestTimeout = HTTP_TIMEOUT;
server.keepAliveTimeout = HTTP_TIMEOUT + 1000;

const stopWorkspaceGc = startWorkspaceGc();
const GRACEFUL_TIMEOUT_MS = parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS, 10) || 5 * 60 * 1000;

function cleanupAndExit(code) {
  try { stopWorkspaceGc(); } catch {}
  try { hermesHealth.stop(); } catch {}
  try { docService.stop(); } catch {}
  try { closeDb(); } catch {}
  process.exit(code);
}

function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`${signal} received, shutting down gracefully (timeout=${GRACEFUL_TIMEOUT_MS}ms)...`);
  server.close(() => {
    console.log("All connections closed, exiting...");
    cleanupAndExit(0);
  });

  setTimeout(() => {
    console.error(`Graceful shutdown timed out (${GRACEFUL_TIMEOUT_MS}ms), forcing exit...`);
    cleanupAndExit(1);
  }, GRACEFUL_TIMEOUT_MS).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  console.error("[FATAL] Unhandled Rejection:", err.stack || err.message);
});

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught Exception:", err.stack || err.message);
  gracefulShutdown("uncaughtException");
});

module.exports = { isShuttingDown };
