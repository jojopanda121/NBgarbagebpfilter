const { runWorkspaceMemoryGc } = require("../services/workspaceService");

function startWorkspaceGc() {
  const runOnce = () => {
    try {
      const result = runWorkspaceMemoryGc();
      if (result && result.artifactsDeleted) {
        console.log(`[Cleanup] 清理 ${result.artifactsDeleted} 个过期文件`);
      }
    } catch (err) {
      console.error("[Cleanup]", err.message);
    }
  };

  const startupTimer = setTimeout(runOnce, 60_000);
  const interval = setInterval(runOnce, 24 * 60 * 60 * 1000);

  return function stopWorkspaceGc() {
    clearTimeout(startupTimer);
    clearInterval(interval);
  };
}

module.exports = {
  startWorkspaceGc,
};
