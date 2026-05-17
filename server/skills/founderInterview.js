// ============================================================
// skills/founderInterview.js — 创始人访谈提纲
// 强 harness: Fact Pack → JSON schema → source_refs audit → deterministic Docx
// ============================================================

function _deps() {
  return {
    callLLMJson: require("../services/llmService").callLLMJson,
    buildFactPack: require("./_factPack").buildFactPack,
    formatFactPackForPrompt: require("./_factPack").formatFactPackForPrompt,
    assertGrounded: require("./_groundingAudit").assertGrounded,
    exportDocx: require("./_artifactExport").exportDocx,
  };
}

const SYSTEM = `你是一级市场投资机构的访谈主导，正在设计创始人访谈提纲。

你的目标不是泛泛聊天，而是把投资 thesis 中最脆弱的假设问穿。

硬性约束：
- 只能基于 Fact Pack 设计问题；没有事实支撑时，必须写成“需访谈确认/未披露”。
- 每个问题都必须给 why_ask、good_answer_signal、red_flag_signal、follow_up。
- source_refs 只能引用 Fact Pack 中的 F 编号；不得虚构编号。
- 问题口吻必须适合当面访谈，简洁、尖锐、尊重创始人。
- 禁止宣传词，禁止替公司回答。`;

const SOURCE_REFS = {
  type: "array",
  minItems: 1,
  maxItems: 5,
  items: { type: "string" },
};

const QUESTION = {
  type: "object",
  required: ["question", "why_ask", "good_answer_signal", "red_flag_signal", "follow_up", "source_refs"],
  additionalProperties: false,
  properties: {
    question: { type: "string", minLength: 8, maxLength: 180 },
    why_ask: { type: "string", minLength: 8, maxLength: 240 },
    good_answer_signal: { type: "string", minLength: 4, maxLength: 180 },
    red_flag_signal: { type: "string", minLength: 4, maxLength: 180 },
    follow_up: { type: "string", minLength: 4, maxLength: 180 },
    source_refs: SOURCE_REFS,
  },
};

const SCHEMA = {
  type: "object",
  required: ["title", "opening", "sections", "closing_checks"],
  additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 4, maxLength: 80 },
    opening: { type: "array", minItems: 3, maxItems: 5, items: QUESTION },
    sections: {
      type: "array",
      minItems: 6,
      maxItems: 8,
      items: {
        type: "object",
        required: ["name", "objective", "questions"],
        additionalProperties: false,
        properties: {
          name: {
            type: "string",
            enum: ["创始人动机", "市场判断", "产品技术", "商业化", "财务融资", "团队治理", "红旗追问", "退出与下一轮"],
          },
          objective: { type: "string", minLength: 8, maxLength: 180 },
          questions: { type: "array", minItems: 2, maxItems: 5, items: QUESTION },
        },
      },
    },
    closing_checks: { type: "array", minItems: 3, maxItems: 6, items: QUESTION },
  },
};

// 服务端强制开放式问题校验：封闭式问题自动追加"请详细说明"
const CLOSED_Q_RE = /[吗嘛][\s？?]*$|^是否|^有没有|^能不能|^会不会/;

function _fixClosedQuestions(data) {
  let fixCount = 0;
  const fix = (q) => {
    if (typeof q?.question === "string" && CLOSED_Q_RE.test(q.question.trim())) {
      q.question = q.question.replace(/[\s？?]+$/, "") + "——请详细说明";
      fixCount++;
    }
  };
  (data.opening || []).forEach(fix);
  (data.sections || []).forEach((s) => (s.questions || []).forEach(fix));
  (data.closing_checks || []).forEach(fix);
  return fixCount;
}

function buildDocxSections(payload) {
  const sections = [
    {
      heading: "开场校准",
      bullets: payload.opening.map((q) => `${q.question}｜追问：${q.follow_up}`),
      paragraphs: payload.opening.map((q) => `为什么问：${q.why_ask}`),
    },
  ];

  for (const s of payload.sections) {
    sections.push({
      heading: s.name,
      paragraphs: [s.objective],
      bullets: s.questions.map((q) => (
        `${q.question}｜好答案信号：${q.good_answer_signal}｜红旗：${q.red_flag_signal}｜依据：${q.source_refs.join(", ")}`
      )),
    });
  }

  sections.push({
    heading: "结束前必须确认",
    bullets: payload.closing_checks.map((q) => (
      `${q.question}｜需要听到：${q.good_answer_signal}｜依据：${q.source_refs.join(", ")}`
    )),
  });
  return sections;
}

module.exports = {
  id: "founder_interview_docx",
  title: "创始人访谈提纲",
  description: "基于 Fact Pack 生成创始人访谈提纲，每个问题带追问、好答案信号、红旗信号和事实来源",
  category: "research",
  outputArtifactKind: "docx",
  inputSchema: {
    type: "object",
    properties: {
      interview_stage: { type: "string", description: "可选，如 首次面谈 / IC 前复核 / 交易条款前" },
      focus_areas: { type: "array", items: { type: "string" }, description: "可选，额外关注方向" },
    },
    additionalProperties: false,
  },

  async run({ project, params = {}, ctx = {}, userId }) {
    if (!project) return { ok: false, error: "需要项目上下文" };
    const { callLLMJson, buildFactPack, formatFactPackForPrompt, assertGrounded, exportDocx } = _deps();
    const { factPack } = buildFactPack(project);

    const userMsg = [
      formatFactPackForPrompt(factPack),
      "",
      "【访谈场景】",
      params.interview_stage || "IC 前创始人访谈",
      "",
      "【额外关注方向】",
      (params.focus_areas || []).join("、") || "无",
      "",
      "请按 schema 输出创始人访谈提纲 JSON。",
    ].join("\n");

    const { data, repairs } = await callLLMJson(SYSTEM, userMsg, SCHEMA, { maxTokens: 6144, maxRepairs: 2 });
    const closedQFixes = _fixClosedQuestions(data);
    const audit = assertGrounded(data, factPack, { requiredPaths: ["opening", "closing_checks"] });
    const artifact = await exportDocx({
      title: data.title || "创始人访谈提纲",
      sections: buildDocxSections(data),
      ctx,
      userId,
      artifactTitle: "创始人访谈",
    });

    return {
      ok: true,
      artifact: artifact || {
        kind: "json",
        summary: data.title,
        payload: data,
      },
      metadata: { llm_repairs: repairs, grounding: audit, closed_question_fixes: closedQFixes },
    };
  },
  _private: { SCHEMA, buildDocxSections },
};
