// ============================================================
// server/services/llmService.js — LLM 调用服务
//
// 对上：向全代码库提供 Anthropic 风格的调用接口（callLLM / callLLMJson /
//       callLLMWithSearch / callLLMAgentic ...），含超时、重试、降级。
// 对下：通过 services/llm/providers 注册表连接任意厂商（DeepSeek / Claude /
//       OpenAI / Gemini / Kimi / 通义 / 智谱 / MiniMax）。
//
// 用哪个厂商、哪个 key，由**请求级上下文**决定（runtime/llmContext）：
//   - 没有上下文 → 平台自己的 key（config.llm*），即默认行为
//   - 有 BYOK 上下文 → 用户自带的厂商 + key + 模型
//
// 能力适配是本文件的核心职责之一：流水线的 token 预算是照 DeepSeek V4
// （64K 输出）写的，直接打到输出上限 8K 的模型上会**每次调用都 400**。
// 所以所有 token 预算和思考开关都要先过 _planTokens 按能力裁剪，
// 而不是发出去等报错。
// ============================================================

const config = require("../config");
const { runWebSearch, formatSearchContext } = require("./webSearchService");
const { extractJson } = require("../utils/jsonParser");
const jsonSchema = require("../utils/jsonSchema");
const { createLLMClient } = require("../utils/llmClient");
const { resolveCapabilities, inputCharBudget } = require("./llm/capabilities");
const { getLlmContext, addDegradeNote, getDegradeNotes, fingerprint } = require("../runtime/llmContext");

// ── LLM 调用计量（成本可观测最小实现）────────────────────────
// 在客户端入口处统一拦截 messages.create：每次调用记录结构化日志
// （model / token 用量 / 耗时），并维护进程级累计计数（getLlmStats 可查）。
// BYOK 调用同样计量，但用量归到 source=byok，不与平台成本混在一起。
const _llmStats = {
  calls: 0,
  errors: 0,
  input_tokens: 0,
  output_tokens: 0,
  total_latency_ms: 0,
};

function getLlmStats() {
  return { ..._llmStats, since: _llmStats.since || (_llmStats.since = new Date().toISOString()) };
}

function _instrument(client, meta) {
  if (!client || !client.messages || typeof client.messages.create !== "function") return client;
  const _origCreate = client.messages.create.bind(client.messages);
  client.messages.create = async function instrumentedCreate(body, ...rest) {
    const start = Date.now();
    try {
      const resp = await _origCreate(body, ...rest);
      const latency = Date.now() - start;
      _llmStats.calls += 1;
      _llmStats.total_latency_ms += latency;
      // 流式调用返回 Stream 对象，usage 不在此处；仅非流式记录 token
      const usage = resp && resp.usage ? resp.usage : null;
      if (usage) {
        _llmStats.input_tokens += usage.input_tokens || 0;
        _llmStats.output_tokens += usage.output_tokens || 0;
      }
      console.log(JSON.stringify({
        evt: "llm_call",
        provider: meta.providerId,
        source: meta.source,
        model: body?.model,
        max_tokens: body?.max_tokens,
        input_tokens: usage?.input_tokens ?? null,
        output_tokens: usage?.output_tokens ?? null,
        latency_ms: latency,
        stream: !!body?.stream,
      }));
      return resp;
    } catch (err) {
      _llmStats.calls += 1;
      _llmStats.errors += 1;
      console.warn(JSON.stringify({
        evt: "llm_call_error",
        provider: meta.providerId,
        source: meta.source,
        model: body?.model,
        latency_ms: Date.now() - start,
        status: err?.status ?? null,
        message: (err?.message || "").slice(0, 200),
      }));
      throw err;
    }
  };
  return client;
}

// 客户端缓存：同一个 (provider, host, key, model) 复用一个客户端实例，
// 避免每次调用都重建。key 只以指纹参与缓存键，明文不进任何可打印结构。
const CLIENT_CACHE_MAX = 32;
const _clientCache = new Map();

