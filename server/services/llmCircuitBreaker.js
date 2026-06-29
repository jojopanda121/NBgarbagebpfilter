// ============================================================
// server/services/llmCircuitBreaker.js — LLM 熔断器（进程级单例）
//
// 目的：高峰期 MiniMax 限流(429)与"订阅额度用尽"两类故障需要被区分对待，
// 而不是一律重试到底然后把任务判失败。
//
//   · overload（429 / 5xx / 超时）—— 短时故障：熔断"打开"，调用方在 create
//     之前被 gate 住，等后台探活把它恢复，再自动续跑。
//   · depleted（余额/额度用尽）—— 需充值/等额度恢复（用户 Token Plan 每 5h
//     恢复一次），等待无意义：立即抛出，让上层快速给用户明确提示、不扣额度。
//
// 本模块不直接 require llmService（llmService 反向 require 本模块），探活函数
// 由 llmService 通过 setProbe() 注入，避免循环依赖。
// ============================================================

const config = require("../config");

const STATE = { CLOSED: "closed", OPEN: "open", DEPLETED: "depleted" };

// 余额/额度耗尽特征。可用 env LLM_DEPLETED_ERROR_PATTERN 覆盖默认正则。
const DEFAULT_DEPLETED_RE =
  /余额|balance|insufficient|欠费|arrears|quota.*(exhaust|exceed)|额度.*(用尽|不足)|用量.*用尽|\b1008\b|rate.?limit.*(quota|balance)/i;

function buildDepletedRe() {
  const raw = config.llmDepletedErrorPattern;
  if (raw && typeof raw === "string") {
    try {
      return new RegExp(raw, "i");
    } catch (err) {
      console.warn("[LLMBreaker] LLM_DEPLETED_ERROR_PATTERN 非法正则，使用默认:", err.message);
    }
  }
  return DEFAULT_DEPLETED_RE;
}
const DEPLETED_RE = buildDepletedRe();

const FAIL_THRESHOLD = config.llmBreakerFailThreshold;
const OVERLOAD_CALL_WAIT_MS = config.llmOverloadCallWaitMs;
const PROBE_MS = config.llmBreakerProbeMs;

const DEPLETED_USER_MSG =
  "AI 分析服务的用量额度已临时用尽（订阅额度每 5 小时自动恢复一次），请稍后再试，本次未消耗您的分析次数。";
const OVERLOAD_USER_MSG =
  "当前正值使用高峰，AI 服务繁忙，请稍后重试。";

// 非用户原因导致的失败，携带类型供上层做文案分流与重试判定
class LLMDepletedError extends Error {
  constructor(message) {
    super(message || DEPLETED_USER_MSG);
    this.name = "LLMDepletedError";
    this.llmState = "depleted";
    this.status = 402;
    this.retryable = false;
    this.userMessage = DEPLETED_USER_MSG;
  }
}
class LLMOverloadError extends Error {
  constructor(message) {
    super(message || OVERLOAD_USER_MSG);
    this.name = "LLMOverloadError";
    this.llmState = "overload";
    this.status = 429;
    this.retryable = true;
    this.userMessage = OVERLOAD_USER_MSG;
  }
}

// ── 错误分类 ────────────────────────────────────────────────
function classify(err) {
  if (!err) return "other";
  if (err.llmState === "depleted") return "depleted";
  if (err.llmState === "overload") return "overload";

  const status = err.status;
  const hay = `${err.message || ""} ${typeof err.body === "string" ? err.body : ""}`;

  if (DEPLETED_RE.test(hay)) return "depleted";

  if (status === 429) return "overload";
  if (typeof status === "number" && status >= 500) return "overload";
  // 与 llmService.isRetryable 同款的瞬时网络/超时特征
  if (/超时|timeout|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(hay)) return "overload";
  return "other";
}

