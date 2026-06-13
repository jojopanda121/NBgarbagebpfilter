// NewDiscussionModal — 发纯文字帖（行业讨论 / 找钱找项目）
// 评分帖不走这里——评分帖必须从分析结果页「转发到论坛」(ShareToForumModal)，
// 以保证分数为平台实测快照。
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, Loader2 } from "lucide-react";
import forumApi from "../../services/forumApi";
import ForumDisclaimer from "../../components/forum/ForumDisclaimer";
import { FORUM_CATEGORIES } from "../../constants/forum";

export default function NewDiscussionModal({ onClose, onCreated }) {
  // 纯文字帖只能选 讨论 / 找钱找项目（评分帖走「转发到论坛」）
  // 注意：在组件内计算，避免模块顶层访问导入常量引发 HMR 下的 TDZ
  const CATS = FORUM_CATEGORIES.filter((c) => c.key !== "project");
  const navigate = useNavigate();
  const [category, setCategory] = useState("discussion");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [allowContact] = useState(true);   // 纯文字帖默认开放撮合
  const [publicContact, setPublicContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!title.trim()) { setError("请填写标题"); return; }
    setSubmitting(true);
    setError("");
    try {
      const post = await forumApi.createPost({
        category, title: title.trim(), body,
        allow_contact: allowContact,
        public_contact: publicContact.trim() || undefined,
      });
      onCreated?.();
      navigate(`/forum/post/${post.id}`);
    } catch (e) {
      setError(e.message || "发布失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-lg w-full max-w-xl max-h-[92vh] flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 border-b border-[#EEF1F7]">
          <div className="text-sm font-semibold text-[#0D2145]">发帖</div>
          <button onClick={onClose} className="text-[#8E9BB0] hover:text-[#0F1C36]"><X className="w-5 h-5" /></button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {error && <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded px-2.5 py-1.5">{error}</div>}

          <div className="grid grid-cols-2 gap-2">
            {CATS.map((c) => (
              <button key={c.key} onClick={() => setCategory(c.key)}
                className={`text-left px-3 py-2 rounded-lg border ${category === c.key ? "border-[#1B4FD8] bg-[#EEF1F7]" : "border-[#D8DCE8]"}`}>
                <div className="text-sm font-medium text-[#0D2145] flex items-center gap-1.5"><c.Icon className="w-4 h-4" /> {c.label}</div>
                <div className="text-[11px] text-[#8E9BB0] mt-0.5">{c.desc}</div>
              </button>
            ))}
          </div>

          <label className="block text-sm">
            <div className="text-xs text-[#0D2145] mb-1">标题 *</div>
            <input className="w-full border border-[#D8DCE8] rounded-lg px-3 py-2 text-sm"
              value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="标题" />
          </label>
          <label className="block text-sm">
            <div className="text-xs text-[#0D2145] mb-1">正文</div>
            <textarea className="w-full border border-[#D8DCE8] rounded-lg px-3 py-2 text-sm h-32 resize-none"
              value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} placeholder="说点什么…" />
          </label>

          {category === "market" && (
            <label className="block text-sm">
              <div className="text-xs text-[#0D2145] mb-1">公开联系方式（选填）</div>
              <input className="w-full border border-[#D8DCE8] rounded-lg px-3 py-2 text-sm"
                value={publicContact} onChange={(e) => setPublicContact(e.target.value)} maxLength={500}
                placeholder="如微信/邮箱，留空则走站内撮合" />
            </label>
          )}

          <ForumDisclaimer variant="inline" />
        </div>

        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[#EEF1F7]">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#4B5A72] hover:bg-[#EEF1F7] rounded-lg">取消</button>
          <button onClick={handleSubmit} disabled={submitting}
            className="px-5 py-2 text-sm bg-[#1B4FD8] hover:bg-[#163069] disabled:opacity-60 text-white rounded-lg font-semibold flex items-center gap-1.5">
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />} 发布
          </button>
        </footer>
      </div>
    </div>
  );
}
