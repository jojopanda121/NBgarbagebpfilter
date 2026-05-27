// ============================================================
// skills/founderInterview.js — 创始人访谈提纲
// 强 harness: Fact Pack → JSON schema → source_refs audit → deterministic Docx
// ============================================================

function _deps() {
  return {
    callLLMJson: require("../services/llmService").callLLMJson,
    buildEvidencePack: require("./_factPack").buildEvidencePack,
    formatFactPackForPrompt: require("./_factPack").formatFactPackForPrompt,
    assertGrounded: require("./_groundingAudit").assertGrounded,
    semanticGroundingAudit: require("./_groundingAudit").semanticGroundingAudit,
    summarizeFallback: require("./_groundingAudit").summarizeFallback,
    exportDocx: require("./_artifactExport").exportDocx,
  };
}

const SYSTEM = `你是一级市场投资机构的访谈主导，正在设计创始人访谈提纲。

你的目标不是泛泛聊天，而是把投资 thesis 中最脆弱的假设问穿。

硬性约束：
- 只能基于 Fact Pack 设计问题；没有事实支撑时，必须写成”需访谈确认/未披露”。
- 每个问题都必须给 why_ask、good_answer_signal、red_flag_signal、follow_up。
- source_refs 只能引用 Fact Pack 中的 F 编号；不得虚构编号。
- 问题口吻必须适合当面访谈，简洁、尖锐、尊重创始人。
- 禁止宣传词，禁止替公司回答。

【外部背调线索 — background_signals 段】
- 扫描 Fact Pack 中的负面/异常信号：商业纠纷、诉讼、被列被执行人、频繁离职、上一家公司倒闭/被收购、合伙人散伙、学历背景核实问题、之前融资标的 verdict 异常等。
- 每条线索必须 source_refs 引用具体 F 编号，并衍生一条**旁敲侧击**的访谈追问（不要直接审讯式发问，给创始人体面回应空间）。
- Fact Pack 中**没有任何**负面/异常信号时，输出 1 条 \`signal_type: “无明显信号”\` 的占位（表示已主动扫描过），但 \`probe_question\` 写成”暂无需追问，建议常规聊履历”。

【极限施压 — stress_test_scenarios 段】
固定包含以下 3 个场景（顺序可微调，但 scenario_id 严格匹配 enum）：
- giant_free_competition：”如果腾讯/微软/字节明天推出免费同类产品，你们 12 个月内的应对方案？”
- runway_six_months：”如果本轮融资延后 6 个月、现金只能撑到那时，你会砍掉哪些业务、保哪些团队？”
- top_customer_loss：”如果第一大客户（占比 _% 见 Fact Pack）下季度不续约，复制时间和现金影响？”
每个场景必须：
- 引用 Fact Pack 相关数字（如客户集中度、跑道月数、巨头近期动作）；找不到就明确写”待访谈核实数据”。
- listen_for 写”好答案应该听到的具体决策动作”（不是空话）。
- red_flag_response 写”如果创始人这么答就是危险信号”。`;

