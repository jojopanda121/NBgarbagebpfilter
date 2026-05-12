// ============================================================
// PublicTeaserPage — /teaser/:token (无需登录)
// 收件人输入密码 → 解密 teaser → 渲染脱敏后的项目要点
// ============================================================

import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { API_BASE } from "../constants";

export default function PublicTeaserPage() {
  const { token } = useParams();
  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState("");
  const [password, setPassword] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/teaser/${encodeURIComponent(token)}/meta`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          setMetaError(body.error || "链接无效");
        } else {
          setMeta(body);
        }
      })
      .catch(() => setMetaError("网络错误"));
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const resp = await fetch(`${API_BASE}/api/teaser/${encodeURIComponent(token)}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setError(body.error || "无法访问");
        return;
      }
      setData(body);
    } catch (e) {
      setError("网络错误");
    } finally {
      setSubmitting(false);
    }
  }

  if (metaError) {
    return (
      <Centered>
        <h1 className="text-xl text-rose-500 font-medium">{metaError}</h1>
        <p className="text-sm text-[#8E9BB0] mt-2">请联系发件人确认链接是否有效。</p>
      </Centered>
    );
  }
  if (!meta) {
    return <Centered><div className="text-[#8E9BB0]">加载中…</div></Centered>;
  }

  if (!data) {
    return (
      <Centered>
        <div className="bg-white rounded-lg shadow-sm border border-[#EEF1F7] p-8 max-w-md w-full">
          <h1 className="text-lg font-medium text-[#0D2145] mb-1">脱敏 Teaser</h1>
          <p className="text-xs text-[#8E9BB0] mb-5">
            该链接需要密码访问。
            {meta.expires_at && <span> 过期时间: {meta.expires_at}.</span>}
            {meta.views_remaining != null && <span> 剩余 {meta.views_remaining} 次。</span>}
          </p>
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入访问密码"
              className="w-full border border-[#EEF1F7] rounded px-3 py-2 text-sm"
              autoFocus
              required
            />
            {error && <div className="text-xs text-rose-500">{error}</div>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full px-3 py-2 rounded bg-[#0D2145] text-white text-sm hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? "正在解密…" : "查看 Teaser"}
            </button>
          </form>
        </div>
      </Centered>
    );
  }

  return <TeaserView data={data} />;
}

function TeaserView({ data }) {
  const t = data.payload || {};
  return (
    <div className="min-h-screen bg-[#FAF7F2] py-10 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-lg border border-[#EEF1F7] shadow-sm relative overflow-hidden">
        {data.watermark && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="text-[#0D2145] opacity-[0.06] text-5xl font-bold rotate-[-30deg] whitespace-nowrap select-none">
              {data.watermark}
            </div>
          </div>
        )}
        <div className="relative p-8 space-y-6">
          <header className="border-b border-[#EEF1F7] pb-4">
            <div className="text-xs uppercase tracking-wide text-[#8B6F3F]">Project</div>
            <h1 className="text-2xl font-medium text-[#0D2145] mt-1">{t.codename}</h1>
            <p className="text-sm text-[#4B5A72] mt-2">{t.headline}</p>
            <div className="text-xs text-[#8E9BB0] mt-2 space-x-3">
              {t.sector && <span>赛道: {t.sector}</span>}
              {t.stage && <span>阶段: {t.stage}</span>}
              {t.geo && <span>地区: {t.geo}</span>}
            </div>
          </header>

          {t.why_now && (
            <Section title="Why Now">
              <p className="text-sm text-[#0F1C36] leading-relaxed">{t.why_now}</p>
            </Section>
          )}

          {Array.isArray(t.highlights) && t.highlights.length > 0 && (
            <Section title="Highlights">
              <ul className="space-y-2">
                {t.highlights.map((h, i) => (
                  <li key={i} className="border-l-2 border-[#C9A96E] pl-3">
                    <div className="text-sm font-medium text-[#0D2145]">{h.title}</div>
                    <div className="text-sm text-[#4B5A72] mt-0.5">{h.desc}</div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {t.metrics_band && (
            <Section title="Traction(区间)">
              <div className="grid grid-cols-2 gap-3 text-sm">
                {t.metrics_band.arr_band_rmb && <KV k="ARR 区间" v={t.metrics_band.arr_band_rmb} />}
                {t.metrics_band.valuation_band_rmb && <KV k="估值区间" v={t.metrics_band.valuation_band_rmb} />}
                {t.metrics_band.team_size_band && <KV k="团队规模" v={t.metrics_band.team_size_band} />}
                {t.metrics_band.traction_note && <KV k="进展" v={t.metrics_band.traction_note} />}
              </div>
            </Section>
          )}

          {t.team_brief && (
            <Section title="Team(脱敏)">
              <p className="text-sm text-[#0F1C36]">{t.team_brief}</p>
            </Section>
          )}

          {t.ask && (
            <Section title="Ask">
              <div className="text-sm text-[#0F1C36]">
                <div>{t.ask.round} · {t.ask.amount_band_rmb}</div>
                {Array.isArray(t.ask.use_of_funds) && (
                  <ul className="mt-2 space-y-1">
                    {t.ask.use_of_funds.map((u, i) => (
                      <li key={i} className="text-[#4B5A72]">· {u}</li>
                    ))}
                  </ul>
                )}
              </div>
            </Section>
          )}

          {Array.isArray(t.investor_fit) && t.investor_fit.length > 0 && (
            <Section title="适合的投资方画像">
              <ul className="text-sm text-[#4B5A72] space-y-1">
                {t.investor_fit.map((f, i) => <li key={i}>· {f}</li>)}
              </ul>
            </Section>
          )}

          <footer className="text-[10px] text-[#8E9BB0] pt-4 border-t border-[#EEF1F7]">
            {t.redacted_disclaimer || "本材料为脱敏 Teaser,所有数字与名称已去标识化。如需深入了解,请通过发件人对接并签署 NDA。"}
            {data.meta?.view_count != null && (
              <span> · 已查看 {data.meta.view_count}{data.meta.max_views ? ` / ${data.meta.max_views}` : ""} 次</span>
            )}
          </footer>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section>
      <div className="text-[11px] uppercase tracking-wide text-[#8B6F3F] mb-2">{title}</div>
      {children}
    </section>
  );
}

function KV({ k, v }) {
  return (
    <div>
      <div className="text-xs text-[#8E9BB0]">{k}</div>
      <div className="text-[#0F1C36]">{v}</div>
    </div>
  );
}

function Centered({ children }) {
  return (
    <div className="min-h-screen bg-[#FAF7F2] flex items-center justify-center px-4">
      <div className="text-center">{children}</div>
    </div>
  );
}
