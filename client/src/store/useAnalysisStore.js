import { create } from "zustand";

/**
 * useAnalysisStore — 统一管理分析流水线的所有状态
 *
 * 分两个关注域，以便组件按需订阅，避免无关渲染：
 *   1. 进度域：analyzing / currentStep / progress / eta / progressMessage（高频更新，仅 PipelineTracker 订阅）
 *   2. 结果域：result / showResearch（低频更新，仅 DetailedReport / ScoreVisualizer 订阅）
 */
const useAnalysisStore = create((set) => ({
  // ── 文件上传状态 ──
  file: null,
  dragOver: false,

  // ── 流水线进度状态（高频更新） ──
  analyzing: false,
  currentStep: -1,   // -1=未开始  0/1=步骤中  2=全部完成
  progress: 0,        // 0-100，整体百分比进度
  eta: null,          // 预估剩余秒数（null=尚未计算）
  progressMessage: "", // 当前阶段描述文字

  // ── 分析结果（低频更新） ──
  result: null,

  // ── 错误 ──
  error: "",

  // ── UI 状态 ──
  showResearch: false,

  // ══════════════════════════
  // Actions
  // ══════════════════════════
  setFile: (file) => set({ file }),
  setDragOver: (dragOver) => set({ dragOver }),

  setAnalyzing: (analyzing) => set({ analyzing }),
  setCurrentStep: (currentStep) => set({ currentStep }),
  setProgress: (progress) => set({ progress }),
  setEta: (eta) => set({ eta }),
  setProgressMessage: (progressMessage) => set({ progressMessage }),

  setResult: (result) => set({ result }),
  setError: (error) => set({ error }),

  setShowResearch: (showResearch) => set({ showResearch }),

  /** 完整重置，准备下一次分析 */
  reset: () =>
    set({
      file: null,
      dragOver: false,
      analyzing: false,
      currentStep: -1,
      progress: 0,
      eta: null,
      progressMessage: "",
      result: null,
      error: "",
      showResearch: false,
    }),
}));

export default useAnalysisStore;
