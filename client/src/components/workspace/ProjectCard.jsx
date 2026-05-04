import React from "react";
import ProjectStatusBadge from "./ProjectStatusBadge";

export default function ProjectCard({ project }) {
  return (
    <div className="border border-[#EEF1F7] hover:border-[#D8DCE8] rounded-lg p-4 bg-white transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium text-[#0D2145] truncate">{project.name}</h3>
          {project.one_liner && (
            <p className="text-sm text-[#4B5A72] mt-1 line-clamp-2">{project.one_liner}</p>
          )}
        </div>
        <ProjectStatusBadge status={project.status} />
      </div>
      <div className="mt-3 flex items-center gap-3 text-xs text-[#8E9BB0]">
        {project.industry && <span>{project.industry}</span>}
        {project.stage && <span>· {project.stage}</span>}
        {project.latest_score != null && (
          <span className="ml-auto text-[#0F1C36]">
            评分 {Number(project.latest_score).toFixed(1)}
          </span>
        )}
      </div>
    </div>
  );
}
