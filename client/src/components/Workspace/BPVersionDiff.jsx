import React, { useEffect, useState } from "react";
import workspaceProjectApi from "../../services/workspaceProjectApi";

const LABEL_MAP = {
  claimed_valuation: "估值",
  claimed_revenue: "收入",
  claimed_users: "用户数",
  funding_round: "融资轮次",
  funding_amount: "融资金额",
  total_score: "总分",
};

function fmt(v) {
  if (v == null) return "—";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}

export default function BPVersionDiff({ project }) {
  const versions = project?.versions || [];
  const [vA, setVA] = useState(versions[1]?.version_number);
  const [vB, setVB] = useState(versions[0]?.version_number);
  const [diff, setDiff] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!project || !vA || !vB || vA === vB) return;
    workspaceProjectApi
      .diffVersions(project.id, vA, vB)
      .then(setDiff)
      .catch((e) => setError(e.message));
  }, [project, vA, vB]);

  if (versions.length < 2) {
    return (
      <div className="text-[#8E9BB0] text-sm py-8">
        当前项目仅有 1 个版本，再上传一份新 BP 即可看到对比。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <select
          value={vA}
          onChange={(e) => setVA(parseInt(e.target.value, 10))}
          className="bg-white border border-[#D8DCE8] rounded px-2 py-1"
        >
          {versions.map((v) => (
            <option key={v.id} value={v.version_number}>
              v{v.version_number}
            </option>
          ))}
        </select>
        <span className="text-[#8E9BB0]">vs</span>
        <select
          value={vB}
          onChange={(e) => setVB(parseInt(e.target.value, 10))}
          className="bg-white border border-[#D8DCE8] rounded px-2 py-1"
        >
          {versions.map((v) => (
            <option key={v.id} value={v.version_number}>
              v{v.version_number}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="text-rose-400 text-sm">{error}</div>}

      {diff && (
        <table className="w-full text-sm border border-[#EEF1F7]">
          <thead className="bg-white text-[#4B5A72]">
            <tr>
              <th className="text-left px-3 py-2">指标</th>
              <th className="text-left px-3 py-2">v{vA}</th>
              <th className="text-left px-3 py-2">v{vB}</th>
              <th className="text-left px-3 py-2">变化</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(diff.changes).map(([key, c]) => (
              <tr
                key={key}
                className={
                  "border-t border-[#EEF1F7] " +
                  (c.changed ? "bg-white" : "")
                }
              >
                <td className="px-3 py-2 text-[#0F1C36]">{LABEL_MAP[key] || key}</td>
                <td className="px-3 py-2">{fmt(c.from)}</td>
                <td className="px-3 py-2">{fmt(c.to)}</td>
                <td className="px-3 py-2">
                  {!c.changed ? (
                    <span className="text-[#8E9BB0]">—</span>
                  ) : c.deltaPct != null ? (
                    <span
                      className={
                        c.deltaPct > 0 ? "text-emerald-400" : "text-rose-400"
                      }
                    >
                      {c.deltaPct > 0 ? "+" : ""}
                      {(c.deltaPct * 100).toFixed(0)}%
                    </span>
                  ) : (
                    <span className="text-amber-400">已变更</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {diff?.coreMetricsDiff?.length > 0 && (
        <div>
          <h4 className="text-sm text-[#4B5A72] mb-2">核心指标变化</h4>
          <ul className="space-y-1 text-sm">
            {diff.coreMetricsDiff.map((m) => (
              <li
                key={m.name}
                className="flex items-center gap-2 text-[#0F1C36]"
              >
                <span
                  className={
                    "px-1.5 py-0.5 rounded text-xs " +
                    (m.status === "added"
                      ? "bg-emerald-900 text-emerald-200"
                      : m.status === "removed"
                      ? "bg-rose-900 text-rose-200"
                      : "bg-[#EEF1F7] text-[#0F1C36]")
                  }
                >
                  {m.status === "added" ? "新增" : m.status === "removed" ? "删除" : "变更"}
                </span>
                <span>{m.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
