import React, { useEffect, useRef } from "react";
import useAnalysisStore from "../store/useAnalysisStore";
import useAuthStore from "../store/useAuthStore";
import UploadSection from "../components/UploadSection";
import PipelineTracker from "../components/PipelineTracker";
import ScoreVisualizer from "../components/ScoreVisualizer";
import DetailedReport from "../components/DetailedReport";
import VerdictCard from "../components/VerdictCard";
import { useAnalysisPipeline } from "../hooks/useAnalysisPipeline";
import { Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function DashboardPage() {
  const result = useAnalysisStore((s) => s.result);
  const token = useAuthStore((s) => s.token);
  const quota = useAuthStore((s) => s.quota);
  const { resumeAnalysis, getPendingTask } = useAnalysisPipeline();
  const navigate = useNavigate();

  const resumeRef = useRef(resumeAnalysis);
  const getPendingRef = useRef(getPendingTask);
  useEffect(() => {
    const pendingTaskId = getPendingRef.current();
    if (pendingTaskId) {
      resumeRef.current(pendingTaskId);
    }
  }, []);

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
      {/* 额度提示条 */}
      {token && quota && !result && (
        <div className="flex items-center justify-between bg-slate-900/50 border border-white/10 rounded-xl px-4 py-3 mb-6">
          <div className="flex items-center gap-2 text-sm">
            <Zap className="w-4 h-4 text-yellow-400" />
            <span className="text-slate-300">
              剩余额度：
              <span className="text-white font-medium">{quota.free || 0}</span> 次免费
              {quota.paid > 0 && (
                <> + <span className="text-blue-400 font-medium">{quota.paid}</span> 次付费</>
              )}
            </span>
          </div>
          <button
            onClick={() => navigate("/settings?tab=token")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
          >
            <Zap className="w-3.5 h-3.5" />
            兑换额度
          </button>
        </div>
      )}

      {!result && (
        <>
          <UploadSection />
          <PipelineTracker />
        </>
      )}

      {result && (
        <div className="space-y-6">
          <VerdictCard result={result} />
          <ScoreVisualizer verdict={result.verdict} />
          <DetailedReport result={result} />
        </div>
      )}
    </main>
  );
}
