import { useCallback, useEffect, useRef } from "react";
import useAnalysisStore from "../store/useAnalysisStore";
import { API_BASE } from "../constants";

/**
 * useAnalysisPipeline
 *
 * 封装两步流水线的完整业务逻辑：
 *   Step 0 — 数据提取（提取BP关键声明与评分数据）
 *   Step 1 — AI深度研究（MiniMax知识库专家分析 & 评分）
 *
 * 实现：
 *   - 向 /api/analyze 发送 multipart/form-data 请求
 *   - 解析 SSE（Server-Sent Events）流，获取后端真实进度事件
 *   - 在 AI 深度研究阶段使用慢速爬行动画，保持进度条持续移动
 *   - 基于已用时间和当前进度实时计算 ETA（预估剩余时间）
 *   - 全程将进度写入 Zustand store，与 UI 完全解耦
 *   - 错误统一通过 setError 上报，不向调用方抛出
 *
 * SSE 阶段 → currentStep 映射：
 *   pdf_done / data_extract / data_extract_retry / data_done → step 0
 *   ai_research / ai_research_retry / ai_done / scoring / report / finalizing → step 1
 *   complete → step 2（全部完成）
 */

/** SSE stage 映射到 pipeline step */
const STAGE_TO_STEP = {
  pdf_done: 0,
  data_extract: 0,
  data_extract_retry: 0,
  data_done: 0,
  ai_research: 1,
  ai_research_retry: 1,
  ai_done: 1,
  scoring: 1,
  report: 1,
  finalizing: 1,
};

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

      // ETA 计算：基于已用时间和当前百分比推算剩余时间
      if (progress > 2 && progress < 99 && startTimeRef.current) {
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        const totalEstimate = elapsed / (progress / 100);
        const remaining = Math.max(0, totalEstimate - elapsed);
        state.setEta(Math.round(remaining));
      }

      // 慢速爬行：在等待后端响应期间保持进度条缓慢移动，避免卡死感
      // step 0（数据提取）：在 12%-25% 范围内缓慢爬行（0.2%/s）
      if (currentStep === 0 && progress >= 12 && progress < 25) {
        state.setProgress(Math.min(progress + 0.2, 25));
      }
      // step 1（AI 研究）：在 32%-79% 范围内缓慢爬行（0.15%/s ≈ 5分钟从32到79）
      else if (currentStep === 1 && progress >= 32 && progress < 79) {
        state.setProgress(Math.min(progress + 0.15, 79));
      }
      // step 1 报告生成阶段：在 90%-97% 范围内缓慢爬行（0.05%/s）
      else if (currentStep === 1 && progress >= 90 && progress < 97) {
        state.setProgress(Math.min(progress + 0.05, 97));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []); // 仅挂载时创建一次，通过 ref 访问最新状态

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
    setProgressMessage("正在上传文件并提取PDF文本...");

    // 15 分钟超时（AI 深度分析流水线单次耗时可达 6-10 分钟）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15 * 60 * 1000);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const resp = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      // 验证错误（PDF 格式错误等）以普通 JSON 返回，此时不会有 SSE 流
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error || `服务器错误 ${resp.status}`);
      }

      // ── 解析 SSE 流 ──
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE 帧以 "\n\n" 分隔
        const frames = buffer.split("\n\n");
        buffer = frames.pop(); // 保留未完整的帧

        for (const frame of frames) {
          // 每帧可能包含多行，取 "data: ..." 行
          const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;

          let event;
          try {
            event = JSON.parse(dataLine.slice(6));
          } catch {
            continue;
          }

          if (event.type === "progress") {
            // 后端发来真实进度，直接使用（只单调递增，不允许倒退）
            const current = useAnalysisStore.getState().progress;
            if (event.percentage > current) {
              setProgress(event.percentage);
            }
            if (event.message) setProgressMessage(event.message);

            // 更新 step
            const step = STAGE_TO_STEP[event.stage];
            if (step !== undefined) {
              setCurrentStep(step);
            }
          } else if (event.type === "complete") {
            clearTimeout(timeoutId);
            setProgress(100);
            setProgressMessage("分析完成！");
            setCurrentStep(2);
            setResult(event.data);
          } else if (event.type === "error") {
            throw new Error(event.error || "分析失败，请重试");
          }
        }
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        setError("分析超时（超过15分钟），请上传更小的文件后重试");
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
