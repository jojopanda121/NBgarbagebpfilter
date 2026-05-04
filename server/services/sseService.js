// ============================================================
// server/services/sseService.js — Server-Sent Events 实时推送
// 用于向前端推送 Agent 进度事件
// ============================================================

const logger = require("../utils/logger");

// runId => Set<res>（每个 runId 可有多个连接，如刷新页面重连）
const subscribers = new Map();

const HEARTBEAT_INTERVAL_MS = parseInt(process.env.SSE_HEARTBEAT_INTERVAL || "15000", 10);

/**
 * 将 res 注册为 runId 的 SSE 订阅者
 */
function subscribe(runId, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // 禁止 nginx 缓冲
  if (res.flushHeaders) res.flushHeaders();

  if (!subscribers.has(runId)) subscribers.set(runId, new Set());
  subscribers.get(runId).add(res);

  // 心跳防止连接超时（M1: unref 避免阻塞进程退出）
  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch (_) {
      cleanup();
    }
  }, HEARTBEAT_INTERVAL_MS);
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    clearInterval(heartbeat);
    subscribers.get(runId)?.delete(res);
    if (subscribers.get(runId)?.size === 0) subscribers.delete(runId);
  }

  // M1: 监听多种连接终止事件，确保心跳定时器一定被清理
  res.on("close", cleanup);
  res.on("error", cleanup);
  res.on("finish", cleanup);
  if (res.req) {
    res.req.on("close", cleanup);
    res.req.on("aborted", cleanup);
  }

  logger.info("[SSE] subscribe", { runId, totalSubs: subscribers.get(runId)?.size });
}

/**
 * 向指定 runId 的所有订阅者推送事件
 * @param {string} runId
 * @param {object} event — 任意 JSON 对象
 */
function publish(runId, event) {
  const subs = subscribers.get(runId);
  if (!subs || subs.size === 0) return;

  const payload = `data: ${JSON.stringify(event)}\n\n`;
  const toRemove = [];

  for (const res of subs) {
    try {
      res.write(payload);
      // 工作流全部完成时关闭连接
      if (event.type === "run_finished") {
        res.end();
        toRemove.push(res);
      }
    } catch (err) {
      logger.warn("[SSE] write error, removing subscriber", { runId, err: err.message });
      toRemove.push(res);
    }
  }

  for (const res of toRemove) subs.delete(res);
  if (subs.size === 0) subscribers.delete(runId);
}

/**
 * 发送单个 Agent 进度事件
 */
function publishAgentEvent(runId, { agent, status, userOutput, error }) {
  publish(runId, { type: "agent_update", agent, status, userOutput: userOutput || null, error: error || null });
}

/**
 * 发送工作流结束事件
 */
function publishRunFinished(runId, { failedCount }) {
  publish(runId, { type: "run_finished", failedCount });
}

module.exports = { subscribe, publish, publishAgentEvent, publishRunFinished };
