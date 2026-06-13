// InterestModal — 表达撮合意向（投资人/FA → 项目方）
import React, { useState } from "react";
import { X, Loader2, Handshake } from "lucide-react";
import forumApi from "../../services/forumApi";
import ForumDisclaimer from "../../components/forum/ForumDisclaimer";

export default function InterestModal({ post, onClose, onDone }) {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      await forumApi.expressInterest(post.id, message.trim());
      onDone?.();
    } catch (e) {
      setError(e.message || "发送失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-lg w-full max-w-md">
        <header className="flex items-center justify-between px-5 py-3 border-b border-[#EEF1F7]">
          <div className="text-sm font-semibold text-[#0D2145] flex items-center gap-1.5">
            <Handshake className="w-4 h-4 text-[#1B4FD8]" /> 表达撮合意向
          </div>
          <button onClick={onClose} className="text-[#8E9BB0] hover:text-[#0F1C36]"><X className="w-5 h-5" /></button>
        </header>
        <div className="px-5 py-4 space-y-3">
          {error && <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded px-2.5 py-1.5">{error}</div>}
          <p className="text-xs text-[#4B5A72]">
            向发帖人「{post.codename || post.title}」表达兴趣。对方同意后，你们将互相解锁名片（资料里填写的联系方式）。
          </p>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000}
            placeholder="附言（选填）：简单介绍你/你的机构，以及为什么感兴趣"
            className="w-full border border-[#D8DCE8] rounded-lg px-3 py-2 text-sm h-24 resize-none" />
          <ForumDisclaimer variant="inline" />
        </div>
        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[#EEF1F7]">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#4B5A72] hover:bg-[#EEF1F7] rounded-lg">取消</button>
          <button onClick={submit} disabled={submitting}
            className="px-5 py-2 text-sm bg-[#1B4FD8] hover:bg-[#163069] disabled:opacity-60 text-white rounded-lg font-semibold flex items-center gap-1.5">
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />} 发送意向
          </button>
        </footer>
      </div>
    </div>
  );
}
