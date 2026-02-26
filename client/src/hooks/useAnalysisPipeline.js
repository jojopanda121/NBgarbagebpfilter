import { useCallback, useEffect, useRef } from "react";
import useAnalysisStore from "../store/useAnalysisStore";
import useAuthStore from "../store/useAuthStore";
import api, { ApiError } from "../services/api";

/**
 * useAnalysisPipeline (v3.0)
 *
 * 使用统一 API 服务层，自动携带 JWT token，
 * 全局拦截 4031（绑定联系方式）和 4032（额度不足）状态码。
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
const MAX_CONSECUTIVE_ERRORS = 8;

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
      setProgressMessage("任务已提交，分析进行中...");

      // Step 2: 轮询任务状态
      let consecutiveErrors = 0;

      while (analyzingRef.current) {
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

          // 刷新额度
          try {
            const quotaData = await api.get("/api/quota");
            useAuthStore.getState().setQuota(quotaData);
          } catch {}

          break;
        } else if (taskData.status === "error") {
          throw new Error(taskData.error || "分析失败，请重试");
        }
      }
    } catch (err) {
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
  }, [file, setAnalyzing, setCurrentStep, setProgress, setEta, setProgressMessage, setResult, setError]);

  return { startAnalysis };
}
