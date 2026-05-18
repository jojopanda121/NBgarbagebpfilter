// ============================================================
// skills/unitEconomicsReview.js — 单位经济模型 / 收入质量评估
//
// 直接消费已落库的 upload_structured 抽取(financialStatementsAgent +
// unitEconomicsAgent + customerListAgent)结果,合成一份 PE/VC 投决会议
// 可读的"收入质量 + 单位经济"评估:
//   - inputs_summary    : 用了哪些数字(标 source_ref + period + confidence)
//   - benchmarks        : Rule of 40 / NDR / LTV:CAC / Payback 等基准对照
//   - revenue_quality_scorecard : 6 维 1-5 分(参考 Anthropic financial-services
//                                 Apache-2.0 仓库 PE 单位经济 skill 的评分骨架)
//   - red_flags         : 客户集中度、毛利倒挂、流失等显式风险
//   - diligence_recommendations : 下阶段需要补的数据 / 访谈点
//
// 设计参考:Anthropic financial-services Apache-2.0 仓库
//   plugins/vertical-plugins/private-equity/skills/unit-economics/SKILL.md
// 改写要点:
//   - 输入数据**全部**来自本仓库 upload_structured 抽取,不让 LLM 自己读原文。
//   - confidence 字段贯穿:Fact Pack 中"missing/n/a"的数字不会被强行打分。
//   - benchmarks 阈值是行业 baseline,允许通过 params.benchmarks 覆盖。
//   - 输出 JSON, 与现有 SkillResultModal 兼容。
// ============================================================

const { getDb } = require("../db");
const upload = require("../services/extraction/uploadStructuredExtraction");

function _deps() {
  return {
    callLLMJson: require("../services/llmService").callLLMJson,
    buildContext: require("./_projectContext").buildContext,
    summarizeFallback: require("./_groundingAudit").summarizeFallback,
  };
}

// PE/VC SaaS / 订阅模式常用 baseline,允许覆盖。
// rule_of_40 = revenue_growth_pct + ebitda_margin_pct(或 fcf margin) ≥ 40
const DEFAULT_BENCHMARKS = {
  rule_of_40_target: 40,
  ltv_cac_target: 3,
  payback_months_target: 24,
  nrr_pct_target: 110,
  gross_margin_pct_target: 65,
  monthly_churn_pct_max: 3,
  top1_concentration_pct_max: 30,
  top3_concentration_pct_max: 60,
};

const SYSTEM = `你是一级市场基金的单位经济 / 收入质量分析师。
你只能基于"已抽取的结构化数据" (Inputs JSON) 做判断,**不要**对未给出的数字外推或猜测。

【硬性约束】
- 任何字段在 Inputs 中标 confidence="missing" 或值为 null,你必须在 inputs_summary 中显式说明"未披露",并跳过该维度打分(给 1 分并在 reason 中说明"数据缺失,无法评估")。
- 任何字段标 confidence="n/a"(业务模式不适用,如硬件没有 NRR)同样不打分,给"n/a"并解释。
- benchmarks_comparison 必须对照 fund_benchmarks 中给出的阈值,**不要**自创新阈值。
- revenue_quality_scorecard 严格 6 维: recurring_mix, customer_concentration, retention_quality, unit_economics, growth_efficiency, gross_margin_quality;每维 1-5 整数;每维必须给 reason(≤200 字)。
- overall_grade 由 average ∈ [1,5] 映射: A(≥4.5) / B(≥3.5) / C(≥2.5) / D(≥1.5) / F(<1.5)。
- red_flags 是上传数据**显式**暴露的风险(例如 TOP1 占比 78%、Net retention < 95%、毛利倒挂),不要写"市场竞争激烈"这种空话。
- diligence_recommendations 写"下一步需要补 X 数据 / 问 Y 问题"的可执行清单,1 条 1 行。
- 中文输出,**禁止**宣传词。`;

const SCORE_ITEM = {
  type: "object",
  required: ["dimension", "score", "reason", "source_fields"],
  additionalProperties: false,
  properties: {
    dimension: {
      type: "string",
      enum: [
        "recurring_mix",
        "customer_concentration",
        "retention_quality",
        "unit_economics",
        "growth_efficiency",
        "gross_margin_quality",
      ],
    },
    score: { type: "integer", minimum: 1, maximum: 5 },
    reason: { type: "string", minLength: 4, maxLength: 240 },
    source_fields: {
      type: "array",
      maxItems: 6,
      items: { type: "string", maxLength: 80 },
      description: "Inputs JSON 中实际用到的字段路径,如 'unit_economics.ltv_cac_ratio'",
    },
  },
};

