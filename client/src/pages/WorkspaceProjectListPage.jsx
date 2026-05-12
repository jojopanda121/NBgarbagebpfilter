import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspaceProjectList } from "../hooks/useWorkspaceProject";
import workspaceProjectApi from "../services/workspaceProjectApi";
import ProjectCard from "../components/Workspace/ProjectCard";
import MergeSuggestionBanner from "../components/Workspace/MergeSuggestionBanner";

const STATUS_OPTIONS = [
  { value: "", label: "全部" },
  { value: "screening", label: "初筛" },
  { value: "met", label: "已见面" },
  { value: "shortlisted", label: "立项" },
  { value: "dd", label: "尽调中" },
  { value: "ic", label: "IC" },
  { value: "ts", label: "TS" },
  { value: "invested", label: "已投" },
  { value: "passed", label: "Pass" },
];

export default function WorkspaceProjectListPage() {
  const [filter, setFilter] = useState({ status: "", industry: "" });
  const { projects, loading, error, refresh } = useWorkspaceProjectList(filter);
  const [migrating, setMigrating] = useState(false);

  const handleMigrate = async () => {
    setMigrating(true);
    try {
      const r = await workspaceProjectApi.migrateLegacy();
      alert(`已整理 ${r.migrated} / ${r.total} 份历史 BP`);
      refresh();
    } catch (e) {
      alert(e.message);
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-medium text-[#0D2145]">我的项目</h1>
          <p className="text-sm text-[#8E9BB0] mt-1">
            每次上传 BP 都会自动归档到对应项目，多版本永不覆盖。
          </p>
        </div>
        <button
          onClick={handleMigrate}
          disabled={migrating}
          className="text-sm px-3 py-1.5 border border-[#D8DCE8] hover:border-[#BFC5D6] rounded text-[#0F1C36] disabled:opacity-40"
          title="把还没有项目归属的历史 BP 一键整理成项目"
        >
          {migrating ? "整理中..." : "一键整理历史 BP"}
        </button>
      </header>

      <MergeSuggestionBanner onChange={refresh} />

      <div className="flex flex-wrap gap-1 mb-6">
        {STATUS_OPTIONS.map((opt) => {
          const active = filter.status === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => setFilter((f) => ({ ...f, status: opt.value }))}
              className={[
                "px-3 py-1 rounded-md text-xs",
                active
                  ? "bg-[#E5E9F4] text-[#0D2145]"
                  : "text-[#4B5A72] hover:bg-[#EEF1F7]",
              ].join(" ")}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {error && <div className="text-rose-400 text-sm mb-4">{error}</div>}
      {loading ? (
        <div className="text-[#8E9BB0] text-sm">加载中...</div>
      ) : projects.length === 0 ? (
        <div className="text-[#8E9BB0] text-sm py-12 text-center border border-dashed border-[#EEF1F7] rounded">
          还没有项目。先<Link className="text-emerald-400 mx-1" to="/app/dashboard">上传一份 BP</Link>试试。
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <Link key={p.id} to={`/app/projects/${p.id}`}>
              <ProjectCard project={p} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
