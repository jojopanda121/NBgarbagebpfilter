// ============================================================
// server/services/hermesHealth.js
//
// Hermes 健康状态缓存。
//
// 目的：每次用户请求都 ping 一次新加坡太重（VPN RTT 70-120ms 叠加），
// 所以后台心跳定时探测，请求侧只读缓存。
//
// 状态机：
//   unknown   —— 进程启动后还没探测过
//   ok        —— 上一次 ping 成功
//   unhealthy —— 上一次 ping 失败（带 reason）
//
// 用法：
//   require("./hermesHealth").start();          // app 启动时调一次
//   const s = require("./hermesHealth").get();  // 路由侧零成本读
// ============================================================

const { flags } = require("../config/featureFlags");
const hermes = require("./hermesClient");

let state = {
  status: "unknown",
  reason: null,
  latencyMs: null,
  lastCheckAt: 0,
  lastError: null,
};

let timer = null;
let inFlight = null;

async function probe() {
  if (inFlight) return inFlight;
  const start = Date.now();
  inFlight = (async () => {
    try {
      const result = await hermes.pingHealth({ timeoutMs: 3000 });
      if (result.ok) {
        state = {
          status: "ok",
          reason: null,
          latencyMs: result.latencyMs,
          lastCheckAt: start,
          lastError: null,
        };
      } else {
        state = {
          status: "unhealthy",
          reason: result.reason,
          latencyMs: null,
          lastCheckAt: start,
          lastError: result.error || result.status || null,
        };
      }
    } catch (err) {
      state = {
        status: "unhealthy",
        reason: "connect_timeout",
        latencyMs: null,
        lastCheckAt: start,
        lastError: err.message,
      };
    } finally {
      inFlight = null;
    }
    return state;
  })();
  return inFlight;
}

function get() {
  return { ...state };
}

/**
 * 请求侧用：如果缓存够新就直接返回；否则触发一次同步探测。
 * 探测期间多个请求会共享同一个 in-flight promise，不会风暴打 Hermes。
 */
async function getFresh() {
  const age = Date.now() - state.lastCheckAt;
  if (state.status !== "unknown" && age < flags.hermesHealthCacheMs) {
    return get();
  }
  await probe();
  return get();
}

function start() {
  if (timer) return;
  // 启动时立刻探一次，建立初始状态
  probe().catch(() => {});
  timer = setInterval(() => {
    probe().catch(() => {});
  }, flags.hermesHealthCheckIntervalMs);
  if (timer.unref) timer.unref();
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop, probe, get, getFresh };
