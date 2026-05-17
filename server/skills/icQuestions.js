// ============================================================
// skills/icQuestions.js — IC 投委问题清单（左右脑互搏 · 3 步串行 Pipeline）
//
// Bull Agent  → 构建投资论据（乐观方）
// Bear Agent  → 针对 Bull 论据精准反驳（悲观方，接收 Bull 输出）
// Synthesizer → 合成 IC 问题清单 + 建议回答（接收 Bull+Bear 输出）
//
// 三步串行确保 Bear 真正看到 Bull 再攻击，实现真正的"左右脑互搏"。
// ============================================================

function _deps() {
  return {
    callLLMJson: require("../services/llmService").callLLMJson,
    buildFactPack: require("./_factPack").buildFactPack,
    formatFactPackForPrompt: require("./_factPack").formatFactPackForPrompt,
    assertGrounded: require("./_groundingAudit").assertGrounded,
    exportXlsx: require("./_artifactExport").exportXlsx,
  };
}

// ── Step 1: Bull Agent ──────────────────────────────────────

const SYSTEM_BULL = `你是项目的坚定支持者——一个热情但理性的 Deal Champion。
你的任务是从 Fact Pack 中构建最强的投资论据。

硬性约束：
- 每条论据必须引用 Fact Pack 的 F 编号（source_refs），不得虚构。
- 不要复读 BP 的话术，你需要用投资逻辑重构论点：为什么此时此刻这个团队能赢？
- confidence 必须如实反映事实支撑强度：strong 有硬数据、medium 有间接信号、weak 仅凭逻辑推断。
- 禁止宣传词："颠覆""独角兽潜质""革命性""全球领先""弯道超车"。`;

const SCHEMA_BULL = {
  type: "object",
  required: ["thesis_statement", "key_strengths"],
  additionalProperties: false,
  properties: {
    thesis_statement: { type: "string", minLength: 30, maxLength: 500 },
    key_strengths: {
      type: "array",
      minItems: 4,
      maxItems: 8,
      items: {
        type: "object",
        required: ["point", "evidence", "confidence", "source_refs"],
        additionalProperties: false,
        properties: {
          point: { type: "string", minLength: 8, maxLength: 180 },
          evidence: { type: "string", minLength: 8, maxLength: 300 },
          confidence: { type: "string", enum: ["强", "中", "弱"] },
          source_refs: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } },
        },
      },
    },
  },
};

// ── Step 2: Bear Agent ──────────────────────────────────────

const SYSTEM_BEAR = `你是投委会中最严苛的风控官。你将看到一份项目的 Bull Case（支持投资的论据），你的任务是逐条找致命漏洞。

硬性约束：
- 每条反驳必须精准指向 Bull Case 的某条论据（attack_target 写 Bull 的论点原文摘要）。
- objection_type 必须分类，不要都写"事实缺口"。
- 如果攻击基于事实，source_refs 引用 Fact Pack 的 F 编号。
- 如果攻击基于假设脆弱性（"即使这个数据是真的，结论也不成立"），source_refs 可以为空，但 objection_type 必须标为"假设脆弱"。
- killer_question 是一击致命的追问，投资人在 IC 上会直接问的那种。
- 不要泛泛而谈"市场风险大"，必须精准打击每一条论据的逻辑弱点、数据缺口或隐含假设。
- 禁止宣传词。`;

const SCHEMA_BEAR = {
  type: "object",
  required: ["counter_arguments"],
  additionalProperties: false,
  properties: {
    counter_arguments: {
      type: "array",
      minItems: 4,
      maxItems: 12,
      items: {
        type: "object",
        required: ["attack_target", "objection", "objection_type", "severity", "killer_question", "data_gap", "source_refs"],
        additionalProperties: false,
        properties: {
          attack_target: { type: "string", minLength: 4, maxLength: 180 },
          objection: { type: "string", minLength: 12, maxLength: 300 },
          objection_type: { type: "string", enum: ["事实缺口", "假设脆弱", "数字冲突", "市场竞争", "团队治理", "财务压力", "退出路径"] },
          severity: { type: "string", enum: ["高", "中", "低"] },
          killer_question: { type: "string", minLength: 8, maxLength: 200 },
          data_gap: { type: "string", maxLength: 200 },
          source_refs: { type: "array", minItems: 0, maxItems: 5, items: { type: "string" } },
        },
      },
    },
  },
};

// ── Step 3: Synthesizer ─────────────────────────────────────