function _getClient({ providerId, apiKey, baseURL, model, capabilityOverrides, source }) {
  const cacheKey = [providerId, baseURL || "", fingerprint(apiKey), model || "", JSON.stringify(capabilityOverrides || {})].join("|");
  const hit = _clientCache.get(cacheKey);
  if (hit) {
    // LRU：命中后挪到队尾
    _clientCache.delete(cacheKey);
    _clientCache.set(cacheKey, hit);
    return hit;
  }
  const client = _instrument(
    createLLMClient({ apiKey, baseURL, providerId, model, capabilityOverrides }),
    { providerId, source }
  );
  _clientCache.set(cacheKey, client);
  while (_clientCache.size > CLIENT_CACHE_MAX) {
    _clientCache.delete(_clientCache.keys().next().value);
  }
  return client;
}

// ── 平台默认配置（无 BYOK 上下文时使用）──────────────────────
// config 里 deepseek* 是历史别名，llm* 是中立名；两者指向同一批环境变量，
// 换厂商只需改 env，不改代码。
function _platformProfile() {
  return {
    source: "platform",
    providerId: config.llmProvider || "deepseek",
    apiKey: config.llmApiKey || config.deepseekApiKey || "",
    baseURL: config.llmApiHost || config.deepseekApiHost || "",
    models: {
      default: config.llmModel || config.deepseekModel,
      heavy: config.llmModelHeavy || config.deepseekModelHeavy,
      light: config.llmModelLight || config.deepseekModelLight,
    },
    reasoningEffort: config.llmReasoningEffort || config.deepseekReasoningEffort || "",
  };
}

/** 当前生效的 LLM 配置：BYOK 上下文优先，否则平台默认 */
function _activeProfile() {
  const ctx = getLlmContext();
  // 注意条件里**不能**加 "&& ctx.apiKey"：那样 key 为空时会悄悄落回平台 profile，
  // 变成"用户选了自带模型，实际却在花平台的钱跑"。key 缺失应该由
  // ensureLLMConfigured 明确报错，而不是被一个短路运算符掩盖过去。
  if (ctx && ctx.source === "byok") {
    return {
      source: "byok",
      providerId: ctx.providerId,
      apiKey: ctx.apiKey,
      baseURL: ctx.baseURL || "",
      models: ctx.models || {},
      capabilityOverrides: ctx.capabilityOverrides || {},
      reasoningEffort: ctx.reasoningEffort || "",
      userId: ctx.userId,
    };
  }
  return _platformProfile();
}

const MODEL = config.deepseekModel;

// 合法档位集合（显式 opts.modelTier 的白名单）
const MODEL_TIERS = { heavy: true, default: true, light: true };

// ── P2-4 per-skill 模型路由 ─────────────────────────────────
// 三档：heavy / default / light。每档可走不同 model name；未配置时回落 default。
// 路由表按 skillId / taskHint 命中；都不命中 → "default" 档。
// DeepSeek 默认：heavy = deepseek-v4-pro（3元/6元 每 M token），
//                default/light = deepseek-v4-flash（1元/2元）。
//
// BYOK 时同样分档：用户给了 heavy/light 模型名就用，只给一个就三档同模型。
// 用户只配一个模型是完全正常的用法，不能因此报错。
function _modelForTier(tier, profile) {
  const models = profile.models || {};
  const fallback = models.default || MODEL;
  if (tier === "heavy") return models.heavy || fallback;
  if (tier === "light") return models.light || fallback;
  return fallback;
}

