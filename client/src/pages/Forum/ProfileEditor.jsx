// ProfileEditor — 编辑论坛身份资料（投资人/项目方/FA 标签 + 名片 + 头像 + 徽章展示）
// 也被「个人中心」复用。
import React, { useEffect, useRef, useState } from "react";
import { Loader2, Check, Camera, Lock } from "lucide-react";
import forumApi from "../../services/forumApi";
import useAuthStore from "../../store/useAuthStore";
import { USER_TYPE_OPTIONS } from "../../constants/forum";
import Avatar from "../../components/forum/Avatar";

export default function ProfileEditor({ onSaved }) {
  const refreshAuth = useAuthStore((s) => s.initAuth);
  const me = useAuthStore((s) => s.user);
  const fileRef = useRef(null);
  const [form, setForm] = useState(null);
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [badges, setBadges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    forumApi.getMyProfile()
      .then((p) => {
        setForm({
          user_type: p.user_type || "unset",
          display_name: p.display_name || "",
          org_name: p.org_name || "",
          bio: p.bio || "",
          contact_card: p.contact_card || "",
        });
        setAvatarUrl(p.avatar_url || null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // 完整徽章目录（含未解锁）
    forumApi.getMyBadges().then((r) => setBadges(r.badges || [])).catch(() => {});
  }, []);

  async function onPickAvatar(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const r = await forumApi.uploadAvatar(file);
      setAvatarUrl(r.avatar_url);
      refreshAuth?.();
    } catch (err) {
      setError(err.message || "头像上传失败");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function toggleBadge(badge) {
    if (!badge.is_current) return; // 只有「当前所持等级」的徽章可挂出/收起
    try {
      const r = await forumApi.setBadgeDisplay(badge.code, !badge.displayed);
      setBadges(r.badges || []);
    } catch (err) {
      setError(err.message || "操作失败");
    }
  }

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await forumApi.updateMyProfile(form);
      setSaved(true);
      refreshAuth?.();           // 同步 header 里的身份
      onSaved?.();
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !form) return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[#8E9BB0]" /></div>;

  const displayName = form.display_name || me?.username;

  return (
    <div className="space-y-5 max-w-lg">
      {error && <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded px-2.5 py-1.5">{error}</div>}

      {/* 头像 */}
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => fileRef.current?.click()}
          className="relative group rounded-full" title="点击更换头像">
          <Avatar src={avatarUrl} name={displayName} id={me?.id} size="lg" />
          <span className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/35 flex items-center justify-center transition-colors">
            {uploading
              ? <Loader2 className="w-5 h-5 text-white animate-spin" />
              : <Camera className="w-5 h-5 text-white opacity-0 group-hover:opacity-100" />}
          </span>
        </button>
        <div className="text-xs text-[#8E9BB0]">
          点击头像上传<br />支持 png/jpg/webp/gif，≤ 2MB
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onPickAvatar} />
      </div>

      {/* 身份选择 */}
      <div>
        <div className="text-xs font-semibold text-[#0D2145] mb-2">我的身份</div>
        <div className="space-y-2">
          {USER_TYPE_OPTIONS.map((opt) => (
            <button key={opt.value} onClick={() => setForm({ ...form, user_type: opt.value })}
              className={`w-full text-left px-3 py-2.5 rounded-lg border flex items-center justify-between ${
                form.user_type === opt.value ? "border-[#1B4FD8] bg-[#EEF1F7]" : "border-[#D8DCE8] hover:border-[#B9C2D6]"
              }`}>
              <div>
                <div className="text-sm font-medium text-[#0D2145]">{opt.label}</div>
                <div className="text-[11px] text-[#8E9BB0]">{opt.desc}</div>
              </div>
              {form.user_type === opt.value && <Check className="w-4 h-4 text-[#1B4FD8]" />}
            </button>
          ))}
        </div>
      </div>

      <Field label="论坛展示名" hint="留空则用账号名">
        <input className="w-full border border-[#D8DCE8] rounded-lg px-3 py-2 text-sm"
          value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} maxLength={60} />
      </Field>
      <Field label="机构 / 公司名" hint="选填，会显示在帖子和主页">
        <input className="w-full border border-[#D8DCE8] rounded-lg px-3 py-2 text-sm"
          value={form.org_name} onChange={(e) => setForm({ ...form, org_name: e.target.value })} maxLength={100} />
      </Field>
      <Field label="一句话简介" hint="选填">
        <input className="w-full border border-[#D8DCE8] rounded-lg px-3 py-2 text-sm"
          value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} maxLength={300} />
      </Field>
      <Field label="名片 / 联系方式" hint="仅在撮合双方确认后互相可见，不会公开展示">
        <input className="w-full border border-[#D8DCE8] rounded-lg px-3 py-2 text-sm"
          value={form.contact_card} onChange={(e) => setForm({ ...form, contact_card: e.target.value })} maxLength={500}
          placeholder="如：微信 abc123 / 邮箱 you@vc.com" />
      </Field>

      {/* 徽章：根据 BP 分析自动获得，自选挂出展示。全目录展示，未解锁灰显。 */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-[#0D2145]">我的徽章</span>
          {badges.length > 0 && (
            <span className="text-[11px] text-[#8E9BB0]">已解锁 {badges.filter((b) => b.earned).length} / {badges.length}</span>
          )}
        </div>
        <div className="text-[11px] text-[#8E9BB0] mb-2">根据你分析过的 BP 自动授予。点击已解锁徽章切换「挂出/收起」，挂出的会显示在帖子与主页。</div>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(108px, 1fr))" }}>
          {badges.map((b) => {
            const clickable = b.is_current;
            return (
              <button key={b.code + "_" + b.tier} type="button" onClick={() => toggleBadge(b)}
                disabled={!clickable} title={b.earned ? (b.desc || b.req) : `未解锁 · ${b.req}`}
                className={`relative text-center rounded-lg border p-2.5 ${clickable ? "cursor-pointer" : "cursor-default"} ${
                  b.displayed ? "border-2" : "border-[#EEF1F7]"
                }`}
                style={b.displayed ? { borderColor: b.color } : undefined}>
                {b.displayed && (
                  <span className="absolute top-1 right-1 text-[9px] px-1.5 rounded-full text-white" style={{ backgroundColor: b.color }}>展示中</span>
                )}
                <div className="relative w-12 h-12 mx-auto mb-1">
                  <img src={b.image} alt={b.name}
                    className="w-12 h-12 object-contain"
                    style={b.earned ? undefined : { filter: "grayscale(1)", opacity: 0.45 }} />
                  {!b.earned && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-white border border-[#E6E9F0] flex items-center justify-center">
                      <Lock className="w-2.5 h-2.5 text-[#8E9BB0]" />
                    </span>
                  )}
                </div>
                <div className={`text-[11px] font-medium leading-tight ${b.earned ? "text-[#0D2145]" : "text-[#8E9BB0]"}`}>{b.name}</div>
                <div className="text-[10px] text-[#8E9BB0] mt-0.5 leading-tight">{b.earned ? (b.desc || b.req) : b.req}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="px-5 py-2 text-sm bg-[#1B4FD8] hover:bg-[#163069] disabled:opacity-60 text-white rounded-lg font-semibold flex items-center gap-1.5">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} 保存
        </button>
        {saved && <span className="text-xs text-[#0F8A5F] flex items-center gap-1"><Check className="w-3.5 h-3.5" /> 已保存</span>}
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <div className="text-xs text-[#0D2145] mb-1">{label}{hint && <span className="text-[#8E9BB0] ml-1.5">— {hint}</span>}</div>
      {children}
    </label>
  );
}
