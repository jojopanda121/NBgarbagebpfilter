// ============================================================
// server/services/llm/concurrency.js — 每把 key 的在途请求闸门
//
// 为什么需要：本仓库的并发是按 DeepSeek 的配额（RPM 200）调的
// （pipelineService 一次开 8 路声明核查批次，外加三路并行报告任务），
// 而一把 MiniMax Token Plan 订阅 key 或用户自带的入门档 key，
// 允许的并发可能只有个位数。超了之后上游返回 429，我们退避重试，
// 重试又和其他几路撞在一起——限流会自我放大成"整份分析全批次失败"。
//
// 真正的解法是在客户端就把在途请求数压进配额，而不是事后重试。
//
// 闸门按 (厂商, key 指纹) 分组：限流额度是按账号算的，平台自己的 key
// 和用户 BYOK 的 key 互不相干，不能共用一个闸门（否则一个用户自带的
// 慢模型会把平台的分析队列一起堵死）。
// ============================================================

const pLimit = require("p-limit");
const config = require("../../config");

// 各厂商的保守默认并发。宁可慢一点，也不要把一份分析跑成"全批次限流失败"。
// 想调大：设环境变量 LLM_MAX_CONCURRENCY（0 = 完全关闭闸门）。
const DEFAULT_CONCURRENCY = {
  deepseek: 8,   // 迁移前的历史值，RPM 200 下有大量余量
  anthropic: 4,
  openai: 4,
  gemini: 4,
  minimax: 3,    // Token Plan / 订阅制 key 并发额度很小，实测 8 路稳定触发限流
  moonshot: 2,   // Kimi 低档 RPM 个位数，几乎不能并发
  qwen: 4,
  zhipu: 4,
};
const FALLBACK_CONCURRENCY = 3; // 未知厂商（BYOK 自建网关等）一律保守

/** 闸门大小；0 = 不限制（用户显式设 LLM_MAX_CONCURRENCY=0） */
function concurrencyFor(providerId) {
  const override = config.llmMaxConcurrency;
  if (override !== null && override !== undefined) return override;
  return DEFAULT_CONCURRENCY[String(providerId || "").toLowerCase()] || FALLBACK_CONCURRENCY;
}

/**
 * 调用方（如 pipelineService 的批次并发）该开多少路。
 * 闸门被关掉时返回历史默认值 8，保持"关掉开关就是老行为"。
 */
function recommendedConcurrency(providerId) {
  const n = concurrencyFor(providerId);
  return n > 0 ? n : 8;
}

const _gates = new Map(); // gateKey -> { limit, size }
const GATE_CACHE_MAX = 64;

function _gate(gateKey, providerId) {
  const size = concurrencyFor(providerId);
  const hit = _gates.get(gateKey);
  if (hit && hit.size === size) return hit;
  const gate = { limit: pLimit(size), size };
  _gates.set(gateKey, gate);
  while (_gates.size > GATE_CACHE_MAX) _gates.delete(_gates.keys().next().value);
  return gate;
}

/**
 * 在对应闸门下执行一次上游请求。
 * 只用于非流式调用：流式请求会在闸门里挂到整段回答读完，
 * 而流式只服务单用户的交互对话，量小，不值得为它占住一个并发位。
 */
function runLimited(gateKey, providerId, fn) {
  if (concurrencyFor(providerId) <= 0) return fn();
  return _gate(gateKey, providerId).limit(fn);
}

/** 可观测：当前各闸门的大小（排查"为什么这么慢/为什么还在限流"用） */
function describeGates() {
  return [..._gates.entries()].map(([key, g]) => ({ gate: key, size: g.size, pending: g.limit.pendingCount, active: g.limit.activeCount }));
}

module.exports = { DEFAULT_CONCURRENCY, concurrencyFor, recommendedConcurrency, runLimited, describeGates };
