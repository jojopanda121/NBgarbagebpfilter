// ============================================================
// server/services/iMemoService.js — 投资备忘录生成服务
//
// 纯模板拼接，不调用 LLM。基于已有分析结果生成 Markdown 格式 IMemo。
// 首次生成后缓存到 tasks.imemo_cache，后续直接返回。
// ============================================================

const { getDb } = require("../db");

/**
 * 将 0-100 分数转为文字等级
 */
function scoreToBand(score) {
  if (score == null) return "暂无数据";
  if (score >= 85) return `${score}分（优秀）`;
  if (score >= 70) return `${score}分（良好）`;
  if (score >= 60) return `${score}分（一般）`;
  return `${score}分（较弱）`;
}

/**
 * 从 claim_verdicts 中提取风险摘要
 */
function extractRisks(claimVerdicts = []) {
  const risky = claimVerdicts.filter(cv =>
    ["夸大", "严重夸大", "信息不对称", "证伪"].includes(cv.verdict)
  );
  if (risky.length === 0) return "暂未发现明显信息不对称风险。";
  return risky.map(cv =>
    `- **[${cv.verdict}]** ${cv.original_claim}${cv.diff ? `（${cv.diff}）` : ""}`
  ).join("\n");
}

/**
 * 生成 IMemo Markdown 文本
 */
function buildIMemoMarkdown(task, result) {
  const e = result.extracted_data || {};
  const v = result.verdict || {};
  const dims = v.dimensions || {};
  const vc = v.valuation_comparison || {};
  const totalScore = task.adjusted_score ?? v.total_score ?? 0;
  const gradeLabel = v.grade_label || "";

  const companyName = e.company_name || task.title || "（未知公司）";
  const archiveNo = task.archive_number || "";
  const dateStr = task.created_at ? new Date(task.created_at).toLocaleDateString("zh-CN") : "";

  return `# 投资备忘录（初稿）

> 本备忘录由 AI 辅助生成，仅供内部参考，不构成最终投资建议。
> 归档编号：${archiveNo}　生成日期：${dateStr}

---

## 一、项目概况

| 字段 | 内容 |
|------|------|
| 公司名称 | ${companyName} |
| 行业赛道 | ${result.industry || e.industry || "—"} |
| 产品/服务 | ${e.product_name || "—"} |
| 所在地区 | ${task.project_location || e.project_location || "—"} |
| BP 估值 | ${e.BP_Valuation ? `${e.BP_Valuation} 亿元` : "—"} |
| BP 收入/ARR | ${e.BP_Revenue ? `${e.BP_Revenue} 亿元` : "—"} |
| 商业模式 | ${e.Business_Model || "—"} |
| 增长引擎 | ${e.Growth_Engine || "—"} |
| 网络效应 | ${e.Network_Effect || "无明确网络效应"} |

**AI 综合评分：${totalScore} 分（${v.grade || "—"}级）** — ${gradeLabel}

---

## 二、市场分析

**市场规模（TAM）：** ${e.TAM_Million_RMB ? `${(e.TAM_Million_RMB / 100).toFixed(0)} 亿人民币` : "暂无数据"}

**市场增速（CAGR）：** ${e.CAGR ? `${e.CAGR}%` : "暂无数据"}

**时机与天花板评分：** ${scoreToBand(dims.timing_ceiling?.score)}

${result.deep_research ? `**深度研究摘要：**

${result.deep_research.slice(0, 800)}${result.deep_research.length > 800 ? "\n\n*（以下内容省略，请查看完整深度报告）*" : ""}` : ""}

---

## 三、产品与技术评估

**技术就绪水平（TRL）：** ${e.TRL || "—"} / 9

**竞品排名：** ${dims.product_moat?.inputs?.Competitor_Rank_Score || "—"} / 10

**产品与壁垒评分：** ${scoreToBand(dims.product_moat?.score)}

${dims.product_moat?.finding ? `**AI 发现：** ${dims.product_moat.finding}` : ""}

---

## 四、资本效率与规模效应

**行业资本效率：** ${dims.business_validation?.inputs?.Industry_Capital_Score || "—"} / 10

**行业规模效应：** ${dims.business_validation?.inputs?.Industry_Scale_Score || "—"} / 10

**资本效率评分：** ${scoreToBand(dims.business_validation?.score)}

---

## 五、团队评估

**团队基因评分：** ${scoreToBand(dims.team?.score)}

${dims.team?.finding ? `**AI 发现：** ${dims.team.finding}` : ""}

---

## 六、估值分析

${vc.bp_multiple ? `**BP 声明估值倍数：** ${vc.bp_multiple}×

**行业平均倍数：** ${vc.industry_avg_multiple || "—"}×

**溢价幅度：** ${vc.overvalued_pct != null ? `${vc.overvalued_pct > 0 ? "+" : ""}${vc.overvalued_pct}%` : "—"}

**参考公司：** ${(vc.comparable_companies || []).join("、") || "—"}

**数据来源：** ${vc.data_source || "—"}

${vc.analysis ? `**分析：** ${vc.analysis}` : ""}` : "暂无估值对比数据。"}

---

## 七、BP 诚信度

**BP 诚信度评分：** ${scoreToBand(dims.external_risk?.score)}

**信息风险项：**

${extractRisks(v.claim_verdicts)}

---

## 八、风险矩阵

${(v.risk_flags || []).length > 0
  ? (v.risk_flags || []).map(r => `- ${r}`).join("\n")
  : "AI 未发现明显结构性风险。"}

---

## 九、优势亮点

${(v.strengths || []).length > 0
  ? (v.strengths || []).map(s => `- ${s}`).join("\n")
  : "—"}

---

## 十、投资建议

**评级：${v.grade || "—"} — ${gradeLabel}**

${v.grade_action || ""}

---

## 十一、尽调清单（待核实事项）

> 以下事项源自 AI 声明核查结果，建议在正式尽调中逐一核实。

${(v.claim_verdicts || [])
  .filter(cv => ["存疑", "夸大", "严重夸大", "信息不对称", "证伪"].includes(cv.verdict))
  .map((cv, i) => `${i + 1}. **[${cv.verdict}]** ${cv.original_claim}${cv.diff ? `  →  ${cv.diff}` : ""}`)
  .join("\n") || "无需重点核实的声明。"}

---

*本文件由垃圾BP过滤机 AI 系统自动生成 · 归档编号 ${archiveNo}*
`;
}

