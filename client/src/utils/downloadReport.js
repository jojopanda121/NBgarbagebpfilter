import { getGrade, getGradeLabel, getGradeAction, getScoreBg } from "./scoreHelpers";
import { dimLabelsMap } from "../constants";

// ── PDF 报告下载（打开新窗口触发浏览器打印/另存为PDF）──
export function downloadReportAsPdf(result) {
  const verdict = result.verdict;
  const totalScore = verdict.total_score ?? 0;
  const grade = verdict.grade || getGrade(totalScore);
  const gradeAction = verdict.grade_action || getGradeAction(grade);
  const dims = verdict.dimensions || {};

  // 估值温度计 HTML
  const vc = verdict.valuation_comparison || {};
  const bp = vc.bp_multiple || 0;
  const avg = vc.industry_avg_multiple || 0;
  const overvalued =
    vc.overvalued_pct ??
    (avg > 0 ? Math.round(((bp - avg) / avg) * 100) : 0);
  const valuationHtml =
    bp || avg
      ? `
    <div class="section">
      <h2>估值温度计</h2>
      <table>
        <tr><td>BP 声称估值倍数</td><td><strong>${bp}x</strong></td></tr>
        <tr><td>行业平均估值倍数</td><td><strong>${avg}x</strong></td></tr>
        <tr><td>溢价程度</td><td><strong style="color:${
          overvalued > 100 ? "#dc2626" : overvalued > 50 ? "#d97706" : "#059669"
        }">${overvalued > 0 ? "+" : ""}${overvalued}%</strong></td></tr>
        ${vc.industry_name ? `<tr><td>对标行业</td><td>${vc.industry_name}</td></tr>` : ""}
        ${vc.data_source ? `<tr><td>数据来源</td><td>${vc.data_source}</td></tr>` : ""}
        ${vc.analysis ? `<tr><td colspan="2" style="padding-top:8px">${vc.analysis}</td></tr>` : ""}
      </table>
    </div>
  `
      : "";

  // 冲突分析 HTML
  const conflictsHtml =
    verdict.conflicts?.length > 0
      ? `
    <div class="section">
      <h2>冲突分析（BP 诉求 vs 搜索证据）</h2>
      ${verdict.conflicts
        .map(
          (c) => `
        <div class="conflict">
          <span class="severity severity-${
            c.severity === "严重" ? "high" : c.severity === "中等" ? "mid" : "low"
          }">${c.severity}</span>
          <p><strong style="color:#dc2626">BP 声称：</strong>${c.claim}</p>
          <p><strong style="color:#059669">搜索发现：</strong>${c.evidence}</p>
        </div>
      `
        )
        .join("")}
    </div>
  `
      : "";

  // 深度研究（Markdown → HTML）
  const deepResearch = result.deep_research || "";
  const drHtml = deepResearch
    .replace(/^### (.*$)/gm, "<h3>$1</h3>")
    .replace(/^## (.*$)/gm, '<h2 style="margin-top:16px">$1</h2>')
    .replace(/^# (.*$)/gm, "<h1>$1</h1>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/^- (.*$)/gm, "<li>$1</li>")
    .replace(/^\* (.*$)/gm, "<li>$1</li>")
    .replace(/\n/g, "<br>");

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>BP尽调报告 - 垃圾BP过滤机</title>
<style>
  body { font-family: -apple-system, "Microsoft YaHei", sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; color: #1f2937; line-height: 1.6; }
  h1.title { text-align: center; font-size: 24px; margin-bottom: 4px; }
  .subtitle { text-align: center; color: #6b7280; font-size: 14px; margin-bottom: 30px; }
  .score-card { text-align: center; padding: 30px; background: #f9fafb; border-radius: 12px; margin-bottom: 24px; }
  .score { font-size: 64px; font-weight: 900; color: ${getScoreBg(totalScore)}; }
  .grade { font-size: 36px; font-weight: 900; color: ${getScoreBg(totalScore)}; margin-top: 4px; }
  .grade-label { font-size: 18px; color: #374151; margin-top: 8px; font-weight: 600; }
  .verdict-text { font-size: 16px; color: #4b5563; margin-top: 12px; line-height: 1.5; }
  .tags { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 12px; }
  .tag-green { background: #d1fae5; color: #065f46; padding: 4px 12px; border-radius: 20px; font-size: 12px; }
  .tag-red { background: #fee2e2; color: #991b1b; padding: 4px 12px; border-radius: 20px; font-size: 12px; }
  .section { margin-bottom: 24px; }
  .section h2 { font-size: 18px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 8px 12px; border-bottom: 1px solid #f3f4f6; }
  .dim-row td:first-child { font-weight: 600; width: 180px; }
  .dim-score { font-weight: 700; font-size: 16px; width: 50px; text-align: right; }
  .dim-finding { color: #4b5563; font-size: 14px; }
  .dim-subtitle { color: #6b7280; font-size: 12px; }
  .conflict { padding: 12px; margin-bottom: 8px; background: #fefce8; border-left: 4px solid #d97706; border-radius: 4px; }
  .severity { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 700; margin-bottom: 4px; }
  .severity-high { background: #fee2e2; color: #dc2626; }
  .severity-mid { background: #fef3c7; color: #d97706; }
  .severity-low { background: #dbeafe; color: #2563eb; }
  .deep-research { background: #f9fafb; padding: 20px; border-radius: 8px; font-size: 14px; }
  .deep-research h2 { border-bottom: none; }
  .deep-research li { margin-left: 16px; }
  .footer { text-align: center; color: #9ca3af; font-size: 12px; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>
  <h1 class="title">BP 尽调分析报告</h1>
  <p class="subtitle">由垃圾BP过滤机生成 · 五维定量评分体系 v4.0 · Powered by MiniMax M2.5 · ${new Date().toLocaleDateString("zh-CN")}</p>

  <div class="score-card">
    <div class="score">${totalScore}</div>
    <div class="grade">${grade}</div>
    <div class="grade-label">${verdict.grade_label || getGradeLabel(grade)}</div>
    <div class="verdict-text">${gradeAction}</div>
    ${verdict.strengths?.length > 0 ? `<div class="tags">${verdict.strengths.map((s) => `<span class="tag-green">${s}</span>`).join("")}</div>` : ""}
    ${verdict.risk_flags?.length > 0 ? `<div class="tags" style="margin-top:8px">${verdict.risk_flags.map((r) => `<span class="tag-red">${r}</span>`).join("")}</div>` : ""}
    ${result.elapsed_seconds ? `<p style="color:#9ca3af;font-size:12px;margin-top:12px">分析耗时 ${result.elapsed_seconds}s</p>` : ""}
  </div>

  <div class="section">
    <h2>五维评分详情</h2>
    <table>
      ${Object.entries(dims)
        .map(
          ([key, dim]) => `
        <tr class="dim-row">
          <td>
            <div>${dim.label || dimLabelsMap[key] || key}</div>
            <div class="dim-subtitle">${dim.subtitle || ""}</div>
          </td>
          <td class="dim-score" style="color:${getScoreBg(dim.score)}">${dim.score}</td>
          <td class="dim-finding">${dim.finding || ""}</td>
        </tr>
      `
        )
        .join("")}
    </table>
  </div>

  ${valuationHtml}

  ${
    deepResearch
      ? `
  <div class="section deep-research">
    <h2>AI 深度研究报告</h2>
    ${drHtml}
  </div>
  `
      : ""
  }

  <div class="footer">
    本报告由 AI 自动生成，仅供参考，不构成投资建议。<br>
    垃圾BP过滤机 v4.0 · 五维定量评分体系 · Powered by MiniMax M2.5
  </div>
</body>
</html>`;

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("请允许弹出窗口以下载报告");
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onload = () => {
    setTimeout(() => printWindow.print(), 300);
  };
}
