import { useCallback } from "react";
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
 *   - 通过定时器模拟步骤切换（与后端单请求架构匹配）
 *   - 全程将进度写入 Zustand store，与 UI 完全解耦
 *   - 错误统一通过 setError 上报，不向调用方抛出
 */
export function useAnalysisPipeline() {
  const {
    file,
    setAnalyzing,
    setCurrentStep,
    setResult,
    setError,
  } = useAnalysisStore();

  const startAnalysis = useCallback(async () => {
    if (!file) return;

    setAnalyzing(true);
    setError("");
    setResult(null);
    setCurrentStep(0);

    // 模拟两步进度（后端实际为单请求，前端用定时器驱动视觉进度）
    // Step 0: 数据提取（约8s）→ Step 1: AI深度研究（主要耗时）
    const stepTimer1 = setTimeout(() => setCurrentStep(1), 8000);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const resp = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        body: formData,
      });

      clearTimeout(stepTimer1);

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error || `服务器错误 ${resp.status}`);
      }

      const data = await resp.json();
      setCurrentStep(2); // 全部完成
      setResult(data);
    } catch (err) {
      clearTimeout(stepTimer1);
      setError(err.message || "分析失败，请重试");
    } finally {
      setAnalyzing(false);
    }
  }, [file, setAnalyzing, setCurrentStep, setResult, setError]);

  return { startAnalysis };
}