// skillId / taskHint → tier
//
// 分档依据是**判断难度**，不是 token 量：
//   heavy → 结论会直接写进评级/诚信度/投决意见的判断题，以及多步对抗推理
//   light → 版式和字段都被模板锁死、模型只负责填内容的格式化活
//   default→ 其余
//
// 注：包含 skill id 和 pptxTemplate name 的两套命名，便于不同入口路由
const SKILL_TIER_MAP = {
  // heavy
  investment_deck_pptx: "heavy",  // 8-30 页叙事连贯性；若想省钱可降 light 后观察跨页逻辑
  investment_deck: "heavy",       // pptxTemplate name
  ic_questions_xlsx: "heavy",     // Bull/Bear 左右脑互搏，真对抗推理
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
  upload_structured_extraction: "default",
  // 核心分析链路。曾短暂设为 heavy(pro)，但 2026-08 用真实 API 实测：
  // 同一组声明核查任务，pro 比 flash 慢 1 倍、贵 3 倍，判定质量没有可见优势，
  // 且出现过 JSON 解析失败。真正决定判定质量的是"思考开关"而非模型档位
  // （见下方 THINKING_MAP）。所以核心链路回到 flash + 强制思考。
  claim_verdict: "default",
  scoring_judge: "default",
  dimension_analysis: "default",
  deep_research: "default",
  bp_extraction: "default",
};

// ── 思考开关：比 flash/pro 更重要的成本与质量杠杆 ──────────────
//
// 实测（2026-08，真实 DeepSeek API）：
//   机械活（BP 抽取）  思考关 1.2s/¥0.0003  vs  思考开 3.2s/¥0.0008 → 结果完全相同
//   判断题（声明核查）  思考关会把无佐证的自报数据判成"诚实"；思考开判"存疑/夸大"
//
// 对一个 BP 过滤产品，判定偏松 = 放过垃圾 BP，是致命方向的错误，
// 所以判断题一律强制开思考；机械活一律关，省下的是纯浪费的推理 token。
//
// 另一条硬约束：**思考内容计入 max_tokens**。实测 max_tokens=800 时
// 思考写了 1400 字、正文 0 字（撞上限直接没答案）。所以开思考的任务
// 必须有 token 下限保护，见 THINKING_MIN_TOKENS。
const THINKING_ON = true;
const THINKING_OFF = false;

const TASK_HINT_THINKING_MAP = {
  // 判断题 —— 结论会写进评级/诚信度，必须思考
  claim_verdict: THINKING_ON,
  scoring_judge: THINKING_ON,
  dimension_analysis: THINKING_ON,
  deep_research: THINKING_ON,
  // 机械活 —— 照原文填字段，思考纯属浪费
  bp_extraction: THINKING_OFF,
  upload_structured_extraction: THINKING_OFF,
  semantic_audit: THINKING_OFF,
};

const SKILL_THINKING_MAP = {
  // 多步对抗推理
  ic_questions_xlsx: THINKING_ON,
  ic_memo: THINKING_ON,
  investment_deck_pptx: THINKING_ON,
  investment_deck: THINKING_ON,
  unit_economics_review: THINKING_ON,
  // 模板填充：版式字段都锁死了，模型只负责填内容
  onepager_pptx: THINKING_OFF,
  investment_snapshot: THINKING_OFF,
  project_brief: THINKING_OFF,
  highlight_visual: THINKING_OFF,
  teaser_generate: THINKING_OFF,
  deal_screening: THINKING_OFF,
};

// 开思考时的 max_tokens 下限。实测思考普遍写 1000-3400 字（约 1500-5000 token），
// 低于这个预算正文会被挤没。调用方给的值小于下限时自动抬到下限。
const THINKING_MIN_TOKENS = 12000;

function _resolveThinking(opts = {}) {
  if (opts && typeof opts.thinking === "boolean") return opts.thinking;
  if (opts && opts.taskHint && opts.taskHint in TASK_HINT_THINKING_MAP) {
    return TASK_HINT_THINKING_MAP[opts.taskHint];
  }
  if (opts && opts.skillId && opts.skillId in SKILL_THINKING_MAP) {
    return SKILL_THINKING_MAP[opts.skillId];
  }
  return null; // 未声明 → 不显式发送，用服务端默认（DeepSeek 默认开）
}

// 开思考时保证 token 预算够写完正文。
// 只在**显式**开思考（thinking === true）时生效：未声明思考的调用方

