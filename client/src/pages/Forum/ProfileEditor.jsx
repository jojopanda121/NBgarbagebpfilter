// ProfileEditor — 编辑论坛身份资料（投资人/项目方/FA 标签 + 名片）
// 也被「个人中心」复用。
import React, { useEffect, useState } from "react";
import { Loader2, Check } from "lucide-react";
import forumApi from "../../services/forumApi";
import useAuthStore from "../../store/useAuthStore";
import { USER_TYPE_OPTIONS } from "../../constants/forum";

export default function ProfileEditor({ onSaved }) {
  const refreshAuth = useAuthStore((s) => s.initAuth);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    forumApi.getMyProfile()
      .then((p) => setForm({
        user_type: p.user_type || "unset",
        display_name: p.display_name || "",
        org_name: p.org_name || "",
        bio: p.bio || "",
        contact_card: p.contact_card || "",
      }))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

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

  return (
    <div className="space-y-5 max-w-lg">
      {error && <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded px-2.5 py-1.5">{error}</div>}

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
