// ============================================================
// client/src/pages/ProjectPage.jsx — 项目详情页（三 Tab 布局）
//
// Tab 1: 分析报告（现有报告内容）
// Tab 2: 尽调问卷（用户主动开启后可见）
// Tab 3: 项目备注（阶段、标签、跟进日期、备注）
// ============================================================

import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Gavel, ArrowLeft, Loader2, ClipboardList, FileText,
  BookOpen, Play, CheckCircle2, AlertCircle, Share2, Copy
} from "lucide-react";
import api from "../services/api";
import useAuthStore from "../store/useAuthStore";
import VerdictCard from "../components/VerdictCard";
import ScoreVisualizer from "../components/ScoreVisualizer";
import DetailedReport from "../components/DetailedReport";
import DDQuestionnaire from "../components/DDQuestionnaire";
import IMemoTab from "../components/IMemoTab";
import ProjectNotesTab from "../components/ProjectNotesTab";

const STAGE_CONFIG = {
  new:            { label: "新建",     color: "bg-slate-500/20 text-[#4B5A72] border-slate-500/30" },
  reviewed:       { label: "已评估",   color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  dd_pending:     { label: "待尽调",   color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  dd_in_progress: { label: "尽调中",   color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  dd_done:        { label: "尽调完成", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  decided:        { label: "已决策",   color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  passed:         { label: "已投资",   color: "bg-green-500/20 text-green-400 border-green-500/30" },
  rejected:       { label: "已否决",   color: "bg-red-500/20 text-red-400 border-red-500/30" },
};

const DD_ACTIVE_STAGES = ["dd_pending", "dd_in_progress", "dd_done"];

export default function ProjectPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [project, setProject] = useState(null);
  const [activeTab, setActiveTab] = useState("report");
  const [startingDD, setStartingDD] = useState(false);
  const [rescoreResult, setRescoreResult] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchProject();
  }, [taskId]);

  const fetchProject = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/api/projects/${taskId}`);
      setProject(data);
      // 看完报告后自动标记 reviewed（若还是 new）
      if (data.project_stage === "new") {
        api.put(`/api/projects/${taskId}/stage`, { stage: "reviewed" }).catch(() => {});
        setProject(p => ({ ...p, project_stage: "reviewed" }));
      }
    } catch (e) {
      setError(e.message || "加载项目失败");
    } finally {
      setLoading(false);
    }
  };

  const handleStartDD = async () => {
    setStartingDD(true);
    try {
      const data = await api.post(`/api/projects/${taskId}/dd/start`, {});
      setProject(p => ({
        ...p,
        project_stage: data.project_stage,
        dd_questionnaire: data.questionnaire,
      }));
      setActiveTab("dd");
    } catch (e) {
      alert("开启尽调失败：" + e.message);
    } finally {
      setStartingDD(false);
    }
  };

  const handleRescore = (result, latestAnswers) => {
    setRescoreResult(result);
    setProject(p => ({
      ...p,
      adjusted_score: result.newTotal,
      project_stage: "dd_done",
      ...(latestAnswers ? { dd_answers: latestAnswers } : {}),
    }));
  };

  const handleShare = async () => {
    setSharing(true);
    try {
      const data = await api.post(`/api/task/${taskId}/share`);
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

  const handleCopyLink = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = shareLink;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
      document.body.removeChild(ta);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F6F7FA] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#F6F7FA] flex flex-col items-center justify-center">
        <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
        <p className="text-red-400 mb-4">{error}</p>
        <button onClick={() => navigate("/app/history")} className="px-4 py-2 bg-[#EEF1F7] rounded-lg">
          返回历史记录
        </button>
      </div>
    );
  }

  const result = project?.result;
  const stage = project?.project_stage || "new";
  const stageCfg = STAGE_CONFIG[stage] || STAGE_CONFIG.new;
  const isDDActive = DD_ACTIVE_STAGES.includes(stage);
  const displayScore = project?.adjusted_score ?? project?.total_score;
  const gradeLabel = result?.verdict?.grade_label || "";

  const tabs = [
    { key: "report", label: "分析报告", icon: BookOpen },
    { key: "dd",     label: isDDActive ? "尽调问卷" : "开始尽调", icon: ClipboardList, highlight: !isDDActive },
    { key: "imemo",  label: "投资备忘录", icon: FileText },
    { key: "notes",  label: "项目备注", icon: CheckCircle2 },
  ];

  return (
    <div className="min-h-screen bg-[#F6F7FA]">
      {/* Header */}
      <header className="border-b border-[#D8DCE8] bg-[#F6F7FA]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate("/")}>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
              <Gavel className="w-5 h-5 text-[#0D2145]" />
            </div>
            <span className="text-lg font-bold">垃圾BP过滤机</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleShare}
              disabled={sharing}
              className="px-3 py-1.5 text-sm bg-[#1B4FD8] hover:bg-[#163069] disabled:bg-[#E5E9F4] rounded-lg transition-colors flex items-center gap-1.5"
            >
              {sharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
              分享
            </button>
            <span className={`px-2.5 py-1 rounded-lg border text-xs font-medium ${stageCfg.color}`}>
              {stageCfg.label}
            </span>
            {displayScore != null && (
              <span className="px-2.5 py-1 rounded-lg bg-[#EEF1F7] text-sm font-bold text-[#0F1C36]">
                {displayScore} 分
                {project?.adjusted_score != null && project?.total_score != null && project.adjusted_score !== project.total_score && (
                  <span className="text-xs font-normal text-[#8E9BB0] ml-1">（已尽调）</span>
                )}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* 分享链接弹出 */}
      {shareLink && (
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-blue-400 mb-1">分享链接已生成（3天有效）</p>
              <p className="text-xs text-[#4B5A72] truncate">{shareLink}</p>
            </div>
            <button
              onClick={handleCopyLink}
              className="shrink-0 px-3 py-1.5 bg-[#1B4FD8] hover:bg-[#163069] rounded-lg text-sm flex items-center gap-1.5"
            >
              {copied ? <><CheckCircle2 className="w-4 h-4" />已复制</> : <><Copy className="w-4 h-4" />复制</>}
            </button>
          </div>
        </div>
      )}

      {/* 返回 + 项目标题 */}
      <div className="max-w-6xl mx-auto px-4 py-4">
        <button
          onClick={() => navigate("/app/history")}
          className="flex items-center gap-2 text-[#4B5A72] hover:text-[#0D2145] transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          返回项目列表
        </button>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              {result?.extracted_data?.company_name || project?.title || "BP 项目"}
            </h1>
            <p className="text-[#4B5A72] text-sm mt-1">
              {project?.archive_number && (
                <span className="font-mono mr-2">{project.archive_number}</span>
              )}
              {result?.industry || project?.industry || ""}
              {project?.project_location && ` · ${project.project_location}`}
            </p>
          </div>

          {/* 开始尽调 CTA 按钮（显眼位置，仅在未开始尽调时显示） */}
          {!isDDActive && result && (
            <button
              onClick={handleStartDD}
              disabled={startingDD}
              className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:opacity-60 rounded-xl font-medium flex items-center gap-2 transition-all shadow-lg shadow-blue-900/30"
            >
              {startingDD
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Play className="w-4 h-4" />
              }
              {startingDD ? "生成尽调问卷..." : "开始尽调"}
            </button>
          )}

          {isDDActive && (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 text-sm">
                <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
                尽调进行中
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Tab 导航 */}
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex gap-1 border-b border-[#D8DCE8]">
          {tabs.map(tab => {
            const Icon = tab.icon;
            // 尽调 tab 未开启时，不作为独立 tab，只当按钮
            if (tab.key === "dd" && !isDDActive) return null;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  activeTab === tab.key
                    ? "border-blue-500 text-blue-400"
                    : "border-transparent text-[#8E9BB0] hover:text-[#0F1C36]"
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab 内容 */}
      <main className="max-w-6xl mx-auto px-4 py-6 pb-16">
        {/* Tab 1: 分析报告 */}
        {activeTab === "report" && result && (
          <div className="space-y-6">
            {/* 尽调校正分提示 */}
            {rescoreResult && (
              <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                <p className="text-sm text-blue-400">
                  尽调校正后评分：<strong>{rescoreResult.newTotal} 分（{rescoreResult.newGrade}级）</strong>
                  <span className="ml-2 text-[#4B5A72]">
                    原始 {rescoreResult.originalTotal} 分
                    {rescoreResult.delta >= 0 ? ` → +${rescoreResult.delta}` : ` → ${rescoreResult.delta}`}
                  </span>
                </p>
              </div>
            )}
            <VerdictCard result={result} />
            <ScoreVisualizer verdict={result.verdict} />
            <DetailedReport result={result} />
          </div>
        )}

        {/* Tab 2: 尽调问卷 */}
        {activeTab === "dd" && isDDActive && (
          <DDQuestionnaire
            taskId={taskId}
            questionnaire={project?.dd_questionnaire || []}
            initialAnswers={project?.dd_answers || {}}
            onRescore={handleRescore}
            onAnswersChange={(updated) => setProject(p => ({ ...p, dd_answers: updated }))}
          />
        )}

        {/* Tab 3: 投资备忘录 */}
        {activeTab === "imemo" && (
          <IMemoTab taskId={taskId} />
        )}

        {/* Tab 4: 项目备注 */}
        {activeTab === "notes" && (
          <ProjectNotesTab
            taskId={taskId}
            initialNotes={project?.project_notes || ""}
            initialTags={project?.project_tags || []}
            initialStage={project?.project_stage || "new"}
            initialFollowup={project?.next_followup_date || null}
          />
        )}
      </main>
    </div>
  );
}
