// ============================================================
// server/agents/baseAgent.js — Agent 基类
// 统一接口、重试逻辑、状态追踪、日志
// ============================================================

const { callLLM, callLLMWithSearch } = require("../services/llmService");
const agentRunService = require("../services/agentRunService");
const { publishAgentEvent } = require("../services/sseService");
const { extractJson } = require("../utils/jsonParser");
const logger = require("../utils/logger");

class BaseAgent {
  /**
   * @param {object} opts
   * @param {string} opts.name       — Agent 标识，与 agent_results.agent_name 一致
   * @param {string} opts.systemPrompt — LLM system prompt
   * @param {number} [opts.maxRetries=2]
   * @param {number} [opts.maxTokens=6144]
   * @param {boolean} [opts.useSearch=false] — 是否启用 web_search（仅 CompetitorAgent 用）
   */
  constructor({ name, systemPrompt, maxRetries = 2, maxTokens = 6144, useSearch = false }) {
    this.name = name;
    this.systemPrompt = systemPrompt;
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
   * 调用 LLM（带重试）
   */
  async callLLMWithRetry(userMessage) {
    let lastErr;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (this.useSearch) {
          const { text } = await callLLMWithSearch(this.systemPrompt, userMessage, { maxTokens: this.maxTokens });
          return text;
        }
        const text = await callLLM(this.systemPrompt, userMessage, this.maxTokens);
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
      const rawText = await this.callLLMWithRetry(userMessage);
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
