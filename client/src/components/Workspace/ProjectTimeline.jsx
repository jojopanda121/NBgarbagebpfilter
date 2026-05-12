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
    return <div className="text-[#8E9BB0] text-sm py-8">暂无记录</div>;
  }
  return (
    <ol className="relative border-l border-[#EEF1F7] ml-3 space-y-4">
      {items.map((it) => (
        <li key={it.id} className="ml-4">
          <span className="absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full bg-[#E5E9F4] border border-[#EEF1F7]" />
          <div className="flex items-baseline gap-2 text-xs text-[#8E9BB0]">
            <span className="px-1.5 py-0.5 rounded bg-[#EEF1F7] text-[#0F1C36]">
              {TYPE_LABEL[it.entry_type] || it.entry_type}
            </span>
            <time>{it.created_at}</time>
          </div>
          <p className="mt-1 text-sm text-[#0F1C36] whitespace-pre-wrap">{it.content}</p>
        </li>
      ))}
    </ol>
  );
}
