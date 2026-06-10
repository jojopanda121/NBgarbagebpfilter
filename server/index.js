const config = require("./config");
const { createApp } = require("./app");
const { closeDb } = require("./db");
const { getModelName } = require("./services/llmService");
const { checkPythonDeps, bootDocServiceIfLocal } = require("./runtime/docService");
const { startWorkspaceGc } = require("./runtime/workspaceGc");

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
  console.log("  通信模式: 异步任务轮询\n");
});

const HTTP_TIMEOUT = 2 * 60 * 1000;
server.timeout = HTTP_TIMEOUT;
server.requestTimeout = HTTP_TIMEOUT;
server.keepAliveTimeout = HTTP_TIMEOUT + 1000;

const stopWorkspaceGc = startWorkspaceGc();
const GRACEFUL_TIMEOUT_MS = parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS, 10) || 5 * 60 * 1000;

function cleanupAndExit(code) {
  try { stopWorkspaceGc(); } catch {}
  try { docService.stop(); } catch {}
  try { closeDb(); } catch {}
  process.exit(code);
}

function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`${signal} received, shutting down gracefully (timeout=${GRACEFUL_TIMEOUT_MS}ms)...`);

  // 1. 停止接收新连接；2. 等待在途后台分析收尾（LLM 成本已花，
  //    腰斩=用户看到失败+平台白付钱）；3. 超时则放弃，由下次启动的
  //    recoverStaleTasks 标记失败并退款。
  server.close(() => {
    const inflightTasks = require("./runtime/inflightTasks");
    const pending = inflightTasks.count();
    if (pending === 0) {
      console.log("All connections closed, exiting...");
      return cleanupAndExit(0);
    }
    console.log(`等待 ${pending} 个在途分析任务收尾...`);
    inflightTasks.waitForDrain(GRACEFUL_TIMEOUT_MS - 10_000).then((drained) => {
      if (!drained) {
        console.warn(`仍有 ${inflightTasks.count()} 个任务未完成，由下次启动恢复退款`);
      }
      cleanupAndExit(drained ? 0 : 1);
    });
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
  // 未处理的 Promise 拒绝意味着进程状态已不可信，按未捕获异常同等处理：
  // 优雅收尾后退出，交由 PM2/Docker 重启。仅记日志会留下僵尸进程慢性劣化。
  gracefulShutdown("unhandledRejection");
});

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught Exception:", err.stack || err.message);
  gracefulShutdown("uncaughtException");
});

module.exports = { isShuttingDown };
