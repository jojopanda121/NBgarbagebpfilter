// ============================================================
// server/services/analysisQueue.js — 分析任务全局并发闸 + 排队位次
//
// 根因：/api/analyze 过去一收到上传就立刻在后台跑 runPipeline，没有任何全局
// 并发上限。同一时刻 N 个用户 = 几十上百并发 LLM 请求砸向 MiniMax → 必然 429。
//
// 本模块用 p-limit 把"同时进行的分析数"卡到 ANALYSIS_MAX_CONCURRENCY（默认 2），
// 多出来的自动 FIFO 排队；ticker 周期性把每个排队任务的位次写进 task.message，
// 前端轮询即可显示"使用高峰，排队中（前方还有 N 位）"。
// ============================================================

const pLimit = require("p-limit");
const config = require("../config");
const { updateTask } = require("./taskService");

const MAX_CONCURRENCY = config.analysisMaxConcurrency;
const MAX_QUEUE = config.analysisMaxQueue;
const MAX_QUEUE_WAIT_MS = config.analysisMaxQueueWaitMs;
const TICK_MS = 3000;

let limiter = pLimit(Math.max(1, MAX_CONCURRENCY));

// taskId → { enqueuedAt, cancelled, onTimeout }
// 仅含"尚未拿到执行槽"的任务；拿到槽即从此移除，故位次只反映真实等待中的任务。
const waiting = new Map();

function queuedMessage(ahead) {
  if (ahead <= 0) {
    return "当前正值使用高峰，您已排到队首，服务空闲后将立即开始分析，请耐心等待，无需重复上传。";
  }
  return `当前正值使用高峰，您的分析正在排队（前方还有 ${ahead} 位），服务空闲后将自动开始，请耐心等待，无需重复上传。`;
}

let ticker = null;
function ensureTicker() {
  if (ticker) return;
  ticker = setInterval(tick, TICK_MS);
  if (typeof ticker.unref === "function") ticker.unref();
}

function tick() {
  if (waiting.size === 0) {
    clearInterval(ticker);
    ticker = null;
    return;
  }
  const now = Date.now();
  let ahead = 0;
  for (const [taskId, entry] of waiting) {
    if (entry.cancelled) continue;
    // 排队超时：放弃等待，交回调用方收尾（标失败 + 退额度）
    if (now - entry.enqueuedAt > MAX_QUEUE_WAIT_MS) {
      entry.cancelled = true;
      try {
        if (typeof entry.onTimeout === "function") entry.onTimeout(taskId);
      } catch (err) {
        console.warn(`[AnalysisQueue] onTimeout 回调异常 (${taskId}):`, err.message);
      }
      continue;
    }
    try {
      updateTask(taskId, { stage: "queued", message: queuedMessage(ahead) });
    } catch (_) { /* updateTask 内部已容错 */ }
    ahead += 1;
  }
}

/**
 * 是否应在准入阶段直接拒绝（队列过满）。
 * @returns {boolean}
 */
function isQueueFull() {
  return waiting.size >= MAX_QUEUE;
}

function depth() {
  return waiting.size;
}

/**
 * 提交一个分析任务到全局并发闸。
 * @param {string} taskId
 * @param {() => Promise<void>} runJob  真正的分析闭包（拿到执行槽后调用）
 * @param {{ onTimeout?: (taskId:string)=>void }} [opts] 排队超时回调（标失败/退额度由调用方实现）
 * @returns {Promise<void>} job 完成（或被取消）后 resolve
 */
function submit(taskId, runJob, opts = {}) {
  const entry = { enqueuedAt: Date.now(), cancelled: false, onTimeout: opts.onTimeout };
  waiting.set(taskId, entry);
  ensureTicker();

  return limiter(async () => {
    const e = waiting.get(taskId);
    waiting.delete(taskId);
    // 排队期间已超时被取消：收尾已由 onTimeout 完成，这里直接跳过，避免浪费 LLM
    if (e && e.cancelled) return;
    await runJob();
  });
}

// 测试辅助：清空排队 + 重建 limiter（丢弃残留的 active/pending）+ 停 ticker
function _reset() {
  waiting.clear();
  limiter = pLimit(Math.max(1, MAX_CONCURRENCY));
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

module.exports = { submit, depth, isQueueFull, _reset, _tick: tick, MAX_CONCURRENCY, MAX_QUEUE };
