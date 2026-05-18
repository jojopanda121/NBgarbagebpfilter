// ============================================================
// server/services/llmService.js — LLM 调用服务
// 封装 MiniMax via Anthropic SDK 的调用逻辑
// 含超时控制和重试机制
// ============================================================

const Anthropic = require("@anthropic-ai/sdk").default;
const config = require("../config");
const { runWebSearch, formatSearchContext } = require("./webSearchService");
const { extractJson } = require("../utils/jsonParser");
const jsonSchema = require("../utils/jsonSchema");
const { resolveAnthropicBaseURL } = require("../utils/minimaxEndpoints");

const anthropic = new Anthropic({
  apiKey: config.minimaxApiKey,
  baseURL: resolveAnthropicBaseURL(config.minimaxApiHost),
});

const MODEL = config.minimaxModel;

// ── P2-4 per-skill 模型路由 ─────────────────────────────────
// 三档：heavy / default / light。每档可走不同 model name；未配置时回落 default。
// 路由表按 skillId / taskHint 命中；都不命中 → "default" 档。
const MODEL_TIERS = {
  heavy: () => config.minimaxModelHeavy || MODEL,
  default: () => MODEL,
  light: () => config.minimaxModelLight || MODEL,
};

// skillId / taskHint → tier
// heavy：长 deck、IC 多步对抗、估值/退出推演 (token 多 + 推理重)
// light：1 页材料抽取、视觉信息提炼、语义抽样校验 (短任务 + 模板化)
// 注：包含 skill id 和 pptxTemplate name 的两套命名，便于不同入口路由
const SKILL_TIER_MAP = {
  // heavy
  investment_deck_pptx: "heavy",
  investment_deck: "heavy",       // pptxTemplate name
  ic_questions_xlsx: "heavy",
  ic_memo: "heavy",
  unit_economics_review: "default",
  // light
  onepager_pptx: "light",
  investment_snapshot: "light",
  project_brief: "light",
  highlight_visual: "light",
  teaser_generate: "light",
  deal_screening: "light",
};
const TASK_HINT_TIER_MAP = {
  semantic_audit: "light",
  upload_structured_extraction: "default",  // 上传结构化抽取需要中等理解力，走 default
};

function _resolveModelTier(opts = {}) {
  if (opts && opts.modelTier && MODEL_TIERS[opts.modelTier]) return opts.modelTier;
  if (opts && opts.taskHint && TASK_HINT_TIER_MAP[opts.taskHint]) return TASK_HINT_TIER_MAP[opts.taskHint];
  if (opts && opts.skillId && SKILL_TIER_MAP[opts.skillId]) return SKILL_TIER_MAP[opts.skillId];
  return "default";
}

function _resolveModel(opts = {}) {
  const tier = _resolveModelTier(opts);
  return MODEL_TIERS[tier]();
}

// 超时和重试配置
const LLM_TIMEOUT_MS = 300 * 1000;    // 单次请求超时 300s（5分钟），大 prompt 需要更多时间
const MAX_RETRIES = 3;                  // 最多重试 3 次（共 4 次尝试）
const BASE_DELAY_MS = 2000;             // 重试基础延迟 2s

// ── Prompt Caching (Anthropic ephemeral cache) ─────────────
// 默认关闭，因为 MiniMax 兼容端点不一定支持 cache_control 数组形式。
// 开关：env ENABLE_PROMPT_CACHE=1（生产对接真 Anthropic / Claude 时启用）。
// 经验阈值：≥ 1500 字符（~ 1000 tokens）才值得标 cache_control，
// 否则缓存收益不抵开销（Sonnet/Haiku 最低 1024 tokens 才入缓存）。
const PROMPT_CACHE_MIN_CHARS = 1500;
function _promptCacheEnabled() {
  return process.env.ENABLE_PROMPT_CACHE === "1";
}

// 系统提示如够长且 cache 开启，转成带 cache_control 的 content block 数组。
// 不够长或未开启 → 原样字符串。
function _buildCacheableSystem(systemPrompt) {
  if (!_promptCacheEnabled()) return systemPrompt;
  if (typeof systemPrompt !== "string" || systemPrompt.length < PROMPT_CACHE_MIN_CHARS) {
    return systemPrompt;
  }
  return [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }];
}

