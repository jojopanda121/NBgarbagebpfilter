import React, { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useWorkspaceProject } from "../hooks/useWorkspaceProject";
import ProjectStatusStepper from "../components/workspace/ProjectStatusStepper";
import BPVersionDiff from "../components/workspace/BPVersionDiff";
import ProjectTimeline from "../components/workspace/ProjectTimeline";
import ProjectNotesPanel from "../components/workspace/ProjectNotesPanel";

const TABS = [
  { key: "overview", label: "概览" },
  { key: "versions", label: "BP 历史" },
  { key: "reports", label: "Agent 报告" },
  { key: "files", label: "资料" },
  { key: "notes", label: "笔记" },
  { key: "timeline", label: "时间线" },
];

function OverviewTab({ project }) {
  const latest = project.versions?.[0];
  const cards = [
    {
      label: "本轮估值",
      value: latest?.claimed_valuation
        ? `${(latest.claimed_valuation / 10000).toFixed(2)} 亿`
        : "—",
    },
    { label: "融资轮次", value: latest?.funding_round || "—" },
    {
      label: "融资金额",
      value: latest?.funding_amount ? `${latest.funding_amount} 万` : "—",
    },
    { label: "BP 版本数", value: project.versions?.length || 0 },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className="border border-[#EEF1F7] rounded p-4 bg-white"
        >
          <div className="text-xs text-[#8E9BB0]">{c.label}</div>
          <div className="mt-2 text-lg text-[#0D2145]">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

function ReportsTab({ project }) {
  const tasks = project.tasks || [];
  if (!tasks.length) {
    return <div className="text-[#8E9BB0] text-sm py-6">暂无 Agent 报告</div>;
  }
  return (
    <ul className="space-y-2">
      {tasks.map((t) => (
        <li key={t.id} className="border border-[#EEF1F7] rounded p-3 bg-white">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-[#0F1C36]">
                {t.title || t.archive_number || t.id}
              </div>
              <div className="text-xs text-[#8E9BB0] mt-1">
                {t.created_at} · 评分 {t.total_score?.toFixed?.(1) ?? "—"}
              </div>
            </div>
            <Link
              to={`/report/${t.id}`}
              className="text-sm text-emerald-400 hover:text-emerald-300"
            >
              查看报告 →
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

function FilesTab({ project }) {
  // 占位：Sprint 2 暂不实现独立资料上传，沿用 BP 文件
  const versions = project.versions || [];
  if (!versions.length) {
    return <div className="text-[#8E9BB0] text-sm py-6">暂无资料</div>;
  }
  return (
    <ul className="space-y-2">
      {versions.map((v) => (
        <li key={v.id} className="border border-[#EEF1F7] rounded p-3 bg-white text-sm">
          <span className="text-[#0F1C36]">v{v.version_number}</span>
          <span className="text-[#8E9BB0] ml-2">{v.uploaded_at}</span>
          {v.task_id && (
            <Link
              to={`/report/${v.task_id}`}
              className="text-emerald-400 hover:text-emerald-300 ml-3"
            >
              报告
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function WorkspaceProjectPage() {
  const { id } = useParams();
  const { project, loading, error, refresh } = useWorkspaceProject(id);
  const [activeTab, setActiveTab] = useState("overview");

  if (loading) return <div className="p-8 text-[#8E9BB0]">加载中...</div>;
  if (error)
    return (
      <div className="p-8 text-rose-400 text-sm">
        {error} <Link className="text-emerald-400 ml-2" to="/app/projects">返回列表</Link>
      </div>
    );
  if (!project) return null;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="mb-2">
        <Link to="/app/projects" className="text-xs text-[#8E9BB0] hover:text-[#0F1C36]">
          ← 我的项目
        </Link>
      </div>

      <header className="border-b border-[#EEF1F7] pb-5 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-2xl font-medium text-[#0D2145]">{project.name}</h1>
            {project.one_liner && (
              <p className="text-sm text-[#4B5A72] mt-1">{project.one_liner}</p>
            )}
            <div className="mt-2 flex items-center gap-3 text-xs text-[#8E9BB0]">
              {project.industry && <span>{project.industry}</span>}
              {project.stage && <span>· {project.stage}</span>}
              {project.region && <span>· {project.region}</span>}
              {project.latest_score != null && (
                <span className="text-[#0F1C36]">
                  · 评分 {Number(project.latest_score).toFixed(1)}
                </span>
              )}
            </div>
          </div>
          <ProjectStatusStepper project={project} onChange={refresh} />
        </div>
      </header>

      <nav className="flex gap-1 mb-6 border-b border-[#EEF1F7]">
        {TABS.map((t) => {
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={[
                "px-3 py-2 text-sm transition-colors -mb-px border-b-2",
                active
                  ? "text-[#0D2145] border-emerald-500"
                  : "text-[#8E9BB0] border-transparent hover:text-[#0F1C36]",
              ].join(" ")}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      <main>
        {activeTab === "overview" && <OverviewTab project={project} />}
        {activeTab === "versions" && <BPVersionDiff project={project} />}
        {activeTab === "reports" && <ReportsTab project={project} />}
        {activeTab === "files" && <FilesTab project={project} />}
        {activeTab === "notes" && <ProjectNotesPanel project={project} onChange={refresh} />}
        {activeTab === "timeline" && <ProjectTimeline project={project} />}
      </main>
    </div>
  );
}