const BENCHMARK_ITEM = {
  type: "object",
  required: ["metric", "target", "actual", "verdict", "source_fields"],
  additionalProperties: false,
  properties: {
    metric: { type: "string", maxLength: 60 },
    target: { type: "string", maxLength: 60 },
    actual: { type: "string", maxLength: 60 },
    verdict: { type: "string", enum: ["above_target", "near_target", "below_target", "data_missing", "not_applicable"] },
    source_fields: { type: "array", maxItems: 4, items: { type: "string", maxLength: 80 } },
  },
};

const SCHEMA = {
  type: "object",
  required: [
    "inputs_summary",
    "fund_benchmarks_used",
    "benchmarks_comparison",
    "revenue_quality_scorecard",
    "overall_grade",
    "red_flags",
    "diligence_recommendations",
    "data_quality_note",
  ],
  additionalProperties: false,
  properties: {
    inputs_summary: {
      type: "object",
      required: ["business_model_hint", "fields_used", "fields_missing"],
      additionalProperties: false,
      properties: {
        business_model_hint: { type: "string", maxLength: 200 },
        fields_used: {
          type: "array",
          maxItems: 30,
          items: {
            type: "object",
            required: ["field", "value", "confidence"],
            additionalProperties: false,
            properties: {
              field: { type: "string", maxLength: 80 },
              value: { type: "string", maxLength: 80 },
              period: { type: "string", maxLength: 40 },
              source_ref: { type: "string", maxLength: 40 },
              confidence: { type: "string", maxLength: 16 },
            },
          },
        },
        fields_missing: {
          type: "array",
          maxItems: 30,
          items: { type: "string", maxLength: 80 },
        },
      },
    },
    fund_benchmarks_used: {
      type: "object",
      additionalProperties: true,
      description: "回传 LLM 实际使用的阈值,应等于入参 benchmarks 或 DEFAULT_BENCHMARKS",
    },
    benchmarks_comparison: {
      type: "array",
      minItems: 4,
      maxItems: 10,
      items: BENCHMARK_ITEM,
    },
    revenue_quality_scorecard: {
      type: "array",
      minItems: 6,
      maxItems: 6,
      items: SCORE_ITEM,
    },
    overall_grade: {
      type: "object",
      required: ["grade", "average_score", "headline"],
      additionalProperties: false,
      properties: {
        grade: { type: "string", enum: ["A", "B", "C", "D", "F"] },
        average_score: { type: "number", minimum: 1, maximum: 5 },
        headline: { type: "string", minLength: 4, maxLength: 200 },
      },
    },
    red_flags: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        required: ["flag", "severity", "evidence"],
        additionalProperties: false,
        properties: {
          flag: { type: "string", maxLength: 200 },
          severity: { type: "string", enum: ["低", "中", "高"] },
          evidence: { type: "string", maxLength: 240 },
        },
      },
    },
    diligence_recommendations: {
      type: "array",
      minItems: 2,
      maxItems: 8,
      items: { type: "string", minLength: 6, maxLength: 220 },
    },
    data_quality_note: { type: "string", maxLength: 300 },
  },
};

// ── Inputs JSON 抽取:把多个 upload_structured 行合并成一份给 LLM 的紧凑视图 ──
// 不要把整个 structured JSON 塞给 LLM,只挑跟 UE / 收入质量相关的字段,
// 避免无谓 token 消耗。
function _pickFields(structured) {
  if (!structured) return null;
  const fin = structured.financials || {};
  const ue = structured.unit_economics || {};
  const cust = structured.customers || {};
  const pickNum = (n) => (n && typeof n === "object" ? {
    value: n.value ?? null,
    unit: n.unit || "",
    period: n.period || "",
    source_ref: n.source_ref || "",
    confidence: n.confidence || "missing",
  } : null);
  return {
    financials: {
      revenue: pickNum(fin.pl?.revenue),
      gross_margin_pct: pickNum(fin.pl?.gross_margin_pct),
      ebitda: pickNum(fin.pl?.ebitda),
      net_income: pickNum(fin.pl?.net_income),
      operating_cf: pickNum(fin.cf?.operating_cf),
      runway_months: pickNum(fin.cf?.runway_months),
      fiscal_periods: Array.isArray(fin.fiscal_periods) ? fin.fiscal_periods.slice(0, 4) : [],
    },
    unit_economics: {
      ltv: pickNum(ue.ltv),
      cac: pickNum(ue.cac),
      ltv_cac_ratio: pickNum(ue.ltv_cac_ratio),
      payback_months: pickNum(ue.payback_months),
      gross_margin_pct: pickNum(ue.gross_margin_pct),
      churn_monthly_pct: pickNum(ue.churn_monthly_pct),
      nrr_pct: pickNum(ue.nrr_pct),
      arpa: pickNum(ue.arpa),
      business_model_hint: ue.notes?.business_model_hint?.value || "unknown",
      warnings: ue.notes?.warnings || [],
    },
    customers: {
      top_customers_count: Array.isArray(cust.top_customers) ? cust.top_customers.length : 0,
      top_customers_sample: Array.isArray(cust.top_customers)
        ? cust.top_customers.slice(0, 5).map((c) => ({
            name: c.name,
            revenue_share_pct: c.revenue_share_pct,
            contract_status: c.contract_status,
            confidence: c.confidence,
          }))
        : [],
      concentration_top3_pct: pickNum(cust.concentration_top3_pct),
      concentration_top10_pct: pickNum(cust.concentration_top10_pct),
      warnings: cust.notes?.warnings || [],
    },
  };
}

