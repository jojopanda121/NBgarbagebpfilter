import React, { useEffect, useRef, useState } from "react";
import useAnalysisStore from "../store/useAnalysisStore";
import useAuthStore from "../store/useAuthStore";
import UploadSection from "../components/UploadSection";
import PipelineTracker from "../components/PipelineTracker";
import AgentProgress from "../components/AgentProgress";
import MultiagentReport from "../components/MultiagentReport";
import ScoreVisualizer from "../components/ScoreVisualizer";
import DetailedReport from "../components/DetailedReport";
import VerdictCard from "../components/VerdictCard";
import { useAnalysisPipeline } from "../hooks/useAnalysisPipeline";
import { Zap, BarChart2, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";

export default function DashboardPage() {
  const result = useAnalysisStore((s) => s.result);
  const token = useAuthStore((s) => s.token);
  const quota = useAuthStore((s) => s.quota);
  const { resumeAnalysis, getPendingTask } = useAnalysisPipeline();
  const navigate = useNavigate();
  const [personalStats, setPersonalStats] = useState(null);

  const resumeRef = useRef(resumeAnalysis);
  const getPendingRef = useRef(getPendingTask);
  useEffect(() => {
    const pendingTaskId = getPendingRef.current();
    if (pendingTaskId) {
      resumeRef.current(pendingTaskId);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    api.get("/api/stats/personal").then(setPersonalStats).catch(() => {});
  }, [token]);

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
      {/* 额度提示条 */}
      {token && quota && !result && (
        <div className="flex items-center justify-between bg-white border border-[#CBD1E0] rounded-xl px-4 py-3 mb-6">
          <div className="flex items-center gap-2 text-sm">
            <Zap className="w-4 h-4 text-yellow-400" />
            <span className="text-[#0C1A30]">
              剩余额度：
              <span className="text-[#0C1A30] font-medium">{quota.free || 0}</span> 次免费
              {quota.paid > 0 && (
                <> + <span className="text-blue-400 font-medium">{quota.paid}</span> 次付费</>
              )}
            </span>
          </div>
          <button
            onClick={() => navigate("/settings?tab=token")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[#1749C9] hover:bg-[#0A1F3D] rounded-lg transition-colors"
          >
            <Zap className="w-3.5 h-3.5" />
            兑换额度
          </button>
        </div>
      )}

      {/* 个人工作台统计栏（无分析结果时显示） */}
      {!result && token && personalStats && (
        <div
          onClick={() => navigate("/app/stats")}
          className="flex items-center justify-between bg-white border border-[#CBD1E0] hover:border-[#A8B0C8] rounded-xl px-4 py-3 mb-5 cursor-pointer transition-colors group"
        >
          <div className="flex items-center gap-4 text-sm">
            <BarChart2 className="w-4 h-4 text-blue-400 shrink-0" />
            <span className="text-[#2D3D54]">
              本月分析 <span className="text-[#0C1A30] font-medium">{personalStats.month_count}</span> 份
            </span>
            {personalStats.avg_score != null && (
              <span className="text-[#2D3D54]">
                平均 <span className="text-yellow-400 font-medium">{personalStats.avg_score}</span> 分
              </span>
            )}
            {personalStats.top_score != null && (
              <span className="text-[#2D3D54]">
                最高 <span className="text-emerald-400 font-medium">{personalStats.top_score}</span> 分
              </span>
            )}
            {/* 管道摘要 */}
            {(personalStats.pipeline?.dd_in_progress > 0 || personalStats.pipeline?.dd_pending > 0) && (
              <span className="text-orange-400 text-xs flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
                {(personalStats.pipeline.dd_pending || 0) + (personalStats.pipeline.dd_in_progress || 0)} 个项目尽调中
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs text-[#526078] group-hover:text-[#0C1A30] transition-colors">
            查看数据看板
            <ChevronRight className="w-4 h-4" />
          </div>
        </div>
      )}

      {!result && (
        <>
          <UploadSection />
          <PipelineTracker />
          <AgentProgress runId={null} />
        </>
      )}

      {result && (
        <div className="space-y-6">
          <VerdictCard result={result} />
          <ScoreVisualizer verdict={result.verdict} />
          <DetailedReport result={result} />
          <AgentProgress runId={result.multiagent?.run_id || null} />
          <MultiagentReport multiagent={result.multiagent} />
        </div>
      )}
    </main>
  );
}
