// ============================================================
// server/agents/baseAgent.js — Agent 基类
// 统一接口、重试逻辑、状态追踪、日志
// ============================================================

const { callLLM, callLLMWithSearch } = require("../services/llmService");
const agentRunService = require("../services/agentRunService");
const { publishAgentEvent } = require("../services/sseService");
const { extractJson, diagnoseJsonOutput } = require("../utils/jsonParser");
const { UNTRUSTED_DOC_GUARD, JSON_OUTPUT_DIRECTIVE } = require("../utils/prompts");
const logger = require("../utils/logger");

// think-only / 截断这类"成功返回但没有可用 JSON"的纠偏反馈。
// 注意：不压制思考（深度思考是我们要的），只要求"思考完务必把完整 JSON
// 写出来、不要中途收不了尾"，并配合放大的 token 预算重试。
// reason 见 jsonParser.diagnoseJsonOutput。
function buildJsonRecoveryHint(reason) {
  if (reason === "truncated") {
    return [
      "【上一轮输出的 JSON 被截断、未闭合，无法解析。】",
      "这次预算已放大，请把完整答案写完：可以照常深度思考，",
      "但务必把整个 JSON 写到结束、闭合所有括号，产出一个完整、可被 JSON.parse 解析的对象。",
      "无需为省空间删减内容，只输出该 JSON 本身、不要 markdown 围栏。",
    ].join("");
  }
  // empty / think_only / no_json：上轮思考没收尾、或返回为空、没出 JSON
  return [
    "【上一轮没有产出可解析的 JSON（疑似思考未收尾或返回为空）。】",
    "可以正常深度思考，但思考之后务必输出最终答案：",
    "给出符合要求的完整 JSON 对象，闭合所有括号、确保可被 JSON.parse 解析，不要 markdown 围栏。",
  ].join("");
}

class BaseAgent {
  /**
   * @param {object} opts
   * @param {string} opts.name       — Agent 标识，与 agent_results.agent_name 一致
   * @param {string} opts.systemPrompt — LLM system prompt
   * @param {number} [opts.maxRetries=2]
   * @param {number} [opts.maxTokens=8192]
   * @param {boolean} [opts.useSearch=false] — 是否启用 MiniMax web_search 预检索
   * @param {boolean} [opts.jsonOnly=true] — 输出为纯 JSON 时附加 JSON-only 输出纪律
   */
  constructor({ name, systemPrompt, maxRetries = 2, maxTokens = 8192, useSearch = false, jsonOnly = true }) {
    this.name = name;
    // 所有专家 Agent 都直接消费 BP 原文（不可信第三方输入），统一附加注入防线；
    // 纯 JSON 专家再附加 JSON-only 纪律——不压制思考，只要求最终答案是完整 JSON。
    this.systemPrompt = systemPrompt + UNTRUSTED_DOC_GUARD + (jsonOnly ? JSON_OUTPUT_DIRECTIVE : "");
    this.jsonOnly = jsonOnly;
    this.maxRetries = maxRetries;
    this.maxTokens = maxTokens;
    this.useSearch = useSearch;
  }

  /**
   * 子类必须实现：构建传给 LLM 的 user message
   * @param {object} context — 由 orchestrator 传入，含 bpFullText / extractedData 等
   * @returns {string}
   */
  buildUserMessage(_context) {
    throw new Error(`[${this.name}] buildUserMessage() must be implemented`);
  }

  /**
   * 子类可覆盖：为 callLLMWithSearch 提供服务端预检索 query。
   * 这些 query 会先用 MiniMax $web_search 执行，再注入 LLM 上下文。
   */
  buildSearchQueries(_context) {
    return [];
  }

  /**
   * 子类必须实现：把 LLM 原始文本解析为结构化输出
   * 容错：LLM 可能返回 ```json 包裹，extractJson 会自动处理
   * @param {string} rawText
   * @returns {{ userOutput: object, dataPayload: object }}
   */
  parseResponse(rawText) {
    const parsed = extractJson(rawText);
    if (!parsed) throw new Error(`${this.name}: JSON 解析失败`);
    return { userOutput: parsed, dataPayload: parsed };
  }

