// ============================================================
// server/runtime/inflightTasks.js — 进行中后台分析任务登记表
//
// analyzeController 启动后台分析时登记，结束（成功/失败）时注销。
// index.js 优雅关停时通过 waitForDrain 等待在途任务收尾，
// 避免部署/重启把跑到一半的分析直接腰斩（LLM 成本已花掉）。
// 等待超时后仍未完成的任务由下次启动的 recoverStaleTasks 标记失败并退款。
// ============================================================

const inflight = new Set();

function register(taskId) {
  inflight.add(taskId);
}

function unregister(taskId) {
  inflight.delete(taskId);
}

function count() {
  return inflight.size;
}

/**
 * 等待所有在途任务完成，最多等 timeoutMs。
 * @returns {Promise<boolean>} true=全部完成，false=超时仍有残留
 */
async function waitForDrain(timeoutMs, pollMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (inflight.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs).unref());
  }
  return inflight.size === 0;
}

module.exports = { register, unregister, count, waitForDrain };
