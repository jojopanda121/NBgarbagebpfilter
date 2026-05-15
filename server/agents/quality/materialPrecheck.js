// ============================================================
// server/agents/quality/materialPrecheck.js
//
// 生成前材料完整性预检 — fail-fast, 不调 LLM, 纯规则.
//
// 目的: 在调 LLM 之前判断"用户给的材料是否足以支撑一个 PE/VC 速览".
// 不够就直接拒绝, 不要让 LLM 编造.
//
// 输出: { ok, errors[], warnings[], stats }
//   - ok = false 时, 上游应当抛错给用户, 不要继续调 LLM.
//   - warnings 不阻止生成, 但应当透传给前端做"质量提示".
// ============================================================

"use strict";

// 公司主体识别 — 出现这些词中任一即视为提到公司
const COMPANY_HINT_RE = /(公司|集团|股份|有限|科技|医药|生物|实业|网络|信息|Inc\b|Corp\b|Ltd\b|LLC\b|GmbH\b)/i;

// 数字识别 — 匹配 "12,345" / "65.4%" / "3 亿" / "10x" / "Q3" 等 PE/VC 常见数字形式
const NUMBER_RE = /(\d[\d,\.]*\s*(亿|万|千|%|x|倍|人|个|轮|月|年|季|Q[1-4])|\d{2,}|\d+\.\d+)/g;

// 一级市场材料应当覆盖的 4 个核心维度
const REQUIRED_TOPIC_HINTS = {
  product:  /(产品|解决方案|服务|技术|平台|赛道|业务|software|product|service)/i,
  team:     /(创始人|CEO|CTO|COO|CFO|团队|founder|履历|毕业|创业|管理层)/i,
  finance:  /(收入|营收|ARR|GMV|毛利|净利|现金流|EBITDA|revenue|profit|loss)/i,
  funding:  /(融资|估值|轮|valuation|raise|pre-?money|领投|跟投|股东|investor)/i,
};

/**
 * 对一段公司材料做完整性预检.
 *
 * @param {string} materials  用户提供的原始材料 (BP / 招股书 / 行研 / 路演纪要节选)
 * @param {object} [opts]
 * @param {string} [opts.templateName]   模板名, 仅用于错误信息
 * @param {number} [opts.minChars=200]   字数下限. 一级市场速览至少要 200 字, 否则信息量不够
 * @param {number} [opts.minNumbers=3]   数字下限. 没有数字就不是 PE/VC 材料, 是宣传册
 * @returns {{ok:boolean, errors:string[], warnings:string[], stats:object}}
 */
function precheck(materials, opts = {}) {
  const {
    templateName = "pptx",
    minChars = 200,
    minNumbers = 3,
  } = opts;

  const text = String(materials || "").trim();
  const errors = [];
  const warnings = [];

  // 1. 字数下限
  if (text.length < minChars) {
    errors.push(
      `材料字数 ${text.length} 不足 ${minChars}, 不足以生成 ${templateName} 模板的内容. 请补充更详细的 BP / 招股书 / 调研笔记.`
    );
  }

  // 2. 公司主体识别
  if (!COMPANY_HINT_RE.test(text)) {
    errors.push(
      "材料中未识别到公司主体词 (公司/集团/股份/有限/科技/医药/Inc/Ltd 等), 无法确定生成对象."
    );
  }

  // 3. 数字密度 (PE/VC 材料应当含足够数字)
  const numbers = text.match(NUMBER_RE) || [];
  if (numbers.length < minNumbers) {
    warnings.push(
      `材料数字仅 ${numbers.length} 个 (低于 ${minNumbers}), 输出可能偏叙事化, ` +
      `估值/收入/份额等关键字段大概率会标 "未披露".`
    );
  }

  // 4. 核心维度覆盖
  const missingTopics = [];
  for (const [key, re] of Object.entries(REQUIRED_TOPIC_HINTS)) {
    if (!re.test(text)) missingTopics.push(key);
  }
  if (missingTopics.length >= 3) {
    errors.push(
      `材料未覆盖核心维度 [${missingTopics.join(" / ")}], ` +
      `4 个维度 (产品/团队/财务/融资) 缺失 ${missingTopics.length} 个. ` +
      `建议补充后再生成, 否则 agent 会用 "未披露" 填满半数字段.`
    );
  } else if (missingTopics.length > 0) {
    warnings.push(
      `材料缺少维度 [${missingTopics.join(" / ")}], 这些字段将以 "未披露" 占位.`
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      chars: text.length,
      numbers: numbers.length,
      missingTopics,
    },
  };
}

module.exports = { precheck };
