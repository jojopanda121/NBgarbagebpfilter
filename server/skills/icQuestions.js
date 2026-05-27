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
    buildEvidencePack: require("./_factPack").buildEvidencePack,
    formatFactPackForPrompt: require("./_factPack").formatFactPackForPrompt,
    assertGrounded: require("./_groundingAudit").assertGrounded,
    summarizeFallback: require("./_groundingAudit").summarizeFallback,
    semanticGroundingAudit: require("./_groundingAudit").semanticGroundingAudit,
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
- source_refs 引用 Fact Pack 的 F 编号。**除"假设挑战型"外，所有问题的 source_refs 必须至少包含 1 个 F 编号，绝对不能为空数组**；只有 question_type 为"假设挑战型"的问题允许 source_refs 为空，但必须填 assumption_basis。如果某个问题找不到对应的 F 编号，请将其 question_type 改为"假设挑战型"并在 assumption_basis 中说明推断依据。
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

// ── Step 4: Valuation & Exit Agent ──────────────────────────
// 在 Synthesizer 之后跑：合伙人最关心估值合理性与退出推演，把这两块从
// "假设挑战型" 问题里提炼成独立结构化产出，方便后续条款会和投决用。

const SYSTEM_VALUATION_EXIT = `你是一级市场基金的估值合伙人 (Valuation Partner)。你已看完 Bull/Bear/IC 问题清单，
现在要给投委会一份"估值挑战 + 退出推演"独立结论，覆盖被 Bull/Bear 都点到但未深挖的估值与退出维度。

任务：
1. valuation_benchmark：基于 Fact Pack（含 web_search 检索到的可比公司）+ 项目自身 ARR/GMV/利润数据，
   计算/估算被投项目隐含倍数，与同赛道同阶段公允中位数对比，给出明确判定。
2. exit_scenarios：列出 2-4 条退出路径（IPO / 战略并购 / 二级市场 / 回购 / 清算），每条给出
   时点、概率档、可比先例、假设退出估值、MOIC 区间 (downside/base/upside)。

硬性约束：
- 任何倍数、可比公司、退出先例必须 source_refs 引用 Fact Pack F 编号；找不到对照就写"待检索"并放
  到 challenge_questions 里追问，**绝不编造可比公司估值或退出对价**。
- Fact Pack 中 source_type=upload_structured 的 F 编号来自用户上传底层资料（财务表、客户清单、合同、Cap Table、合规材料），可信度最高。
  计算 subject_implied PS / PE 倍数：
    1) 行业公允倍数 / 可比交易必须用 **外部检索 (F 编号 source_type=external_search)** 或上传材料，不得编造行业基准。
    2) 项目自身收入 / EBITDA / LTV 等优先用 upload_structured；若只有 BP 自报，必须标注「BP 自报/待验证」。
  source_refs 必须真实引用对应 F/C 编号。
- MOIC 三档 (downside/base/upside) 必须自洽：downside ≤ base ≤ upside，downside 可以 < 1.0（亏损）。
- verdict 判定必须能在 challenge_questions 中至少 1 条找到对应质问。
- challenge_questions 是给投委会的"估值挑战追问"，与已有 IC 问题清单不重复（不能是已经问过的）。
- 退出 timeline 必须给具体年份范围（如 "2028-2030"），不允许写 "未来若干年"。
- probability 档严格 4 档：高/中/低/极低，并且 sum 不要求 = 100%（互不排斥）。
- 退出 precedents 至少 1 条要有 source_refs；找不到就标"待补充行业可比"。
- 禁止宣传词。`;

const VAL_EXIT_SOURCE_REFS = {
  type: "array",
  minItems: 0,
  maxItems: 5,
  items: { type: "string" },
};

