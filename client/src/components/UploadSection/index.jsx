import React, { useRef, useCallback, memo } from "react";
import { Upload, FileText, XCircle, Lock, Loader2, Mail } from "lucide-react";
import { useNavigate } from "react-router-dom";
import useAnalysisStore from "../../store/useAnalysisStore";
import useAuthStore from "../../store/useAuthStore";
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

  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const emailBound = !!(user?.email);

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
      {/* 未绑定邮箱提示 */}
      {!emailBound && (
        <div className="mb-6 p-5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-center">
          <Mail className="w-8 h-8 text-amber-400 mx-auto mb-2" />
          <p className="text-amber-300 font-medium mb-1">请先绑定邮箱后再使用分析功能</p>
          <p className="text-sm text-slate-400 mb-3">绑定邮箱后即可开始分析商业计划书</p>
          <button
            onClick={() => navigate("/settings?tab=account")}
            className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-medium rounded-lg transition-colors text-sm"
          >
            前往绑定邮箱
          </button>
        </div>
      )}

      {/* 标题 */}
      <div className="text-center mb-6 sm:mb-8">
        <h2 className="text-xl sm:text-2xl font-bold mb-2">上传商业计划书</h2>
        <p className="text-slate-400 mb-4">
          MiniMax M2.5 将扮演行业专家 + 投资专家，深度研究 BP 中每条声明，逐条核查真实性
        </p>
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800/50 rounded-full border border-white/10/50">
          <Lock className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-sm text-slate-400">
            您的文件将安全存储，仅用于本次分析
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
              : "border-white/10 hover:border-gray-500 bg-slate-900/50"
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
            <p className="text-sm text-slate-500">
              {(file.size / 1024 / 1024).toFixed(2)} MB · 点击更换文件
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Upload className="w-12 h-12 text-slate-500" />
            <p className="text-lg text-slate-400">
              拖拽 PDF 到此处，或点击选择文件
            </p>
            <p className="text-sm text-slate-600">支持文字版和扫描版 PDF</p>
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
        disabled={!file || analyzing || !emailBound}
        className={`
          mt-6 w-full py-4 rounded-xl text-lg font-semibold transition-all
          ${
            file && !analyzing && emailBound
              ? "bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white shadow-lg shadow-red-500/20"
              : "bg-slate-800 text-slate-500 cursor-not-allowed"
          }
        `}
      >
        {analyzing ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            分析中...
          </span>
        ) : !emailBound ? (
          "请先绑定邮箱"
        ) : (
          "开始辩证分析"
        )}
      </button>

      {/* Powered by */}
      {!analyzing && (
        <div className="mt-8 text-center">
          <p className="text-xs text-slate-600">Powered by MiniMax M2.5 · DeepThink 深度研究引擎 · 提取30000字符</p>
        </div>
      )}
    </div>
  );
});

export default UploadSection;
