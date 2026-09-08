import React, { useRef, useCallback, memo, useEffect, useState } from "react";
import { Upload, FileText, XCircle, Lock, Loader2, Mail, Cpu, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import useAnalysisStore from "../../store/useAnalysisStore";
import useAuthStore from "../../store/useAuthStore";
import { useAnalysisPipeline } from "../../hooks/useAnalysisPipeline";
import api from "../../services/api";

/**
 * UploadSection
 *
 * 职责：
 *   - 拖拽 / 点击上传 PDF / Word(.doc/.docx) / PPT(.pptx) 文件
 *   - 文件类型校验（PDF / doc/docx / pptx）
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
  const useOwnModel = useAnalysisStore((s) => s.useOwnModel);
  const setUseOwnModel = useAnalysisStore((s) => s.setUseOwnModel);

  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const username = (user?.username || "").trim().toLowerCase();
  const isTestAccount = username === "admin" || username === "test";
  const canAnalyze = !!user?.email || isTestAccount;

  const { startAnalysis } = useAnalysisPipeline();
  const fileInputRef = useRef(null);

  // ── 自带模型（BYOK）──
  // 只有"功能开着 + 用户已保存并通过校验"时才出现引擎选择；
  // 其余情况完全不打扰，分析照旧走平台模型。
  const [byok, setByok] = useState(null);
  // 平台模型是否可用。默认按"可用"起步：接口没回来之前不该先吓唬用户。
  const [platformModel, setPlatformModel] = useState(true);
  useEffect(() => {
    let alive = true;
    if (!user) return undefined;
    (async () => {
      try {
        const resp = await api.getLlmCredential();
        if (!alive) return;
        setByok(resp?.byok_enabled ? resp.credential : null);
        // 字段缺失（老后端）时按可用处理，避免把正常站点误判成停服
        setPlatformModel(resp?.platform_model_available !== false);
      } catch (_) {
        if (alive) setByok(null); // 拿不到就当没配，不影响主流程
      }
    })();
    return () => {
      alive = false;
    };
  }, [user]);
  // 凭证被删除或失效时，别让上次的勾选残留下来导致提交必然失败
  useEffect(() => {
    if (useOwnModel && !byok?.usable) setUseOwnModel(false);
  }, [byok, useOwnModel, setUseOwnModel]);
  // 平台模型不可用时，自带模型不是"可选项"而是唯一通路：配好了就默认选中，
  // 省得用户点了分析才被后端拒绝。
  useEffect(() => {
    if (!platformModel && byok?.usable && !useOwnModel) setUseOwnModel(true);
  }, [platformModel, byok, useOwnModel, setUseOwnModel]);

  // 没有任何模型可用：平台停了，用户也没配自己的
  const noModelAvailable = !platformModel && !byok?.usable;

  // ── 文件校验 ──
  // 支持 PDF / Word(.doc/.docx) / PPT(.pptx)。部分浏览器对 doc/docx/pptx 的 MIME 不稳定，
  // 故同时按扩展名兜底判断。
  const handleFile = useCallback(
    (f) => {
      if (!f) return;
      const name = (f.name || "").toLowerCase();
      const okExt =
        name.endsWith(".pdf") ||
        name.endsWith(".doc") ||
        name.endsWith(".docx") ||
        name.endsWith(".pptx");
      const okMime =
        f.type === "application/pdf" ||
        f.type === "application/msword" ||
        f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        f.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation";
      if (okExt || okMime) {
        setFile(f);
        setError("");
      } else if (name.endsWith(".ppt")) {
        setError("不支持旧版 .ppt，请另存为 .pptx 后上传");
      } else {
        setError("请上传 PDF / Word(.doc/.docx) / PPT(.pptx) 文件");
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
      {!canAnalyze && (
        <div className="mb-6 p-5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-center">
          <Mail className="w-8 h-8 text-amber-400 mx-auto mb-2" />
          <p className="text-amber-300 font-medium mb-1">请先绑定邮箱后再使用分析功能</p>
          <p className="text-sm text-[#4B5A72] mb-3">绑定邮箱后即可开始分析商业计划书</p>
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
        <p className="text-[#4B5A72] mb-4">
          AI 大模型将扮演行业专家 + 投资专家，深度研究 BP 中每条声明，逐条核查真实性
        </p>
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#EEF1F7] rounded-full border border-[#D8DCE8]/50">
          <Lock className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-sm text-[#4B5A72]">您的文件将安全存储，仅用于本次分析</span>
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
                : "border-[#D8DCE8] hover:border-[#BFC5D6] bg-white"
          }
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.pptx"
          className="hidden"
          onChange={(e) => handleFile(e.target.files[0])}
        />
        {file ? (
          <div className="flex flex-col items-center gap-3">
            <FileText className="w-12 h-12 text-emerald-400" />
            <p className="text-lg font-medium text-emerald-400">{file.name}</p>
            <p className="text-sm text-[#8E9BB0]">
              {(file.size / 1024 / 1024).toFixed(2)} MB · 点击更换文件
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Upload className="w-12 h-12 text-[#8E9BB0]" />
            <p className="text-lg text-[#4B5A72]">拖拽 PDF / Word / PPT 到此处，或点击选择文件</p>
            <p className="text-sm text-[#8E9BB0]">
              支持 PDF（文字版/扫描版）、Word(.doc/.docx)、PPT(.pptx)
            </p>
          </div>
        )}
      </div>

      {/* 分析引擎选择（仅在用户配好自带模型时出现） */}
      {byok?.usable && (
        <div className="mt-4 rounded-xl border border-[#D8DCE8] bg-white p-3">
          <div className="flex items-center gap-2 mb-2">
            <Cpu className="w-4 h-4 text-[#1B4FD8]" />
            <span className="text-sm font-medium text-[#0D2145]">分析引擎</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => platformModel && setUseOwnModel(false)}
              disabled={!platformModel}
              className={`px-3 py-2 rounded-lg text-left border transition-colors ${
                !platformModel
                  ? "border-[#D8DCE8] bg-[#F5F7FB] cursor-not-allowed opacity-60"
                  : !useOwnModel
                    ? "border-[#1B4FD8] bg-[#1B4FD8]/5"
                    : "border-[#D8DCE8] hover:border-[#BFC5D6]"
              }`}
            >
              <div className="text-sm text-[#0D2145]">平台模型</div>
              <div className="text-[11px] text-[#8E9BB0] mt-0.5">
                {platformModel ? "消耗 1 次分析额度" : "当前不可用"}
              </div>
            </button>
            <button
              type="button"
              onClick={() => setUseOwnModel(true)}
              className={`px-3 py-2 rounded-lg text-left border transition-colors ${
                useOwnModel
                  ? "border-[#1B4FD8] bg-[#1B4FD8]/5"
                  : "border-[#D8DCE8] hover:border-[#BFC5D6]"
              }`}
            >
              <div className="text-sm text-[#0D2145]">我自己的模型</div>
              <div className="text-[11px] text-[#8E9BB0] mt-0.5 font-mono truncate">
                {byok.models?.default}
              </div>
            </button>
          </div>
          {useOwnModel && (
            <p className="text-[11px] text-[#8E9BB0] mt-2 leading-relaxed">
              本次分析走你自己的 API，不消耗平台额度，费用由你的模型账户承担。
              若你的模型能力弱于平台默认模型，报告里会注明哪些判定环节被降级。
            </p>
          )}
        </div>
      )}
      {/* 平台模型停用且用户没配自己的模型：这时候不是"顺带推荐"，而是唯一出路 */}
      {noModelAvailable && user && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-start gap-2">
            <Cpu className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-medium text-[#0D2145]">需要先配置你自己的模型</div>
              <p className="text-xs text-[#4B5A72] mt-1 leading-relaxed">
                平台模型当前不可用。在「设置 → 我的模型」填入你自己的 API Key （DeepSeek / Claude /
                GPT / Gemini 等任选），即可继续分析，费用由你的模型账户承担、不消耗平台额度。
              </p>
              <button
                type="button"
                onClick={() => navigate("/settings?tab=mymodel")}
                className="mt-2 px-3 py-1.5 rounded-lg bg-[#1B4FD8] text-white text-xs font-medium hover:bg-[#1745BC] transition-colors"
              >
                去配置我的模型
              </button>
            </div>
          </div>
        </div>
      )}

      {byok === null && user && platformModel && (
        <button
          type="button"
          onClick={() => navigate("/settings?tab=mymodel")}
          className="mt-4 w-full flex items-center justify-center gap-1.5 text-xs text-[#8E9BB0] hover:text-[#1B4FD8] transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
          想用自己的 Claude / GPT / Gemini 跑？去配置「我的模型」（不消耗平台额度）
        </button>
      )}

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
        disabled={!file || analyzing || !canAnalyze || noModelAvailable}
        className={`
          mt-6 w-full py-4 rounded-xl text-lg font-semibold transition-all
          ${
            file && !analyzing && canAnalyze && !noModelAvailable
              ? "bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-[#0D2145] shadow-lg shadow-red-500/20"
              : "bg-[#EEF1F7] text-[#8E9BB0] cursor-not-allowed"
          }
        `}
      >
        {analyzing ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            分析中...
          </span>
        ) : !canAnalyze ? (
          "请先绑定邮箱"
        ) : noModelAvailable ? (
          "请先配置你自己的模型"
        ) : (
          "开始辩证分析"
        )}
      </button>

      {/* Powered by */}
      {!analyzing && (
        <div className="mt-8 text-center">
          <p className="text-xs text-[#8E9BB0]">
            Powered by AI 大模型 · DeepThink 深度研究引擎 · 提取30000字符
          </p>
        </div>
      )}
    </div>
  );
});

export default UploadSection;
