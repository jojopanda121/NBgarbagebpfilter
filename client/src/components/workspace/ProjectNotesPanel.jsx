import React, { useState } from "react";
import workspaceProjectApi from "../../services/workspaceProjectApi";

export default function ProjectNotesPanel({ project, onChange }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await workspaceProjectApi.addNote(project.id, text.trim());
      setText("");
      onChange?.();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const notes = (project.timeline || []).filter((t) => t.entry_type === "note");

  return (
    <div className="space-y-4">
      <div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="写下你的尽调感受、待办、电话纪要……"
          className="w-full bg-white border border-[#EEF1F7] rounded p-3 text-sm focus:outline-none focus:border-slate-600"
          rows={4}
        />
        <div className="mt-2 text-right">
          <button
            onClick={submit}
            disabled={saving || !text.trim()}
            className="px-4 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded text-[#0D2145]"
          >
            {saving ? "保存中..." : "添加笔记"}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {notes.length === 0 && (
          <div className="text-[#8E9BB0] text-sm">还没有笔记</div>
        )}
        {notes.map((n) => (
          <div key={n.id} className="border border-[#EEF1F7] rounded p-3 bg-white">
            <div className="text-xs text-[#8E9BB0] mb-1">{n.created_at}</div>
            <div className="text-sm text-[#0F1C36] whitespace-pre-wrap">{n.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
