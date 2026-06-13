// ScoreSnapshotCard — 论坛里展示的"评分结果第一部分"快照
// 只读、精简：总分 + 评级 + 一句话结论 + 亮点 + 风险（风险强制展示）。
// 带"平台实测"徽章（lucide ShieldCheck）—— 论坛分数恒为平台快照。
import React from "react";
import { ShieldCheck, TrendingUp, AlertTriangle } from "lucide-react";
import { gradeColorClass } from "../../constants/forum";

export default function ScoreSnapshotCard({ score, compact = false }) {
  if (!score) return null;
  const gradeColor = gradeColorClass(score.grade);

  return (
    <div className="border border-[#D8DCE8] rounded-lg bg-white overflow-hidden">
      {/* 顶部：分数 + 评级 + 实测徽章 */}
      <div className="flex items-stretch">
        <div className="flex flex-col items-center justify-center px-5 py-4 bg-[#F6F7FA] border-r border-[#EEF1F7] min-w-[110px]">
          <div className={`text-4xl font-black ${gradeColor} font-mono-fin`}>{score.total_score}</div>
          <div className="text-[11px] text-[#8E9BB0] mt-0.5">总分 / 100</div>
        </div>
        <div className="flex-1 px-4 py-3 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-2xl font-black ${gradeColor}`}>{score.grade}</span>
            <span className="text-sm font-medium text-[#0D2145]">{score.grade_label}</span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#E7F6EF] text-[#0F8A5F] text-[10px] font-medium">
              <ShieldCheck className="w-3 h-3" /> 平台实测
            </span>
          </div>
          {score.verdict_summary && (
            <p className="text-sm text-[#4B5A72] mt-1.5 leading-relaxed">{score.verdict_summary}</p>
          )}
        </div>
      </div>

      {!compact && (score.strengths?.length > 0 || score.risk_flags?.length > 0) && (
        <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[#EEF1F7] border-t border-[#EEF1F7]">
          {score.strengths?.length > 0 && (
            <div className="px-4 py-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#0F8A5F] mb-1.5">
                <TrendingUp className="w-3.5 h-3.5" /> 亮点
              </div>
              <ul className="space-y-1">
                {score.strengths.map((s, i) => (
                  <li key={i} className="text-xs text-[#4B5A72] flex gap-1.5">
                    <span className="text-[#0F8A5F]">•</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {score.risk_flags?.length > 0 && (
            <div className="px-4 py-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#B45309] mb-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> 风险旗标
              </div>
              <ul className="space-y-1">
                {score.risk_flags.map((r, i) => (
                  <li key={i} className="text-xs text-[#4B5A72] flex gap-1.5">
                    <span className="text-[#B45309]">•</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
