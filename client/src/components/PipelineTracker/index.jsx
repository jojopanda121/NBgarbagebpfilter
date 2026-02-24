import React, { memo } from "react";
import { CheckCircle2, Loader2, Clock } from "lucide-react";
import useAnalysisStore from "../../store/useAnalysisStore";
import { STEPS } from "../../constants";

/**
 * 将剩余秒数格式化为可读字符串
 * @param {number|null} seconds
 * @returns {string|null}
 */
function formatEta(seconds) {
  if (seconds === null || seconds === undefined || seconds <= 0) return null;
  if (seconds > 3600) return "> 1小时";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0) return `${mins}分${secs > 0 ? secs + "秒" : ""}`;
  return `${secs}秒`;
}

/**
 * PipelineTracker
 *
 * 职责：实时展示两步流水线进度，包含：
 *   - 步骤状态指示（待机 / 进行中 / 完成）
 *   - 可视化进度条 + 百分比
 *   - 当前阶段描述文字
 *   - 预估剩余时间（ETA）
 *
 * 性能策略：
 *   - 仅订阅进度域状态，结果域变更不会触发此组件重绘。
 *   - React.memo 防止父组件无关状态更新时的重渲染。
 */
const PipelineTracker = memo(function PipelineTracker() {
  const analyzing = useAnalysisStore((s) => s.analyzing);
  const currentStep = useAnalysisStore((s) => s.currentStep);
  const progress = useAnalysisStore((s) => s.progress);
  const eta = useAnalysisStore((s) => s.eta);
  const progressMessage = useAnalysisStore((s) => s.progressMessage);

  if (!analyzing) return null;

  const etaText = formatEta(eta);
  // 展示给用户的进度百分比：取整，最多显示 99% 直到 complete 事件到达
  const displayProgress = Math.min(Math.floor(progress), progress >= 100 ? 100 : 99);

  return (
    <div className="mt-8 space-y-4">
      {/* ── 总体进度条 ── */}
      <div className="bg-gray-900/60 border border-gray-700/50 rounded-xl p-4 space-y-3">
        {/* 顶行：阶段描述 + 百分比 */}
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-blue-300 truncate flex-1">
            {progressMessage || "分析中..."}
          </p>
          <span className="text-sm font-mono font-semibold text-blue-400 shrink-0 tabular-nums">
            {displayProgress}%
          </span>
        </div>

        {/* 进度条轨道 */}
        <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
          <div
            className="h-2 rounded-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-all duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* 底行：ETA */}
        <div className="flex items-center justify-end gap-1.5 h-4">
          {etaText && (
            <>
              <Clock className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <span className="text-xs text-gray-400 tabular-nums">
                预计剩余&nbsp;{etaText}
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── 步骤列表 ── */}
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        const active = currentStep === i;
        const done = currentStep > i;

        return (
          <div
            key={step.key}
            className={`
              flex items-center gap-4 p-4 rounded-xl transition-all duration-300
              ${active ? "bg-blue-500/10 border border-blue-500/30" : ""}
              ${done ? "bg-emerald-500/5 border border-emerald-500/20" : ""}
              ${!active && !done ? "opacity-40" : ""}
            `}
          >
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                done
                  ? "bg-emerald-500/20"
                  : active
                  ? "bg-blue-500/20"
                  : "bg-gray-800"
              }`}
            >
              {done ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              ) : active ? (
                <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
              ) : (
                <Icon className="w-5 h-5 text-gray-500" />
              )}
            </div>
            <span
              className={`font-medium text-sm ${
                done
                  ? "text-emerald-400"
                  : active
                  ? "text-blue-400"
                  : "text-gray-500"
              }`}
            >
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
});

export default PipelineTracker;
