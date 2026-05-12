// ============================================================
// MergeSuggestionBanner — 顶部 alert 条
// 替代之前 orchestrator 静默 auto-merge:用户能看到候选并自己点击合并/驳回
// ============================================================

import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import workspaceProjectApi from "../../services/workspaceProjectApi";

export default function MergeSuggestionBanner({ onChange }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);

  const reload = useCallback(async () => {
    try {
      const r = await workspaceProjectApi.listMergeSuggestions();
      setItems(r.suggestions || []);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function accept(id) {
    setBusy(id); setError("");
    try {
      await workspaceProjectApi.acceptMergeSuggestion(id);
      await reload();
      onChange?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }
  async function dismiss(id) {
    setBusy(id); setError("");
    try {
      await workspaceProjectApi.dismissMergeSuggestion(id);
      await reload();
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  if (items.length === 0) return null;

  return (
    <div className="mb-4 border border-amber-300 bg-amber-50 rounded p-3 text-sm space-y-2">
      <div className="font-medium text-amber-900">
        待确认的项目合并 ({items.length})
      </div>
      {error && <div className="text-rose-600 text-xs">{error}</div>}
      <ul className="space-y-2">
        {items.map((s) => (
          <li key={s.id} className="bg-white border border-amber-200 rounded p-2.5 flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <div className="text-[#0F1C36]">
                新上传的{" "}
                <Link to={`/app/projects/${s.new_project_id}`} className="text-emerald-700 underline">
                  {s.new_project_name}
                </Link>{" "}
                与已有的{" "}
                <Link to={`/app/projects/${s.candidate_project_id}`} className="text-emerald-700 underline">
                  {s.candidate_project_name}
                </Link>{" "}
                <span className="text-[#8E9BB0]">
                  相似度 {(s.match_score * 100).toFixed(0)}%
                  {s.candidate_industry && ` · ${s.candidate_industry}`}
                </span>
              </div>
              {s.match_signals && (
                <div className="text-[11px] text-[#8E9BB0] mt-0.5">
                  名称相似 {(s.match_signals.name_sim * 100).toFixed(0)}%
                  {s.match_signals.founder_count > 0 && ` · 创始人相似 ${(s.match_signals.founder_sim * 100).toFixed(0)}%`}
                </div>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => accept(s.id)}
                disabled={busy === s.id}
                className="px-2.5 py-1 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                合并到{s.candidate_project_name}
              </button>
              <button
                onClick={() => dismiss(s.id)}
                disabled={busy === s.id}
                className="px-2.5 py-1 text-xs rounded border border-[#EEF1F7] text-[#0F1C36] hover:bg-[#F6F7FA] disabled:opacity-60"
              >
                不是同一个
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
