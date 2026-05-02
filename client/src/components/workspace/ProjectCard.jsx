import React from "react";
import ProjectStatusBadge from "./ProjectStatusBadge";

export default function ProjectCard({ project }) {
  return (
    <div className="border border-slate-800 hover:border-slate-700 rounded-lg p-4 bg-slate-900 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium text-slate-100 truncate">{project.name}</h3>
          {project.one_liner && (
            <p className="text-sm text-slate-400 mt-1 line-clamp-2">{project.one_liner}</p>
          )}
        </div>
        <ProjectStatusBadge status={project.status} />
      </div>
      <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
        {project.industry && <span>{project.industry}</span>}
        {project.stage && <span>· {project.stage}</span>}
        {project.latest_score != null && (
          <span className="ml-auto text-slate-300">
            评分 {Number(project.latest_score).toFixed(1)}
          </span>
        )}
      </div>
    </div>
  );
}
