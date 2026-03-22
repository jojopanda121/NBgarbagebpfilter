// ============================================================
// server/services/ddService.js — 尽调问卷服务
//
// 职责：
//   1. generateDDQuestionnaire: 对存疑声明调用 LLM 生成核实方法（一次性，幂等）
//   2. rescoreAfterDD: 基于用户填写的答案，纯 JS 重算评分（不跑 LLM）
// ============================================================

const { getDb } = require("../db");
const { callLLM } = require("./llmService");
const { getGrade, VERDICT_SCORE_MAP } = require("../scoring");

// 需要尽调核实的 verdict 类型
const DD_VERDICTS = new Set(["存疑", "夸大", "严重夸大", "信息不对称", "证伪"]);

// 用户选择 → 对应的 verdict 得分
const CHOICE_SCORE_MAP = {
  A: 10,  // 实际更好
  B: 10,  // 基本属实
  C: {    // 实际与声明不符，根据原始严重程度赋分
    "存疑":       3,
    "夸大":       1,
    "严重夸大":   0,
    "信息不对称": 1,
    "证伪":       0,
  },
};

/**
 * 从任务结果中提取需要尽调的声明列表
 */
function extractDDClaims(result) {
  const claimVerdicts = result?.verdict?.claim_verdicts || [];
  return claimVerdicts
    .map((cv, index) => ({ ...cv, index }))
    .filter(cv => DD_VERDICTS.has(cv.verdict));
}

/**
 * 调用 LLM 为每条存疑声明生成具体的核实方法
 * 返回格式: [{ claim_index, original_claim, original_verdict, dd_methods: [] }]
 */
async function generateDDMethods(claims) {
  if (!claims || claims.length === 0) return [];

  const claimsJson = JSON.stringify(
    claims.map(c => ({
      index: c.index,
      category: c.category,
      claim: c.original_claim,
      verdict: c.verdict,
      diff: c.diff || "",
    }))
  );

  const systemPrompt = `你是一位经验丰富的 PE/VC 尽职调查专家。
对于每一条存疑的 BP 声明，你需要提供 2-3 条具体可操作的核实方法。

核实方法要求：
- 具体可操作，不要泛泛而谈
- 针对该声明的特定内容（如财务数字、客户名称、专利等）
- 说明从哪里获取证据（银行流水、合同、专利证书、客户访谈等）

只输出纯 JSON 数组，不要任何其他文字：
[
  {
    "index": 0,
    "dd_methods": ["方法1", "方法2", "方法3"]
  }
]`;

  const userContent = `以下是需要核实的 BP 声明列表，请为每条生成核实方法：\n${claimsJson}`;

  try {
    const raw = await callLLM(systemPrompt, userContent, 4096);
    // 提取 JSON 数组
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("LLM 返回格式错误");
    return JSON.parse(match[0]);
  } catch (err) {
    console.error("[ddService] generateDDMethods 失败:", err.message);
    // 降级：返回默认核实方法
    return claims.map(c => ({
      index: c.index,
      dd_methods: ["请要求提供相关证明文件", "与第三方交叉核实"],
    }));
  }
}

/**
 * 生成尽调问卷（幂等：已生成则直接返回缓存）
 *
 * @param {string} taskId
 * @returns {Promise<Array>} questionnaire items
 */
async function generateDDQuestionnaire(taskId) {
  const db = getDb();
  const row = db.prepare("SELECT result, dd_questionnaire FROM tasks WHERE id = ?").get(taskId);
  if (!row) throw new Error("任务不存在");

  // 已有问卷，直接返回
  if (row.dd_questionnaire) {
    return JSON.parse(row.dd_questionnaire);
  }

  const result = typeof row.result === "string" ? JSON.parse(row.result) : row.result;
  if (!result?.verdict?.claim_verdicts) {
    return [];
  }

  const ddClaims = extractDDClaims(result);
  if (ddClaims.length === 0) {
    // 无需尽调，存空数组
    db.prepare("UPDATE tasks SET dd_questionnaire = ? WHERE id = ?").run("[]", taskId);
    return [];
  }

  // 调用 LLM 生成核实方法
  const ddMethods = await generateDDMethods(ddClaims);
  const methodsMap = {};
  for (const m of ddMethods) {
    methodsMap[m.index] = m.dd_methods || [];
  }

  // 组装问卷
  const questionnaire = ddClaims.map(c => ({
    claim_index: c.index,
    category: c.category,
    original_claim: c.original_claim,
    original_verdict: c.verdict,
    diff: c.diff || "",
    severity: c.severity || "",
    dd_methods: methodsMap[c.index] || ["请要求提供相关证明文件"],
    options: {
      A: "实际情况比声明更好（超出或等同于声明且有佐证）",
      B: "基本属实（±20%以内，有证据支撑）",
      C: "实际与声明不符（存在夸大或误导）",
    },
  }));

  // 持久化存储
  db.prepare("UPDATE tasks SET dd_questionnaire = ? WHERE id = ?")
    .run(JSON.stringify(questionnaire), taskId);

  return questionnaire;
}

