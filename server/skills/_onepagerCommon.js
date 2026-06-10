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
        maxItems: 12,
        items: { type: "string", minLength: 4, maxLength: 240 },
        description: "搜不到/时效存疑/需进一步核实的点",
      },
    },
  };
}

function _formatPoint(p) {
  const tier = p.data_tier ? `[${p.data_tier}] ` : "";
  const srcs = Array.isArray(p.sources) && p.sources.length ? `〔来源: ${p.sources.join("；")}〕` : "〔来源: 待核实〕";
  return `${tier}${p.point} ${srcs}`;
}

/** JSON → generate_docx 的 sections（按模块定义的规范顺序） */
function buildSections(payload, modules) {
  const byKey = new Map((payload.modules || []).map((m) => [m.key, m]));
  const sections = [];
  for (const def of modules) {
    const m = byKey.get(def.key);
    if (!m) continue; // schema 已锁死覆盖，这里只是防御
    const bullets = (m.key_points || []).map(_formatPoint);
    sections.push({
      heading: m.heading || def.heading,
      paragraphs: m.analysis ? [m.analysis] : [],
      bullets,
    });
  }
  const oq = payload.open_questions || [];
  sections.push({
    heading: "数据来源与局限（待核实）",
    paragraphs: ["本报告仅以联网检索（MiniMax web_search）为数据源，无专业金融数据库支撑；下列为搜索未能确证、需进一步核实的点。"],
    bullets: oq.length ? oq : ["（无显著待核实项）"],
  });
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
    "请先用 web_search 充分检索，再严格按 schema 输出 JSON。",
    `modules 必须严格包含全部 ${modules.length} 个模块（key: ${modules.map((m) => m.key).join("、")}），缺一即失败。`,
    "每个 key_point 必须标 data_tier（原始/计算/推理）并尽量挂 sources；搜不到的放进 open_questions 标待核实，不要编造。",
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
