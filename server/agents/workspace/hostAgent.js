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

// 动态拉 PPT 模板 catalog —— host prompt 不写死模板列表,这里每次对话刷新.
// 任何用 pptxTemplate 元数据注册的 skill 自动出现在这里.
function _buildPptxCatalogBlock() {
  let templates = [];
  try {
    const skills = require("../../skills");
    skills.init();
    templates = skills.registry.listPptxTemplates() || [];
  } catch {
    return "(PPT 模板 catalog 不可用 —— 此时严禁追加任何 PPT 相关 TOOL_CALL,直接告知用户)";
  }
  if (templates.length === 0) {
    return "(PPT 模板 catalog 为空 —— 严禁追加任何 PPT 相关 TOOL_CALL。直接告知用户当前无可用模板。)";
  }
  return templates
    .map((t, i) => {
      const lines = [
        `## ${i + 1}. ${t.title}  (id: \`${t.id}\`)`,
        `- 适用场景: ${t.useCase}`,
        t.pageCount ? `- 页数: ${t.pageCount}` : null,
        t.argsHint ? `- 调用形如: ${t.argsHint}` : null,
      ].filter(Boolean);
      return lines.join("\n");
    })
    .join("\n\n");
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
      `# 可用 PPT 模板`,
      `(以下是后端当前注册的全部 PPT 模板。系统 prompt 的 PPT 硬规则要求你只能从这里选 id 调用,`,
      `不要发明 args 字段。空表示无模板可用,此时严禁追加 PPT 相关 TOOL_CALL。)`,
      ``,
      _buildPptxCatalogBlock(),
      ``,
      `请融会贯通后给用户回答。`,
    ].join("\n");
  }
}

module.exports = { HostAgent };
