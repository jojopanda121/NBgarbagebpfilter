import React, { memo } from "react";
import { CheckCircle2, Loader2, Clock, AlertCircle } from "lucide-react";
import useAnalysisStore from "../../store/useAnalysisStore";
import { useAgentRunStream } from "../../hooks/useAgentRunStream";
import { AGENT_DEFS } from "../../constants";

const COLOR_MAP = {
  blue:    { ring: "border-blue-500/40",    bg: "bg-blue-500/10",    icon: "text-blue-400",    text: "text-blue-300" },
  purple:  { ring: "border-purple-500/40",  bg: "bg-purple-500/10",  icon: "text-purple-400",  text: "text-purple-300" },
  emerald: { ring: "border-emerald-500/40", bg: "bg-emerald-500/10", icon: "text-emerald-400", text: "text-emerald-300" },
  orange:  { ring: "border-orange-500/40",  bg: "bg-orange-500/10",  icon: "text-orange-400",  text: "text-orange-300" },
  red:     { ring: "border-red-500/40",     bg: "bg-red-500/10",     icon: "text-red-400",     text: "text-red-300" },
  yellow:  { ring: "border-yellow-500/40",  bg: "bg-yellow-500/10",  icon: "text-yellow-400",  text: "text-yellow-300" },
};

// Map SSE status strings to display status strings used by the store
function sseStatusToDisplay(s) {
  if (s === "done") return "complete";
  if (s === "failed") return "error";
  return s; // "running" | "pending"
}

function StatusIcon({ status, color }) {
  if (status === "complete") return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
  if (status === "running")  return <Loader2 className={`w-4 h-4 ${COLOR_MAP[color]?.icon || "text-blue-400"} animate-spin shrink-0`} />;
  if (status === "error")    return <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />;
  return <Clock className="w-4 h-4 text-slate-500 shrink-0" />;
}

function statusLabel(status) {
  switch (status) {
    case "complete": return "完成";
    case "running":  return "分析中...";
    case "error":    return "失败";
    default:         return "等待中";
  }
}

/**
 * AgentProgress — 展示 6 个 AI Agent 实时进度卡片
 *
 * Props:
 *   runId?: string — when provided, subscribes to SSE for live updates
 *                    (used in post-result view); falls back to store polling
 */
const AgentProgress = memo(function AgentProgress({ runId }) {
  // SSE mode — active when runId is provided (e.g., after task completes)
  const { agents: sseAgents, connected } = useAgentRunStream(runId || null);

  // Store polling mode — active during in-progress analysis
  const agentStatuses  = useAnalysisStore((s) => s.agentStatuses);
  const agentSummaries = useAnalysisStore((s) => s.agentSummaries);

  // Decide which data source to use
  const useSSE = !!runId && connected;

  // Build unified status map
  const statusMap = {};
  const summaryMap = {};
  for (const { key } of AGENT_DEFS) {
    if (useSSE) {
      const a = sseAgents[key];
      statusMap[key] = a ? sseStatusToDisplay(a.status) : "pending";
      summaryMap[key] = null; // SSE userOutput available in MultiagentReport
    } else {
      statusMap[key] = agentStatuses[key] || "pending";
      summaryMap[key] = agentSummaries[key] || null;
    }
  }

  const hasAnyStatus = useSSE
    ? Object.values(sseAgents).some((a) => a.status !== "pending")
    : Object.keys(agentStatuses).length > 0;

  if (!hasAnyStatus) return null;

  const completedCount = Object.values(statusMap).filter((s) => s === "complete").length;
  const totalCount = AGENT_DEFS.length;
  const allDone = completedCount === totalCount;

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300 tracking-wide uppercase">
          AI 深度尽调 · 6 个 Agent
        </h3>
        <span className={`text-xs font-mono tabular-nums ${allDone ? "text-emerald-400" : "text-blue-400"}`}>
          {completedCount} / {totalCount}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {AGENT_DEFS.map(({ key, label, icon: Icon, color }) => {
          const status  = statusMap[key];
          const summary = summaryMap[key];
          const c       = COLOR_MAP[color] || COLOR_MAP.blue;
          const isDone  = status === "complete";
          const isRun   = status === "running";

          return (
            <div
              key={key}
              className={`
                flex flex-col gap-1.5 p-3 rounded-xl border transition-all duration-300
                ${isDone ? "bg-emerald-500/5 border-emerald-500/20" : ""}
                ${isRun  ? `${c.bg} ${c.ring}` : ""}
                ${!isDone && !isRun ? "bg-slate-900/40 border-white/5 opacity-50" : ""}
              `}
            >
              <div className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${isDone ? "bg-emerald-500/20" : isRun ? c.bg : "bg-slate-800"}`}>
                  <Icon className={`w-3.5 h-3.5 ${isDone ? "text-emerald-400" : c.icon}`} />
                </div>
                <span className={`text-xs font-medium flex-1 truncate ${isDone ? "text-emerald-300" : isRun ? c.text : "text-slate-500"}`}>
                  {label}
                </span>
                <StatusIcon status={status} color={color} />
              </div>

              <p className="text-xs leading-snug text-slate-400 truncate pl-0.5" title={summary || statusLabel(status)}>
                {summary || statusLabel(status)}
              </p>
            </div>
          );
        })}
      </div>

      {allDone && (
        <p className="text-xs text-center text-emerald-400/80 mt-1">
          ✓ 6 个 AI Agent 全部完成，报告已就绪
        </p>
      )}
    </div>
  );
});

export default AgentProgress;