// ── 状态机 ──────────────────────────────────────────────────
let state = STATE.CLOSED;
let consecutiveOverload = 0;
let changedAt = Date.now();
let lastReason = null;
let probeTimer = null;
let probing = false;
let probeFn = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setState(next, reason) {
  if (state === next) return;
  state = next;
  changedAt = Date.now();
  lastReason = reason || null;
  if (next === STATE.OPEN || next === STATE.DEPLETED) {
    console.warn(JSON.stringify({ evt: "llm_breaker_open", state: next, reason: lastReason }));
    startProbe();
  } else {
    console.warn(JSON.stringify({ evt: "llm_breaker_recovered", state: next }));
    stopProbe();
  }
}

function startProbe() {
  if (probeTimer) return;
  probeTimer = setInterval(runProbe, PROBE_MS);
  if (typeof probeTimer.unref === "function") probeTimer.unref();
}
function stopProbe() {
  if (probeTimer) {
    clearInterval(probeTimer);
    probeTimer = null;
  }
}

// 探活：直连底层 create（绕过 gate），成功即认为已恢复。
async function runProbe() {
  if (probing || !probeFn) return;
  probing = true;
  try {
    await probeFn();
    recordSuccess();
  } catch (err) {
    // 仍未恢复：若错误类型从 overload 变为 depleted（或反之）则切换状态
    recordFailure(err);
  } finally {
    probing = false;
  }
}

function setProbe(fn) {
  probeFn = fn;
}

function recordSuccess() {
  consecutiveOverload = 0;
  if (state !== STATE.CLOSED) setState(STATE.CLOSED, "probe_or_call_success");
}

function recordFailure(err) {
  const kind = classify(err);
  if (kind === "depleted") {
    setState(STATE.DEPLETED, "depleted_error");
    return;
  }
  if (kind === "overload") {
    consecutiveOverload += 1;
    if (consecutiveOverload >= FAIL_THRESHOLD && state === STATE.CLOSED) {
      setState(STATE.OPEN, `overload_x${consecutiveOverload}`);
    }
    return;
  }
  // other：业务/参数错误，不影响熔断（避免被无关报错带偏）
}

/**
 * 在每次真实 create 之前调用。
 *   closed   → 放行
 *   depleted → 立即抛 LLMDepletedError（等几小时无意义）
 *   open     → 轮询等待至恢复，最多 OVERLOAD_CALL_WAIT_MS；超时抛 LLMOverloadError
 * @param {{ isProbe?: boolean }} [opts]
 */
async function gateBeforeCreate(opts = {}) {
  if (opts.isProbe) return; // 探活自身不被 gate，避免死锁
  if (state === STATE.CLOSED) return;
  if (state === STATE.DEPLETED) throw new LLMDepletedError();

  // state === OPEN：等待后台探活把它恢复
  const pollMs = Math.min(2000, Math.max(250, Math.floor(PROBE_MS / 4)));
  const deadline = Date.now() + OVERLOAD_CALL_WAIT_MS;
  while (state === STATE.OPEN && Date.now() < deadline) {
    // 最后一轮不超出剩余预算，避免明显过冲
    await sleep(Math.max(50, Math.min(pollMs, deadline - Date.now())));
  }
  if (state === STATE.CLOSED) return;
  if (state === STATE.DEPLETED) throw new LLMDepletedError();
  throw new LLMOverloadError(); // 仍 open，超出单次调用等待预算
}

function getState() {
  return {
    state,
    reason: lastReason,
    since: new Date(changedAt).toISOString(),
    consecutiveOverload,
  };
}

function isDepleted() {
  return state === STATE.DEPLETED;
}
function isOpen() {
  return state === STATE.OPEN;
}

// 测试辅助：复位内部状态
function _reset() {
  stopProbe();
  state = STATE.CLOSED;
  consecutiveOverload = 0;
  changedAt = Date.now();
  lastReason = null;
  probing = false;
  probeFn = null;
}

module.exports = {
  STATE,
  classify,
  recordSuccess,
  recordFailure,
  gateBeforeCreate,
  setProbe,
  getState,
  isDepleted,
  isOpen,
  LLMDepletedError,
  LLMOverloadError,
  DEPLETED_USER_MSG,
  OVERLOAD_USER_MSG,
  _reset,
};