// 把用户消息切成 [稳定前缀（缓存）, 动态尾部（不缓存）]。
// 调用方传 opts.userPrefix = Fact Pack 长文本时，可显著降低重复 token 成本。
// 不开启缓存或前缀过短 → 直接拼接成单字符串，行为与之前一致。
function _buildCacheableUserMessage(userContent, userPrefix) {
  if (!_promptCacheEnabled() || !userPrefix || userPrefix.length < PROMPT_CACHE_MIN_CHARS) {
    return userPrefix ? `${userPrefix}\n\n${userContent}` : userContent;
  }
  return [
    { type: "text", text: userPrefix, cache_control: { type: "ephemeral" } },
    { type: "text", text: userContent || "" },
  ];
}

function ensureMinimaxConfigured() {
  if (!config.minimaxApiKey) {
    throw new Error("LLM 未配置：服务端缺少 MINIMAX_API_KEY，请在 .env 中设置后重启进程");
  }
}

/** 根据 maxTokens 动态计算超时时间 */
function calcTimeout(maxTokens) {
  // 基础 300s，每增加 4096 tokens 多给 60s，上限 600s
  const extra = Math.floor(maxTokens / 4096) * 60 * 1000;
  return Math.min(LLM_TIMEOUT_MS + extra, 600 * 1000);
}

/** 延迟工具函数 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 带超时的 Promise 包装 */
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`LLM 请求超时 (${ms}ms): ${label}`)),
      ms
    );
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/** 判断是否可重试的错误 */
function isRetryable(err) {
  const msg = err?.message || "";
  const status = err?.status;
  // 永久错误：401/403/404/400 不重试，立刻冒泡
  if (status === 401 || status === 403 || status === 404 || status === 400) return false;
  // 超时、网络错误、速率限制、5xx 可重试
  if (msg.includes("超时")) return true;
  if (msg.includes("timeout")) return true;
  if (msg.includes("ECONNRESET") || msg.includes("ENOTFOUND") || msg.includes("ETIMEDOUT")) return true;
  if (status >= 500) return true;
  if (status === 429) return true;
  return false;
}

/** 将上游错误规范化为对调用方友好的中文异常 */
function normalizeLLMError(err) {
  const status = err?.status;
  if (status === 401 || status === 403) {
    const e = new Error("LLM 服务认证失败：请检查 MINIMAX_API_KEY 配置");
    e.permanent = true;
    return e;
  }
  if (status === 429) {
    return new Error("LLM 服务限流，请稍后重试");
  }
  return err;
}

/**
 * 调用 MiniMax LLM（普通模式），含超时和重试。
 *
 * @param {string} systemPrompt
 * @param {string} userContent
 * @param {number|object} [maxTokensOrOpts=8192]  - 兼容旧签名 (数字 = maxTokens)；
 *                                                   或传 { maxTokens, userPrefix } 启用 prompt caching
 */
async function callLLM(systemPrompt, userContent, maxTokensOrOpts = 8192) {
  ensureMinimaxConfigured();
  const opts = typeof maxTokensOrOpts === "object" ? maxTokensOrOpts : { maxTokens: maxTokensOrOpts };
  const { maxTokens = 8192, userPrefix = "" } = opts;
  let lastError;

  // Prompt caching: 系统提示 + 用户消息可选前缀
  const cachedSystem = _buildCacheableSystem(systemPrompt);
  const userMessage = _buildCacheableUserMessage(userContent, userPrefix);
  // P2-4 模型路由
  const model = _resolveModel(opts);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`[LLM] 第 ${attempt + 1} 次尝试（延迟 ${delay}ms）...`);
        await sleep(delay);
      }

      const timeout = calcTimeout(maxTokens);
      const resp = await withTimeout(
        anthropic.messages.create({
          model,
          max_tokens: maxTokens,
          system: cachedSystem,
          messages: [{ role: "user", content: userMessage }],
        }),
        timeout,
        `callLLM(model=${model}, maxTokens=${maxTokens})`
      );

      return resp.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES && isRetryable(err)) {
        console.warn(`[LLM] 请求失败 (attempt ${attempt + 1}): ${err.message}`);
        continue;
      }
      break;
    }
  }

  throw normalizeLLMError(lastError);
}