const SCHEMA_VALUATION_EXIT = {
  type: "object",
  required: ["valuation_benchmark", "exit_scenarios"],
  additionalProperties: false,
  properties: {
    valuation_benchmark: {
      type: "object",
      required: [
        "methodology", "comparable_set", "industry_median",
        "subject_implied", "verdict", "challenge_questions",
      ],
      additionalProperties: false,
      properties: {
        methodology: {
          type: "string",
          enum: ["PS 倍数", "PE 倍数", "DCF", "用户数估值", "EV/EBITDA", "可比交易倍数", "暂无可用方法"],
        },
        comparable_set: {
          type: "array",
          minItems: 0,
          maxItems: 8,
          items: {
            type: "object",
            required: ["company", "stage", "year", "source_refs"],
            additionalProperties: false,
            properties: {
              company: { type: "string", minLength: 2, maxLength: 80 },
              stage: { type: "string", maxLength: 60 },
              year: { type: "string", maxLength: 12 },
              ps_multiple: { type: ["number", "string"], description: "PS 倍数；缺失填字符串'待检索'" },
              pe_multiple: { type: ["number", "string"], description: "PE 倍数；缺失填字符串'待检索'或'N/A — 未盈利'" },
              ev_ebitda: { type: ["number", "string"] },
              note: { type: "string", maxLength: 160 },
              source_refs: VAL_EXIT_SOURCE_REFS,
            },
          },
        },
        industry_median: {
          type: "object",
          required: ["note"],
          additionalProperties: false,
          properties: {
            ps: { type: ["number", "string"] },
            pe: { type: ["number", "string"] },
            ev_ebitda: { type: ["number", "string"] },
            note: { type: "string", minLength: 4, maxLength: 240 },
          },
        },
        subject_implied: {
          type: "object",
          required: ["note"],
          additionalProperties: false,
          properties: {
            ps: { type: ["number", "string"] },
            pe: { type: ["number", "string"] },
            ev_ebitda: { type: ["number", "string"] },
            note: { type: "string", minLength: 4, maxLength: 240 },
          },
        },
        verdict: {
          type: "string",
          enum: ["明显偏高", "略偏高", "合理", "偏低", "无法判断"],
        },
        challenge_questions: {
          type: "array",
          minItems: 2,
          maxItems: 6,
          items: { type: "string", minLength: 8, maxLength: 240 },
        },
      },
    },
    exit_scenarios: {
      type: "array",
      minItems: 2,
      maxItems: 4,
      items: {
        type: "object",
        required: [
          "path", "timeline", "probability", "precedents",
          "assumed_exit_value", "moic_range", "key_risks", "source_refs",
        ],
        additionalProperties: false,
        properties: {
          path: { type: "string", enum: ["IPO", "战略并购", "二级市场转让", "管理层回购", "清算"] },
          timeline: { type: "string", minLength: 4, maxLength: 40 },
          probability: { type: "string", enum: ["高", "中", "低", "极低"] },
          precedents: {
            type: "array",
            minItems: 0,
            maxItems: 5,
            items: { type: "string", maxLength: 160 },
          },
          assumed_exit_value: { type: "string", minLength: 2, maxLength: 80 },
          moic_range: {
            type: "object",
            required: ["downside", "base", "upside"],
            additionalProperties: false,
            properties: {
              downside: { type: "number" },
              base: { type: "number" },
              upside: { type: "number" },
            },
          },
          key_risks: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: { type: "string", maxLength: 180 },
          },
          source_refs: VAL_EXIT_SOURCE_REFS,
        },
      },
    },
  },
};

// ── 服务端后处理 ────────────────────────────────────────────

function _sortByPriority(questions) {
  questions.sort((a, b) => a.priority - b.priority);
}

// MOIC 三档自洽校验：downside ≤ base ≤ upside。LLM 偶尔会写反，主动 swap，
// 而不是抛错把整次 pipeline 浪费掉。
function _normalizeExitScenarios(scenarios) {
  if (!Array.isArray(scenarios)) return [];
  for (const s of scenarios) {
    const m = s.moic_range;
    if (!m) continue;
    const trio = [Number(m.downside), Number(m.base), Number(m.upside)].filter((v) => !Number.isNaN(v));
    if (trio.length === 3) {
      trio.sort((a, b) => a - b);
      m.downside = trio[0];
      m.base = trio[1];
      m.upside = trio[2];
    }
  }
  return scenarios;
}

// ── XLSX 导出 ───────────────────────────────────────────────

