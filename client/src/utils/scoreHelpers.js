// ── 评分辅助函数 (v4.0 重构版) ──
// 与 server/scoring.js 的二维评级系统保持一致

export const getGrade = (s) =>
  s >= 85 ? "A" :
  s >= 70 ? "B" :
  s >= 60 ? "C" :
  "D";

export const getGradeColor = (grade) => {
  if (grade === "A") return "text-emerald-400";
  if (grade === "B") return "text-blue-400";
  if (grade === "C") return "text-yellow-400";
  return "text-red-400";
};

export const getGradeLabel = (grade) => {
  const labels = {
    A: "强烈推荐投资 (Fast Track)",
    B: "谨慎推荐 (Proceed with DD)",
    C: "观望跟踪 (Keep In View)",
    D: "建议放弃 (Reject / Archive)",
  };
  return labels[grade] || grade;
};

export const getGradeAction = (grade) => {
  const actions = {
    A: "立刻推进：建议 24 小时内约见创始人，同步启动业务尽调（客户访谈、竞品验证）和财务尽调（审计底稿、银行流水），并行开始估值建模。优先关注收入确认方式与客户集中度。",
    B: "安排创始人面谈，重点考察团队对行业周期的认知深度与战略定力。要求提供近 12 个月的月度财务明细，验证单位经济模型（LTV/CAC、毛利率、回款周期），同步启动竞品客户交叉验证。",
    C: "项目处于早期验证阶段，商业模式尚未完全跑通。建议保持季度跟踪频率，关注关键里程碑达成情况（首个标杆客户、产品 PMF 验证、单月盈亏平衡），如有显著进展可重新进入评审流程。",
    D: "项目存在结构性硬伤：可能涉及伪需求（缺乏付费意愿验证）、商业模式不可持续（边际成本不收敛）、核心团队与赛道严重不匹配、或估值脱离基本面。建议归档并标注具体否决原因，供投委会复盘参考。",
  };
  return actions[grade] || "";
};

export const getGradeInfo = (score) => {
  const grade = getGrade(score);
  const color = getGradeColor(grade);
  const label = getGradeLabel(grade);
  const action = getGradeAction(grade);

  let bg, border;
  if (grade === "A") {
    bg = "bg-emerald-500/10";
    border = "border-emerald-500/20";
  } else if (grade === "B") {
    bg = "bg-blue-500/10";
    border = "border-blue-500/20";
  } else if (grade === "C") {
    bg = "bg-yellow-500/10";
    border = "border-yellow-500/20";
  } else {
    bg = "bg-red-500/10";
    border = "border-red-500/20";
  }

  return { grade, color, label, action, bg, border };
};

export const getScoreColor = (s) =>
  s >= 70 ? "text-emerald-400" : s >= 50 ? "text-yellow-400" : "text-red-400";

export const getScoreBg = (s) =>
  s >= 70 ? "#34d399" : s >= 50 ? "#fbbf24" : "#f87171";

export const getVerdict = (s) =>
  s >= 85 ? "难得不是垃圾，值得深入看看" :
  s >= 70 ? "有点意思，建议约谈创始人" :
  s >= 60 ? "一般般，建议观望" :
  s >= 45 ? "风险较高，谨慎考虑" :
  "建议直接 Pass，下一个";
