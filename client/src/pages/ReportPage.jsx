import React, { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Gavel, ArrowLeft, Loader2, Share2, Copy, CheckCircle } from "lucide-react";
import api from "../services/api";
import useAuthStore from "../store/useAuthStore";
import VerdictCard from "../components/VerdictCard";
import ScoreVisualizer from "../components/ScoreVisualizer";
import DetailedReport from "../components/DetailedReport";

export default function ReportPage() {
  const { taskId, shareToken } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [copied, setCopied] = useState(false);

  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const isSharedMode = !!shareToken;

  useEffect(() => {
    async function fetchReport() {
      try {
        let data;
        if (isSharedMode) {
          // 分享模式：公开访问
          data = await api.get(`/api/task/shared/${shareToken}`);
        } else if (taskId) {
          // 正常模式：需登录
          data = await api.get(`/api/task/${taskId}`);
        } else {
          setError("缺少任务 ID");
          setLoading(false);
          return;
        }

        if (!data || !data.result) {
          setError("报告不存在或尚未生成");
          return;
        }
        const parsed = typeof data.result === "string" ? JSON.parse(data.result) : data.result;
        setResult(parsed);
      } catch (err) {
        setError(err.message || "获取报告失败");
      } finally {
        setLoading(false);
      }
    }

    fetchReport();
  }, [taskId, shareToken, isSharedMode]);

  const handleShare = async () => {
    if (!taskId) return;
    setSharing(true);
    try {
      const data = await api.post(`/api/task/${taskId}/share`);
      // 获取邀请码
      let inviteCode = "";
      try {
        const inv = await api.get("/api/user/invite-code");
        inviteCode = inv.invite_code || "";
      } catch {}
      const link = `${window.location.origin}/report/s/${data.share_token}${inviteCode ? `?ref=${inviteCode}` : ""}`;
      setShareLink(link);
    } catch (err) {
      alert(err.message || "生成分享链接失败");
    } finally {
      setSharing(false);
    }
  };

  const handleCopy = async () => {
    if (!shareLink) {
      alert("分享链接不存在，请先生成分享链接");
      return;
    }
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // 降级方案：使用传统方法复制
      const textArea = document.createElement("textarea");
      textArea.value = shareLink;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (e) {
        alert("复制失败，请手动复制链接");
      }
      document.body.removeChild(textArea);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center">
        <p className="text-red-400 mb-4">{error}</p>
        <button
          onClick={() => navigate("/")}
          className="px-4 py-2 bg-slate-800 rounded-lg"
        >
          返回首页
        </button>
      </div>
    );
  }

  // 是否是报告 owner（可以分享）
  const canShare = !!token && !!taskId && !isSharedMode;

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="border-b border-white/10 bg-slate-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => navigate("/")}
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
              <Gavel className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold">垃圾BP过滤机</span>
          </div>

          <div className="flex items-center gap-2">
            {canShare && (
              <button
                onClick={handleShare}
                disabled={sharing}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5"
              >
                {sharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                分享报告
              </button>
            )}
            <button
              onClick={() => navigate(token ? "/app/dashboard" : "/")}
              className="px-4 py-2 text-sm bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
            >
              {token ? "分析新 BP" : "返回首页"}
            </button>
          </div>
        </div>
      </header>

      {/* 分享链接弹出 */}
      {shareLink && (
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-blue-400 mb-1">分享链接已生成（3天有效）</p>
              <p className="text-xs text-slate-400 truncate">{shareLink}</p>
            </div>
            <button
              onClick={handleCopy}
              className="shrink-0 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm flex items-center gap-1.5"
            >
              {copied ? <><CheckCircle className="w-4 h-4" />已复制</> : <><Copy className="w-4 h-4" />复制</>}
            </button>
          </div>
        </div>
      )}

      {/* 返回按钮 */}
      {!isSharedMode && (
        <div className="max-w-6xl mx-auto px-4 py-4">
          <button
            onClick={() => navigate("/app/history")}
            className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            返回历史报告
          </button>
        </div>
      )}

      {/* 报告内容 */}
      <main className="max-w-6xl mx-auto px-4 pb-16">
        {/* 公司信息 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">
            {result.extracted_data?.company_name || "商业计划书分析"}
          </h1>
          <p className="text-slate-400">
            {result.industry} · {result.extracted_data?.product_name}
          </p>
        </div>

        {/* 评分结果 */}
        <VerdictCard result={result} />

        {/* 五维雷达图 */}
        <div className="mt-6">
          <ScoreVisualizer verdict={result.verdict} />
        </div>

        {/* 详细报告 */}
        <div className="mt-6">
          <DetailedReport result={result} />
        </div>
      </main>

      {/* 未登录用户注册引导 banner */}
      {isSharedMode && !token && (
        <div className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-white/10 p-4 z-50">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div>
              <p className="font-medium">想分析自己的 BP？</p>
              <p className="text-sm text-slate-400">注册即可免费体验</p>
            </div>
            <button
              onClick={() => {
                const ref = searchParams.get("ref");
                navigate(ref ? `/login?ref=${ref}` : "/login");
              }}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors"
            >
              免费注册
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
