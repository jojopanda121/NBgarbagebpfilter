// ============================================================
// server/agents/quality/contentCritic.js
//
// Critic agent — JSON 产出后的语义批判. 调一次 LLM, 返回结构化判决.
//
// 集成方式: pptxTemplate.generate() 在 generateJson 之后调 critique(),
// 若返回 block-级 issue 则触发"带提示重试", 二次仍 block 则降级为占位.
//
// 此模块独立可测: 通过 jest.mock("../../services/llmService") 注入 fake.
// ============================================================

"use strict";

const { callLLMJson } = require("../../services/llmService");
const { CRITIC_SYSTEM_PROMPT } = require("./criticPrompts");
const logger = require("../../utils/logger");

// Critic 输出的 schema. 与 prompt 里描述的字段集合保持一致.
const CRITIC_OUTPUT_SCHEMA = {
  type: "object",
  required: ["pass", "issues"],
  additionalProperties: false,
  properties: {
    pass: { type: "boolean" },
    issues: {
      type: "array",
      items: {
        type: "object",
        required: ["severity", "field", "kind", "detail"],
        additionalProperties: false,
        properties: {
          severity: { type: "string", enum: ["block", "warn"] },
          field:    { type: "string", minLength: 1, maxLength: 80 },
          kind: {
            type: "string",
            enum: [
              "fabricated_fact",
              "inconsistent_number",
              "no_comparator",
              "single_source_unmarked",
              "sales_language",
              "topic_drift",
            ],
          },
          detail:        { type: "string", minLength: 4, maxLength: 240 },
          suggested_fix: { type: "string", maxLength: 200 },
        },
      },
    },
  },
};

/**
 * 调 critic 审查一份 agent 产出的 JSON 是否对得起材料原文.
 *
 * @param {object} args
 * @param {object} args.json          agent 产出的待审 JSON
 * @param {string} args.materials     原始材料 (与 generateJson 用的同一份)
 * @param {string} args.templateName  模板名, 仅日志用
 * @returns {Promise<{pass:boolean, issues:Array}>}
 */
async function critique({ json, materials, templateName = "pptx" }) {
  const userContent = [
    `【模板】${templateName}`,
    "",
    "【公司材料原文】",
    materials,
    "",
    "【LLM 产出的 JSON】",
    JSON.stringify(json, null, 2),
    "",
    "请逐字段比对材料原文与 JSON, 按 schema 返回 critique. 严格按规则判, 不要无中生有.",
  ].join("\n");

  const r = await callLLMJson(CRITIC_SYSTEM_PROMPT, userContent, CRITIC_OUTPUT_SCHEMA, {
    maxTokens: 1500,
    maxRepairs: 1,
    useSearch: false,  // critic 不需要联网, 只比对眼前材料
  });
  const judgment = r.data || { pass: true, issues: [] };
  const blockers = (judgment.issues || []).filter((i) => i.severity === "block");
  logger.info(
    `[Critic/${templateName}] pass=${judgment.pass} issues=${(judgment.issues || []).length} blockers=${blockers.length}`
  );
  return judgment;
}

/**
 * 取 critique 结果里 block-级 issue 的可执行修复说明,
 * 以塞回 LLM 上下文 做"带提示重生成".
 *
 * @param {Array} issues
 * @returns {string}  形如 "- highlights[2].desc: fabricated_fact ...\n- ..."
 */
function blockerInstructions(issues) {
  return (issues || [])
    .filter((i) => i.severity === "block")
    .map((i) => `- ${i.field} (${i.kind}): ${i.detail}${i.suggested_fix ? ` | 建议: ${i.suggested_fix}` : ""}`)
    .join("\n");
}

module.exports = {
  critique,
  blockerInstructions,
  CRITIC_OUTPUT_SCHEMA,
};