/** 调用 MiniMax LLM（深度思考模式，不支持时自动降级），含超时和重试 */
async function callLLMWithThinking(systemPrompt, userContent, maxTokens = 16000, thinkingBudget = 8000) {
  ensureMinimaxConfigured();
  try {
    let lastError;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          console.warn(`[LLM/Thinking] 第 ${attempt + 1} 次尝试（延迟 ${delay}ms）...`);
          await sleep(delay);
        }

        const timeout = calcTimeout(maxTokens) * 2; // thinking 模式给双倍超时
        const resp = await withTimeout(
          anthropic.messages.create({
            model: MODEL,
            max_tokens: maxTokens,
            thinking: { type: "enabled", budget_tokens: thinkingBudget },
            system: systemPrompt,
            messages: [{ role: "user", content: userContent }],
          }),
          timeout,
          `callLLMWithThinking(maxTokens=${maxTokens})`
        );

        let thinking = "";
        let text = "";
        for (const block of resp.content) {
          if (block.type === "thinking") thinking += block.thinking;
          if (block.type === "text") text += block.text;
        }
        if (text) return { thinking, text };
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES && isRetryable(err)) {
          console.warn(`[LLM/Thinking] 请求失败 (attempt ${attempt + 1}): ${err.message}`);
          continue;
        }
        break;
      }
    }

    // Thinking 模式完全失败，抛出以便降级
    throw lastError;
  } catch (thinkErr) {
    console.warn("[LLM] Thinking 模式不可用，降级为普通模式:", thinkErr.message);
  }

  const text = await callLLM(systemPrompt, userContent, maxTokens);
  return { thinking: "", text };
}

/**
 * 调用 LLM，支持自定义多轮 messages 和流式回调。
 * @param {string} systemPrompt
 * @param {Array<{role:'user'|'assistant', content:string}>} messages
 * @param {object} opts
 * @param {number} [opts.maxTokens=4096]
 * @param {(delta:string)=>void} [opts.onDelta] 每次 token 增量回调（设置后启用流式）
 * @param {AbortSignal} [opts.signal] 调用方取消信号（用于客户端断开）
 * @returns {Promise<string>} 完整文本
 */
async function callLLMChat(systemPrompt, messages, opts = {}) {
  const { maxTokens = 4096, onDelta, signal } = opts;
  ensureMinimaxConfigured();
  let lastError;
  let streamUnsupported = false;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`[LLM/Chat] 第 ${attempt + 1} 次尝试（延迟 ${delay}ms）...`);
        await sleep(delay);
      }

      if (signal?.aborted) throw new Error("客户端取消");

      const timeout = calcTimeout(maxTokens);

      if (onDelta && !streamUnsupported) {
        // H8: 流式模式 — 即便 stream 创建本身失败，也保证 timeout/abort 监听器被清理
        let stream;
        let onAbort;
        let timeoutTimer;
        try {
          // 显式 timeout 包裹 stream 创建
          stream = await new Promise((resolve, reject) => {
            timeoutTimer = setTimeout(
              () => reject(new Error(`LLM 请求超时 (${timeout}ms): callLLMChat(stream)`)),
              timeout
            );
            try {
              const s = anthropic.messages.stream({
                model: MODEL,
                max_tokens: maxTokens,
                system: systemPrompt,
                messages,
              });
              clearTimeout(timeoutTimer);
              resolve(s);
            } catch (e) {
              clearTimeout(timeoutTimer);
              reject(e);
            }
          });

          let full = "";
          onAbort = () => { try { stream.controller?.abort?.(); } catch (_) { /* ignore */ } };
          if (signal) signal.addEventListener("abort", onAbort);

          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
              const piece = event.delta.text || "";
              if (piece) {
                full += piece;
                onDelta(piece);
              }
            }
          }
          return full;
        } finally {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          if (signal && onAbort) signal.removeEventListener("abort", onAbort);
          try { stream && stream.controller?.abort?.(); } catch (_) { /* ignore */ }
        }
      }

      // 非流式
      const resp = await withTimeout(
        anthropic.messages.create({
          model: MODEL,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages,
        }),
        timeout,
        `callLLMChat(maxTokens=${maxTokens})`
      );
      const fullText = resp.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      // 如果调用方期望流式但上游不支持，至少把完整文本作为一个 delta 推给前端，
      // 否则 SSE 端会出现"主持人开口但说不出话"的视觉假死。
      if (onDelta && fullText) onDelta(fullText);
      return fullText;
    } catch (err) {
      lastError = err;
      // 客户端取消不重试
      if (err?.message === "客户端取消" || signal?.aborted) break;

      // 流式不被上游支持（MiniMax 兼容端点常见）→ 改走非流式，下一轮直接降级
      const msg = err?.message || "";
      if (
        onDelta && !streamUnsupported &&
        (err?.status === 400 || err?.status === 404 ||
         msg.includes("stream") || msg.includes("SSE") ||
         msg.includes("not supported") || msg.includes("unsupported"))
      ) {
        console.warn("[LLM/Chat] 流式不被支持，降级为非流式:", msg);
        streamUnsupported = true;
        continue;
      }

      if (attempt < MAX_RETRIES && isRetryable(err)) {
        console.warn(`[LLM/Chat] 请求失败 (attempt ${attempt + 1}): ${err.message}`);
        continue;
      }
      break;
    }
  }
  throw normalizeLLMError(lastError);
}