/**
 * 保存尽调答案（部分保存，随时可调用）
 *
 * @param {string} taskId
 * @param {Object} answers - { "0": "A", "2": "C", ... }
 */
function saveDDAnswers(taskId, answers) {
  const db = getDb();
  const row = db.prepare("SELECT dd_answers FROM tasks WHERE id = ?").get(taskId);
  if (!row) throw new Error("任务不存在");

  // 合并已有答案
  let existing = {};
  try {
    if (row.dd_answers) existing = JSON.parse(row.dd_answers);
  } catch {}

  const merged = { ...existing, ...answers };
  db.prepare("UPDATE tasks SET dd_answers = ? WHERE id = ?")
    .run(JSON.stringify(merged), taskId);

  return merged;
}

/**
 * 基于尽调答案重新计算评分（纯 JS，不跑 LLM）
 *
 * 逻辑：
 *   - S1, S2, S3, S4 完全不变
 *   - S5（BP诚信度）基于用户答案重算：A/B → 10分，C → 按原始严重程度降分
 *   - 未回答的声明保持原始 verdict 得分
 *
 * @param {string} taskId
 * @returns {{ newS5, newTotal, newGrade, delta, originalTotal }}
 */
function rescoreAfterDD(taskId) {
  const db = getDb();
  const row = db.prepare(
    "SELECT result, dd_answers, total_score FROM tasks WHERE id = ?"
  ).get(taskId);
  if (!row) throw new Error("任务不存在");
  if (!row.dd_answers) throw new Error("尚未填写尽调答案");

  const result = typeof row.result === "string" ? JSON.parse(row.result) : row.result;
  const answers = JSON.parse(row.dd_answers);
  const claimVerdicts = result?.verdict?.claim_verdicts || [];

  if (claimVerdicts.length === 0) {
    throw new Error("无声明核查数据");
  }

  // 计算每条声明的得分（已回答 → 用答案分，未回答 → 用原始 verdict 分）
  const scores = claimVerdicts.map((cv, idx) => {
    const choice = answers[String(idx)];
    if (!choice) {
      // 未回答，用原始分
      return VERDICT_SCORE_MAP[cv.verdict] ?? VERDICT_SCORE_MAP["存疑"];
    }
    if (choice === "A" || choice === "B") {
      return CHOICE_SCORE_MAP.A;
    }
    if (choice === "C") {
      return CHOICE_SCORE_MAP.C[cv.verdict] ?? 1;
    }
    return VERDICT_SCORE_MAP[cv.verdict] ?? VERDICT_SCORE_MAP["存疑"];
  });

  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const newS5 = Math.min(100, Math.max(0, Math.round(avgScore * 10)));

  // 取原始各维度分（S1-S4 不变）
  const dims = result.verdict.dimensions;
  const S1 = dims.timing_ceiling?.score || 0;
  const S2 = dims.product_moat?.score || 0;
  const S3 = dims.business_validation?.score || 0;
  const S4 = dims.team?.score || 0;

  const newTotal = Math.min(100, Math.max(0, Math.round((S1 + S2 + S3 + S4 + newS5) / 5)));
  const grading = getGrade(newTotal);
  const originalTotal = row.total_score ?? result.verdict.total_score ?? 0;
  const delta = newTotal - originalTotal;

  // 持久化新分数
  db.prepare("UPDATE tasks SET adjusted_score = ?, project_stage = ? WHERE id = ?")
    .run(newTotal, "dd_done", taskId);

  return {
    newS5,
    newTotal,
    newGrade: grading.grade,
    newGradeLabel: grading.label,
    originalTotal,
    delta,
    answeredCount: Object.keys(answers).length,
    totalClaims: claimVerdicts.length,
  };
}

module.exports = {
  generateDDQuestionnaire,
  saveDDAnswers,
  rescoreAfterDD,
};