function buildSheets(payload) {
  const sheets = [
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
  ];

  const vb = payload.valuation_benchmark;
  if (vb) {
    sheets.push({
      name: "估值挑战",
      headers: ["板块", "字段", "内容", "事实来源"],
      rows: [
        ["方法", "methodology", vb.methodology || "", ""],
        ["行业中位", "PS", String(vb.industry_median?.ps ?? ""), ""],
        ["行业中位", "PE", String(vb.industry_median?.pe ?? ""), ""],
        ["行业中位", "EV/EBITDA", String(vb.industry_median?.ev_ebitda ?? ""), ""],
        ["行业中位", "注解", vb.industry_median?.note || "", ""],
        ["项目隐含", "PS", String(vb.subject_implied?.ps ?? ""), ""],
        ["项目隐含", "PE", String(vb.subject_implied?.pe ?? ""), ""],
        ["项目隐含", "EV/EBITDA", String(vb.subject_implied?.ev_ebitda ?? ""), ""],
        ["项目隐含", "注解", vb.subject_implied?.note || "", ""],
        ["判定", "verdict", vb.verdict || "", ""],
        ...(vb.challenge_questions || []).map((q, i) => [
          "挑战追问", `Q${i + 1}`, q, "",
        ]),
      ],
    });
    sheets.push({
      name: "可比公司",
      headers: ["公司", "阶段", "年份", "PS", "PE", "EV/EBITDA", "备注", "事实来源"],
      rows: (vb.comparable_set || []).map((c) => [
        c.company,
        c.stage || "",
        c.year || "",
        String(c.ps_multiple ?? ""),
        String(c.pe_multiple ?? ""),
        String(c.ev_ebitda ?? ""),
        c.note || "",
        (c.source_refs || []).join(", "),
      ]),
    });
  }

  if (Array.isArray(payload.exit_scenarios) && payload.exit_scenarios.length > 0) {
    sheets.push({
      name: "退出推演",
      headers: ["路径", "时间窗", "概率", "假设退出对价", "MOIC 悲观", "MOIC 中性", "MOIC 乐观", "可比先例", "关键风险", "事实来源"],
      rows: payload.exit_scenarios.map((s) => [
        s.path,
        s.timeline,
        s.probability,
        s.assumed_exit_value,
        String(s.moic_range?.downside ?? ""),
        String(s.moic_range?.base ?? ""),
        String(s.moic_range?.upside ?? ""),
        (s.precedents || []).join(" | "),
        (s.key_risks || []).join(" | "),
        (s.source_refs || []).join(", "),
      ]),
    });
  }

  sheets.push({
    name: "准备摘要",
    headers: ["项目", "内容"],
    rows: [
      ["Bull Thesis", payload.bull_thesis_statement || ""],
      ["准备摘要", payload.preparation_summary],
      ["估值判定", payload.valuation_benchmark?.verdict || "（未生成）"],
      ["退出路径数", String((payload.exit_scenarios || []).length)],
    ],
  });

  return sheets;
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
      enable_semantic_audit: {
        type: "boolean",
        description: "可选。开启后，对 ic_questions + bull_theses + bear_objections 做语义抽样校验。默认走 env ENABLE_SEMANTIC_AUDIT。",
      },
      enable_bp_deep_parsing: {
        type: "boolean",
        description: "可选。兼容旧参数；上传材料结构化抽取现在会在上传后自动执行，并以 upload_structured F 编号注入 Fact Pack。",
      },
    },
    additionalProperties: false,
  },

  async run({ project, params = {}, ctx = {}, userId }) {
    if (!project) return { ok: false, error: "需要项目上下文" };
    const { callLLMJson, buildEvidencePack, formatFactPackForPrompt, assertGrounded, summarizeFallback, semanticGroundingAudit, exportXlsx } = _deps();
    const { factPack, searchUsed, uploadCount, uploadStructuredUsed, uploadStructuredFactCount } = await buildEvidencePack(project, {
      ctx,
      skillId: "ic_questions_xlsx",
      useSearch: true,
      materialsHint: params.ic_stage || "",
      enableBpDeepParsing: params.enable_bp_deep_parsing,
    });
    const factsPrompt = formatFactPackForPrompt(factPack);

    // ── Step 1: Bull Agent ──────────────────────────────────
    const bullMsg = [
      factsPrompt,
      "",
      "请按 schema 输出你的投资论据 JSON（thesis_statement + key_strengths）。",
    ].join("\n");

    const { data: bullData, repairs: bullRepairs } = await callLLMJson(
      SYSTEM_BULL, bullMsg, SCHEMA_BULL,
      { maxTokens: 4096, maxRepairs: 2, skillId: "ic_questions_xlsx" }
    );
    // Bull 论点事实支撑校验——失败时降级为警告，不阻塞后续 Bear/Synth 步骤
    let bullAudit;
    try {
      bullAudit = assertGrounded(bullData, factPack, { requiredPaths: ["key_strengths"] });
    } catch (groundingErr) {
      bullAudit = {
        ok: false,
        errors: groundingErr.audit?.errors || [],
        warnings: ["部分 Bull 论点缺少事实引用(source_refs)，建议人工核实"],
        referenced_count: groundingErr.audit?.referenced_count || 0,
      };
    }

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
      SYSTEM_BEAR, bearMsg, SCHEMA_BEAR,
      { maxTokens: 4096, maxRepairs: 2, skillId: "ic_questions_xlsx" }
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
      SYSTEM_SYNTH, synthMsg, SCHEMA_SYNTH,
      { maxTokens: 8192, maxRepairs: 2, skillId: "ic_questions_xlsx" }
    );
    // Synth 产出走 grounding audit，假设挑战型允许空 source_refs
    let audit;
    try {
      audit = assertGrounded(synthData, factPack, {
        requiredPaths: ["ic_questions"],
        allowHypothesis: true,
      });
    } catch (groundingErr) {
      // 自动修复：将缺少 source_refs 的非假设型问题重新分类为"假设挑战型"
      for (const q of synthData.ic_questions) {
        if ((!Array.isArray(q.source_refs) || q.source_refs.length === 0) && q.question_type !== "假设挑战型") {
          q.question_type = "假设挑战型";
          if (!q.assumption_basis || q.assumption_basis === "暂无") {
            q.assumption_basis = q.why_asked || "基于 Bear Case 逻辑推断";
          }
        }
      }
      try {
        audit = assertGrounded(synthData, factPack, {
          requiredPaths: ["ic_questions"],
          allowHypothesis: true,
        });
      } catch (_retryErr) {
        // 修复后仍失败——降级为警告，不阻塞文档生成
        audit = {
          ok: false,
          errors: groundingErr.audit?.errors || [],
          warnings: ["部分 IC 问题缺少事实引用(source_refs)，已尽量自动修复，建议人工补充"],
          referenced_count: groundingErr.audit?.referenced_count || 0,
        };
      }
    }

    // 服务端后处理：按 priority 排序
    _sortByPriority(synthData.ic_questions);

    // ── Step 4: Valuation & Exit Agent ───────────────────────
    // 不阻断主流程：估值/退出生成失败时，仍输出前三步的结果，只在 metadata 里记录失败原因。
    let valExitData = null;
    let valExitRepairs = 0;
    let valExitError = null;
    try {
      const valExitMsg = [
        factsPrompt,
        "",
        "【Bull Case（乐观论据）】",
        JSON.stringify(bullData, null, 2),
        "",
        "【Bear Case（质疑反驳）】",
        JSON.stringify(bearData, null, 2),
        "",
        "【已生成 IC 问题清单（不要重复其中的问题）】",
        JSON.stringify(synthData.ic_questions.map((q) => q.question), null, 2),
        "",
        "请按 schema 输出 valuation_benchmark + exit_scenarios JSON。",
      ].join("\n");
      const out = await callLLMJson(
        SYSTEM_VALUATION_EXIT, valExitMsg, SCHEMA_VALUATION_EXIT,
        { maxTokens: 6144, maxRepairs: 2, skillId: "ic_questions_xlsx" }
      );
      valExitData = out.data;
      valExitRepairs = out.repairs;
      _normalizeExitScenarios(valExitData.exit_scenarios);
      // 不在估值/退出节点强制 assertGrounded —— 估值挑战本身就是"假设型"产出，
      // 但记录在 metadata 让人工 review 时能扫到 source_refs 完整性。
    } catch (e) {
      valExitError = e.message;
    }

    // 组装最终 payload（合并四步产出，供 buildSheets 消费）
    const finalPayload = {
      bull_thesis_statement: bullData.thesis_statement,
      bull_theses: bullData.key_strengths,
      bear_objections: bearData.counter_arguments,
      ic_questions: synthData.ic_questions,
      preparation_summary: synthData.preparation_summary,
      valuation_benchmark: valExitData?.valuation_benchmark || null,
      exit_scenarios: valExitData?.exit_scenarios || [],
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
        llm_repairs: { bull: bullRepairs, bear: bearRepairs, synth: synthRepairs, val_exit: valExitRepairs },
        grounding: audit,
        fallback: summarizeFallback(finalPayload, "ic_questions_xlsx"),
        semantic_audit: await (async () => {
          const enable = params.enable_semantic_audit === true
            || (params.enable_semantic_audit !== false && process.env.ENABLE_SEMANTIC_AUDIT === "1");
          if (!enable) return null;
          return semanticGroundingAudit(finalPayload, factPack, {
            sampleRate: 0.3,
            maxSamples: 15,
            skillId: "ic_questions_xlsx",
          });
        })(),
        pipeline_steps: 4,
        evidence_search_used: searchUsed,
        upload_facts_used: uploadCount,
        upload_structured_used: !!uploadStructuredUsed,
        upload_structured_fact_count: uploadStructuredFactCount || 0,
        valuation_exit_error: valExitError,
      },
    };
  },
  _private: { SCHEMA_BULL, SCHEMA_BEAR, SCHEMA_SYNTH, SCHEMA_VALUATION_EXIT, buildSheets, _normalizeExitScenarios },
};