/**
 * 调用 MiniMax LLM 并启用 web_search 工具。
 * MiniMax Anthropic 兼容端点不接受 type:"web_search" 这种内置工具声明；
 * 这里声明为函数工具，由本服务端执行搜索并把结果回填给模型。
 *
 * 回退：若服务端不识别工具，自动降级为普通 callLLM。
 *
 * @param {string} systemPrompt
 * @param {string} userContent
 * @param {object} [opts]
 * @param {number} [opts.maxTokens=8192]
 * @param {number} [opts.maxToolRounds=6]
 * @param {string[]} [opts.preSearchQueries] — 服务端先行检索并注入上下文, 避免模型在 JSON 模式下不主动 tool_use
 * @returns {Promise<{ text: string, searchUsed: boolean }>}
 */
async function callLLMWithSearch(systemPrompt, userContent, opts = {}) {
  ensureMinimaxConfigured();
  const { maxTokens = 8192, maxToolRounds = 6, preSearchQueries = [] } = opts;

  const tools = [{
    name: "web_search",
    description: "Search the public web for recent market, policy, company, competitor, regulatory, or news information.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query." },
        queries: {
          type: "array",
          items: { type: "string" },
          description: "Optional multiple search queries.",
        },
      },
      required: ["query"],
    },
  }];

  let searchUsed = false;
  let lastError;
  let initialUserContent = userContent;

  const forcedQueries = Array.isArray(preSearchQueries)
    ? preSearchQueries.map((q) => String(q || "").trim()).filter(Boolean)
    : [];
  if (forcedQueries.length > 0) {
    try {
      const rows = await runWebSearch(forcedQueries);
      if (rows.length > 0) {
        searchUsed = true;
        initialUserContent = [
          userContent,
          "",
          formatSearchContext(rows),
          "",
          "重要：上方是服务端已经完成的联网检索证据。涉及市场规模、政策、竞品、融资、诉讼、创始人背景等外部事实时，优先使用这些结果；未被检索结果支撑的信息必须标注待核实，不得补全。",
        ].join("\n");
      }
    } catch (err) {
      console.warn("[LLM/Search] preSearch 失败，继续使用模型工具搜索:", err.message);
    }
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`[LLM/Search] 第 ${attempt + 1} 次尝试（延迟 ${delay}ms）...`);
        await sleep(delay);
      }

      const convo = [{ role: "user", content: initialUserContent }];
      let finalText = "";

      // 工具调用循环（兼容客户端 tool_use 格式）
      for (let round = 0; round < maxToolRounds; round++) {
        const timeout = calcTimeout(maxTokens);
        const resp = await withTimeout(
          anthropic.messages.create({
            model: MODEL,
            max_tokens: maxTokens,
            system: systemPrompt,
            tools,
            messages: convo,
          }),
          timeout,
          `callLLMWithSearch(round=${round})`
        );

        const text = resp.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("");
        if (text) finalText = text;

        const toolUses = resp.content.filter((b) => b.type === "tool_use");
        if (toolUses.length === 0 || resp.stop_reason === "end_turn") break;

        searchUsed = true;
        convo.push({ role: "assistant", content: resp.content });
        const toolResults = [];
        for (const tu of toolUses) {
          const input = tu.input || {};
          const queries = Array.isArray(input.queries) && input.queries.length
            ? input.queries
            : [input.query || input.q || ""];
          const rows = await runWebSearch(queries);
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: formatSearchContext(rows) || "未取得可用搜索结果。请基于已有上下文直接回答，并明确说明哪些信息仍待核实。",
          });
        }
        convo.push({
          role: "user",
          content: toolResults,
        });
      }

      return { text: finalText, searchUsed };
    } catch (err) {
      lastError = err;
      const msg = err?.message || "";
      // 工具声明不被服务端识别 → 降级
      if (
        err?.status === 400 ||
        msg.includes("invalid params") ||
        msg.includes("unsupported")
      ) {
        console.warn("[LLM/Search] web_search 不可用，降级为普通模式:", msg);
        const text = await callLLM(
          `${systemPrompt}\n\n重要：当前未能执行联网检索。不要输出 tool_call、web_search 或“我来搜索”。请基于已有上下文直接回答，并标注待核实信息。`,
          userContent,
          maxTokens
        );
        return { text, searchUsed: false };
      }
      if (attempt < MAX_RETRIES && isRetryable(err)) continue;
      break;
    }
  }

  // 重试用尽 → 最后再兜底降级
  console.warn("[LLM/Search] 全部重试失败，降级为普通模式:", lastError?.message);
  const text = await callLLM(systemPrompt, userContent, maxTokens);
  return { text, searchUsed: false };
}

