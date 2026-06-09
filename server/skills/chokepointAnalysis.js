// ============================================================
// skills/chokepointAnalysis.js — 供应链咽喉护城河分析
//
// 用途:对一份创业公司 BP,用「供应链咽喉理论」逆向拆解它所处产业链,判断它
// 是否卡在一个「下游大玩家绕不开、高度集中、且能把卡点转化为真实营收」的咽喉
// 节点。输出 5 因子打分 + is_chokepoint 判定 + 综合咽喉分(chokepoint_score)
// + thesis + 关键风险 + 红旗 + 待核实清单,全部 source_refs 溯源到 Fact Pack。
//
// 与 scoring.js 的关系:本 skill 产出的 chokepoint_score(0-100)可作为
// 「产品与壁垒」(S2)维度的护城河信号回灌评分系统(见 scoring.js
// calculateDimension2_ProductAndMoat 的第三参数),让结构性护城河被量化进总分。
//
// 设计原则(与 scoring.js / dealScreening.js 一致):
//   - LLM 只输出客观因子分(0-100 枚举式判断)+ 事实判定,**综合分在 JS 端
//     按权重确定性计算**,杜绝让大模型拍脑袋给总分。
//   - 强制联网检索(useSearch:true)以核实供应链位置,压制幻觉——这是原
//     Serenity 方法「强制联网取证」的要求。
//   - source_refs 强制指向 Fact Pack 的 F/C/K 编号,复用 _groundingAudit。
// ============================================================

const {
  CHOKEPOINT_FACTORS,
  FACTOR_LABELS,
  FACTOR_WEIGHTS,
  CHOKEPOINT_METHODOLOGY,
} = require("./_chokepointMethodology");

function _deps() {
  return {
    callLLMJson: require("../services/llmService").callLLMJson,
    buildEvidencePack: require("./_factPack").buildEvidencePack,
    formatFactPackForPrompt: require("./_factPack").formatFactPackForPrompt,
    assertGrounded: require("./_groundingAudit").assertGrounded,
    countMissingRefs: require("./_groundingAudit").countMissingRefs,
    summarizeFallback: require("./_groundingAudit").summarizeFallback,
  };
}

// thesis / key_risks / red_flags 缺 source_refs 不阻塞(它们是综合判断/风险);
// 仅 factor_assessment 强制溯源。
const _SOFT_REFS_PATHS = ["key_risks", "red_flags"];

const FACTOR_ITEM = {
  type: "object",
  required: ["factor", "score", "rationale", "source_refs"],
  additionalProperties: false,
  properties: {
    factor: { type: "string", enum: CHOKEPOINT_FACTORS },
    score: { type: "integer", minimum: 0, maximum: 100 },
    rationale: { type: "string", minLength: 8, maxLength: 280 },
    source_refs: { type: "array", maxItems: 5, items: { type: "string" } },
  },
};

const SCHEMA = {
  type: "object",
  required: [
    "company_name",
    "chain_position",
    "factor_assessment",
    "is_chokepoint",
    "thesis",
    "key_risks",
    "red_flags",
    "verification_backlog",
  ],
  additionalProperties: false,
  properties: {
    company_name: { type: "string", minLength: 1, maxLength: 80 },
    // 它卡在哪条链的哪个节点 —— 一句话定位
    chain_position: {
      type: "object",
      required: ["value_chain", "node", "source_refs"],
      additionalProperties: false,
      properties: {
        value_chain: { type: "string", minLength: 4, maxLength: 160 },
        node: { type: "string", minLength: 2, maxLength: 160 },
        source_refs: { type: "array", maxItems: 5, items: { type: "string" } },
      },
    },
    factor_assessment: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: FACTOR_ITEM,
    },
    is_chokepoint: { type: "boolean" },
    thesis: { type: "string", minLength: 20, maxLength: 600 },
    key_risks: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: { type: "string", minLength: 6, maxLength: 240 },
    },
    // 红旗:designed-out 风险 / 卡点变现不了 / 靠输血维持 等
    red_flags: {
      type: "array",
      minItems: 0,
      maxItems: 5,
      items: { type: "string", minLength: 6, maxLength: 240 },
    },
    verification_backlog: {
      type: "array",
      minItems: 0,
      maxItems: 8,
      items: { type: "string", minLength: 4, maxLength: 200 },
      description: "确认咽喉地位前必须补的供应链/客户/订单证据",
    },
  },
};

/**
 * 在 JS 端确定性计算综合咽喉分 —— 不让 LLM 拍脑袋给总分。
 *
 * 规则:
 *   1. 基础分 = Σ(因子分 × FACTOR_WEIGHTS)
 *   2. 「价值捕获」门控(必要不充分条件):value_capture 很低时,说明卡点变现不了,
 *      综合分按比例衰减——再强的瓶颈地位,变现不了就不是投资级护城河。
 *        value_capture < 40 → 综合分 × (0.6 + value_capture/100)
 *      (value_capture=0 → ×0.6 ; =40 → ×1.0 ; ≥40 不衰减)
 *
 * @param {Array} factorAssessment LLM 输出的 5 因子打分
 * @returns {{ chokepoint_score:number, base_score:number, value_capture:number, gated:boolean }}
 */