// ── 能力适配：把"想要的预算"裁成"这个模型真能接受的预算" ──────
//
// 这是多模型支持里最容易出事的地方。举个真实会发生的例子：
// claim_verdict 任务强制开思考 → _guardTokensForThinking 把 max_tokens 抬到
// 12000 → 用户选的是输出上限 8192 的 Kimi/通义 → 每一次声明核查都 400，
// 重试三次全废，整份分析直接失败。所以必须在发出前裁。
//
// 裁剪优先级：能跑完 > 判定严格。宁可降级思考并**如实告诉用户**，
// 也不要让用户拿到一份"分析失败"。
const THINKING_SAFE_FLOOR = 6000; // 低于这个输出预算就别开思考了，正文会被思考挤没

function _planTokens(requestedMaxTokens, thinking, caps, label) {
  const cap = caps.maxOutputTokens;
  const requested = requestedMaxTokens || 0;

  // 模型根本不支持思考开关 → 别把预算抬到思考下限（纯浪费，还可能撞上限）
  if (caps.thinkingStyle === "none" && thinking === true) {
    addDegradeNote(`所选模型不支持深度思考开关，${label || "判定类任务"}已按普通模式执行（判定严格度低于平台默认模型）`);
    return { maxTokens: Math.min(requested || 4096, cap), thinking: false };
  }

  // 不是显式开思考 → 只做上限裁剪，保持原有语义
  if (thinking !== true) {
    return { maxTokens: Math.min(requested || 4096, cap), thinking };
  }

  // 显式开思考：思考 token 计入输出预算，需要下限保护
  const want = Math.max(requested, THINKING_MIN_TOKENS);
  if (cap >= want) return { maxTokens: want, thinking: true };

  if (cap >= THINKING_SAFE_FLOOR) {
    // 预算不够但还够用：贴着上限跑，思考深度压到最低档
    addDegradeNote(`所选模型单次输出上限约 ${cap} tokens，低于平台默认预算，已压低思考深度以保证正文完整`);
    return { maxTokens: cap, thinking: true, forceLowEffort: true };
  }

  // 预算太小：开思考必然把正文挤没，只能关掉
  addDegradeNote(`所选模型单次输出上限仅 ${cap} tokens，已关闭深度思考（否则思考过程会占满输出、拿不到结论）。判定严格度低于平台默认模型`);
  return { maxTokens: cap, thinking: false };
}

/**
 * 解析一次调用的完整执行环境：用谁的 key、哪个模型、什么能力、什么预算。
 * 所有 callLLM* 都从这里拿 client，不再有模块级单例。
 */
function _session(opts = {}) {
  const profile = _activeProfile();
  const tier = _resolveModelTier(opts);
  const model = _modelForTier(tier, profile);
  const caps = resolveCapabilities(profile.providerId, model, profile.capabilityOverrides);
  const client = _getClient({
    providerId: profile.providerId,
    apiKey: profile.apiKey,
    baseURL: profile.baseURL,
    model,
    capabilityOverrides: profile.capabilityOverrides,
    source: profile.source,
  });
  return { client, caps, model, tier, profile, isByok: profile.source === "byok" };
}

/** 可观测入口：查某个任务最终会用什么模型 / 开不开思考 */
function getTaskProfile(opts = {}) {
  const thinking = _resolveThinking(opts);
  return {
    tier: _resolveModelTier(opts),
    model: _resolveModel(opts),
    thinking,                       // true=开 false=关 null=用服务端默认
    minTokens: thinking === true ? THINKING_MIN_TOKENS : null,
  };
}

function _resolveModelTier(opts = {}) {
  if (opts && opts.modelTier && MODEL_TIERS[opts.modelTier]) return opts.modelTier;
  if (opts && opts.taskHint && TASK_HINT_TIER_MAP[opts.taskHint]) return TASK_HINT_TIER_MAP[opts.taskHint];
  if (opts && opts.skillId && SKILL_TIER_MAP[opts.skillId]) return SKILL_TIER_MAP[opts.skillId];
  return "default";
}

function _resolveModel(opts = {}) {
  return _modelForTier(_resolveModelTier(opts), _activeProfile());
}

