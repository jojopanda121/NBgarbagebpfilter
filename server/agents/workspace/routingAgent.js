// ============================================================
// RoutingAgent — 决定本轮调度哪些专家
// 用 callLLMJson 把"输出契约"硬性化:Schema 不通过自动让模型修。
// 取代之前的手工 parseRoutingJson + 字符串容错。
// ============================================================

const PROMPT = require("../prompts/workspaceRouting.prompt");
const VALID_AGENTS = ["market", "finance", "tech", "risk"];

const ROUTING_SCHEMA = {
  type: "object",
  required: ["agents"],
  additionalProperties: false,
  properties: {
    agents: {
      type: "array",
      maxItems: 4,
      items: { type: "string", enum: VALID_AGENTS },
    },
    reason: { type: "string", maxLength: 200 },
  },
};

function _formatHistory(history, max = 8) {
  return history.slice(-max).map((m) => {
    const tag = m.role === "user" ? "用户" : (m.agent_name || "AI");
    return `【${tag}】${m.content}`;
  }).join("\n");
}

class RoutingAgent {
  constructor() {
    this.name = "routing";
  }

  /**
   * @param {object} ctx — { projectCtx, history, userMsg }
   * @returns {Promise<{ agents: string[], reason: string }>}
   */
  async run({ projectCtx, history, userMsg }) {
    const { callLLMJson } = require("../../services/llmService");
    const userPrompt = `# 项目上下文\n${projectCtx}\n\n# 最近对话\n${_formatHistory(history, 8)}\n\n# 当前用户消息\n${userMsg}`;
    try {
      const { data } = await callLLMJson(PROMPT, userPrompt, ROUTING_SCHEMA, { maxTokens: 512, maxRepairs: 1 });
      // schema 已限定 enum,这里再做一次 dedup
      const agents = [...new Set(data.agents || [])].filter((a) => VALID_AGENTS.includes(a));
      return { agents, reason: data.reason || "" };
    } catch (err) {
      // 路由失败不应影响主流程 — 退化为"无专家协助"
      console.warn(`[RoutingAgent] schema 校验失败,降级为空数组:${err.message}`);
      return { agents: [], reason: "routing_failed" };
    }
  }
}

module.exports = { RoutingAgent, VALID_AGENTS };
