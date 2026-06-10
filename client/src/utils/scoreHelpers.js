// ── 评分展示辅助函数 ──
// 评级阈值、评级文案、行动建议均为后端权威输出
// （server/scoring.js getGrade → verdict.grade / grade_label / grade_action），
// 前端不再维护副本，避免前后端阈值/文案漂移。
// 本文件只保留"评级字母 → 展示样式"的纯展示映射。

/** 评级字母 → 文字颜色 */
export const getGradeColor = (grade) => {
  if (grade === "A") return "text-emerald-400";
  if (grade === "B") return "text-blue-400";
  if (grade === "C") return "text-yellow-400";
  return "text-red-400";
};

/** 评级字母 → 背景/边框样式 */
export const getGradeStyle = (grade) => {
  if (grade === "A") return { bg: "bg-emerald-500/10", border: "border-emerald-500/20" };
  if (grade === "B") return { bg: "bg-blue-500/10", border: "border-blue-500/20" };
  if (grade === "C") return { bg: "bg-yellow-500/10", border: "border-yellow-500/20" };
  return { bg: "bg-red-500/10", border: "border-red-500/20" };
};

/** 分数 → 文字颜色（纯展示渐变，与评级无关） */
export const getScoreColor = (s) =>
  s >= 70 ? "text-emerald-400" : s >= 50 ? "text-yellow-400" : "text-red-400";

/** 分数 → 进度环颜色 */
export const getScoreBg = (s) =>
  s >= 70 ? "#34d399" : s >= 50 ? "#fbbf24" : "#f87171";
