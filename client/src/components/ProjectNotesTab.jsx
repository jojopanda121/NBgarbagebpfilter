import React, { useState, useEffect } from "react";
import { Save, Loader2, CheckCircle, Tag, Calendar, X } from "lucide-react";
import api from "../services/api";

const STAGE_CONFIG = {
  new:           { label: "新建",     color: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
  reviewed:      { label: "已评估",   color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  dd_pending:    { label: "待尽调",   color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  dd_in_progress:{ label: "尽调中",   color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  dd_done:       { label: "尽调完成", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  decided:       { label: "已决策",   color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  passed:        { label: "已投资",   color: "bg-green-500/20 text-green-400 border-green-500/30" },
  rejected:      { label: "已否决",   color: "bg-red-500/20 text-red-400 border-red-500/30" },
};

const STAGE_ORDER = ["new", "reviewed", "dd_pending", "dd_in_progress", "dd_done", "decided", "passed", "rejected"];

const PRESET_TAGS = ["重点关注", "跟进中", "待讨论", "高潜力", "团队强", "市场大", "估值合理", "风险较高"];

export default function ProjectNotesTab({ taskId, initialNotes = "", initialTags = [], initialStage = "new", initialFollowup = null }) {
  const [notes, setNotes] = useState(initialNotes);
  const [tags, setTags] = useState(initialTags);
  const [stage, setStage] = useState(initialStage);
  const [followupDate, setFollowupDate] = useState(initialFollowup || "");
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await Promise.all([
        api.put(`/api/projects/${taskId}/notes`, { notes }),
        api.put(`/api/projects/${taskId}/tags`, { tags }),
        api.put(`/api/projects/${taskId}/stage`, { stage }),
        followupDate
          ? api.put(`/api/projects/${taskId}/followup`, { date: followupDate })
          : api.put(`/api/projects/${taskId}/followup`, { date: null }),
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      alert("保存失败：" + e.message);
    } finally {
      setSaving(false);
    }
  };

  const addTag = (t) => {
    const trimmed = t.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setTagInput("");
  };

  const removeTag = (t) => setTags(tags.filter(x => x !== t));

  return (
    <div className="space-y-5">
      {/* 投资阶段 */}
      <div className="bg-slate-900 border border-white/10 rounded-xl p-4">
        <p className="text-sm font-medium text-slate-300 mb-3">投资流程阶段</p>
        <div className="flex flex-wrap gap-2">
          {STAGE_ORDER.map(s => {
            const cfg = STAGE_CONFIG[s];
            return (
              <button
                key={s}
                onClick={() => setStage(s)}
                className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                  stage === s
                    ? `${cfg.color} ring-1 ring-current/50`
                    : "border-white/10 bg-slate-800 text-slate-500 hover:border-white/20"
                }`}
              >
                {cfg.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 标签 */}
      <div className="bg-slate-900 border border-white/10 rounded-xl p-4">
        <p className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-1.5">
          <Tag className="w-4 h-4" />
          项目标签
        </p>
        {/* 已选标签 */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {tags.map(t => (
              <span
                key={t}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-blue-500/15 text-blue-400 border border-blue-500/20"
              >
                {t}
                <button onClick={() => removeTag(t)} className="hover:text-blue-200">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        {/* 预设标签快速添加 */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {PRESET_TAGS.filter(t => !tags.includes(t)).map(t => (
            <button
              key={t}
              onClick={() => addTag(t)}
              className="px-2.5 py-1 rounded-full text-xs bg-slate-800 text-slate-400 hover:bg-slate-700 border border-white/5 transition-colors"
            >
              + {t}
            </button>
          ))}
        </div>
        {/* 自定义标签输入 */}
        <div className="flex gap-2">
          <input
            type="text"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addTag(tagInput)}
            placeholder="输入自定义标签，回车添加"
            className="flex-1 px-3 py-1.5 bg-slate-800 border border-white/10 rounded-lg text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => addTag(tagInput)}
            disabled={!tagInput.trim()}
            className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded-lg transition-colors"
          >
            添加
          </button>
        </div>
      </div>

      {/* 下次跟进日期 */}
      <div className="bg-slate-900 border border-white/10 rounded-xl p-4">
        <p className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-1.5">
          <Calendar className="w-4 h-4" />
          下次跟进日期
        </p>
        <input
          type="date"
          value={followupDate}
          onChange={e => setFollowupDate(e.target.value)}
          className="px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-sm text-slate-300 focus:outline-none focus:border-blue-500"
        />
        {followupDate && (
          <button
            onClick={() => setFollowupDate("")}
            className="ml-2 text-sm text-slate-500 hover:text-slate-300"
          >
            清除
          </button>
        )}
      </div>

      {/* 项目备注 */}
      <div className="bg-slate-900 border border-white/10 rounded-xl p-4">
        <p className="text-sm font-medium text-slate-300 mb-3">项目备注</p>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="记录你对这个项目的主观判断、关注点、下一步计划等...（支持 Markdown）"
          rows={8}
          className="w-full px-3 py-2.5 bg-slate-800 border border-white/10 rounded-lg text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500 resize-y leading-relaxed"
        />
      </div>

      {/* 保存按钮 */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
      >
        {saving
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : saved
          ? <CheckCircle className="w-4 h-4 text-emerald-300" />
          : <Save className="w-4 h-4" />
        }
        {saving ? "保存中..." : saved ? "已保存" : "保存更改"}
      </button>
    </div>
  );
}
