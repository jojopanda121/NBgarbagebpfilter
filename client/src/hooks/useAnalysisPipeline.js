import { useCallback } from "react";
import useAnalysisStore from "../store/useAnalysisStore";
import { API_BASE } from "../constants";

/**
 * useAnalysisPipeline
 *
 * 封装三步流水线的完整业务逻辑：
 *   Step 0 — 数据提取
 *   Step 1 — 联网取证
 *   Step 2 — AI 校准 & 标准化评分
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

    // 模拟三步进度（后端实际为单请求，前端用定时器驱动视觉进度）
    const stepTimer1 = setTimeout(() => setCurrentStep(1), 5000);
    const stepTimer2 = setTimeout(() => setCurrentStep(2), 15000);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const resp = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        body: formData,
      });

      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error || `服务器错误 ${resp.status}`);
      }

      const data = await resp.json();
      setCurrentStep(3); // 全部完成
      setResult(data);
    } catch (err) {
      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);
      setError(err.message || "分析失败，请重试");
    } finally {
      setAnalyzing(false);
    }
  }, [file, setAnalyzing, setCurrentStep, setResult, setError]);

  return { startAnalysis };
}
