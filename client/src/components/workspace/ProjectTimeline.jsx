import React from "react";

const TYPE_LABEL = {
  note: "笔记",
  project_created: "项目创建",
  status_change: "状态变更",
  version_uploaded: "新版本",
  agent_done: "AI 完成",
  file_added: "新增资料",
  project_merged: "项目合并",
};

export default function ProjectTimeline({ project }) {
  const items = project?.timeline || [];
  if (!items.length) {
    return <div className="text-slate-500 text-sm py-8">暂无记录</div>;
  }
  return (
    <ol className="relative border-l border-slate-800 ml-3 space-y-4">
      {items.map((it) => (
        <li key={it.id} className="ml-4">
          <span className="absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full bg-slate-700 border border-slate-900" />
          <div className="flex items-baseline gap-2 text-xs text-slate-500">
            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
              {TYPE_LABEL[it.entry_type] || it.entry_type}
            </span>
            <time>{it.created_at}</time>
          </div>
          <p className="mt-1 text-sm text-slate-200 whitespace-pre-wrap">{it.content}</p>
        </li>
      ))}
    </ol>
  );
}