// 推理档位。deepseek-v4-flash 支持 low/high/max，deepseek-v4-pro 目前只支持
// high/max，配了 low 会 400，所以对 pro 自动抬到 high。模型能力矩阵说不支持
// reasoning_effort 的（如 gpt-4o、多数国产模型）一律返回 undefined —— 发过去
// 就是 400，而这条链路上一次 400 等于一份分析报废。
function _reasoningEffortFor(model, caps, forceLow) {
  const c = caps || resolveCapabilities(_activeProfile().providerId, model);
  if (!c.supportsReasoningEffort) return undefined;
  if (forceLow) return /pro/i.test(String(model || "")) ? "high" : "low";
  const effort = String(_activeProfile().reasoningEffort || "").trim().toLowerCase();
  if (!effort) return undefined;
  if (/pro/i.test(String(model || "")) && effort === "low") return "high";
  return effort;
}

// 超时和重试配置
const LLM_TIMEOUT_MS = 300 * 1000;    // 单次请求超时 300s（5分钟），大 prompt 需要更多时间
const MAX_RETRIES = 3;                  // 最多重试 3 次（共 4 次尝试）
const BASE_DELAY_MS = 2000;             // 重试基础延迟 2s

// ── Prompt Caching ──────────────────────────────────────────
// DeepSeek 的上下文缓存是**自动**的：只要请求的 prompt 前缀与近期请求一致就命中，
// 命中部分按 0.02~0.025 元/M 计价（未命中 1~3 元/M）。不需要、也不接受
// Anthropic 式 cache_control 标记。
//
// 所以下面这套 cache_control 组装默认关闭（ENABLE_PROMPT_CACHE=1 才开），仅在把
// baseURL 指回真 Anthropic 时才有意义。对 DeepSeek 真正有效的做法是保持
// system prompt 和 Fact Pack 等长前缀稳定且排在最前——这一点下面的
// _buildCacheableUserMessage 拼接顺序已经满足。
// 经验阈值：≥ 1500 字符（~ 1000 tokens）才值得标 cache_control。
const PROMPT_CACHE_MIN_CHARS = 1500;
const { enablePromptCache } = require("../config/featureFlags");
function _promptCacheEnabled() {
  return enablePromptCache();
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

function ensureLLMConfigured() {
  const profile = _activeProfile();
  if (profile.apiKey) return;
  if (profile.source === "byok") {
    // BYOK 走到这里说明凭证解密后是空的，属于数据问题，不能静默回退到平台 key
    // （用户明确选了"用我自己的模型"，偷偷用平台额度跑是错的）。
    const e = new Error("你选择了使用自己的模型，但未能读取到有效的 API Key，请在「设置 → 我的模型」中重新保存");
    e.permanent = true;
    e.byok = true;
    throw e;
  }
  throw new Error("LLM 未配置：服务端缺少 DEEPSEEK_API_KEY，请在 .env 中设置后重启进程");
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
  const isByok = _activeProfile().source === "byok";
  if (status === 401 || status === 403) {
    const e = new Error(
      isByok
        ? "你的模型 API Key 认证失败（401/403）：请检查 Key 是否正确、是否已过期或被禁用"
        : "LLM 服务认证失败：请检查服务端 LLM API Key 配置"
    );
    e.permanent = true;
    e.byok = isByok;
    return e;
  }
  if (status === 402 || /insufficient|balance|quota|欠费|余额/i.test(err?.message || "")) {
    const e = new Error(
      isByok
        ? "你的模型账户余额不足或已超出配额，请到厂商控制台充值后重试"
        : "LLM 服务余额不足"
    );
    e.permanent = true;
    e.byok = isByok;
    return e;
  }
  if (status === 429) {
    return new Error(isByok ? "你的模型账户被限流，请稍后重试" : "LLM 服务限流，请稍后重试");
  }
  if (isByok && err) err.byok = true;
  return err;
}

/**
 * 调用 DeepSeek LLM（普通模式），含超时和重试。
 *
 * @param {string} systemPrompt
 * @param {string} userContent
 * @param {number|object} [maxTokensOrOpts=8192]  - 兼容旧签名 (数字 = maxTokens)；
 *                                                   或传 { maxTokens, userPrefix } 启用 prompt caching
 */
async function callLLM(systemPrompt, userContent, maxTokensOrOpts = 12000) {
  ensureLLMConfigured();
  const opts = typeof maxTokensOrOpts === "object" ? maxTokensOrOpts : { maxTokens: maxTokensOrOpts };
  const { userPrefix = "" } = opts;
  let lastError;

  // Prompt caching: 系统提示 + 用户消息可选前缀
  const cachedSystem = _buildCacheableSystem(systemPrompt);
  const userMessage = _buildCacheableUserMessage(userContent, userPrefix);
  // P2-4 模型路由 + 思考开关（思考算进 max_tokens，故需下限保护）
  // 预算和思考开关都要过 _planTokens 按所选模型的能力裁剪，见其注释。
  const { client, caps, model } = _session(opts);
  const wantThinking = _resolveThinking(opts);
  const plan = _planTokens(opts.maxTokens ?? 12000, wantThinking, caps);
  const thinking = plan.thinking;
  const maxTokens = plan.maxTokens;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`[LLM] 第 ${attempt + 1} 次尝试（延迟 ${delay}ms）...`);
        await sleep(delay);
      }

      const timeout = calcTimeout(maxTokens);
      const reqBody = {
        model,
        max_tokens: maxTokens,
        system: cachedSystem,
        messages: [{ role: "user", content: userMessage }],
      };
      if (thinking !== null) reqBody.thinking = { type: thinking ? "enabled" : "disabled" };
      if (thinking) {
        const effort = _reasoningEffortFor(model, caps, plan.forceLowEffort);
        if (effort) reqBody.reasoning_effort = effort;
      }
      const resp = await withTimeout(
        client.messages.create(reqBody),
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

/**
 * 调用 DeepSeek LLM（深度思考模式，不支持时自动降级），含超时和重试。
 *
 * @param {string} systemPrompt
 * @param {string} userContent
 * @param {number} [maxTokens=16000]
 * @param {number} [thinkingBudget=8000]
 * @param {object} [opts]  P2-4 模型路由信号 { modelTier, skillId, taskHint }
 */
async function callLLMWithThinking(systemPrompt, userContent, maxTokens = 16000, thinkingBudget = 8000, opts = {}) {
  ensureLLMConfigured();
  const { client, caps, model } = _session(opts);
  // 显式开思考 → 走能力裁剪；模型不支持思考时 plan.thinking=false，
  // 直接跳到下面的普通模式降级，不浪费一次必然失败的请求。
  const plan = _planTokens(maxTokens, true, caps, "深度思考任务");
  maxTokens = plan.maxTokens;
  if (!plan.thinking) {
    const fallbackText = await callLLM(systemPrompt, userContent, { maxTokens, ...opts });
    return { thinking: "", text: fallbackText };
  }
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
        // budget_tokens 对 OpenAI 兼容厂商会被裁掉，只有 Anthropic 原生用得上；
        // 思考深度在兼容协议上靠 reasoning_effort 表达。两条路都由 provider 层处理。
        const resp = await withTimeout(
          client.messages.create({
            model,
            max_tokens: maxTokens,
            thinking: { type: "enabled", budget_tokens: Math.min(thinkingBudget, Math.floor(maxTokens / 2)) },
            reasoning_effort: _reasoningEffortFor(model, caps, plan.forceLowEffort),
            system: systemPrompt,
            messages: [{ role: "user", content: userContent }],
          }),
          timeout,
          `callLLMWithThinking(model=${model}, maxTokens=${maxTokens})`
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

  // 降级为普通模式时保持同一档模型，否则 heavy 任务会在 thinking 失败后
  // 悄悄掉到 default 档，出现"同一个任务两次跑在不同模型上"的隐性漂移。
  const text = await callLLM(systemPrompt, userContent, { maxTokens, ...opts });
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
  const { onDelta, signal } = opts;
  ensureLLMConfigured();
  // 交互式对话默认**关思考**：实测流式下模型可能连写 1600+ 字 thinking 而
  // text_delta 一个字都不发，而本函数只把 text_delta 转给前端 —— 用户会盯着
  // 空白等十几秒。调用方确实需要思考时显式传 thinking:true 并给足 maxTokens。
  const { client, caps, model } = _session(opts);
  const plan = _planTokens(opts.maxTokens ?? 4096, _resolveThinking(opts) ?? false, caps, "对话");
  const thinking = plan.thinking;
  const maxTokens = plan.maxTokens;
  const thinkingField = { type: thinking ? "enabled" : "disabled" };
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
              const s = client.messages.stream({
                model,
                max_tokens: maxTokens,
                thinking: thinkingField,
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
        client.messages.create({
          model,
          max_tokens: maxTokens,
          thinking: thinkingField,
          system: systemPrompt,
          messages,
        }),
        timeout,
        `callLLMChat(model=${model}, maxTokens=${maxTokens})`
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

      // 流式不被上游支持（兼容端点常见）→ 改走非流式，下一轮直接降级
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
 * 调用 DeepSeek LLM 并启用 web_search 工具。
 * DeepSeek 没有任何内置检索工具，所以这里把 web_search 声明为普通函数工具，
 * 由本服务端执行博查 Web Search 检索并把结果回填给模型。
 *
 * 回退：若服务端不识别工具，自动降级为普通 callLLM。
 * 未配置 BOCHA_API_KEY 时检索恒返回空，模型会拿到"未取得可用搜索结果"提示。
 *
 * @param {string} systemPrompt
 * @param {string} userContent
 * @param {object} [opts]
 * @param {number} [opts.maxTokens=8192]
 * @param {number} [opts.maxToolRounds=6]
 * @param {string[]} [opts.preSearchQueries] — 服务端先行检索并注入上下文, 避免模型在 JSON 模式下不主动 tool_use
 * @param {string} [opts.modelTier] / [opts.skillId] / [opts.taskHint] — P2-4 模型路由信号
 * @returns {Promise<{ text: string, searchUsed: boolean }>}
 */
async function callLLMWithSearch(systemPrompt, userContent, opts = {}) {
  ensureLLMConfigured();
  const { maxToolRounds = 6, preSearchQueries = [] } = opts;
  const { client, caps, model } = _session(opts);
  const plan = _planTokens(opts.maxTokens ?? 12000, _resolveThinking(opts), caps, "联网核查");
  const thinking = plan.thinking;
  const maxTokens = plan.maxTokens;
  // 模型不支持工具调用时直接不声明工具，靠服务端预检索把证据喂进去，
  // 而不是发一个必然被拒的 tools 字段。
  const toolsSupported = caps.supportsTools !== false;

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
          client.messages.create({
            model,
            max_tokens: maxTokens,
            ...(thinking === null ? {} : { thinking: { type: thinking ? "enabled" : "disabled" } }),
            system: systemPrompt,
            ...(toolsSupported ? { tools } : {}),
            messages: convo,
          }),
          timeout,
          `callLLMWithSearch(model=${model}, round=${round})`
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
          { maxTokens, ...opts }
        );
        return { text, searchUsed: false };
      }
      if (attempt < MAX_RETRIES && isRetryable(err)) continue;
      break;
    }
  }

  // 重试用尽 → 最后再兜底降级
  console.warn("[LLM/Search] 全部重试失败，降级为普通模式:", lastError?.message);
  // 降级同样保持档位，避免 heavy 任务静默掉档
  const text = await callLLM(systemPrompt, userContent, { maxTokens, ...opts });
  return { text, searchUsed: false };
}

function getModelName(opts) {
  // P2-4: 可选传 { skillId, taskHint, modelTier } 查询路由后的实际 model
  return _resolveModel(opts || {});
}

/**
 * 当前生效的 LLM 环境描述。写进分析结果，让用户和排查者都能看到
 * "这份报告是哪个模型出的、有没有因为能力不足降过级"。
 */
function describeActiveLlm(opts = {}) {
  const profile = _activeProfile();
  const model = _resolveModel(opts);
  const caps = resolveCapabilities(profile.providerId, model, profile.capabilityOverrides);
  return {
    source: profile.source,
    provider: profile.providerId,
    model,
    max_output_tokens: caps.maxOutputTokens,
    context_window: caps.contextWindow,
    thinking_style: caps.thinkingStyle,
    supports_tools: caps.supportsTools !== false,
    degrade_notes: getDegradeNotes(),
  };
}

/**
 * 当前模型一次请求能吃下多少字符的输入。
 * pipelineService 用它来决定 BP 原文截断长度 —— 照 DeepSeek 的 1M 上下文
 * 写死 20 万字符，打到 32K 上下文的模型上是必然失败。
 */
function inputBudgetChars(plannedMaxTokens = 8192, opts = {}) {
  const profile = _activeProfile();
  const caps = resolveCapabilities(profile.providerId, _resolveModel(opts), profile.capabilityOverrides);
  return inputCharBudget(caps, plannedMaxTokens);
}

function getModelTier(opts) {
  return _resolveModelTier(opts || {});
}

// ============================================================
// callLLMAgentic — 工作区"类 Claude"调用核心
//
// 把 DeepSeek 的三个能力（thinking / streaming / tool use）合一暴露：
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
  ensureLLMConfigured();
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

  // 之前这里硬用模块级 MODEL 常量，等于绕过了 per-skill 路由，也没法支持 BYOK。
  // 改走 _session：档位、模型、能力、客户端一次解析到位。
  const { client, caps, model: agenticModel } = _session(opts);

  // 三档能力开关。先按**能力矩阵**关掉这个模型本来就不支持的，
  // 再由下面的 catch 按上游报错动态降级（第二道防线）。
  let enableThinking = thinkingBudget > 0 && caps.thinkingStyle !== "none";
  let enableTools = Array.isArray(tools) && tools.length > 0 && caps.supportsTools !== false;
  let enableStream = caps.supportsStreaming !== false;
  if (thinkingBudget > 0 && caps.thinkingStyle === "none") {
    addDegradeNote("所选模型不支持深度思考，工作区对话已按普通模式执行");
  }

  // 思考计入 max_tokens：默认 6000 在开思考时极易被思考吃光导致无正文
  const agenticPlan = _planTokens(maxTokens, enableThinking, caps, "工作区对话");
  const effMaxTokens = agenticPlan.maxTokens;
  enableThinking = agenticPlan.thinking === true;
  const convo = Array.isArray(messages) ? messages.map((m) => ({ ...m })) : [];
  let finalText = "";
  let totalRounds = 0;
  let stopReason = null;

  for (let round = 0; round < Math.max(1, maxToolRounds); round++) {
    if (signal?.aborted) throw new Error("客户端取消");
    totalRounds++;
    safeEmit({ type: "round_start", round });

    const reqBody = {
      model: agenticModel,
      max_tokens: effMaxTokens,
      system,
      messages: convo,
    };
    if (enableThinking) {
      reqBody.thinking = { type: "enabled", budget_tokens: Math.min(thinkingBudget, Math.floor(effMaxTokens / 2)) };
      const effort = _reasoningEffortFor(agenticModel, caps, agenticPlan.forceLowEffort);
      if (effort) reqBody.reasoning_effort = effort;
    }
    if (enableTools) reqBody.tools = tools;

    const timeout = calcTimeout(effMaxTokens) * (enableThinking ? 2 : 1);
    let assistantContent = []; // 收集到的 content blocks，下一轮喂回 convo
    let textInRound = "";

    try {
      if (enableStream) {
        // ── 流式路径 ─────────────────────────────────
        const blocks = {}; // index → { type, ... }
        const stream = await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error(`LLM 请求超时 (${timeout}ms): agentic-stream`)), timeout);
          try {
            const s = client.messages.stream(reqBody);
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
          client.messages.create(reqBody),
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
        // 修复：useSearch 分支此前吞掉了档位信号，heavy skill 一旦开检索就掉回 default
        modelTier,
        skillId,
        taskHint,
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
  getTaskProfile,
  getLlmStats,
  describeActiveLlm,
  inputBudgetChars,
};
