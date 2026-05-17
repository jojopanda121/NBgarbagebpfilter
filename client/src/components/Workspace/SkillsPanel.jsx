// ============================================================
// SkillsPanel — 项目页右侧的 skill 一键调用面板
// 列出所有已注册 skill,点击 → 弹参数 → 调用 → 渲染产物
// ============================================================

import React, { useEffect, useMemo, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import skillsApi from "../../services/skillsApi";
import TeaserShareModal from "./TeaserShareModal";
import SkillResultModal from "./SkillResultModal";
import {
  STANDARD_SKILL_IDS,
  STANDARD_SKILL_ORDER,
  SKILL_META,
  artifactOutputHint,
  enrichPreviewArtifact,
} from "./workspaceArtifacts";

const CATEGORY_LABELS = {
  standard: "标准化产出",
  report: "报告 / 文档",
  research: "研究 / 尽调",
  memo: "投决 / 内部",
  artifact: "通用产出",
  share: "分享 / Teaser",
};
const CATEGORY_ORDER = ["standard", "report", "research", "memo", "artifact", "share"];

export default function SkillsPanel({ project, onArtifact }) {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(null);    // skillId
  const [error, setError] = useState("");
  const [resultModal, setResultModal] = useState(null);
  const [teaserModalOpen, setTeaserModalOpen] = useState(false);

  useEffect(() => {
    skillsApi.list().then((d) => setSkills(d.skills || [])).finally(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => {
    const buckets = {};
    for (const s of skills) {
      const cat = STANDARD_SKILL_IDS.has(s.id) ? "standard" : (s.category || "report");
      (buckets[cat] = buckets[cat] || []).push(s);
    }
    for (const list of Object.values(buckets)) {
      list.sort((a, b) => sortSkill(a) - sortSkill(b) || a.title.localeCompare(b.title, "zh-CN"));
    }
    return buckets;
  }, [skills]);

  async function runSkill(skill) {
    if (!project?.id) return;
    setError("");
    setRunning(skill.id);
    try {
      const out = await skillsApi.run(skill.id, { projectId: project.id, params: {} });
      if (!out.ok) {
        setError(out.error || "skill 执行失败");
        return;
      }
      const artifact = enrichPreviewArtifact(out.artifact, project.id);
      setResultModal({ skill, runId: out.runId, artifact });
      onArtifact?.(out);
    } catch (e) {
      setError(e.message || "网络错误");
    } finally {
      setRunning(null);
    }
  }

  if (loading) return <div className="text-xs text-[#8E9BB0] p-4">加载 skill 列表…</div>;

  return (
    <div className="bg-white border border-[#EEF1F7] rounded p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[#0D2145]">投研 Skill</h3>
        <span className="text-xs text-[#8E9BB0]">{skills.length} 个</span>
      </div>
      {error && (
        <div className="text-xs text-rose-500 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">
          {error}
        </div>
      )}
      {CATEGORY_ORDER.filter((c) => grouped[c]).map((cat) => (
        <div key={cat}>
          <div className="text-[11px] uppercase tracking-wide text-[#8E9BB0] mb-2">
            {CATEGORY_LABELS[cat] || cat}
          </div>
          <ul className="space-y-1.5">
            {grouped[cat].map((s) => {
              const isTeaserShare = s.id === "teaser_share";
              const busy = running === s.id;
              const meta = SKILL_META[s.id] || { icon: FileText, tone: "text-[#4B5A72]", hint: artifactOutputHint(s) };
              const Icon = meta.icon;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={busy || running}
                    onClick={() => isTeaserShare ? setTeaserModalOpen(true) : runSkill(s)}
                    className={[
                      "w-full text-left px-3 py-2 rounded border text-sm transition-colors",
                      busy
                        ? "bg-[#EEF1F7] border-[#D8DCE8] text-[#8E9BB0] cursor-wait"
                        : "bg-white hover:bg-[#F6F7FA] border-[#EEF1F7] text-[#0F1C36]",
                    ].join(" ")}
                  >
                    <div className="flex items-center gap-2">
                      {busy ? (
                        <Loader2 className="w-4 h-4 animate-spin text-[#8E9BB0] shrink-0" />
                      ) : (
                        <Icon className={`w-4 h-4 shrink-0 ${meta.tone}`} />
                      )}
                      <span className="min-w-0 flex-1 truncate">{s.title}</span>
                      <span className="shrink-0 rounded border border-[#EEF1F7] bg-[#F7F8FC] px-1.5 py-0.5 text-[10px] text-[#8E9BB0]">
                        {meta.hint || artifactOutputHint(s)}
                      </span>
                    </div>
                    {s.description && (
                      <div className="text-xs text-[#8E9BB0] mt-1 leading-snug line-clamp-2">{s.description}</div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {resultModal && (
        <SkillResultModal
          skill={resultModal.skill}
          runId={resultModal.runId}
          artifact={resultModal.artifact}
          projectId={project?.id}
          onClose={() => setResultModal(null)}
        />
      )}
      {teaserModalOpen && (
        <TeaserShareModal
          project={project}
          onClose={() => setTeaserModalOpen(false)}
        />
      )}
    </div>
  );
}

function sortSkill(skill) {
  const idx = STANDARD_SKILL_ORDER.indexOf(skill.id);
  if (idx >= 0) return idx;
  return 100;
}
