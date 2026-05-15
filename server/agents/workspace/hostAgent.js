// ============================================================
// HostAgent — 工作区主持人,流式输出最终回答
// 输入:projectCtx + history + userMsg + expertOutputs
// 输出:Markdown 文本 + 可选的 <TOOL_CALL> 块
//
// 同时导出 validateToolCalls(calls, opts) — 物理拦截 LLM 跑偏:
//   * 单轮最多 1 个 <TOOL_CALL>
//   * skill_id 必须在 catalog (skills.registry.list() + 白名单非 skill 工具)
//   * PPT 模板 skill 严禁传版式字段 (title/slides/color/font/...)
//   * 旧工具名 (generate_onepager / generate_pptx) 走 alias 表归一或显式禁用
// ============================================================

const { ChatAgent } = require("../chatAgent");
const PROMPT = require("../prompts/workspaceHost.prompt");

// 单轮最多 N 个工具调用 (paipai 风格硬约束). 超出整批驳回.
const MAX_TOOL_CALLS_PER_TURN = 1;

// PPT 模板 skill —— 它们的 args 只能是 schema 里定义的内容字段;
// 一旦出现下列版式字段, 视为 LLM 试图自由发挥, 整条驳回.
const PPT_TEMPLATE_IDS = new Set([
  "onepager_pptx",
  "investment_snapshot",
  "project_brief",
]);

const PPT_BANNED_ARG_KEYS = new Set([
  "title", "subtitle",
  "color", "colour", "palette",
  "font", "fontFace", "fontFamily", "fontSize", "font_size",
  "slides", "layout", "theme",
  "pageCount", "page_count", "pages",
  "bg", "background", "bgcolor",
  "css", "style", "styles",
]);

// 旧工具名的 alias 表: null = 直接拒绝, string = 重映射到新名字.
const LEGACY_TOOL_ALIASES = {
  generate_onepager: "onepager_pptx",   // legacy → 新模板
  generate_pptx:     null,              // 自由 PPT 已禁用, 无替代
};

// 非 skill 但合法的工具白名单 (与 workspaceRegistry 一致).
const NON_SKILL_TOOLS = new Set([
  "web_search",
  "generate_docx",
  "generate_xlsx",
  "extract_document",
]);

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

/**
 * 拦截 host 输出的 tool_calls. 纯函数, 不调 LLM / 不写 DB.
 *
 * @param {Array} calls         parseToolCalls 返回的数组 (每项形如 { id|tool, args })
 * @param {object} [opts]
 * @param {number} [opts.maxCalls]   单轮上限, 默认 MAX_TOOL_CALLS_PER_TURN
 * @param {Set<string>} [opts.skillCatalog]  注入用 (测试中 mock catalog 用)
 * @returns {{ok:boolean, errors:Array<{index:number, tool:?string, reason:string}>, accepted:Array}}
 */
function validateToolCalls(calls, opts = {}) {
  const { maxCalls = MAX_TOOL_CALLS_PER_TURN } = opts;
  const errors = [];
  const accepted = [];

  if (!Array.isArray(calls)) {
    return { ok: true, errors, accepted };
  }
  if (calls.length === 0) {
    return { ok: true, errors, accepted };
  }

  // 道闸 1: 单轮总数
  if (calls.length > maxCalls) {
    errors.push({
      index: -1,
      tool: null,
      reason: `单轮最多 ${maxCalls} 个工具调用, 收到 ${calls.length}. 守卫整批驳回.`,
    });
    return { ok: false, errors, accepted: [] };
  }

  // 加载 catalog (允许测试注入)
  let catalog = opts.skillCatalog;
  if (!catalog) {
    catalog = new Set(NON_SKILL_TOOLS);
    try {
      const skills = require("../../skills");
      skills.init();
      for (const s of skills.registry.list()) catalog.add(s.id);
    } catch {
      // skill registry 不可用时, 只用 NON_SKILL_TOOLS 兜底
    }
  } else if (!(catalog instanceof Set)) {
    // 兼容传数组的测试调用
    catalog = new Set([...NON_SKILL_TOOLS, ...catalog]);
  }

  // 道闸 2: 每条 call 单独校验
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i] || {};
    let id = c.id || c.tool;
    if (!id || typeof id !== "string") {
      errors.push({ index: i, tool: null, reason: "工具名 (id/tool 字段) 为空或非字符串" });
      continue;
    }

    // legacy alias 归一 (或直接拒绝)
    if (Object.prototype.hasOwnProperty.call(LEGACY_TOOL_ALIASES, id)) {
      const target = LEGACY_TOOL_ALIASES[id];
      if (target === null) {
        errors.push({
          index: i,
          tool: id,
          reason: `${id} 已禁用 — 请改用 PPT 模板 skill (onepager_pptx / investment_snapshot / project_brief). 该工具版式不可控.`,
        });
        continue;
      }
      id = target;
    }

    if (!catalog.has(id)) {
      errors.push({
        index: i,
        tool: id,
        reason: `skill_id "${id}" 不在 catalog. LLM 严禁发明工具名.`,
      });
      continue;
    }

    // 道闸 3: PPT 模板严禁版式字段
    if (PPT_TEMPLATE_IDS.has(id) && c.args && typeof c.args === "object" && !Array.isArray(c.args)) {
      const banned = Object.keys(c.args).filter((k) => PPT_BANNED_ARG_KEYS.has(k));
      if (banned.length > 0) {
        errors.push({
          index: i,
          tool: id,
          reason: `PPT 模板 ${id} 严禁传版式字段: ${banned.join(", ")}. 版式锁在渲染器, args 只填内容字段.`,
        });
        continue;
      }
    }

    accepted.push({ ...c, id, tool: id });
  }

  return { ok: errors.length === 0, errors, accepted };
}

module.exports = {
  HostAgent,
  validateToolCalls,
  MAX_TOOL_CALLS_PER_TURN,
  PPT_TEMPLATE_IDS,
  PPT_BANNED_ARG_KEYS,
  LEGACY_TOOL_ALIASES,
  NON_SKILL_TOOLS,
};
