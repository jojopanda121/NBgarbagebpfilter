// ============================================================
// ExpertAgent — 4 类专家(market / finance / tech / risk)的统一类
// market 和 risk 走 web_search,其余走普通 LLM。
// ============================================================

const { ChatAgent } = require("../chatAgent");
const EXPERT_PROMPTS = require("../prompts/workspaceExperts.prompt");

const SEARCH_ENABLED = new Set(["market", "risk"]);

function _formatHistory(history, max = 6) {
  return history.slice(-max).map((m) => {
    const tag = m.role === "user" ? "用户" : (m.agent_name || "AI");
    return `【${tag}】${m.content}`;
  }).join("\n");
}

class ExpertAgent extends ChatAgent {
  /**
   * @param {"market"|"finance"|"tech"|"risk"} agentName
   */
  constructor(agentName) {
    const prompt = EXPERT_PROMPTS[agentName];
    if (!prompt) throw new Error(`未知 expert agent: ${agentName}`);
    super({
      name: agentName,
      systemPrompt: prompt,
      useSearch: SEARCH_ENABLED.has(agentName),
      maxTokens: 1500,
    });
  }

  buildUserMessage({ projectCtx, history, userMsg }) {
    return [
      `# 项目上下文`,
      projectCtx,
      ``,
      `# 最近对话`,
      _formatHistory(history, 6),
      ``,
      `# 用户当前问题`,
      userMsg,
    ].join("\n");
  }
}

module.exports = { ExpertAgent };
