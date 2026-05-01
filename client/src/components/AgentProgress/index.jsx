import React, { memo } from "react";
import { CheckCircle2, Loader2, Clock, AlertCircle } from "lucide-react";
import useAnalysisStore from "../../store/useAnalysisStore";
import { AGENT_DEFS } from "../../constants";

const COLOR_MAP = {
  blue:    { ring: "border-blue-500/40",    bg: "bg-blue-500/10",    icon: "text-blue-400",    text: "text-blue-300" },
  purple:  { ring: "border-purple-500/40",  bg: "bg-purple-500/10",  icon: "text-purple-400",  text: "text-purple-300" },
  emerald: { ring: "border-emerald-500/40", bg: "bg-emerald-500/10", icon: "text-emerald-400", text: "text-emerald-300" },
  orange:  { ring: "border-orange-500/40",  bg: "bg-orange-500/10",  icon: "text-orange-400",  text: "text-orange-300" },
  red:     { ring: "border-red-500/40",     bg: "bg-red-500/10",     icon: "text-red-400",     text: "text-red-300" },
  yellow:  { ring: "border-yellow-500/40",  bg: "bg-yellow-500/10",  icon: "text-yellow-400",  text: "text-yellow-300" },
};

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
 * 仅在 multiagent 状态有任何数据时（运行中或完成后）显示
 */
const AgentProgress = memo(function AgentProgress() {
  const agentStatuses  = useAnalysisStore((s) => s.agentStatuses);
  const agentSummaries = useAnalysisStore((s) => s.agentSummaries);

  const hasAnyStatus = Object.keys(agentStatuses).length > 0;
  if (!hasAnyStatus) return null;

  const completedCount = Object.values(agentStatuses).filter((s) => s === "complete").length;
  const totalCount = AGENT_DEFS.length;
  const allDone = completedCount === totalCount;

  return (
    <div className="mt-6 space-y-3">
      {/* 区块标题 */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300 tracking-wide uppercase">
          AI 深度尽调 · 6 个 Agent
        </h3>
        <span className={`text-xs font-mono tabular-nums ${allDone ? "text-emerald-400" : "text-blue-400"}`}>
          {completedCount} / {totalCount}
        </span>
      </div>

      {/* 6 个 Agent 卡片 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {AGENT_DEFS.map(({ key, label, icon: Icon, color }) => {
          const status  = agentStatuses[key]  || "pending";
          const summary = agentSummaries[key] || null;
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
              {/* 顶行：图标 + 名称 + 状态指示 */}
              <div className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${isDone ? "bg-emerald-500/20" : isRun ? c.bg : "bg-slate-800"}`}>
                  <Icon className={`w-3.5 h-3.5 ${isDone ? "text-emerald-400" : c.icon}`} />
                </div>
                <span className={`text-xs font-medium flex-1 truncate ${isDone ? "text-emerald-300" : isRun ? c.text : "text-slate-500"}`}>
                  {label}
                </span>
                <StatusIcon status={status} color={color} />
              </div>

              {/* 状态文字 / 摘要 */}
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
