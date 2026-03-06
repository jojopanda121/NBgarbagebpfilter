import React, { useState } from "react";
import { Mail, Phone, X } from "lucide-react";
import api from "../../services/api";
import useAuthStore from "../../store/useAuthStore";

export default function ContactBindingModal() {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const setRequireContactBinding = useAuthStore((s) => s.setRequireContactBinding);
  const setUser = useAuthStore((s) => s.setUser);
  const user = useAuthStore((s) => s.user);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email && !phone) {
      setError("请填写邮箱或手机号");
      return;
    }
    setError("");
    setLoading(true);

    try {
      await api.post("/api/auth/bind-contact", { email: email || undefined, phone: phone || undefined });
      setUser({ ...user, contact_bound: true, email, phone });
      setRequireContactBinding(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 max-w-md w-full relative">
        <button
          onClick={() => setRequireContactBinding(false)}
          className="absolute top-4 right-4 text-slate-500 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-lg font-bold mb-2">绑定联系方式</h2>
        <p className="text-sm text-slate-400 mb-5">
          您已使用 3 次免费分析。为了继续使用，请绑定邮箱或手机号。
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-slate-500 shrink-0" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 px-3 py-2 bg-slate-800 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500 text-white text-sm"
              placeholder="邮箱地址"
            />
          </div>

          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4 text-slate-500 shrink-0" />
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="flex-1 px-3 py-2 bg-slate-800 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500 text-white text-sm"
              placeholder="手机号"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? "绑定中..." : "确认绑定"}
          </button>
        </form>
      </div>
    </div>
  );
}
