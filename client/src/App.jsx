import React, { memo } from "react";
import { Gavel, Download } from "lucide-react";
import useAnalysisStore from "./store/useAnalysisStore";
import UploadSection from "./components/UploadSection";
import PipelineTracker from "./components/PipelineTracker";
import ScoreVisualizer from "./components/ScoreVisualizer";
import DetailedReport from "./components/DetailedReport";
import { downloadReportAsPdf } from "./utils/downloadReport";
import {
  getGrade,
  getGradeColor,
  getGradeLabel,
  getGradeAction,
  getScoreColor,
  getScoreBg,
  getVerdict,
} from "./utils/scoreHelpers";

// ── 裁决卡片（顶部总分 + 等级 + 标签）──
const VerdictCard = memo(function VerdictCard({ result }) {
  if (!result?.verdict) return null;
  const verdict = result.verdict;
  const totalScore = verdict.total_score ?? 0;
  const grade = verdict.grade || getGrade(totalScore);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 sm:p-8">
      <div className="flex flex-col md:flex-row items-center gap-6 sm:gap-8">
        {/* 圆形分数仪表 */}
        <div className="text-center">
          <div className="relative w-36 h-36">
            <svg className="w-36 h-36 -rotate-90" viewBox="0 0 120 120">
              <circle
                cx="60" cy="60" r="52"
                fill="none" stroke="#1f2937" strokeWidth="8"
              />
              <circle
                cx="60" cy="60" r="52"
                fill="none"
                stroke={getScoreBg(totalScore)}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${(totalScore / 100) * 327} 327`}
                className="transition-all duration-1000"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-4xl font-bold ${getScoreColor(totalScore)}`}>
                {totalScore}
              </span>
              <span className="text-xs text-gray-500">/ 100</span>
            </div>
          </div>
          <div className={`text-3xl font-black mt-2 ${getGradeColor(grade)}`}>
            {grade}
          </div>
        </div>

        {/* 裁决摘要 */}
        <div className="flex-1 text-center md:text-left">
          <h3 className="text-xl font-bold mb-2">评分结果</h3>
          <div className="text-2xl font-bold mb-2">
            {verdict.grade} - {getGradeLabel(verdict.grade)}
          </div>
          <p className="text-base text-gray-300 mb-3">
            {verdict.verdict_summary || getVerdict(totalScore)}
          </p>
          <p className="text-sm text-gray-400 leading-relaxed">
            {getGradeAction(verdict.grade)}
          </p>
          {result.elapsed_seconds && (
            <p className="text-sm text-gray-500 mt-2">
              分析耗时 {result.elapsed_seconds}s
            </p>
          )}

          {/* 优势标签 */}
          {verdict.strengths?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {verdict.strengths.map((s, i) => (
                <span
                  key={i}
                  className="px-3 py-1 text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full"
                >
                  {s}
                </span>
              ))}
            </div>
          )}

          {/* 风险标签 */}
          {verdict.risk_flags?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {verdict.risk_flags.map((r, i) => (
                <span
                  key={i}
                  className="px-3 py-1 text-xs bg-red-500/10 text-red-400 border border-red-500/20 rounded-full"
                >
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

// ── 根组件（薄层协调器）──
export default function App() {
  const result = useAnalysisStore((s) => s.result);
  const reset = useAnalysisStore((s) => s.reset);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
              <Gavel className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold tracking-tight truncate">垃圾BP过滤机</h1>
              <p className="text-xs text-gray-500 hidden sm:block">AI 辩证法尽调 · 辨伪识真</p>
            </div>
          </div>
          {result && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => downloadReportAsPdf(result)}
                className="px-3 py-1.5 sm:px-4 sm:py-2 text-sm bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors flex items-center gap-1.5 sm:gap-2"
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">下载报告</span>
              </button>
              <button
                onClick={reset}
                className="px-3 py-1.5 sm:px-4 sm:py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
              >
                <span className="hidden sm:inline">重新分析</span>
                <span className="sm:hidden">重置</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
        {/* 上传 + 流水线进度（分析中显示） */}
        {!result && (
          <>
            <UploadSection />
            <PipelineTracker />
          </>
        )}

        {/* 结果面板（分析完成后显示） */}
        {result && (
          <div className="space-y-6">
            <VerdictCard result={result} />
            <ScoreVisualizer verdict={result.verdict} />
            <DetailedReport result={result} />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 mt-16 py-6 text-center text-sm text-gray-600">
        <p>垃圾BP过滤机 v2.0 · 辩证法三角验证引擎</p>
        <p className="mt-1">Powered by MiniMax M2.5</p>
      </footer>
    </div>
  );
}
