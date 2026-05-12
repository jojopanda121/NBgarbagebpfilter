// ============================================================
// HostAgent — 工作区主持人,流式输出最终回答
// 输入:projectCtx + history + userMsg + expertOutputs
// 输出:Markdown 文本 + 可选的 <TOOL_CALL> 块
// ============================================================

const { ChatAgent } = require("../chatAgent");
const PROMPT = require("../prompts/workspaceHost.prompt");

function _formatHistory(history, max = 8) {
  return history.slice(-max).map((m) => {
    const tag = m.role === "user" ? "用户" : (m.agent_name || "AI");
    return `【${tag}】${m.content}`;
  }).join("\n");
}

class HostAgent extends ChatAgent {
  constructor() {
    super({ name: "host", systemPrompt: PROMPT, useSearch: false, maxTokens: 3000 });
  }

  buildUserMessage({ projectCtx, history, userMsg, expertOutputs = [] }) {
    const expertBlock = expertOutputs.length > 0
      ? expertOutputs.map((e) => `## ${e.agent} 专家意见\n${e.content}`).join("\n\n")
      : "(无专家协助,直接回答)";
    return [
      `# 项目上下文`,
      projectCtx,
      ``,
      `# 最近对话`,
      _formatHistory(history, 8),
      ``,
      `# 用户当前消息`,
      userMsg,
      ``,
      `# 专家意见汇总`,
      expertBlock,
      ``,
      `请融会贯通后给用户回答。`,
    ].join("\n");
  }
}

module.exports = { HostAgent };
