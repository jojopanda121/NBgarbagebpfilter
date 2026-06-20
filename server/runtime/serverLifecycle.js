const { closeDb } = require("../db");
const { startWorkspaceGc } = require("./workspaceGc");

const DEFAULT_HTTP_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_GRACEFUL_TIMEOUT_MS = 5 * 60 * 1000;

function createShutdownState() {
  let shuttingDown = false;

  return {
    isShuttingDown: () => shuttingDown,
    markShuttingDown: () => {
      if (shuttingDown) return false;
      shuttingDown = true;
      return true;
    },
  };
}

function configureServerTimeouts(server, timeoutMs = DEFAULT_HTTP_TIMEOUT_MS) {
  server.timeout = timeoutMs;
  server.requestTimeout = timeoutMs;
  server.keepAliveTimeout = timeoutMs + 1000;
}

function getGracefulShutdownTimeout(env = process.env) {
  const configured = parseInt(env.GRACEFUL_SHUTDOWN_TIMEOUT_MS, 10);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_GRACEFUL_TIMEOUT_MS;
}

function startRuntimeServices() {
  return {
    stopWorkspaceGc: startWorkspaceGc(),
  };
}

function cleanupAndExit({ code, docService, stopWorkspaceGc }) {
  try { stopWorkspaceGc(); } catch {}
  try { docService.stop(); } catch {}
  try { closeDb(); } catch {}
  process.exit(code);
}

function createGracefulShutdown({
  server,
  docService,
  stopWorkspaceGc,
  shutdownState,
  timeoutMs = getGracefulShutdownTimeout(),
}) {
  return function gracefulShutdown(signal) {
    if (!shutdownState.markShuttingDown()) return;

    console.log(`${signal} received, shutting down gracefully (timeout=${timeoutMs}ms)...`);

    // Stop new connections, then let paid LLM work finish where possible.
    server.close(() => {
      const inflightTasks = require("./inflightTasks");
      const pending = inflightTasks.count();
      if (pending === 0) {
        console.log("All connections closed, exiting...");
        return cleanupAndExit({ code: 0, docService, stopWorkspaceGc });
      }

      console.log(`等待 ${pending} 个在途分析任务收尾...`);
      inflightTasks.waitForDrain(timeoutMs - 10_000).then((drained) => {
        if (!drained) {
          console.warn(`仍有 ${inflightTasks.count()} 个任务未完成，由下次启动恢复退款`);
        }
        cleanupAndExit({ code: drained ? 0 : 1, docService, stopWorkspaceGc });
      });
    });

    setTimeout(() => {
      console.error(`Graceful shutdown timed out (${timeoutMs}ms), forcing exit...`);
      cleanupAndExit({ code: 1, docService, stopWorkspaceGc });
    }, timeoutMs).unref();
  };
}

module.exports = {
  configureServerTimeouts,
  createGracefulShutdown,
  createShutdownState,
  getGracefulShutdownTimeout,
  startRuntimeServices,
};
