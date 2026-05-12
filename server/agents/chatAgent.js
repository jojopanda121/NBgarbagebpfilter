// ============================================================
// server/agents/chatAgent.js — 工作区对话 Agent 基类
//
// 与 BaseAgent 的区别:
//   - BaseAgent 产出结构化 JSON,落 agent_results,服务于"BP 分析报告"
//   - ChatAgent 产出文本(可流式),服务于"投资人对话",不落 agent_results
//
// 共用:
//   - 统一日志 / 重试 / 取消 / SSE 事件命名
//   - useSearch 开关(market / risk 走 web_search)
//   - 失败语义:抛 ChatAgentError(name=this.name, message),由调度层捕获
//
// 子类必须实现:
//   - buildUserMessage({ projectCtx, history, userMsg, expertOutputs }) → string
//   并可选实现:
//   - parseRouting()        若返回 JSON(如 RoutingAgent),走 callLLMJson + schema
// ============================================================

const logger = require("../utils/logger");

class ChatAgentError extends Error {
  constructor(agentName, msg) {
    super(msg);
    this.name = "ChatAgentError";
    this.agentName = agentName;
  }
}

class ChatAgent {
  /**
   * @param {object} opts
   * @param {string}  opts.name         agent 标识(如 "host" / "market")
   * @param {string}  opts.systemPrompt
   * @param {boolean} [opts.useSearch=false]
   * @param {number}  [opts.maxTokens=1500]
   */
  constructor({ name, systemPrompt, useSearch = false, maxTokens = 1500 }) {
    if (!name || !systemPrompt) throw new Error("ChatAgent 需要 name + systemPrompt");
    this.name = name;
    this.systemPrompt = systemPrompt;
    this.useSearch = useSearch;
    this.maxTokens = maxTokens;
  }

  /** 子类必须实现 — 把上下文拼成 user message */
  buildUserMessage(_ctx) {
    throw new Error(`[${this.name}] buildUserMessage() must be implemented`);
  }

  /**
   * 一次性返回完整文本(非流式)。子类可直接用,或被 host 子类覆盖以走流式。
   *
   * @param {object} ctx — { projectCtx, history, userMsg, expertOutputs? }
   * @returns {Promise<{ text: string, searchUsed?: boolean }>}
   */
  async run(ctx) {
    const { callLLM, callLLMWithSearch } = require("../services/llmService");
    const userPrompt = this.buildUserMessage(ctx);

    try {
      if (this.useSearch) {
        const { text, searchUsed } = await callLLMWithSearch(
          this.systemPrompt, userPrompt, { maxTokens: this.maxTokens }
        );
        return { text: (text || "").trim(), searchUsed };
      }
      const text = await callLLM(this.systemPrompt, userPrompt, this.maxTokens);
      return { text: (text || "").trim() };
    } catch (err) {
      logger.warn(`[ChatAgent/${this.name}] 失败: ${err.message}`);
      throw new ChatAgentError(this.name, err.message);
    }
  }

  /**
   * 流式输出 — host 用。子类可覆盖以做更精细的控制。
   *
   * @param {object} ctx
   * @param {(delta:string)=>void} onDelta
   * @param {AbortSignal} [signal]
   * @returns {Promise<{ text: string }>}
   */
  async runStream(ctx, onDelta, signal) {
    const { callLLMChat } = require("../services/llmService");
    const userPrompt = this.buildUserMessage(ctx);
    try {
      const text = await callLLMChat(
        this.systemPrompt,
        [{ role: "user", content: userPrompt }],
        { maxTokens: this.maxTokens, onDelta, signal }
      );
      return { text: (text || "").trim() };
    } catch (err) {
      logger.warn(`[ChatAgent/${this.name}] stream 失败: ${err.message}`);
      throw new ChatAgentError(this.name, err.message);
    }
  }
}

module.exports = { ChatAgent, ChatAgentError };
