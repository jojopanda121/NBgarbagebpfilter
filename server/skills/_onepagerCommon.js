// ============================================================
// skills/_onepagerCommon.js — 行业/公司一页纸的共享 schema + 渲染 + 执行
// 两个 skill 同构，差异只在 模块定义 + system prompt + 入参字段。
// ============================================================

function _deps() {
  return {
    callLLMJson: require("../services/llmService").callLLMJson,
    exportDocx: require("./_artifactExport").exportDocx,
  };
}

/** 按模块定义生成强制覆盖的 JSON schema（minItems=maxItems=模块数，锁死覆盖度） */
function makeSchema(modules) {
  const keys = modules.map((m) => m.key);
  return {
    type: "object",
    required: ["subject", "modules", "open_questions"],
    additionalProperties: false,
    properties: {
      subject: { type: "string", minLength: 1, maxLength: 120 },
      modules: {
        type: "array",
        minItems: keys.length,
        maxItems: keys.length,
        items: {
          type: "object",
          required: ["key", "heading", "analysis", "key_points"],
          additionalProperties: false,
          properties: {
            key: { type: "string", enum: keys },
            heading: { type: "string", minLength: 2, maxLength: 60 },
            analysis: { type: "string", minLength: 20, maxLength: 1800 },
            key_points: {
              type: "array",
              minItems: 0,
              maxItems: 8,
              items: {
                type: "object",
                required: ["point", "data_tier", "sources"],
                additionalProperties: false,
                properties: {
                  point: { type: "string", minLength: 4, maxLength: 320 },
                  // 原始/计算/推理三层：推理必须显式标，不得伪装成事实
                  data_tier: { type: "string", enum: ["原始", "计算", "推理"] },
                  sources: { type: "array", maxItems: 6, items: { type: "string", maxLength: 200 } },
                },
              },
            },
          },
        },
      },
      open_questions: {
        type: "array",
        maxItems: 8,
        items: { type: "string", minLength: 4, maxLength: 240 },
        description: "可选：真正重大、值得持续跟踪的关键变量/不确定性；没有就空数组，不要堆没查到的数据",
      },
    },
  };
}

// 正文 bullet 走干净研报行文：只出要点本身，不堆 [分层]/来源 标签。
// （来源/分层留在结构化 payload 与 metadata 里，不污染成品观感。）
function _formatPoint(p) {
  return typeof p === "string" ? p : String(p.point || "");
}

/** JSON → generate_docx 的 sections（按模块定义的规范顺序） */
function buildSections(payload, modules) {
  const byKey = new Map((payload.modules || []).map((m) => [m.key, m]));
  const sections = [];
  for (const def of modules) {
    const m = byKey.get(def.key);
    if (!m) continue; // schema 已锁死覆盖，这里只是防御
    const bullets = (m.key_points || []).map(_formatPoint).filter(Boolean);
    sections.push({
      heading: m.heading || def.heading,
      paragraphs: m.analysis ? [m.analysis] : [],
      bullets,
    });
  }
  // open_questions 仅在确有"值得持续跟踪的关键变量"时才作为一节正常研报内容呈现，
  // 不再用"数据来源与局限/待核实"这种半成品式免责堆。空则不加这一节。
  const oq = (payload.open_questions || []).filter(Boolean);
  if (oq.length) {
    sections.push({
      heading: "需持续跟踪的关键变量",
      paragraphs: [],
      bullets: oq,
    });
  }
  return sections;
}

/**
 * 执行一页纸生成：检索接地 → 结构化 JSON → docx。
 * 不依赖上传项目(project 可为 null)，唯一数据源是 web_search。
 */
async function runOnepager({ subject, subjectLabel, system, modules, docTitle, skillId, ctx, userId }) {
  const { callLLMJson, exportDocx } = _deps();
  const schema = makeSchema(modules);

  const userMsg = [
    `${subjectLabel}：${subject}`,
    "",
    "请先用 web_search 充分检索，再严格按 schema 输出 JSON，产出一份完整、像样的买方投研报告。",
    `modules 必须严格包含全部 ${modules.length} 个模块（key: ${modules.map((m) => m.key).join("、")}），缺一即失败；每个模块都要写满写实，不许留空。`,
    "查得到的硬数据直接用、可顺带提及出处(sources)；查不到的用'据行业估算约/我们测算/X–Y区间'等措辞给合理判断，不要留'待核实'、也不要假造精确数字。",
    "open_questions 只放真正重大、值得持续跟踪的关键变量（可选，没有就空数组）——不是用来堆没查到的东西。",
  ].join("\n");

  const { data, repairs, searchUsed } = await callLLMJson(system, userMsg, schema, {
    useSearch: true,
    maxTokens: 12000,
    maxRepairs: 2,
    skillId,
  });

  const sections = buildSections(data, modules);
  const title = docTitle(data.subject || subject);
  const artifact = await exportDocx({ title, sections, ctx, userId, artifactTitle: title });

  // 统计接地质量：有来源的 key_point 占比
  let total = 0, sourced = 0, inferred = 0;
  for (const m of data.modules || []) {
    for (const p of m.key_points || []) {
      total++;
      if (Array.isArray(p.sources) && p.sources.length) sourced++;
      if (p.data_tier === "推理") inferred++;
    }
  }

  return {
    ok: true,
    artifact: artifact || { kind: "json", summary: title, payload: data },
    metadata: {
      llm_repairs: repairs,
      evidence_search_used: !!searchUsed,
      onepager_points_total: total,
      onepager_points_sourced: sourced,
      onepager_points_inferred: inferred,
      onepager_open_questions: (data.open_questions || []).length,
    },
  };
}

module.exports = { makeSchema, buildSections, runOnepager, _formatPoint };