  /**
   * 调用 LLM（带重试）。
   *
   * 除了网络/超时等抛出的异常外，还显式探测 MiniMax M3 特有的失败：
   * 推理模型思考没收尾 / 答案被截断、根本不吐完整 JSON（调用成功返回但
   * 内容无可用 JSON，try/catch 抓不到）。命中这类失败时，下一轮带"思考
   * 后务必把完整 JSON 写完"的纠偏反馈、并放大 token 预算重试，而不是原样
   * 重试。不切换模型档位、不压制思考——深度思考本身是我们要的。
   */
  async callLLMWithRetry(userMessage, context = {}) {
    let lastErr;
    let recoveryHint = ""; // 上一轮 think-only/截断后追加的纠偏提示
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const effectiveMessage = recoveryHint
          ? `${userMessage}\n\n${recoveryHint}`
          : userMessage;
        // 纠偏轮放大预算，给"思考 + 完整答案"留足空间（M3 单次可输出 512K）
        const escalatedTokens = recoveryHint
          ? Math.min(this.maxTokens * 2, 24000)
          : this.maxTokens;

        let text;
        if (this.useSearch) {
          const res = await callLLMWithSearch(this.systemPrompt, effectiveMessage, {
            maxTokens: escalatedTokens,
            // 搜索仅首轮执行：JSON 格式失败的重试不该重复烧检索成本
            preSearchQueries: attempt === 0 ? this.buildSearchQueries(context) : [],
          });
          text = res.text;
        } else {
          text = await callLLM(this.systemPrompt, effectiveMessage, escalatedTokens);
        }

        // 显式探测"成功返回但没有可用 JSON"（思考未收尾 / 答案被截断）。
        // 非 JSON Agent（jsonOnly=false）跳过，由各自 parseResponse 处理。
        if (this.jsonOnly) {
          const diag = diagnoseJsonOutput(text);
          if (!diag.ok) {
            recoveryHint = buildJsonRecoveryHint(diag.reason);
            const err = new Error(`LLM 输出无有效 JSON (${diag.reason})`);
            err.jsonDiag = diag.reason;
            throw err;
          }
        }
        return text;
      } catch (err) {
        lastErr = err;
        if (attempt < this.maxRetries) {
          logger.warn(`[${this.name}] attempt ${attempt + 1} failed: ${err.message}，重试中...`);
        }
      }
    }
    throw lastErr;
  }

  /**
   * 主执行入口（由 orchestrator 调用）
   * @param {object} params
   * @param {string} params.runId
   * @param {object} params.context
   * @returns {{ userOutput, dataPayload }}
   */
  async run({ runId, context }) {
    const startedAt = Date.now();
    agentRunService.markAgentStarted(runId, this.name);
    publishAgentEvent(runId, { agent: this.name, status: "running" });

    try {
      const userMessage = this.buildUserMessage(context);
      const rawText = await this.callLLMWithRetry(userMessage, context);
      const { userOutput, dataPayload } = this.parseResponse(rawText);

      const durationMs = Date.now() - startedAt;
      agentRunService.markAgentDone(runId, this.name, { userOutput, dataPayload, tokens: 0, durationMs });
      publishAgentEvent(runId, { agent: this.name, status: "done", userOutput });

      logger.info(`[${this.name}] 完成`, { runId, durationMs });
      return { userOutput, dataPayload };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      agentRunService.markAgentFailed(runId, this.name, { error: err.message, durationMs });
      publishAgentEvent(runId, { agent: this.name, status: "failed", error: err.message });
      logger.warn(`[${this.name}] 失败`, { runId, error: err.message });
      throw err;
    }
  }
}

module.exports = BaseAgent;
