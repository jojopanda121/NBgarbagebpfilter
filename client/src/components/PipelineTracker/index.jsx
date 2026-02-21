import React, { memo } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import useAnalysisStore from "../../store/useAnalysisStore";
import { STEPS } from "../../constants";

/**
 * PipelineTracker
 *
 * 职责：实时展示三步流水线进度。
 *
 * 性能策略：
 *   - 仅订阅 analyzing 和 currentStep，结果域变更不会触发此组件重绘。
 *   - React.memo 防止父组件无关状态更新时的重渲染。
 */
const PipelineTracker = memo(function PipelineTracker() {
  const analyzing = useAnalysisStore((s) => s.analyzing);
  const currentStep = useAnalysisStore((s) => s.currentStep);

  if (!analyzing) return null;

  return (
    <div className="mt-8 space-y-3">
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
              className={`w-10 h-10 rounded-lg flex items-center justify-center ${
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
              className={`font-medium ${
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