function getModelName(opts) {
  // P2-4: 可选传 { skillId, taskHint, modelTier } 查询路由后的实际 model
  if (opts) return _resolveModel(opts);
  return MODEL;
}

function getModelTier(opts) {
  return _resolveModelTier(opts || {});
}

// ============================================================
// callLLMAgentic — 工作区"类 Claude"调用核心
//
// 把 MiniMax 的三个能力（thinking / streaming / tool use）合一暴露：
//   - thinking_delta → onEvent({ type: "thinking_delta", text })
//   - text_delta     → onEvent({ type: "text_delta",     text })
//   - tool_use       → onEvent({ type: "tool_use", id, name, input })
//     调用方在 onEvent 里 await toolRunner(name, input) 不需要——
//     toolRunner 由参数传入，本函数内部完成 tool_result 注入 + 多轮循环。
//
// 自动降级路径：
//   1. stream + thinking + tools           （首选，类 Claude 体验）
//   2. non-stream + thinking + tools       （shim 不支持 thinking-stream）
//   3. non-stream + tools                  （shim 拒绝 thinking）
//   4. non-stream 纯文本 + 文本 TOOL_CALL    （shim 拒绝 tools，由调用方解析）
// 第 4 步只返回 final_text，让调用方走老路；前 3 步都会触发 thinking/text/tool 事件。
//
// 选项：
//   system           string         系统提示
//   messages         array          [{ role, content }]
//   tools            array          Anthropic 工具声明
//   toolRunner       fn(name,input)=> string|Promise<string>
//   toolBatchGuard   fn(toolUses) => {ok, errors}  本轮工具调用整批守卫.
//                    返回 ok=false 时, 本轮所有 tool_use 都不会执行 toolRunner,
//                    而是回灌 guard 错误作为 tool_result, 让模型下一轮收敛.
//                    用于"单轮最多 N 个工具调用"等硬约束 — 必须在执行前预检.
//   thinkingBudget   number         默认 4000，传 0 = 不开 thinking
//   maxTokens        number         默认 6000
//   maxToolRounds    number         默认 4
//   onEvent          fn(event)      所有事件回调（见上）
//   signal           AbortSignal
// ============================================================
async function callLLMAgentic(opts) {
  ensureMinimaxConfigured();
  const {
    system,
    messages,
    tools = [],
    toolRunner,
    toolBatchGuard,
    thinkingBudget = 4000,
    maxTokens = 6000,
    maxToolRounds = 4,
    onEvent = () => {},
    signal,
  } = opts;

  const safeEmit = (event) => {
    try { onEvent(event); } catch (e) {
      console.warn("[Agentic] onEvent 抛出，已忽略:", e?.message);
    }
  };

  // 三档能力开关（按上游报错动态降级）
  let enableThinking = thinkingBudget > 0;
  let enableTools = Array.isArray(tools) && tools.length > 0;
  let enableStream = true;

  const convo = Array.isArray(messages) ? messages.map((m) => ({ ...m })) : [];
  let finalText = "";
  let totalRounds = 0;
  let stopReason = null;

  for (let round = 0; round < Math.max(1, maxToolRounds); round++) {
    if (signal?.aborted) throw new Error("客户端取消");
    totalRounds++;
    safeEmit({ type: "round_start", round });

    const reqBody = {
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: convo,
    };
    if (enableThinking) reqBody.thinking = { type: "enabled", budget_tokens: thinkingBudget };
    if (enableTools) reqBody.tools = tools;

    const timeout = calcTimeout(maxTokens) * (enableThinking ? 2 : 1);
    let assistantContent = []; // 收集到的 content blocks，下一轮喂回 convo
    let textInRound = "";

    try {
      if (enableStream) {
        // ── 流式路径 ─────────────────────────────────
        const blocks = {}; // index → { type, ... }
        const stream = await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error(`LLM 请求超时 (${timeout}ms): agentic-stream`)), timeout);
          try {
            const s = anthropic.messages.stream(reqBody);
            clearTimeout(t);
            resolve(s);
          } catch (e) { clearTimeout(t); reject(e); }
        });

        let onAbort = () => { try { stream.controller?.abort?.(); } catch (_) {} };
        if (signal) signal.addEventListener("abort", onAbort);

        try {
          for await (const ev of stream) {
            if (ev.type === "content_block_start") {
              const i = ev.index;
              const cb = ev.content_block || {};
              blocks[i] = { type: cb.type, name: cb.name, id: cb.id, text: "", thinking: "", input_json: "" };
              if (cb.type === "thinking") safeEmit({ type: "thinking_start" });
              else if (cb.type === "text") safeEmit({ type: "text_start" });
              else if (cb.type === "tool_use") safeEmit({ type: "tool_use_start", id: cb.id, name: cb.name });
            } else if (ev.type === "content_block_delta") {
              const b = blocks[ev.index];
              if (!b) continue;
              const d = ev.delta || {};
              if (d.type === "thinking_delta" && d.thinking) {
                b.thinking += d.thinking;
                safeEmit({ type: "thinking_delta", text: d.thinking });
              } else if (d.type === "text_delta" && d.text) {
                b.text += d.text;
                textInRound += d.text;
                safeEmit({ type: "text_delta", text: d.text });
              } else if (d.type === "input_json_delta" && d.partial_json) {
                b.input_json += d.partial_json;
              }
            } else if (ev.type === "content_block_stop") {
              const b = blocks[ev.index];
              if (!b) continue;
              if (b.type === "thinking") safeEmit({ type: "thinking_stop" });
              else if (b.type === "text") safeEmit({ type: "text_stop" });
              else if (b.type === "tool_use") {
                let parsed = {};
                if (b.input_json) {
                  try { parsed = JSON.parse(b.input_json); }
                  catch (e) { console.warn("[Agentic] tool_use 输入 JSON 解析失败:", e.message); }
                }
                b.input = parsed;
                safeEmit({ type: "tool_use", id: b.id, name: b.name, input: parsed });
              }
            } else if (ev.type === "message_delta") {
              if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
            }
          }
        } finally {
          if (signal) signal.removeEventListener("abort", onAbort);
        }

        // 拼回 assistantContent 给下一轮
        const ordered = Object.keys(blocks).map(Number).sort((a, b) => a - b);
        for (const i of ordered) {
          const b = blocks[i];
          if (b.type === "thinking") assistantContent.push({ type: "thinking", thinking: b.thinking });
          else if (b.type === "text") assistantContent.push({ type: "text", text: b.text });
          else if (b.type === "tool_use") assistantContent.push({ type: "tool_use", id: b.id, name: b.name, input: b.input || {} });
        }
      } else {
        // ── 非流式路径 ───────────────────────────────
        const resp = await withTimeout(
          anthropic.messages.create(reqBody),
          timeout,
          "agentic-nonstream"
        );
        stopReason = resp.stop_reason || null;
        for (const b of resp.content || []) {
          if (b.type === "thinking" && b.thinking) {
            safeEmit({ type: "thinking_start" });
            safeEmit({ type: "thinking_delta", text: b.thinking });
            safeEmit({ type: "thinking_stop" });
            assistantContent.push({ type: "thinking", thinking: b.thinking });
          } else if (b.type === "text" && b.text) {
            safeEmit({ type: "text_start" });
            safeEmit({ type: "text_delta", text: b.text });
            safeEmit({ type: "text_stop" });
            textInRound += b.text;
            assistantContent.push({ type: "text", text: b.text });
          } else if (b.type === "tool_use") {
            safeEmit({ type: "tool_use_start", id: b.id, name: b.name });
            safeEmit({ type: "tool_use", id: b.id, name: b.name, input: b.input || {} });
            assistantContent.push({ type: "tool_use", id: b.id, name: b.name, input: b.input || {} });
          }
        }
      }
    } catch (err) {
      const msg = err?.message || "";
      const status = err?.status;

      // 客户端取消，直接抛
      if (msg === "客户端取消" || signal?.aborted) throw err;

      // 1) stream 不支持 → 降级非流式
      if (enableStream && (status === 400 || status === 404 ||
          /stream|SSE|unsupported|not supported|invalid params/i.test(msg))) {
        console.warn("[Agentic] stream 路径报错，降级为非流式:", msg);
        enableStream = false;
        round--; totalRounds--;
        continue;
      }
      // 2) thinking 不支持 → 关 thinking 重试
      if (enableThinking && (status === 400 || /thinking|invalid params|unsupported/i.test(msg))) {
        console.warn("[Agentic] thinking 不被接受，关闭后重试:", msg);
        enableThinking = false;
        round--; totalRounds--;
        continue;
      }
      // 3) tools 不支持 → 关 tools，让调用方走老 TOOL_CALL 文本解析
      if (enableTools && (status === 400 || /tools?|invalid params|unsupported/i.test(msg))) {
        console.warn("[Agentic] tools 不被接受，关闭后重试:", msg);
        enableTools = false;
        round--; totalRounds--;
        continue;
      }
      // 4) 真正失败 → 抛
      throw normalizeLLMError(err);
    }

    if (textInRound) finalText = textInRound;
    safeEmit({ type: "round_end", round, stop_reason: stopReason });

    // 决定是否继续：只有 tool_use 才继续，否则结束
    const toolUses = assistantContent.filter((b) => b.type === "tool_use");
    if (toolUses.length === 0 || stopReason === "end_turn") {
      break;
    }
    if (!toolRunner) {
      console.warn("[Agentic] 模型请求工具但调用方未提供 toolRunner，强行退出循环");
      break;
    }

    // 把这一轮 assistant 内容写入会话历史
    convo.push({ role: "assistant", content: assistantContent });

    // ── 整批守卫: 在执行任何 toolRunner 之前预检 ──
    // 失败时本轮 toolUses 全部短路, 回灌 guard 错误让模型下轮重新规划.
    // 用于"单轮最多 N 个工具调用"这类必须在执行前判定的硬约束.
    let batchGuardErrors = null;
    if (typeof toolBatchGuard === "function") {
      try {
        const guardRes = toolBatchGuard(toolUses);
        if (guardRes && guardRes.ok === false) {
          batchGuardErrors = guardRes.errors || [{ reason: "tool_batch_guard 拒绝, 无 errors 详情" }];
        }
      } catch (e) {
        batchGuardErrors = [{ reason: `tool_batch_guard 抛错: ${e?.message || e}` }];
      }
    }

    const toolResults = [];
    if (batchGuardErrors) {
      const summary = batchGuardErrors
        .map((e) => `[#${e.index ?? "?"} ${e.tool || "-"}] ${e.reason}`)
        .join("; ");
      const guardMessage = `[host_tool_guard] ${summary}`;
      for (const tu of toolUses) {
        safeEmit({ type: "tool_result", id: tu.id, name: tu.name, result: guardMessage, error: true });
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: guardMessage,
          is_error: true,
        });
      }
    } else {
      // 执行所有 tool_use，回灌 tool_result
      for (const tu of toolUses) {
        if (signal?.aborted) throw new Error("客户端取消");
        let resultText = "";
        let isError = false;
        try {
          const r = await toolRunner(tu.name, tu.input || {});
          resultText = typeof r === "string" ? r : JSON.stringify(r || {});
          safeEmit({ type: "tool_result", id: tu.id, name: tu.name, result: resultText, error: false });
        } catch (e) {
          isError = true;
          resultText = `工具调用失败：${e?.message || e}`;
          safeEmit({ type: "tool_result", id: tu.id, name: tu.name, result: resultText, error: true });
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: resultText,
          is_error: isError,
        });
      }
    }
    convo.push({ role: "user", content: toolResults });
  }

  safeEmit({ type: "done", final_text: finalText, total_rounds: totalRounds, stop_reason: stopReason });
  return {
    text: finalText,
    rounds: totalRounds,
    stop_reason: stopReason,
    used_thinking: enableThinking,
    used_tools: enableTools,
    used_stream: enableStream,
  };
}

