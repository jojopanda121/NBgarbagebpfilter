// ── 评分辅助函数 ──

export const getGrade = (s) =>
  s >= 85 ? "A" :
  s >= 75 ? "B" :
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
    A: "推荐投资 (Fast Track)",
    B: "谨慎推荐 (Proceed with DD)",
    C: "可以跟进 (Keep In View)",
    D: "建议放弃 (Reject / Archive)",
  };
  return labels[grade] || grade;
};

export const getGradeAction = (grade) => {
  const actions = {
    A: "立刻推进：24小时内约见创始人，启动业务尽调和财务尽调，开始建模",
    B: "空甲拟议：安排面聊，核心考察团队对短期的认知，在财务数据中申请行权测试，并始佑价。",
    C: "早期留金 or 平台生高：商业逻辑穿透没准，但缺乏数据验证。建议盒金 VP 梳理 POC，关注签约，再评估天花板价值量，支支评估。",
    D: "结构性死亡：伪需求，烧钱无底洞 (LTV<CAC)，股权结构混乱，严重高估，严重低估处于1万期初的人工时间。",
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
