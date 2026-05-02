import React, { useState } from "react";
import workspaceProjectApi from "../../services/workspaceProjectApi";
import { STATUS_META } from "./ProjectStatusBadge";

const FLOW = ["screening", "met", "shortlisted", "dd", "ic", "ts", "invested", "passed"];

export default function ProjectStatusStepper({ project, onChange }) {
  const [busy, setBusy] = useState(false);
  const idx = FLOW.indexOf(project.status);

  const setStatus = async (s) => {
    if (busy || s === project.status) return;
    setBusy(true);
    try {
      await workspaceProjectApi.updateStatus(project.id, s);
      onChange?.();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {FLOW.map((s, i) => {
        const meta = STATUS_META[s];
        const active = i === idx;
        const done = i < idx;
        return (
          <button
            key={s}
            disabled={busy}
            onClick={() => setStatus(s)}
            className={[
              "px-2.5 py-1 rounded-md text-xs transition-colors",
              active
                ? "bg-emerald-600 text-white"
                : done
                ? "bg-slate-700 text-slate-300"
                : "bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-slate-300",
            ].join(" ")}
            title={`点击切换到「${meta.label}」`}
          >
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}
