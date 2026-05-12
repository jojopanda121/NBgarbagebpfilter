// ============================================================
// SkillsPanel — 项目页右侧的 skill 一键调用面板
// 列出所有已注册 skill,点击 → 弹参数 → 调用 → 渲染产物
// ============================================================

import React, { useEffect, useMemo, useState } from "react";
import skillsApi from "../../services/skillsApi";
import TeaserShareModal from "./TeaserShareModal";
import SkillResultModal from "./SkillResultModal";

const CATEGORY_LABELS = {
  report: "报告 / 文档",
  research: "研究 / 尽调",
  memo: "投决 / 内部",
  share: "分享 / Teaser",
};
const CATEGORY_ORDER = ["report", "research", "memo", "share"];

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
      const cat = s.category || "report";
      (buckets[cat] = buckets[cat] || []).push(s);
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
      setResultModal({ skill, runId: out.runId, artifact: out.artifact });
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
                    <div className="flex items-center justify-between">
                      <span>{s.title}</span>
                      {busy && <span className="text-xs text-[#8E9BB0]">运行中…</span>}
                    </div>
                    {s.description && (
                      <div className="text-xs text-[#8E9BB0] mt-1 leading-snug">{s.description}</div>
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
