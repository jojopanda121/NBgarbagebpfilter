import React, { useState, useEffect, useCallback } from "react";
import { X, Download, RefreshCw, Loader2, FileText, Search } from "lucide-react";
import api from "../services/api";

/**
 * 一页投资亮点 PPT — 预览 + 可选微调 + 下载
 *
 * 整页所见即所得地按"投资要点速览"版式渲染：
 * 标题 / 红底标语 / 公司概况 + 市场机会双栏 / 投资亮点 ×4 / 投资风险 ×2 / 页脚
 */
export default function OnePagerModal({ taskId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [showOverrides, setShowOverrides] = useState(false);
  const [overrides, setOverrides] = useState({
    funding_round: "",
    valuation: "",
    flagship_customers: "",
    extra_milestones: "",
  });

  const fetchOnePager = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/api/projects/${taskId}/onepager`);
      setData(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchOnePager();
  }, [fetchOnePager]);

  const handleRegenerate = async (withOverrides = false) => {
    setRegenerating(true);
    setError(null);
    try {
      let res;
      if (withOverrides) {
        const cleaned = Object.fromEntries(
          Object.entries(overrides).filter(([, v]) => v && v.trim())
        );
        res = await api.post(`/api/projects/${taskId}/onepager`, {
          overrides: Object.keys(cleaned).length ? cleaned : null,
        });
      } else {
        res = await api.post(`/api/projects/${taskId}/onepager/regenerate`, {});
      }
      setData(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setRegenerating(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      await api.downloadBlob(`/api/projects/${taskId}/onepager/pptx`, "onepager.pptx");
    } catch (e) {
      setError(e.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative bg-slate-900 border border-white/10 rounded-2xl max-w-[1280px] w-full mt-8 mb-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部操作栏 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2 text-slate-200">
            <FileText className="w-4 h-4 text-amber-400" />
            <span className="font-semibold">一页投资亮点 PPT 预览</span>
            {data?.search_used && (
              <span className="ml-2 inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300 border border-emerald-700/40">
                <Search className="w-3 h-3" />
                已联网检索增强
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowOverrides((v) => !v)}
              className="px-3 py-1.5 text-sm bg-slate-800 hover:bg-slate-700 rounded-lg"
            >
              {showOverrides ? "收起微调" : "微调内容"}
            </button>
            <button
              onClick={() => handleRegenerate(false)}
              disabled={regenerating || loading}
              className="px-3 py-1.5 text-sm bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-lg flex items-center gap-1.5"
            >
              {regenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              重新生成
            </button>
            <button
              onClick={handleDownload}
              disabled={downloading || loading || !data}
              className="px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded-lg flex items-center gap-1.5 text-white"
            >
              {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              下载 .pptx
            </button>
            <button
              onClick={onClose}
              className="ml-1 p-1.5 hover:bg-slate-800 rounded-lg"
              aria-label="关闭"
            >
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>
        </div>

        {/* 可选微调表单 */}
        {showOverrides && (
          <div className="px-5 py-4 border-b border-white/10 bg-slate-950/40">
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="本轮轮次（可选）"
                value={overrides.funding_round}
                onChange={(v) => setOverrides({ ...overrides, funding_round: v })}
                placeholder="如 A 轮 / Pre-A"
              />
              <Field
                label="本轮估值或拟融资金额（可选）"
                value={overrides.valuation}
                onChange={(v) => setOverrides({ ...overrides, valuation: v })}
                placeholder="如 12 亿（投后） / 募集 1.5 亿"
              />
              <Field
                label="标杆客户（可选，逗号分隔）"
                value={overrides.flagship_customers}
                onChange={(v) => setOverrides({ ...overrides, flagship_customers: v })}
                placeholder="如 中国移动, 招商银行, 字节跳动"
              />
              <Field
                label="关键里程碑（可选）"
                value={overrides.extra_milestones}
                onChange={(v) => setOverrides({ ...overrides, extra_milestones: v })}
                placeholder="如 2025.03 海外首单"
              />
            </div>
            <div className="mt-3 text-right">
              <button
                onClick={() => handleRegenerate(true)}
                disabled={regenerating}
                className="px-4 py-1.5 text-sm bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded-lg text-white"
              >
                {regenerating ? "生成中..." : "应用微调并重生成"}
              </button>
            </div>
          </div>
        )}

        {/* 主体 */}
        <div className="p-5">
          {loading && (
            <div className="flex items-center justify-center py-20 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              正在结合多 Agent 分析与公开资料生成一页 PPT...
            </div>
          )}

          {error && !loading && (
            <div className="text-center py-12">
              <p className="text-red-400 mb-3">{error}</p>
              <button
                onClick={fetchOnePager}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm"
              >
                重试
              </button>
            </div>
          )}

          {!loading && !error && data?.json && <OnePagerPreview json={data.json} />}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="block text-xs text-slate-400 mb-1">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-1.5 bg-slate-900 border border-white/10 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-amber-500"
      />
    </label>
  );
}

/** 按 PPT 版式所见即所得地预览 JSON（米白底 + 红底标语 + 双栏 + 亮点 + 风险） */
function OnePagerPreview({ json }) {
  const o = json.company_overview || {};
  const m = json.market_opportunity || {};
  const f = json.footer || {};
  return (
    <div
      className="mx-auto rounded-lg shadow-lg overflow-hidden"
      style={{
        width: "100%",
        maxWidth: 1200,
        aspectRatio: "16 / 9",
        background: "#FAF7F2",
        color: "#1A1A1A",
        fontFamily: "'Microsoft YaHei','PingFang SC',sans-serif",
      }}
    >
      <div style={{ padding: "26px 32px 14px", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
        {/* 标题 + 金线 */}
        <div style={{ fontSize: 22, fontWeight: 700, color: "#8B6F3F" }}>
          投资要点速览——{json.company_name}
        </div>
        <div style={{ height: 2, background: "#C9A96E", margin: "8px 0 12px" }} />

        {/* 红底标语 */}
        <div
          style={{
            background: "#A8292A",
            color: "#fff",
            fontSize: 16,
            fontWeight: 700,
            padding: "10px 14px",
            borderRadius: 2,
          }}
        >
          {json.headline}
        </div>

        {/* 双栏 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 14 }}>
          {/* 左：公司概况 */}
          <div>
            <SectionLabel>公司概况</SectionLabel>
            <div style={{ border: "1px dashed #C9A96E", padding: 12, borderRadius: 4, fontSize: 12.5, lineHeight: 1.6 }}>
              <div style={{ marginBottom: 10 }}>{o.summary}</div>
              {(o.products || []).slice(0, 3).map((p, i) => (
                <div key={i} style={{ marginTop: 6, lineHeight: 1.55 }}>
                  <span style={{ color: "#C23B3B", fontWeight: 700 }}>{p.name}：</span>
                  <span>{p.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 右：市场机会 */}
          <div>
            <SectionLabel>市场机会与行业速览</SectionLabel>
            <div style={{ border: "1px dashed #C9A96E", padding: 12, borderRadius: 4 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 8 }}>
                {(m.kpis || []).slice(0, 4).map((k, i) => (
                  <div key={i} style={{ textAlign: "center", padding: "4px 2px" }}>
                    <div style={{ fontSize: 11, color: "#666" }}>{k.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#C23B3B", marginTop: 2 }}>{k.value}</div>
                  </div>
                ))}
              </div>
              {(m.drivers || []).slice(0, 3).map((d, i) => (
                <div key={i} style={{ fontSize: 11.5, lineHeight: 1.55, marginTop: 3 }}>
                  <span style={{ color: "#C23B3B", fontWeight: 700 }}>〔{d.type}〕</span>{" "}
                  <span>{d.text}</span>
                </div>
              ))}
              <div style={{ fontSize: 11.5, lineHeight: 1.55, marginTop: 6 }}>
                <span style={{ color: "#C23B3B", fontWeight: 700 }}>〔竞争格局〕</span>{" "}
                <span>{m.competition}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 投资亮点 */}
        <div style={{ marginTop: 12 }}>
          <SectionLabel>投资亮点</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {(json.highlights || []).slice(0, 4).map((h, i) => (
              <div key={i}>
                <div style={{ color: "#C23B3B", fontWeight: 700, fontSize: 13 }}>· {h.title}</div>
                <div style={{ color: "#1A1A1A", fontSize: 11.5, lineHeight: 1.5, paddingLeft: 12, marginTop: 2 }}>
                  {h.desc}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 投资风险 */}
        <div
          style={{
            marginTop: "auto",
            background: "#EEEAE2",
            padding: "8px 12px",
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            fontSize: 11.5,
            lineHeight: 1.5,
          }}
        >
          <div style={{ color: "#C23B3B", fontWeight: 700, minWidth: 64 }}>投资风险</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, flex: 1 }}>
            {(json.risks || []).slice(0, 2).map((r, i) => (
              <div key={i}>
                <span style={{ color: "#C23B3B", fontWeight: 700 }}>{r.title}：</span>
                <span>{r.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 页脚 */}
        <div style={{ marginTop: 6, fontSize: 10.5, color: "#555" }}>
          成立年份 {f.founded}　·　团队规模 {f.team_size}　·　累计融资 {f.funding_total}　·　{f.ai_grade}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div
      style={{
        background: "#F1E9DB",
        color: "#C23B3B",
        fontWeight: 700,
        fontSize: 13,
        padding: "4px 10px",
        display: "inline-block",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}