const SYSTEM_SYNTH = `你是 IC 会议准备的首席策略师。你将看到同一个项目的 Bull Case（乐观论据）和 Bear Case（质疑反驳）。

你的任务：合成出投委会最可能问的 10-15 个问题，按杀伤力排序。

硬性约束：
- 问题必须从 Bear 的攻击点中提炼，不要凭空生造。
- 每个问题必须说明：为什么会被问(why_asked)、需要准备什么材料(materials_needed)、回答不好影响什么(decision_impact)。
- suggested_answer 是建议准备的回答策略（不是替创始人回答），要可操作。
- question_type 标明问题分类。
- source_refs 引用 Fact Pack 的 F 编号；"假设挑战型"问题允许 source_refs 为空，但必须填 assumption_basis。
- owner 指定谁负责准备这个问题的回答。
- 不要重复相似的问题。确保覆盖至少 4 个不同的 question_type。
- priority: 1=不答好就过不了, 2=重要但非致命, 3=加分项。
- 禁止宣传词。`;

const SOURCE_REFS = {
  type: "array",
  minItems: 0,
  maxItems: 5,
  items: { type: "string" },
};

const SCHEMA_SYNTH = {
  type: "object",
  required: ["ic_questions", "preparation_summary"],
  additionalProperties: false,
  properties: {
    ic_questions: {
      type: "array",
      minItems: 10,
      maxItems: 15,
      items: {
        type: "object",
        required: [
          "priority", "question", "question_type", "why_asked", "assumption_basis",
          "suggested_answer", "materials_needed", "decision_impact", "owner", "source_refs",
        ],
        additionalProperties: false,
        properties: {
          priority: { type: "integer", minimum: 1, maximum: 3 },
          question: { type: "string", minLength: 10, maxLength: 220 },
          question_type: {
            type: "string",
            enum: ["事实缺口型", "假设挑战型", "财务压力型", "竞争格局型", "团队治理型", "退出路径型"],
          },
          why_asked: { type: "string", minLength: 8, maxLength: 240 },
          assumption_basis: { type: "string", maxLength: 220 },
          suggested_answer: { type: "string", minLength: 8, maxLength: 320 },
          materials_needed: { type: "string", minLength: 4, maxLength: 220 },
          decision_impact: { type: "string", minLength: 4, maxLength: 180 },
          owner: { type: "string", enum: ["投资经理", "财务尽调", "技术尽调", "法务", "合伙人"] },
          source_refs: SOURCE_REFS,
        },
      },
    },
    preparation_summary: { type: "string", minLength: 20, maxLength: 500 },
  },
};

// ── 服务端后处理 ────────────────────────────────────────────

function _sortByPriority(questions) {
  questions.sort((a, b) => a.priority - b.priority);
}

// ── XLSX 导出 ───────────────────────────────────────────────

function buildSheets(payload) {
  return [
    {
      name: "IC Top问题",
      headers: ["优先级", "投委问题", "问题类型", "为什么会被问", "假设/事实基础", "建议准备回答", "需要补充材料", "回答不好影响", "负责人", "事实来源"],
      rows: payload.ic_questions.map((q) => [
        String(q.priority),
        q.question,
        q.question_type,
        q.why_asked,
        q.assumption_basis,
        q.suggested_answer,
        q.materials_needed,
        q.decision_impact,
        q.owner,
        (q.source_refs || []).join(", "),
      ]),
    },
    {
      name: "Bull论点",
      headers: ["支持投资论点", "证据", "置信度", "事实来源"],
      rows: (payload.bull_theses || []).map((x) => [x.point, x.evidence, x.confidence, (x.source_refs || []).join(", ")]),
    },
    {
      name: "Bear反驳",
      headers: ["攻击目标", "反驳点", "类型", "严重度", "致命追问", "数据缺口", "事实来源"],
      rows: (payload.bear_objections || []).map((x) => [x.attack_target, x.objection, x.objection_type, x.severity, x.killer_question, x.data_gap, (x.source_refs || []).join(", ")]),
    },
    {
      name: "准备摘要",
      headers: ["项目", "内容"],
      rows: [
        ["Bull Thesis", payload.bull_thesis_statement || ""],
        ["准备摘要", payload.preparation_summary],
      ],
    },
  ];
}

