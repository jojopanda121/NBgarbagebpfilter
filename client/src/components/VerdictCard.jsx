import React, { memo } from "react";
import {
  getGradeInfo,
  getScoreColor,
  getScoreBg,
  getVerdict,
} from "../utils/scoreHelpers";

const VerdictCard = memo(function VerdictCard({ result }) {
  if (!result?.verdict) return null;
  const verdict = result.verdict;
  const totalScore = verdict.total_score ?? 0;
  const gradeInfo = getGradeInfo(totalScore);
  const grade = verdict.grade || gradeInfo.grade;
  const displayLabel = verdict.grade_label || gradeInfo.label;
  const displayAction = verdict.grade_action || gradeInfo.action;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 sm:p-8">
      <div className="flex flex-col md:flex-row items-center gap-6 sm:gap-8">
        <div className="text-center">
          <div className="relative w-36 h-36 mx-auto">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="52" fill="none" stroke="#1f2937" strokeWidth="8" />
              <circle
                cx="60" cy="60" r="52" fill="none"
                stroke={getScoreBg(totalScore)}
                strokeWidth="8" strokeLinecap="round"
                strokeDasharray={`${(totalScore / 100) * 327} 327`}
                className="transition-all duration-1000"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-4xl font-bold ${getScoreColor(totalScore)}`}>{totalScore}</span>
              <span className="text-xs text-gray-500">/ 100</span>
            </div>
          </div>
          <div className={`text-3xl font-black mt-2 ${gradeInfo.color}`}>{grade}</div>
        </div>

        <div className="flex-1 text-center md:text-left">
          <h3 className="text-xl font-bold mb-2">评分结果</h3>
          <div className={`text-2xl font-bold mb-2 ${gradeInfo.color}`}>
            {grade} - {displayLabel}
          </div>
          <p className="text-base text-gray-300 mb-3">
            {verdict.verdict_summary || getVerdict(totalScore)}
          </p>
          <div className={`p-4 rounded-xl text-sm leading-relaxed border ${gradeInfo.bg} ${gradeInfo.border} ${gradeInfo.color}`}>
            <span className="font-bold mr-2">行动建议:</span>
            {displayAction}
          </div>
          {result.elapsed_seconds && (
            <p className="text-sm text-gray-500 mt-2">分析耗时 {result.elapsed_seconds}s</p>
          )}

          {verdict.strengths?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {verdict.strengths.map((s, i) => (
                <span key={i} className="px-3 py-1 text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full">
                  {s}
                </span>
              ))}
            </div>
          )}

          {verdict.risk_flags?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {verdict.risk_flags.map((r, i) => (
                <span key={i} className="px-3 py-1 text-xs bg-red-500/10 text-red-400 border border-red-500/20 rounded-full">
                  {r}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default VerdictCard;
