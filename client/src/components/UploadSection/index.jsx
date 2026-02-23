import React, { useRef, useCallback, memo } from "react";
import { Upload, FileText, XCircle, Lock, Loader2 } from "lucide-react";
import useAnalysisStore from "../../store/useAnalysisStore";
import { useAnalysisPipeline } from "../../hooks/useAnalysisPipeline";

/**
 * UploadSection
 *
 * 职责：
 *   - 拖拽 / 点击上传 PDF 文件
 *   - 文件类型校验（仅接受 application/pdf）
 *   - 触发分析并显示加载态按钮
 *   - 错误提示
 *
 * 仅订阅 file / dragOver / analyzing / error，与结果状态完全隔离。
 */
const UploadSection = memo(function UploadSection() {
  const file = useAnalysisStore((s) => s.file);
  const dragOver = useAnalysisStore((s) => s.dragOver);
  const analyzing = useAnalysisStore((s) => s.analyzing);
  const error = useAnalysisStore((s) => s.error);
  const setFile = useAnalysisStore((s) => s.setFile);
  const setDragOver = useAnalysisStore((s) => s.setDragOver);
  const setError = useAnalysisStore((s) => s.setError);

  const { startAnalysis } = useAnalysisPipeline();
  const fileInputRef = useRef(null);

  // ── 文件校验 ──
  const handleFile = useCallback(
    (f) => {
      if (f && f.type === "application/pdf") {
        setFile(f);
        setError("");
      } else if (f) {
        setError("请上传 PDF 文件");
      }
    },
    [setFile, setError]
  );

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      handleFile(e.dataTransfer.files[0]);
    },
    [setDragOver, handleFile]
  );

  const onDragOver = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(true);
    },
    [setDragOver]
  );

  const onDragLeave = useCallback(() => setDragOver(false), [setDragOver]);

  return (
    <div className="max-w-2xl mx-auto">
      {/* 标题 */}
      <div className="text-center mb-6 sm:mb-8">
        <h2 className="text-xl sm:text-2xl font-bold mb-2">上传商业计划书</h2>
        <p className="text-gray-400 mb-4">
          MiniMax M2.5 将扮演行业专家 + 投资专家，深度研究 BP 中每条声明，逐条核查真实性
        </p>
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-gray-800/50 rounded-full border border-gray-700/50">
          <Lock className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-sm text-gray-400">
            本程序不储存您的 BP，请放心上传
          </span>
        </div>
      </div>

      {/* 拖拽上传区 */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={`
          border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center cursor-pointer
          transition-all duration-200
          ${
            dragOver
              ? "border-blue-500 bg-blue-500/5"
              : file
              ? "border-emerald-500/50 bg-emerald-500/5"
              : "border-gray-700 hover:border-gray-500 bg-gray-900/50"
          }
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={(e) => handleFile(e.target.files[0])}
        />
        {file ? (
          <div className="flex flex-col items-center gap-3">
            <FileText className="w-12 h-12 text-emerald-400" />
            <p className="text-lg font-medium text-emerald-400">{file.name}</p>
            <p className="text-sm text-gray-500">
              {(file.size / 1024 / 1024).toFixed(2)} MB · 点击更换文件
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Upload className="w-12 h-12 text-gray-500" />
            <p className="text-lg text-gray-400">
              拖拽 PDF 到此处，或点击选择文件
            </p>
            <p className="text-sm text-gray-600">支持文字版和扫描版 PDF</p>
          </div>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3">
          <XCircle className="w-5 h-5 text-red-400 shrink-0" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* 分析按钮 */}
      <button
        onClick={startAnalysis}
        disabled={!file || analyzing}
        className={`
          mt-6 w-full py-4 rounded-xl text-lg font-semibold transition-all
          ${
            file && !analyzing
              ? "bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white shadow-lg shadow-red-500/20"
              : "bg-gray-800 text-gray-500 cursor-not-allowed"
          }
        `}
      >
        {analyzing ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            分析中...
          </span>
        ) : (
          "开始辩证分析"
        )}
      </button>

      {/* Powered by */}
      {!analyzing && (
        <div className="mt-8 text-center">
          <p className="text-xs text-gray-600">Powered by MiniMax M2.5 · DeepThink 深度研究引擎 · 提取30000字符</p>
        </div>
      )}
    </div>
  );
});

export default UploadSection;