function _mergeInputs(rows) {
  // 多份上传时取最新一份为主,其它合并到 warnings (最简策略,避免数字打架)。
  if (!rows.length) return null;
  const main = _pickFields(rows[0].structured);
  if (!main) return null;
  main._sources = rows.slice(0, 3).map((r) => ({ artifact_id: r.artifactId, filename: r.filename }));
  return main;
}

module.exports = {
  id: "unit_economics_review",
  title: "单位经济 / 收入质量评估",
  description:
    "基于已结构化抽取的财务表 + 单位经济 + 客户清单,合成 6 维收入质量评分 + Rule of 40 / NDR / LTV:CAC 基准对照 + 红旗。需要先上传财务/客户材料触发结构化抽取。",
  category: "memo",
  outputArtifactKind: "json",
  inputSchema: {
    type: "object",
    properties: {
      benchmarks: {
        type: "object",
        additionalProperties: true,
        description: "可选,基金/行业基准阈值,缺省时使用 SaaS 通用 baseline",
      },
    },
    additionalProperties: false,
  },

  async run({ project, params, ctx }) {
    if (!project) return { ok: false, error: "需要项目上下文" };
    if (!ctx?.conversationId) {
      return {
        ok: false,
        error:
          "请先在项目页打开 workspace 对话后再运行本 skill —— 单位经济评估需要绑定到 workspace 才能读取上传材料。",
      };
    }
    const { callLLMJson, summarizeFallback } = _deps();
    const db = getDb();

    const rows = upload.listStructuredExtractsForConversation(db, ctx.conversationId, { limit: 8 });
    if (!rows.length) {
      return {
        ok: false,
        error:
          "本 skill 需要底层财务 / 客户证据才能给出可靠的单位经济评估。\n" +
          "请先在 workspace 上传以下任一类材料(系统会自动结构化抽取):\n" +
          "  · 财务三表(P&L / 资产负债 / 现金流)\n" +
          "  · 客户清单 / 收入构成\n" +
          "  · 合同 / 流水 / 发票\n" +
          "结构化抽取完成后(通常 1-2 分钟)再点击本 skill 运行即可。",
      };
    }
    const inputs = _mergeInputs(rows);
    if (!inputs) {
      return {
        ok: false,
        error:
          "已上传的材料未能抽取出可用的财务 / 客户结构化字段。请确认上传文件包含明确的财务数据或客户清单,或上传补充材料后重试。",
      };
    }

    const benchmarks = { ...DEFAULT_BENCHMARKS, ...(params.benchmarks || {}) };

    const userMsg = [
      "【Inputs JSON — 来自 upload_structured 抽取】",
      JSON.stringify(inputs, null, 2),
      "",
      "【Fund Benchmarks】",
      JSON.stringify(benchmarks, null, 2),
      "",
      "请按 schema 输出收入质量 + 单位经济评估 JSON。Inputs 中 confidence=missing/n/a 的字段必须在 fields_missing 中标出,并在打分时给 1 分或 'not_applicable'。",
    ].join("\n");

    const { data, repairs } = await callLLMJson(SYSTEM, userMsg, SCHEMA, {
      maxTokens: 5120,
      maxRepairs: 2,
      skillId: "unit_economics_review",
      taskHint: "upload_structured_extraction",
    });

    // 服务端复算 average_score & grade,杜绝 LLM 算错。
    const scores = (data.revenue_quality_scorecard || []).map((s) => Number(s.score)).filter((n) => Number.isFinite(n));
    if (scores.length === 6) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      data.overall_grade.average_score = Number(avg.toFixed(2));
      data.overall_grade.grade =
        avg >= 4.5 ? "A" : avg >= 3.5 ? "B" : avg >= 2.5 ? "C" : avg >= 1.5 ? "D" : "F";
    }

    return {
      ok: true,
      artifact: {
        kind: "json",
        summary: `单位经济评估 — ${data.overall_grade.grade} (${data.overall_grade.average_score})`,
        payload: data,
      },
      metadata: {
        llm_repairs: repairs,
        fallback: summarizeFallback(data, "unit_economics_review"),
        upload_structured_used: true,
        upload_structured_artifacts: rows.length,
      },
    };
  },

  // 暴露给测试
  _private: { SCHEMA, DEFAULT_BENCHMARKS, _pickFields, _mergeInputs },
};
