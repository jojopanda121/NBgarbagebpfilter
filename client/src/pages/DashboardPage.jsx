import React, { useEffect, useRef } from "react";
import useAnalysisStore from "../store/useAnalysisStore";
import useAuthStore from "../store/useAuthStore";
import UploadSection from "../components/UploadSection";
import PipelineTracker from "../components/PipelineTracker";
import ScoreVisualizer from "../components/ScoreVisualizer";
import DetailedReport from "../components/DetailedReport";
import VerdictCard from "../components/VerdictCard";
import { useAnalysisPipeline } from "../hooks/useAnalysisPipeline";
import { Zap, CreditCard } from "lucide-react";

export default function DashboardPage() {
  const result = useAnalysisStore((s) => s.result);
  const analyzing = useAnalysisStore((s) => s.analyzing);
  const token = useAuthStore((s) => s.token);
  const quota = useAuthStore((s) => s.quota);
  const setRequirePayment = useAuthStore((s) => s.setRequirePayment);
  const { resumeAnalysis, getPendingTask } = useAnalysisPipeline();

  // 页面加载时检测是否有后台进行中的任务（绑定 userId），有则自动恢复轮询
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
      {/* 额度提示条（已登录时显示） */}
      {token && quota && !result && (
        <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 mb-6">
          <div className="flex items-center gap-2 text-sm">
            <Zap className="w-4 h-4 text-yellow-400" />
            <span className="text-gray-300">
              剩余额度：
              <span className="text-white font-medium">{quota.free || 0}</span> 次免费
              {quota.paid > 0 && (
                <> + <span className="text-blue-400 font-medium">{quota.paid}</span> 次付费</>
              )}
            </span>
          </div>
          <button
            onClick={() => setRequirePayment(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
          >
            <CreditCard className="w-3.5 h-3.5" />
            充值
          </button>
        </div>
      )}

      {/* 上传 + 流水线进度 */}
      {!result && (
        <>
          <UploadSection />
          <PipelineTracker />
        </>
      )}

      {/* 结果面板 */}
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
