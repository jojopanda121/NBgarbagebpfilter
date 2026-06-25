const config = require("./config");
const { createApp } = require("./app");
const { getModelName } = require("./services/llmService");
const { checkPythonDeps, bootDocServiceIfLocal } = require("./runtime/docService");
const {
  configureServerTimeouts,
  createGracefulShutdown,
  createShutdownState,
  startRuntimeServices,
} = require("./runtime/serverLifecycle");

const shutdownState = createShutdownState();

checkPythonDeps();

const docService = bootDocServiceIfLocal({ isShuttingDown: shutdownState.isShuttingDown });
const app = createApp({ getShutdownState: shutdownState.isShuttingDown });
const PORT = config.port;

const server = app.listen(PORT, () => {
  console.log(`\n  GarbageBPFilter v3.0 后端已启动: http://localhost:${PORT}`);
  console.log(`  模型: ${getModelName()}`);
  console.log(`  数据库: ${config.dbPath}`);
  console.log(`  环境: ${config.env}`);
  console.log("  通信模式: 异步任务轮询\n");
});

configureServerTimeouts(server);

const { stopWorkspaceGc } = startRuntimeServices();
const gracefulShutdown = createGracefulShutdown({
  server,
  docService,
  stopWorkspaceGc,
  shutdownState,
});

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  console.error("[FATAL] Unhandled Rejection:", err.stack || err.message);
  // 未处理的 Promise 拒绝意味着进程状态已不可信，按未捕获异常同等处理：
  // 优雅收尾后退出，交由 PM2/Docker 重启。仅记日志会留下僵尸进程慢性劣化。
  gracefulShutdown("unhandledRejection");
});

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught Exception:", err.stack || err.message);
  gracefulShutdown("uncaughtException");
});

module.exports = { isShuttingDown: shutdownState.isShuttingDown };