module.exports = {
  id: "ic_questions_xlsx",
  title: "IC 投委问题清单",
  description: "通过 Bull/Bear 左右脑互搏（3 步串行 pipeline），生成投委可能追问的 Top 问题、建议回答和需补材料",
  category: "memo",
  outputArtifactKind: "xlsx",
  inputSchema: {
    type: "object",
    properties: {
      ic_stage: { type: "string", description: "可选，如 首次 IC / 最终 IC / 条款会前" },
      question_count: { type: "integer", minimum: 10, maximum: 15, description: "目标问题数量，schema 会控制在 10-15" },
    },
    additionalProperties: false,
  },

  async run({ project, params = {}, ctx = {}, userId }) {
    if (!project) return { ok: false, error: "需要项目上下文" };
    const { callLLMJson, buildFactPack, formatFactPackForPrompt, assertGrounded, exportXlsx } = _deps();
    const { factPack } = buildFactPack(project);
    const factsPrompt = formatFactPackForPrompt(factPack);

    // ── Step 1: Bull Agent ──────────────────────────────────
    const bullMsg = [
      factsPrompt,
      "",
      "请按 schema 输出你的投资论据 JSON（thesis_statement + key_strengths）。",
    ].join("\n");

    const { data: bullData, repairs: bullRepairs } = await callLLMJson(
      SYSTEM_BULL, bullMsg, SCHEMA_BULL, { maxTokens: 4096, maxRepairs: 2 }
    );
    // Bull 必须全部有事实支撑
    assertGrounded(bullData, factPack, { requiredPaths: ["key_strengths"] });

    // ── Step 2: Bear Agent ──────────────────────────────────
    const bearMsg = [
      factsPrompt,
      "",
      "【Bull Case — 你需要逐条攻击的投资论据】",
      JSON.stringify(bullData, null, 2),
      "",
      "请按 schema 输出你的反驳 JSON（counter_arguments）。每条 attack_target 必须指向上面 Bull 论点。",
    ].join("\n");

    const { data: bearData, repairs: bearRepairs } = await callLLMJson(
      SYSTEM_BEAR, bearMsg, SCHEMA_BEAR, { maxTokens: 4096, maxRepairs: 2 }
    );
    // Bear 允许假设型攻击无 source_refs，但其他类型需要有
    // 不做 assertGrounded 强制（Bear 的核心价值在于逻辑攻击而非事实引用）

    // ── Step 3: Synthesizer ─────────────────────────────────
    const synthMsg = [
      factsPrompt,
      "",
      "【Bull Case（乐观论据）】",
      JSON.stringify(bullData, null, 2),
      "",
      "【Bear Case（质疑反驳）】",
      JSON.stringify(bearData, null, 2),
      "",
      `【IC 场景】${params.ic_stage || "投委会汇报前预演"}`,
      `【目标问题数】${params.question_count || 12}`,
      "",
      "请按 schema 输出最终的 IC 问题清单 JSON（ic_questions + preparation_summary）。",
    ].join("\n");

    const { data: synthData, repairs: synthRepairs } = await callLLMJson(
      SYSTEM_SYNTH, synthMsg, SCHEMA_SYNTH, { maxTokens: 8192, maxRepairs: 2 }
    );
    // Synth 产出走 grounding audit，假设挑战型允许空 source_refs
    const audit = assertGrounded(synthData, factPack, {
      requiredPaths: ["ic_questions"],
      allowHypothesis: true,
    });

    // 服务端后处理：按 priority 排序
    _sortByPriority(synthData.ic_questions);

    // 组装最终 payload（合并三步产出，供 buildSheets 消费）
    const finalPayload = {
      bull_thesis_statement: bullData.thesis_statement,
      bull_theses: bullData.key_strengths,
      bear_objections: bearData.counter_arguments,
      ic_questions: synthData.ic_questions,
      preparation_summary: synthData.preparation_summary,
    };

    const artifact = await exportXlsx({
      title: "IC 投委问题清单",
      sheets: buildSheets(finalPayload),
      ctx,
      userId,
      artifactTitle: "IC问题清单",
    });

    return {
      ok: true,
      artifact: artifact || { kind: "json", summary: "IC 投委问题清单", payload: finalPayload },
      metadata: {
        llm_repairs: { bull: bullRepairs, bear: bearRepairs, synth: synthRepairs },
        grounding: audit,
        pipeline_steps: 3,
      },
    };
  },
  _private: { SCHEMA_BULL, SCHEMA_BEAR, SCHEMA_SYNTH, buildSheets },
};
