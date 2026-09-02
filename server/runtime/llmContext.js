// ============================================================
// server/runtime/llmContext.js — 请求级 LLM 上下文
//
// 为什么用 AsyncLocalStorage 而不是逐层传参：
// 一次 BP 分析会经过 pipelineService → 6 个 Agent → llmService，
// 中间有几十个 callLLM* 调用点。给每个调用点加一个 "用谁的 key" 参数
// 意味着改几十处签名，而且以后每加一个调用点都可能漏传，漏传的表现是
// **静默用平台的 key 跑用户的活**——账单和归属都错，很难发现。
//
// 分析任务在 analyzeController 里是同一条异步链（后台 IIFE，不跨进程队列），
// 所以在链的最外层 run 一次，链上所有 LLM 调用自动继承，漏不掉。
//
// 上下文里带明文 key，**绝不能进日志**。需要打日志时用 fingerprint()。
// ============================================================

const { AsyncLocalStorage } = require("async_hooks");
const crypto = require("crypto");

const storage = new AsyncLocalStorage();

/**
 * @typedef {object} LlmContext
 * @property {"platform"|"byok"} source
 * @property {string} providerId
 * @property {string} apiKey                明文，仅存活于内存
 * @property {string} [baseURL]
 * @property {{default?:string, heavy?:string, light?:string}} [models]
 * @property {object} [capabilityOverrides]
 * @property {number} [userId]
 * @property {Set<string>} [notes]          运行期降级说明，最终会回写给用户
 */

function runWithLlmContext(ctx, fn) {
  const normalized = ctx ? { ...ctx, notes: ctx.notes || new Set() } : null;
  if (!normalized) return fn();
  return storage.run(normalized, fn);
}

function getLlmContext() {
  return storage.getStore() || null;
}

/** key 的可打印指纹（前 6 位 sha256），用于日志/缓存键，永不还原 */
function fingerprint(apiKey) {
  if (!apiKey) return "none";
  return crypto.createHash("sha256").update(String(apiKey)).digest("hex").slice(0, 12);
}

/**
 * 记录一次能力降级（如"你的模型输出上限只有 8K，已关闭深度思考"）。
 * 这些说明会随分析结果回给用户——用户自带弱模型时必须**明说**判定纪律被削弱了，
 * 而不是让他以为拿到的是同等质量的结论。
 */
function addDegradeNote(note) {
  const ctx = getLlmContext();
  if (!ctx || !note) return;
  if (!ctx.notes) ctx.notes = new Set();
  ctx.notes.add(String(note));
}

function getDegradeNotes() {
  const ctx = getLlmContext();
  if (!ctx || !ctx.notes) return [];
  return Array.from(ctx.notes);
}

module.exports = {
  runWithLlmContext,
  getLlmContext,
  addDegradeNote,
  getDegradeNotes,
  fingerprint,
};
