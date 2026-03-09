import React, { useState, useEffect } from "react";
import { Mail, X, Send, Loader2 } from "lucide-react";
import api from "../../services/api";
import useAuthStore from "../../store/useAuthStore";

export default function ContactBindingModal() {
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState("");

  const setRequireContactBinding = useAuthStore((s) => s.setRequireContactBinding);
  const setUser = useAuthStore((s) => s.setUser);
  const user = useAuthStore((s) => s.user);

  // 倒计时
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // 发送邮箱验证码
  const handleSendCode = async () => {
    if (!email || !email.includes("@")) {
      setError("请输入正确的邮箱地址");
      return;
    }

    setSendingCode(true);
    setError("");
    try {
      await api.post("/api/verify/send", { email });
      setCountdown(60);
    } catch (err) {
      setError(err.message || "发送验证码失败");
    } finally {
      setSendingCode(false);
    }
  };

  // 验证并绑定
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!email) {
      setError("请填写邮箱");
      return;
    }

    if (!emailCode) {
      setError("请输入邮箱验证码");
      return;
    }

    setError("");
    setLoading(true);

    try {
      // 先验证验证码
      await api.post("/api/verify/check", { email, code: emailCode });
      // 再绑定邮箱
      await api.post("/api/auth/bind-contact", { email });
      setUser({ ...user, contact_bound: true, email });
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

        <h2 className="text-lg font-bold mb-2">绑定邮箱</h2>
        <p className="text-sm text-slate-400 mb-5">
          使用分析功能前，请先绑定您的邮箱地址。
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 邮箱输入 */}
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

          {/* 验证码输入 + 发送按钮 */}
          {email && (
            <div className="flex items-center gap-2 ml-6">
              <input
                type="text"
                value={emailCode}
                onChange={(e) => setEmailCode(e.target.value)}
                maxLength={6}
                className="flex-1 px-3 py-2 bg-slate-800 border border-white/10 rounded-lg focus:outline-none focus:border-blue-500 text-white text-sm"
                placeholder="输入 6 位验证码"
              />
              <button
                type="button"
                onClick={handleSendCode}
                disabled={sendingCode || countdown > 0}
                className="px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-500 rounded-lg text-sm font-medium flex items-center gap-1 whitespace-nowrap"
              >
                {sendingCode ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                {countdown > 0 ? `${countdown}s` : "发送"}
              </button>
            </div>
          )}

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
