import React from "react";

const STATUS_META = {
  screening: { label: "初筛", color: "bg-[#E5E9F4] text-[#0F1C36]" },
  met: { label: "已见面", color: "bg-blue-900 text-blue-100" },
  shortlisted: { label: "立项", color: "bg-indigo-900 text-indigo-100" },
  dd: { label: "尽调中", color: "bg-amber-900 text-amber-100" },
  ic: { label: "IC", color: "bg-purple-900 text-purple-100" },
  ts: { label: "TS", color: "bg-pink-900 text-pink-100" },
  invested: { label: "已投", color: "bg-emerald-900 text-emerald-100" },
  passed: { label: "Pass", color: "bg-zinc-800 text-zinc-400" },
};

export default function ProjectStatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status, color: "bg-[#E5E9F4] text-[#0F1C36]" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}>
      {meta.label}
    </span>
  );
}

export { STATUS_META };