/**
 * 获取或生成 IMemo（幂等，有缓存直接返回）
 *
 * @param {string} taskId
 * @returns {{ markdown: string, generated_at: string }}
 */
function getOrGenerateIMemo(taskId) {
  const db = getDb();
  const row = db.prepare(
    "SELECT id, result, imemo_cache, title, archive_number, created_at, project_location, adjusted_score FROM tasks WHERE id = ?"
  ).get(taskId);

  if (!row) throw new Error("任务不存在");

  // 有缓存直接返回
  if (row.imemo_cache) {
    const cached = JSON.parse(row.imemo_cache);
    return cached;
  }

  const result = typeof row.result === "string" ? JSON.parse(row.result) : row.result;
  if (!result?.verdict) throw new Error("报告数据不完整，无法生成 IMemo");

  const markdown = buildIMemoMarkdown(row, result);
  const generated_at = new Date().toISOString();
  const cache = { markdown, generated_at };

  db.prepare("UPDATE tasks SET imemo_cache = ? WHERE id = ?")
    .run(JSON.stringify(cache), taskId);

  return cache;
}

/**
 * 强制重新生成（清除缓存）
 */
function regenerateIMemo(taskId) {
  const db = getDb();
  db.prepare("UPDATE tasks SET imemo_cache = NULL WHERE id = ?").run(taskId);
  return getOrGenerateIMemo(taskId);
}

module.exports = { getOrGenerateIMemo, regenerateIMemo };