function computeChokepointScore(factorAssessment) {
  const byFactor = {};
  for (const item of Array.isArray(factorAssessment) ? factorAssessment : []) {
    if (item && CHOKEPOINT_FACTORS.includes(item.factor)) {
      const n = Number(item.score);
      byFactor[item.factor] = isNaN(n) ? 50 : Math.max(0, Math.min(100, n));
    }
  }
  // 缺失因子按中性 50 兜底
  let base = 0;
  for (const f of CHOKEPOINT_FACTORS) {
    const s = byFactor[f] ?? 50;
    base += s * FACTOR_WEIGHTS[f];
  }
  base = Math.round(base);

  const valueCapture = byFactor.value_capture ?? 50;
  let gated = false;
  let score = base;
  if (valueCapture < 40) {
    score = Math.round(base * (0.6 + valueCapture / 100));
    gated = true;
  }
  score = Math.max(0, Math.min(100, score));
  return { chokepoint_score: score, base_score: base, value_capture: valueCapture, gated };
}

const SYSTEM = CHOKEPOINT_METHODOLOGY;

module.exports = {
  id: "chokepoint_analysis",
  title: "供应链咽喉护城河分析",
  description:
    "用供应链咽喉理论逆向拆解项目所处产业链,判断它是否卡在下游大玩家绕不开、" +
    "高度集中、且能把卡点转化为真实营收的咽喉节点。输出 5 因子打分 + 综合咽喉分 + " +
    "thesis + 红旗,作为「产品与壁垒」维度的护城河信号。仅服务一级市场非上市公司,不涉及选股。",
  category: "research",
  outputArtifactKind: "json",
  inputSchema: {
    type: "object",
    properties: {
      value_chain_hint: {
        type: "string",
        maxLength: 200,
        description: "可选。提示项目所处的产业链/赛道,帮助智能体更快定位咽喉节点。",
      },
    },
    additionalProperties: false,
  },

  async run({ project, params = {}, ctx = {} }) {
    if (!project) return { ok: false, error: "需要项目上下文" };
    const {
      callLLMJson, buildEvidencePack, formatFactPackForPrompt,
      assertGrounded, countMissingRefs, summarizeFallback,
    } = _deps();

    // 咽喉判定高度依赖外部供应链事实 → 强制联网检索交叉验证
    const { factPack, searchUsed, uploadCount, uploadStructuredUsed, uploadStructuredFactCount } =
      await buildEvidencePack(project, {
        ctx,
        skillId: "chokepoint_analysis",
        useSearch: true,
        materialsHint: params.value_chain_hint || "",
      });

    const userMsg = [
      formatFactPackForPrompt(factPack),
      "",
      `【产业链提示】${params.value_chain_hint || "(未提供,请自行从 Fact Pack 推断所处产业链)"}`,
      "",
      "请用供应链咽喉理论评估本项目,严格按 schema 输出:",
      "- chain_position:一句话点明它卡在哪条价值链的哪个节点。",
      `- factor_assessment:必须严格覆盖 5 个 factor(${CHOKEPOINT_FACTORS.join("、")}),每个 0-100 + 判断依据 + source_refs。`,
      "- is_chokepoint:综合判定。记住「是咽喉」是必要不充分条件——能被设计绕开或变现不了的瓶颈不算。",
      "- thesis:2-4 句中文逻辑,点明谁离不开它、卡点如何变现。",
      "- red_flags / verification_backlog:如实列出,无则给空数组,不要凑数编造。",
      "注意:综合咽喉分由系统在服务端按权重计算,你**不要**自行输出总分。",
    ].join("\n");

    const { data, repairs } = await callLLMJson(SYSTEM, userMsg, SCHEMA, {
      maxTokens: 4096,
      maxRepairs: 2,
      useSearch: true,
      skillId: "chokepoint_analysis",
    });

    // 服务端确定性计算综合咽喉分(含价值捕获门控)
    const scoring = computeChokepointScore(data.factor_assessment);
    data.chokepoint_score = scoring.chokepoint_score;
    data.score_breakdown = {
      base_score: scoring.base_score,
      value_capture_gated: scoring.gated,
      weights: FACTOR_WEIGHTS,
      factor_labels: FACTOR_LABELS,
    };
    // is_chokepoint 与综合分自洽:综合分很低却判 true 时,以分数为准下调判定
    if (data.is_chokepoint === true && scoring.chokepoint_score < 45) {
      data.is_chokepoint = false;
      data.thesis = `[系统注:综合咽喉分 ${scoring.chokepoint_score} 偏低,卡点未能转化为投资级护城河,判定下调]\n${data.thesis || ""}`.slice(0, 600);
    }

    let audit;
    try {
      audit = assertGrounded(data, factPack, { requiredPaths: ["factor_assessment"] });
    } catch (groundingErr) {
      audit = {
        ok: false,
        errors: groundingErr.audit?.errors || [],
        warnings: ["部分咽喉判断的事实引用(source_refs)缺失或指向不存在的编号，建议人工核实"],
        referenced_count: groundingErr.audit?.referenced_count || 0,
      };
    }
    const missingRefs = countMissingRefs(data, _SOFT_REFS_PATHS);

    return {
      ok: true,
      artifact: {
        kind: "json",
        summary: `供应链咽喉分析 — ${data.is_chokepoint ? "构成咽喉护城河" : "未构成投资级咽喉"} (咽喉分 ${scoring.chokepoint_score}/100)`,
        payload: data,
      },
      metadata: {
        llm_repairs: repairs,
        grounding: audit,
        grounding_missing_refs_count: missingRefs.count,
        grounding_missing_refs_paths: missingRefs.paths,
        fallback: summarizeFallback(data, "chokepoint_analysis"),
        evidence_search_used: searchUsed,
        upload_facts_used: uploadCount,
        upload_structured_used: !!uploadStructuredUsed,
        upload_structured_fact_count: uploadStructuredFactCount || 0,
        chokepoint_score: scoring.chokepoint_score,
      },
    };
  },

  // 暴露给测试 + 评分系统复用
  _private: { SCHEMA, computeChokepointScore, _SOFT_REFS_PATHS },
};
