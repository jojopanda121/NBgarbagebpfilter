// ============================================================
// hostToolGuard — workspace host 工具调用守卫 (纯函数, 不调 LLM / 不写 DB)
//
// 道闸:
//   * 单轮最多 1 个工具调用 (paipai 风格硬约束)
//   * skill_id 必须在 catalog (skills.registry.list() + 白名单非 skill 工具)
//   * PPT 模板 skill 严禁传版式字段 (title/slides/color/font/...)
//   * 旧工具名 (generate_onepager / generate_pptx) 走 alias 表归一或显式禁用
//
// 暴露的 API:
//   validateToolCalls(calls, opts)          — 批量校验 (parseToolCalls 风格 [{id, args}])
//   validateNativeToolUses(toolUses, opts)  — anthropic SDK 风格 [{name, input}] 的批量校验
//   guardSingleToolCall(name, input, opts)  — 单调用 (service 入口用)
// ============================================================

const MAX_TOOL_CALLS_PER_TURN = 1;

const PPT_TEMPLATE_IDS = new Set([
  "onepager_pptx",
  "investment_snapshot",
  "project_brief",
  "investment_deck_pptx",
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

const LEGACY_TOOL_ALIASES = {
  generate_onepager: "onepager_pptx",
  generate_pptx:     null,
};

const NON_SKILL_TOOLS = new Set([
  "web_search",
  "generate_docx",
  "generate_xlsx",
  "extract_document",
]);

function _loadCatalog(injected) {
  if (injected instanceof Set) return injected;
  if (Array.isArray(injected)) {
    return new Set([...NON_SKILL_TOOLS, ...injected]);
  }
  const catalog = new Set(NON_SKILL_TOOLS);
  try {
    const skills = require("../../skills");
    skills.init();
    for (const s of skills.registry.list()) catalog.add(s.id);
  } catch {
    // skill registry 不可用, 只用 NON_SKILL_TOOLS 兜底
  }
  return catalog;
}

/**
 * 批量校验工具调用 ([{ id|tool, args }] 形式).
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

  // 道闸 1: 单轮总数 — 整批驳回
  if (calls.length > maxCalls) {
    errors.push({
      index: -1,
      tool: null,
      reason: `单轮最多 ${maxCalls} 个工具调用, 收到 ${calls.length}. 守卫整批驳回.`,
    });
    return { ok: false, errors, accepted: [] };
  }

  const catalog = _loadCatalog(opts.skillCatalog);

  for (let i = 0; i < calls.length; i++) {
    const c = calls[i] || {};
    let id = c.id || c.tool;
    if (!id || typeof id !== "string") {
      errors.push({ index: i, tool: null, reason: "工具名 (id/tool 字段) 为空或非字符串" });
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(LEGACY_TOOL_ALIASES, id)) {
      const target = LEGACY_TOOL_ALIASES[id];
      if (target === null) {
        errors.push({
          index: i,
          tool: id,
          reason: `${id} 已禁用 — 请改用 PPT 模板 skill (onepager_pptx / investment_snapshot / project_brief / investment_deck_pptx). 该工具版式不可控.`,
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

/**
 * anthropic SDK native tool_use 风格批量校验.
 *   toolUses: [{ id?, name, input }]
 * 返回结构与 validateToolCalls 一致, 但 accepted 项保留原 native shape (id/name/input).
 */
function validateNativeToolUses(toolUses, opts = {}) {
  const normalized = (toolUses || []).map((t, i) => ({
    _native: t,
    _index: i,
    id: t && t.name,
    args: (t && t.input) || {},
  }));
  const res = validateToolCalls(normalized, opts);
  // 把 accepted 还原成 native shape
  const accepted = res.accepted.map((a) => {
    const orig = a._native;
    // 如果 legacy alias 重映射了 name, 反映回去
    if (orig && a.id && orig.name !== a.id) {
      return { ...orig, name: a.id };
    }
    return orig;
  });
  return { ok: res.ok, errors: res.errors, accepted };
}

/**
 * 单调用守卫. 给 executeWorkspaceTool 入口使用.
 * 不做计数 (单调用), 只做工具名 + 版式字段 + alias 三道闸.
 */
function guardSingleToolCall(name, input, opts = {}) {
  const calls = [{ id: name, args: input || {} }];
  const res = validateToolCalls(calls, { ...opts, maxCalls: 1 });
  return res;
}

class HostToolGuardError extends Error {
  constructor(errors) {
    const summary = errors.map((e) => `[#${e.index} ${e.tool || "?"}] ${e.reason}`).join("; ");
    super(`[host_tool_guard] ${summary}`);
    this.name = "HostToolGuardError";
    this.errors = errors;
    this.code = "HOST_TOOL_GUARD";
  }
}

module.exports = {
  validateToolCalls,
  validateNativeToolUses,
  guardSingleToolCall,
  HostToolGuardError,
  MAX_TOOL_CALLS_PER_TURN,
  PPT_TEMPLATE_IDS,
  PPT_BANNED_ARG_KEYS,
  LEGACY_TOOL_ALIASES,
  NON_SKILL_TOOLS,
};
