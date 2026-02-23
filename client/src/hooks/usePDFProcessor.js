import { useCallback, useState } from "react";
import { API_BASE } from "../constants";

/**
 * usePDFProcessor
 *
 * 处理与后端 /api/pdf-to-text 的交互：
 *   - 将 PDF 文件发送到服务端解析接口
 *   - 返回纯文本内容，供其他 hook / 组件使用
 *   - 独立维护 processing / pdfText / pdfError 状态，不污染全局 store
 *
 * 使用示例：
 *   const { convertToText, processing, pdfText, pdfError } = usePDFProcessor();
 *   const text = await convertToText(file);
 */
export function usePDFProcessor() {
  const [processing, setProcessing] = useState(false);
  const [pdfText, setPdfText] = useState(null);
  const [pdfError, setPdfError] = useState("");

  const convertToText = useCallback(async (file) => {
    if (!file) return null;

    setProcessing(true);
    setPdfError("");
    setPdfText(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const resp = await fetch(`${API_BASE}/api/pdf-to-text`, {
        method: "POST",
        body: formData,
      });

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error || `PDF 转换失败 ${resp.status}`);
      }

      const data = await resp.json();
      const text = data.text || "";
      setPdfText(text);
      return text;
    } catch (err) {
      setPdfError(err.message || "PDF 转换失败");
      return null;
    } finally {
      setProcessing(false);
    }
  }, []);

  return { convertToText, processing, pdfText, pdfError };
}
