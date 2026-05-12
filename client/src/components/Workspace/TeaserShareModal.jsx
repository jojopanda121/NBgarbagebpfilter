// ============================================================
// TeaserShareModal — 创建加密 teaser 分享链接 + 管理已有分享
// 用户体验:
//   1) 表单填收件人备注/有效期/最大次数
//   2) 提交 → teaser_share skill → 拿回 token + password
//   3) 一并展示已有 share 列表(可撤销 / 看访问日志)
// ============================================================

import React, { useEffect, useState, useCallback } from "react";
import skillsApi from "../../services/skillsApi";

export default function TeaserShareModal({ project, onClose }) {
  const [form, setForm] = useState({
    recipient_label: "",
    ttl_hours: 168,
    max_views: "",
    password: "",
    watermark_text: "",
    tone: "concise",
    hide_geo: false,
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);   // { token, password, url, expires_at }
  const [shares, setShares] = useState([]);
  const [accessLog, setAccessLog] = useState(null); // { token, entries }

  const refreshShares = useCallback(async () => {
    try {
      const r = await skillsApi.listTeaserShares(project.id);
      setShares(r.shares || []);
    } catch (e) {
      // 无项目权限,忽略
    }
  }, [project?.id]);

  useEffect(() => { refreshShares(); }, [refreshShares]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.recipient_label.trim()) {
      setError("请填写收件人备注");
      return;
    }
    setCreating(true);
    setError("");
    try {
      // 直接调 teaser_share — 不传 teaser_payload 让后端现场生成
      const out = await skillsApi.run("teaser_share", {
        projectId: project.id,
        params: {
          recipient_label: form.recipient_label.trim(),
          ttl_hours: Number(form.ttl_hours) || 168,
          ...(form.max_views ? { max_views: Number(form.max_views) } : {}),
          ...(form.password ? { password: form.password } : {}),
          ...(form.watermark_text ? { watermark_text: form.watermark_text } : {}),
        },
      });
      if (!out.ok) {
        setError(out.error || "创建失败");
        return;
      }
      const p = out.artifact?.payload || {};
      const fullUrl = `${window.location.origin}${p.url_path}`;
      setCreated({ ...p, fullUrl });
      refreshShares();
    } catch (e) {
      setError(e.message || "网络错误");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(token) {
    if (!window.confirm("撤销后该链接立即失效,无法恢复。继续?")) return;
    try {
      await skillsApi.revokeTeaserShare(token);
      refreshShares();
    } catch (e) {
      setError(e.message);
    }
  }

  async function showAccessLog(token) {
    try {
      const r = await skillsApi.teaserAccessLog(token);
      setAccessLog({ token, entries: r.entries || [] });
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-[#EEF1F7]">
          <div>
            <div className="text-sm font-medium text-[#0D2145]">脱敏 Teaser 分享</div>
            <div className="text-xs text-[#8E9BB0]">{project?.name}</div>
          </div>
          <button onClick={onClose} className="text-[#8E9BB0] hover:text-[#0F1C36] text-xl">×</button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {error && (
            <div className="text-xs text-rose-500 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">{error}</div>
          )}

          {!created && (
            <form onSubmit={handleCreate} className="space-y-3 text-sm">
              <Field label="收件人备注 *" hint="只你看,如:发给红杉张三">
                <input
                  className="w-full border border-[#EEF1F7] rounded px-2 py-1.5"
                  value={form.recipient_label}
                  onChange={(e) => setForm({ ...form, recipient_label: e.target.value })}
                  placeholder="发给XX机构"
                  required
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="有效期(小时)">
                  <input
                    type="number"
                    min="1"
                    max="720"
                    className="w-full border border-[#EEF1F7] rounded px-2 py-1.5"
                    value={form.ttl_hours}
                    onChange={(e) => setForm({ ...form, ttl_hours: e.target.value })}
                  />
                </Field>
                <Field label="最大阅读次数(可空)">
                  <input
                    type="number"
                    min="1"
                    className="w-full border border-[#EEF1F7] rounded px-2 py-1.5"
                    value={form.max_views}
                    onChange={(e) => setForm({ ...form, max_views: e.target.value })}
                    placeholder="不限"
                  />
                </Field>
              </div>
              <Field label="密码(可空,自动生成)">
                <input
                  className="w-full border border-[#EEF1F7] rounded px-2 py-1.5"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="留空 = 自动生成 8 字符"
                />
              </Field>
              <Field label="水印文本(可空)">
                <input
                  className="w-full border border-[#EEF1F7] rounded px-2 py-1.5"
                  value={form.watermark_text}
                  onChange={(e) => setForm({ ...form, watermark_text: e.target.value })}
                  placeholder="如收件人邮箱后缀,显示在 teaser 页角"
                />
              </Field>
              <button
                type="submit"
                disabled={creating}
                className="w-full px-3 py-2 rounded bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-60"
              >
                {creating ? "正在脱敏并加密…" : "生成加密分享链接"}
              </button>
            </form>
          )}

          {created && (
            <div className="border border-emerald-300 bg-emerald-50 rounded p-3 space-y-2 text-sm">
              <div className="font-medium text-[#0D2145]">链接已生成,请尽快保存以下信息:</div>
              <KV k="链接" v={<a href={created.fullUrl} target="_blank" rel="noreferrer" className="text-emerald-700 underline break-all">{created.fullUrl}</a>} />
              <KV k="密码" v={<code className="bg-white px-2 py-0.5 rounded border">{created.password}</code>} />
              <KV k="过期" v={created.expires_at || "永久"} />
              {created.max_views && <KV k="次数" v={`${created.max_views} 次`} />}
              <div className="text-xs text-[#8E9BB0] pt-2">
                密码仅此一次显示,关闭后服务器只保留 hash。请用 IM/邮件分别发送链接和密码。
              </div>
              <button
                onClick={() => setCreated(null)}
                className="text-xs text-[#0F1C36] hover:underline mt-1"
              >
                创建另一条
              </button>
            </div>
          )}

          {/* 已有分享列表 */}
          <div>
            <div className="text-xs font-medium text-[#0D2145] mb-2">该项目已有的分享</div>
            {shares.length === 0 ? (
              <div className="text-xs text-[#8E9BB0]">暂无</div>
            ) : (
              <ul className="space-y-1.5">
                {shares.map((s) => {
                  const isRevoked = !!s.revoked_at;
                  const isExpired = s.expires_at && new Date(s.expires_at.replace(" ", "T") + "Z") < new Date();
                  const isExhausted = s.max_views != null && s.view_count >= s.max_views;
                  const dead = isRevoked || isExpired || isExhausted;
                  return (
                    <li key={s.id} className="border border-[#EEF1F7] rounded px-2.5 py-2 text-xs flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-[#0F1C36] truncate">{s.recipient_label || "(未备注)"}</div>
                        <div className="text-[#8E9BB0] mt-0.5">
                          {s.view_count}/{s.max_views || "∞"} · 过期 {s.expires_at || "—"}
                          {isRevoked && " · 已撤销"}
                          {isExpired && !isRevoked && " · 已过期"}
                          {isExhausted && !isRevoked && !isExpired && " · 已达上限"}
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          className="text-[#0F1C36] hover:underline"
                          onClick={() => showAccessLog(s.id)}
                        >
                          访问记录
                        </button>
                        {!dead && (
                          <button
                            className="text-rose-600 hover:underline"
                            onClick={() => handleRevoke(s.id)}
                          >
                            撤销
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {accessLog && (
            <div className="border border-[#EEF1F7] rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-medium text-[#0D2145]">访问记录 — {accessLog.token}</div>
                <button onClick={() => setAccessLog(null)} className="text-xs text-[#8E9BB0]">关闭</button>
              </div>
              {accessLog.entries.length === 0 ? (
                <div className="text-xs text-[#8E9BB0]">暂无访问</div>
              ) : (
                <ul className="text-xs space-y-1 max-h-60 overflow-y-auto">
                  {accessLog.entries.map((e, i) => (
                    <li key={i} className="text-[#0F1C36]">
                      <span className="text-[#8E9BB0]">{e.viewed_at}</span> · {e.outcome} · {e.ip || "?"} · <span className="text-[#8E9BB0]">{(e.user_agent || "").slice(0, 50)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <div className="text-xs text-[#0D2145] mb-1">{label}{hint && <span className="text-[#8E9BB0] ml-1">— {hint}</span>}</div>
      {children}
    </label>
  );
}

function KV({ k, v }) {
  return (
    <div className="flex items-baseline gap-3 text-xs">
      <span className="text-[#8E9BB0] w-12 shrink-0">{k}</span>
      <span className="text-[#0F1C36] flex-1 break-all">{v}</span>
    </div>
  );
}
