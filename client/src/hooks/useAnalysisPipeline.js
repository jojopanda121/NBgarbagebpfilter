import { useCallback, useEffect, useRef } from "react";
import useAnalysisStore from "../store/useAnalysisStore";
import { API_BASE } from "../constants";

/**
 * useAnalysisPipeline
 *
 * 重构说明：
 *   原实现依赖长连接 SSE（约 7 分钟），被网关/浏览器强制中断。
 *   新实现采用「提交 + 轮询」模式：
 *     1. POST /api/analyze  → 立即返回 { taskId }（<1 秒）
 *     2. GET  /api/task/:id → 每 2.5 秒轮询一次进度（毫秒级完成）
 *   每次轮询均为短生命周期请求，不存在超时问题。
 *   网络抖动时最多容忍连续 8 次失败后才报错，单次失败直接重试下一轮。
 *
 * SSE stage → currentStep 映射（与后端 onProgress 保持一致）：
 *   pdf_done / data_extract / data_extract_retry / data_done → step 0
 *   agent_b_start / claim_verify / claims_verified / scoring_retry /
 *   ai_done / scoring / report / finalizing                 → step 1
 *   complete                                                 → step 2
 */

const STAGE_TO_STEP = {
  pdf_done: 0,
  data_extract: 0,
  data_extract_retry: 0,
  data_done: 0,
  agent_b_start: 1,
  claim_verify: 1,
  claims_verified: 1,
  scoring_retry: 1,
  ai_research: 1,
  ai_research_retry: 1,
  ai_done: 1,
  scoring: 1,
  report: 1,
  finalizing: 1,
  complete: 2,
};

const POLL_INTERVAL_MS = 2500;    // 轮询间隔
const MAX_CONSECUTIVE_ERRORS = 8; // 容忍最大连续失败次数

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

  // ── 慢速爬行 + ETA 实时更新（每秒执行一次）──
  useEffect(() => {
    const interval = setInterval(() => {
      if (!analyzingRef.current) return;

      const state = useAnalysisStore.getState();
      const { progress, currentStep } = state;

      // ETA 计算
      if (progress > 2 && progress < 99 && startTimeRef.current) {
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        const totalEstimate = elapsed / (progress / 100);
        const remaining = Math.max(0, totalEstimate - elapsed);
        state.setEta(Math.round(remaining));
      }

      // 慢速爬行：等待后端进度推送期间保持进度条缓慢移动
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
      // ── 第一步：提交任务，获取 taskId（超时 2 分钟，覆盖大文件上传）──
      const formData = new FormData();
      formData.append("file", file);

      const submitController = new AbortController();
      const submitTimeout = setTimeout(() => submitController.abort(), 120_000);

      let taskId;
      try {
        const resp = await fetch(`${API_BASE}/api/analyze`, {
          method: "POST",
          body: formData,
          signal: submitController.signal,
        });
        clearTimeout(submitTimeout);

        if (!resp.ok) {
          const errBody = await resp.json().catch(() => ({}));
          throw new Error(errBody.error || `服务器错误 ${resp.status}`);
        }

        const body = await resp.json();
        taskId = body.taskId;
      } catch (submitErr) {
        clearTimeout(submitTimeout);
        throw submitErr;
      }

      if (!taskId) throw new Error("未获取到任务ID，请重试");

      setProgressMessage("任务已提交，分析进行中...");

      // ── 第二步：轮询任务状态，直到 complete 或 error ──
      let consecutiveErrors = 0;

      while (analyzingRef.current) {
        // 等待轮询间隔
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (!analyzingRef.current) break;

        // 发起轮询（15 秒超时）
        let taskData;
        try {
          const pollController = new AbortController();
          const pollTimeout = setTimeout(() => pollController.abort(), 15_000);
          const pollResp = await fetch(`${API_BASE}/api/task/${taskId}`, {
            signal: pollController.signal,
          });
          clearTimeout(pollTimeout);

          if (!pollResp.ok) throw new Error(`轮询错误 ${pollResp.status}`);
          taskData = await pollResp.json();
          consecutiveErrors = 0;
        } catch (_pollErr) {
          consecutiveErrors++;
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            throw new Error(
              `连续 ${MAX_CONSECUTIVE_ERRORS} 次轮询失败，请检查网络连接后重试`
            );
          }
          // 单次失败：静默跳过，等待下次轮询
          continue;
        }

        // 更新进度（单调递增，不允许倒退）
        const currentProgress = useAnalysisStore.getState().progress;
        if (taskData.percentage > currentProgress) {
          setProgress(taskData.percentage);
        }
        if (taskData.message) setProgressMessage(taskData.message);

        const step = STAGE_TO_STEP[taskData.stage];
        if (step !== undefined) setCurrentStep(step);

        // 检查终止状态
        if (taskData.status === "complete") {
          setProgress(100);
          setProgressMessage("分析完成！");
          setCurrentStep(2);
          setResult(taskData.result);
          break;
        } else if (taskData.status === "error") {
          throw new Error(taskData.error || "分析失败，请重试");
        }
        // status === "running" → 继续轮询
      }
    } catch (err) {
      if (err.name === "AbortError") {
        setError("文件上传超时，请检查网络后重试");
      } else if (err.message === "Failed to fetch") {
        setError("网络连接失败，服务器可能正在重启，请稍后重试");
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