// ============================================================
// callLLMJson — 让 Anthropic 兼容模型按 JSON Schema 输出
// ============================================================

class LLMJsonValidationError extends Error {
  constructor(message, { errors, raw } = {}) {
    super(message);
    this.name = "LLMJsonValidationError";
    this.validationErrors = errors || [];
    this.lastRaw = raw || "";
  }
}

const JSON_CONTRACT_PREFIX = `【输出契约】
你必须只输出一个 JSON 对象，严格匹配下面的 JSON Schema。
- 不要任何前后缀解释、不要 markdown、不要 \`\`\`json 包裹
- 字段顺序无所谓，但所有 required 字段必须存在，类型必须匹配
- 字符串字段无可用信息时填 "暂无"；数值字段无信息填 null；数组无信息填 []
- 不允许出现 schema 之外的字段（若 additionalProperties=false）

【JSON Schema】
`;

function buildJsonSystemPrompt(originalSystem, schema) {
  return `${originalSystem}\n\n${JSON_CONTRACT_PREFIX}${jsonSchema.stringifyForPrompt(schema)}`;
}

async function callLLMJson(systemPrompt, userContent, schema, opts = {}) {
  const {
    maxTokens = 8192,
    maxRepairs = 2,
    useSearch = false,
    preSearchQueries = [],
    userPrefix = "", // P2-3 prompt caching: 调用方可把 Fact Pack 等稳定长文本前缀单独传入
    // P2-4 model routing 信号 (透传给 callLLM)
    modelTier,       // 显式 'heavy'|'default'|'light'
    skillId,
    taskHint,
  } = opts;
  const sysWithContract = buildJsonSystemPrompt(systemPrompt, schema);

  let lastRaw = "";
  let lastErrors = [];
  let repairs = 0;
  let searchUsed = false;
  let conversation = userContent;
  // 首次尝试可走 cached prefix；repair 轮已经把错误 + 上次输出拼进新 conversation，
  // 缓存命中率为零，关闭以省一次"试探"开销。
  let activeUserPrefix = userPrefix;

  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    let raw;
    if (useSearch) {
      const r = await callLLMWithSearch(sysWithContract, conversation, {
        maxTokens,
        preSearchQueries: attempt === 0 ? preSearchQueries : [],
      });
      raw = r.text;
      searchUsed = searchUsed || r.searchUsed;
    } else {
      raw = await callLLM(sysWithContract, conversation, {
        maxTokens,
        userPrefix: activeUserPrefix,
        modelTier,
        skillId,
        taskHint,
      });
    }
    lastRaw = raw;

    const parsed = extractJson(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const { valid, errors } = jsonSchema.validate(parsed, schema);
      if (valid) return { data: parsed, raw, repairs, searchUsed };
      lastErrors = errors;
    } else {
      lastErrors = [{ path: "$", message: "无法从输出中提取合法 JSON 对象" }];
    }

    if (attempt === maxRepairs) break;
    repairs++;
    console.warn(`[LLM/JSON] 第 ${attempt + 1} 次输出未通过 schema，反馈错误重试`);
    conversation = [
      "你上一次的输出未通过 JSON Schema 校验，请基于以下错误修正后重新输出。",
      "【你的上次输出（节选）】",
      lastRaw.length > 2000 ? `${lastRaw.slice(0, 2000)}...(已截断)` : lastRaw,
      "",
      "【校验错误】",
      jsonSchema.formatErrors(lastErrors),
      "",
      "【原始任务】",
      userContent,
    ].join("\n");
    // repair 轮起，userPrefix 已经被合并进原始任务的 userContent；
    // 同时新对话头部包含错误反馈，缓存命中率为 0，关闭以省 cache 探测开销。
    activeUserPrefix = "";
  }

  throw new LLMJsonValidationError(
    `LLM 输出在 ${maxRepairs + 1} 次尝试后仍未通过 schema 校验`,
    { errors: lastErrors, raw: lastRaw }
  );
}

module.exports = {
  callLLM,
  callLLMWithThinking,
  callLLMChat,
  callLLMWithSearch,
  callLLMAgentic,
  callLLMJson,
  LLMJsonValidationError,
  getModelName,
  getModelTier,
};