const SOURCE_REFS = {
  type: "array",
  minItems: 0,
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

const BG_SIGNAL = {
  type: "object",
  required: ["signal_type", "fact_summary", "probe_question", "source_refs"],
  additionalProperties: false,
  properties: {
    signal_type: {
      type: "string",
      enum: [
        "商业纠纷",
        "诉讼/被执行",
        "频繁离职",
        "上一家公司异常退出",
        "合伙人散伙",
        "学历/履历存疑",
        "前置融资 verdict 异常",
        "媒体负面",
        "无明显信号",
      ],
    },
    fact_summary: { type: "string", minLength: 4, maxLength: 220 },
    probe_question: { type: "string", minLength: 6, maxLength: 200 },
    follow_up: { type: "string", maxLength: 180 },
    source_refs: {
      type: "array",
      // 允许 "无明显信号" 占位无 source_refs；有信号时强制 ≥1
      minItems: 0,
      maxItems: 5,
      items: { type: "string" },
    },
  },
};

const STRESS_SCENARIO = {
  type: "object",
  required: ["scenario_id", "scenario_prompt", "context_anchor", "listen_for", "red_flag_response", "source_refs"],
  additionalProperties: false,
  properties: {
    scenario_id: {
      type: "string",
      enum: ["giant_free_competition", "runway_six_months", "top_customer_loss"],
    },
    scenario_prompt: { type: "string", minLength: 10, maxLength: 280 },
    context_anchor: { type: "string", minLength: 4, maxLength: 220 },
    listen_for: { type: "string", minLength: 6, maxLength: 220 },
    red_flag_response: { type: "string", minLength: 6, maxLength: 220 },
    source_refs: {
      type: "array",
      minItems: 0,
      maxItems: 5,
      items: { type: "string" },
    },
  },
};

const SCHEMA = {
  type: "object",
  required: ["title", "opening", "sections", "background_signals", "stress_test_scenarios", "closing_checks"],
  additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 4, maxLength: 80 },
    opening: { type: "array", minItems: 3, maxItems: 5, items: QUESTION },
    sections: {
      type: "array",
      minItems: 4,
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
    background_signals: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: BG_SIGNAL,
    },
    stress_test_scenarios: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: STRESS_SCENARIO,
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

  // 外部背调线索段
  if (Array.isArray(payload.background_signals) && payload.background_signals.length > 0) {
    sections.push({
      heading: "外部背调线索追问（旁敲侧击）",
      paragraphs: ["以下问题来自 Fact Pack 中扫描到的异常信号，建议在中后段插入，不要开场就问。"],
      bullets: payload.background_signals.map((s) => (
        `[${s.signal_type}] ${s.fact_summary}｜追问：${s.probe_question}` +
        (s.follow_up ? `｜延伸：${s.follow_up}` : "") +
        (s.source_refs && s.source_refs.length ? `｜依据：${s.source_refs.join(", ")}` : "")
      )),
    });
  }

  // 极限施压场景段
  const STRESS_LABELS = {
    giant_free_competition: "巨头免费冲击",
    runway_six_months: "资金 6 个月",
    top_customer_loss: "核心客户流失",
  };
  if (Array.isArray(payload.stress_test_scenarios) && payload.stress_test_scenarios.length > 0) {
    sections.push({
      heading: "极限施压场景（必跑 3 题）",
      paragraphs: ["这 3 个场景用来检验创始人的判断力与韧性，听决策动作和数字，不听口号。"],
      bullets: payload.stress_test_scenarios.map((s) => (
        `【${STRESS_LABELS[s.scenario_id] || s.scenario_id}】${s.scenario_prompt}` +
        `｜锚定事实：${s.context_anchor}` +
        `｜好答案听点：${s.listen_for}` +
        `｜红旗回答：${s.red_flag_response}` +
        (s.source_refs && s.source_refs.length ? `｜依据：${s.source_refs.join(", ")}` : "")
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
      enable_semantic_audit: {
        type: "boolean",
        description: "可选。对生成的访谈问题做语义抽样校验。默认走 env ENABLE_SEMANTIC_AUDIT。",
      },
      enable_bp_deep_parsing: {
        type: "boolean",
        description: "可选。兼容旧参数；上传结构化证据会用于设计 LTV/CAC、跑道、客户集中度等精准追问。",
      },
    },
    additionalProperties: false,
  },

  async run({ project, params = {}, ctx = {}, userId }) {
    if (!project) return { ok: false, error: "需要项目上下文" };
    const {
      callLLMJson, buildEvidencePack, formatFactPackForPrompt, assertGrounded,
      semanticGroundingAudit, exportDocx,
    } = _deps();
    const { factPack, searchUsed, uploadCount, uploadStructuredUsed, uploadStructuredFactCount } = await buildEvidencePack(project, {
      ctx,
      skillId: "founder_interview_docx",
      useSearch: true,
      materialsHint: `${params.interview_stage || ""} ${(params.focus_areas || []).join(" ")}`,
      enableBpDeepParsing: params.enable_bp_deep_parsing,
    });

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

    const { data, repairs } = await callLLMJson(SYSTEM, userMsg, SCHEMA, {
      maxTokens: 6144, maxRepairs: 3,
      skillId: "founder_interview_docx",
    });
    const closedQFixes = _fixClosedQuestions(data);
    let audit;
    try {
      audit = assertGrounded(data, factPack, { requiredPaths: ["opening", "closing_checks"] });
    } catch (groundingErr) {
      // 降级为警告，不阻塞文档生成
      audit = {
        ok: false,
        errors: groundingErr.audit?.errors || [],
        warnings: ["部分访谈问题缺少事实引用(source_refs)，建议人工补充"],
        referenced_count: groundingErr.audit?.referenced_count || 0,
      };
    }
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
      metadata: {
        llm_repairs: repairs,
        grounding: audit,
        closed_question_fixes: closedQFixes,
        evidence_search_used: searchUsed,
        upload_facts_used: uploadCount,
        upload_structured_used: !!uploadStructuredUsed,
        upload_structured_fact_count: uploadStructuredFactCount || 0,
        semantic_audit: await (async () => {
          const enable = params.enable_semantic_audit === true
            || (params.enable_semantic_audit !== false && process.env.ENABLE_SEMANTIC_AUDIT === "1");
          if (!enable) return null;
          return semanticGroundingAudit(data, factPack, {
            sampleRate: 0.3, maxSamples: 12, skillId: "founder_interview_docx",
          });
        })(),
      },
    };
  },
  _private: { SCHEMA, buildDocxSections },
};
