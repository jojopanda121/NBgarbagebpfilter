import { useCallback, useEffect, useRef } from "react";
import useAnalysisStore from "../store/useAnalysisStore";
import useAuthStore from "../store/useAuthStore";
import api, { ApiError } from "../services/api";

/**
 * useAnalysisPipeline (v3.2)
 *
 * - 支持后台分析：提交后将 taskId 存入 localStorage，用户离开页面后可在历史记录查看结果
 * - 支持恢复轮询：DashboardPage 挂载时检测到 localStorage 中的 pending taskId，可恢复
 * - pending task 绑定 userId，防止多账号串号
 */

const STAGE_TO_STEP = {
  pdf_done: 0, data_extract: 0, data_extract_retry: 0, data_done: 0,
  agent_b_start: 1, claim_verify: 1, claims_verified: 1,
  scoring_retry: 1, scoring_retry2: 1,
  ai_research: 1, ai_research_retry: 1, ai_done: 1,
  scoring: 1, report: 1, finalizing: 1,
  complete: 2,
};

const POLL_INTERVAL_MS = 2500;
const MAX_POLL_COUNT = 120;           // 最多轮询 120 次（约 5 分钟）
const MAX_CONSECUTIVE_ERRORS = 8;
const PENDING_TASK_KEY = "bp_pending_task";

/** 读取当前用户的 pending task（绑定 userId 防串号） */
function getPendingTask() {
  try {
    const raw = localStorage.getItem(PENDING_TASK_KEY);
    if (!raw) return null;
    // 兼容旧格式（纯 taskId 字符串）
    if (!raw.startsWith("{")) {
      // 旧格式无法验证归属，清除
      localStorage.removeItem(PENDING_TASK_KEY);
      return null;
    }
    const data = JSON.parse(raw);
    const currentUser = useAuthStore.getState().user;
    if (!currentUser || data.userId !== currentUser.id) return null;
    return data.taskId;
  } catch {
    return null;
  }
}

/** 保存 pending task（绑定当前 userId） */
function savePendingTask(taskId) {
  const currentUser = useAuthStore.getState().user;
  const data = { taskId, userId: currentUser?.id || null };
  localStorage.setItem(PENDING_TASK_KEY, JSON.stringify(data));
}

export function useAnalysisPipeline() {
  const {
    file,
    setAnalyzing,
    setCurrentStep,
    setProgress,
    setEta,
    setProgressMessage,
    setResult,
    setError,
  } = useAnalysisStore();

  const startTimeRef = useRef(null);
  const analyzingRef = useRef(false);

  // 慢速爬行 + ETA
  useEffect(() => {
    const interval = setInterval(() => {
      if (!analyzingRef.current) return;

      const state = useAnalysisStore.getState();
      const { progress, currentStep } = state;

      if (progress > 2 && progress < 99 && startTimeRef.current) {
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        const totalEstimate = elapsed / (progress / 100);
        const remaining = Math.max(0, totalEstimate - elapsed);
        state.setEta(Math.round(remaining));
      }

      if (currentStep === 0 && progress >= 12 && progress < 25) {
        state.setProgress(Math.min(progress + 0.2, 25));
      } else if (currentStep === 1 && progress >= 32 && progress < 79) {
        state.setProgress(Math.min(progress + 0.15, 79));
      } else if (currentStep === 1 && progress >= 90 && progress < 97) {
        state.setProgress(Math.min(progress + 0.05, 97));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  /** 核心轮询逻辑，传入 taskId 开始轮询 */
  const pollUntilDone = useCallback(async (taskId) => {
    let consecutiveErrors = 0;
    let pollCount = 0;

    while (analyzingRef.current) {
      pollCount++;
      if (pollCount > MAX_POLL_COUNT) {
        localStorage.removeItem(PENDING_TASK_KEY);
        throw new Error("分析超时，请稍后在历史记录中查看结果");
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (!analyzingRef.current) break;

      let taskData;
      try {
        taskData = await api.pollTask(taskId);
        consecutiveErrors = 0;
      } catch (_pollErr) {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          throw new Error(`连续 ${MAX_CONSECUTIVE_ERRORS} 次轮询失败，请检查网络`);
        }
        continue;
      }

      const currentProgress = useAnalysisStore.getState().progress;
      if (taskData.percentage > currentProgress) {
        setProgress(taskData.percentage);
      }
      if (taskData.message) setProgressMessage(taskData.message);

      const step = STAGE_TO_STEP[taskData.stage];
      if (step !== undefined) setCurrentStep(step);

      if (taskData.status === "complete") {
        setProgress(100);
        setProgressMessage("分析完成！");
        setCurrentStep(2);
        setResult(taskData.result);
        localStorage.removeItem(PENDING_TASK_KEY);  // 完成后清除

        // 刷新额度
        try {
          const quotaData = await api.get("/api/quota");
          useAuthStore.getState().setQuota(quotaData);
        } catch {}

        break;
      } else if (taskData.status === "error") {
        localStorage.removeItem(PENDING_TASK_KEY);
        throw new Error(taskData.error || "分析失败，请重试");
      }
    }
  }, [setCurrentStep, setProgress, setProgressMessage, setResult]);

  /** 从头开始分析（上传文件） */
  const startAnalysis = useCallback(async () => {
    if (!file) return;

    startTimeRef.current = Date.now();
    analyzingRef.current = true;

    setAnalyzing(true);
    setError("");
    setResult(null);
    setCurrentStep(0);
    setProgress(0);
    setEta(null);
    setProgressMessage("正在上传文件...");

    try {
      // Step 1: 提交任务
      let taskId;
      try {
        const body = await api.uploadFile(file);
        taskId = body.taskId;
      } catch (err) {
        if (err instanceof ApiError && (err.status === 4031 || err.status === 4032)) {
          return; // 业务拦截，弹层已通过 store 触发
        }
        throw err;
      }

      if (!taskId) throw new Error("未获取到任务ID，请重试");

      // 保存到 localStorage（绑定 userId），支持离开页面后后台继续
      savePendingTask(taskId);
      setProgressMessage("任务已提交，分析在后台进行中...");

      // Step 2: 轮询
      await pollUntilDone(taskId);
    } catch (err) {
      localStorage.removeItem(PENDING_TASK_KEY);
      if (err.name === "AbortError") {
        setError("文件上传超时，请检查网络");
      } else if (err.message === "Failed to fetch") {
        setError("网络连接失败，请稍后重试");
      } else {
        setError(err.message || "分析失败，请重试");
      }
    } finally {
      analyzingRef.current = false;
      setAnalyzing(false);
    }
  }, [file, setAnalyzing, setCurrentStep, setProgress, setEta, setProgressMessage, setResult, setError, pollUntilDone]);

  /** 恢复对已提交任务的轮询（用户返回页面时调用） */
  const resumeAnalysis = useCallback(async (taskId) => {
    if (!taskId || analyzingRef.current) return;

    startTimeRef.current = Date.now();
    analyzingRef.current = true;

    setAnalyzing(true);
    setError("");
    setResult(null);
    setCurrentStep(1);
    setProgress(10);
    setEta(null);
    setProgressMessage("正在恢复分析进度...");

    try {
      await pollUntilDone(taskId);
    } catch (err) {
      localStorage.removeItem(PENDING_TASK_KEY);
      setError(err.message || "恢复分析失败，请在历史记录中查看");
    } finally {
      analyzingRef.current = false;
      setAnalyzing(false);
    }
  }, [setAnalyzing, setCurrentStep, setProgress, setEta, setProgressMessage, setResult, setError, pollUntilDone]);

  return { startAnalysis, resumeAnalysis, getPendingTask };
}
