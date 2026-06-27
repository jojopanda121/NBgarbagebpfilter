// UnlockedReportModal — 查看「授权解锁」的完整评分报告。
// 内容由后端从平台报告现取并自动脱敏(发帖人不可改),带水印可追溯。
// 严肃区:不放任何卡通/表情。
import React, { useEffect, useState } from "react";
import { X, Loader2, ShieldCheck, AlertTriangle, Sparkles } from "lucide-react";
import forumApi from "../../services/forumApi";

function arr(v) { return Array.isArray(v) ? v : []; }

export default function UnlockedReportModal({ postId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try { const r = await forumApi.getUnlockedReport(postId); if (alive) setData(r); }
      catch (e) { if (alive) setErr(e.message || "无法加载报告"); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [postId]);

  const v = data?.verdict || {};
  const dims = v.dimensions && typeof v.dimensions === "object" ? v.dimensions : null;
  const claims = arr(v.claim_verdicts);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-auto py-8 px-3" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#EEF1F7]">
          <div className="text-sm font-semibold text-[#0D2145]">完整评分报告</div>
          <button onClick={onClose} className="text-[#8E9BB0] hover:text-[#0D2145]"><X className="w-5 h-5" /></button>
        </div>

        {loading ? (
          <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-[#8E9BB0]" /></div>
        ) : err ? (
          <div className="py-16 text-center text-sm text-[#8E9BB0]">{err}</div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            {/* 水印 / 可信锚点 */}
            <div className="flex items-center gap-2 text-[11px] text-[#0F8A5F] bg-[#E7F6EF] border border-[#CDEBDD] rounded-lg px-3 py-2">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>
                平台实测报告,发帖人不可改 · 已分享给 <b>{data?.watermark?.shared_to}</b> · {data?.watermark?.date}
              </span>
            </div>

            {/* 分数 */}
            <div className="flex items-end gap-3">
              {v.total_score != null && <div className="text-3xl font-bold text-[#0D2145]">{v.total_score}</div>}
              {v.grade && <div className="text-sm text-[#4B5A72] pb-1">{v.grade} · {v.grade_label || ""}</div>}
            </div>
            {v.verdict_summary && <p className="text-sm text-[#0D2145] leading-relaxed">{v.verdict_summary}</p>}

            {/* 亮点 */}
            {arr(v.strengths).length > 0 && (
              <Block icon={<Sparkles className="w-4 h-4 text-[#1B7A46]" />} title="亮点">
                <ul className="space-y-1">
                  {arr(v.strengths).map((s, i) => <li key={i} className="text-sm text-[#0D2145]">· {String(s)}</li>)}
                </ul>
              </Block>
            )}

            {/* 风险旗标(强制全带,醒目) */}
            {arr(v.risk_flags).length > 0 && (
              <Block icon={<AlertTriangle className="w-4 h-4 text-[#B45309]" />} title={`风险旗标 (${arr(v.risk_flags).length})`}>
                <ul className="space-y-1">
                  {arr(v.risk_flags).map((s, i) => (
                    <li key={i} className="text-sm text-[#9A3412] bg-[#FBF1E3] border border-[#F0DCC0] rounded px-2 py-1">{String(s)}</li>
                  ))}
                </ul>
              </Block>
            )}

            {/* 维度拆解 */}
            {dims && (
              <Block title="维度拆解">
                <div className="space-y-1.5">
                  {Object.entries(dims).map(([k, d]) => (
                    <div key={k} className="flex items-start justify-between gap-3 text-sm border-b border-[#F2F4F9] pb-1.5">
                      <div className="text-[#0D2145] font-medium">{k}</div>
                      <div className="text-right">
                        {d && d.score != null && <span className="text-[#1B4FD8] font-semibold">{d.score}</span>}
                        {d && (d.note || d.summary) && <div className="text-xs text-[#4B5A72] mt-0.5 max-w-sm">{d.note || d.summary}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </Block>
            )}

            {/* 声明核查 */}
            {claims.length > 0 && (
              <Block title={`声明核查 (${claims.length})`}>
                <div className="space-y-1.5">
                  {claims.map((c, i) => (
                    <div key={i} className="text-sm border-b border-[#F2F4F9] pb-1.5">
                      <span className="text-[#0D2145]">{c.claim || c.statement || `声明 ${i + 1}`}</span>
                      {c.verdict && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-[#EEF1F7] text-[#4B5A72]">{c.verdict}</span>}
                    </div>
                  ))}
                </div>
              </Block>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Block({ icon, title, children }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-semibold text-[#0D2145] mb-1.5">{icon}{title}</div>
      {children}
    </div>
  );
}
