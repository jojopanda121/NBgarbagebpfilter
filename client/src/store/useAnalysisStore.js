import { create } from "zustand";

/**
 * useAnalysisStore — 统一管理分析流水线的所有状态
 *
 * 分两个关注域，以便组件按需订阅，避免无关渲染：
 *   1. 进度域：analyzing / currentStep / progress / eta / progressMessage（高频更新，仅 PipelineTracker 订阅）
 *   2. 结果域：result / showResearch（低频更新，仅 DetailedReport / ScoreVisualizer 订阅）
 */
const useAnalysisStore = create((set, get) => ({
  // ── 文件上传状态 ──
  file: null,
  dragOver: false,
  // 本次分析是否使用用户自己的模型 API（BYOK）。默认走平台模型。
  useOwnModel: false,

  // ── 轮询世代号 ──
  // 「当前有效分析」的单一真相。每开启一轮（start/resume）或 reset 时 +1，
  // 进行中的轮询循环只有在自己的世代号仍是最新时才继续写 store，
  // 否则自行终止 —— 借此让任何僵尸 / 重复循环失效，避免并发写同一全局 store。
  analysisGeneration: 0,

  // ── 流水线进度状态（高频更新） ──
  analyzing: false,
  currentStep: -1, // -1=未开始  0/1=步骤中  2=全部完成
  progress: 0, // 0-100，整体百分比进度
  eta: null, // 预估剩余秒数（null=尚未计算）
  progressMessage: "", // 当前阶段描述文字

  // ── 分析结果（低频更新） ──
  result: null,

  // ── 错误 ──
  error: "",

  // ── 后台处理状态 ──
  backgroundProcessing: false,

  // ── UI 状态 ──
  showResearch: false,

  // ── Multiagent 状态（Sprint 1 新增） ──
  // agentStatuses: { [agentName]: 'pending'|'running'|'complete'|'error' }
  agentStatuses: {},
  agentSummaries: {}, // { [agentName]: string | null } 每个 agent 的一句话摘要

  // ══════════════════════════
  // Actions
  // ══════════════════════════
  setFile: (file) => set({ file }),
  setDragOver: (dragOver) => set({ dragOver }),
  setUseOwnModel: (useOwnModel) => set({ useOwnModel }),

  setAnalyzing: (analyzing) => set({ analyzing }),
  setCurrentStep: (currentStep) => set({ currentStep }),
  setProgress: (progress) => set({ progress }),
  setEta: (eta) => set({ eta }),
  setProgressMessage: (progressMessage) => set({ progressMessage }),

  setResult: (result) => set({ result }),
  setError: (error) => set({ error }),

  setBackgroundProcessing: (backgroundProcessing) => set({ backgroundProcessing }),
  setShowResearch: (showResearch) => set({ showResearch }),

  setAgentStatuses: (agentStatuses) => set({ agentStatuses }),
  setAgentSummaries: (agentSummaries) => set({ agentSummaries }),

  /**
   * 开启新一轮分析：递增世代号并返回新值。
   * 任何持有旧世代号的轮询循环都会因此失效并自行终止。
   */
  beginRun: () => {
    const gen = get().analysisGeneration + 1;
    set({ analysisGeneration: gen });
    return gen;
  },

  /** 完整重置，准备下一次分析（同时作废任何进行中的轮询循环） */
  reset: () =>
    set((s) => ({
      file: null,
      dragOver: false,
      analyzing: false,
      currentStep: -1,
      progress: 0,
      eta: null,
      progressMessage: "",
      result: null,
      error: "",
      backgroundProcessing: false,
      showResearch: false,
      agentStatuses: {},
      agentSummaries: {},
      analysisGeneration: s.analysisGeneration + 1,
    })),
}));

export default useAnalysisStore;
