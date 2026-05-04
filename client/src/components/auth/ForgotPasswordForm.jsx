import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, Lock, ArrowLeft, Send, CheckCircle } from "lucide-react";
import api from "../../services/api";

export default function ForgotPasswordForm() {
  // step: 1=输入邮箱, 2=输入验证码+新密码, 3=成功
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState(0);

  const navigate = useNavigate();

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleSendCode = async (e) => {
    e.preventDefault();
    setError("");

    if (!email) {
      setError("请输入邮箱地址");
      return;
    }

    setLoading(true);
    try {
      await api.post("/api/auth/forgot-password", { email });
      setStep(2);
      setCountdown(60);
    } catch (err) {
      setError(err.message || "发送失败");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    setError("");
    setLoading(true);
    try {
      await api.post("/api/auth/forgot-password", { email });
      setCountdown(60);
    } catch (err) {
      setError(err.message || "发送失败");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError("");

    if (!code) {
      setError("请输入验证码");
      return;
    }
    if (!newPassword) {
      setError("请输入新密码");
      return;
    }
    if (newPassword.length < 6) {
      setError("密码至少 6 个字符");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }

    setLoading(true);
    try {
      await api.post("/api/auth/reset-password", { email, code, newPassword });
      setStep(3);
    } catch (err) {
      setError(err.message || "重置失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border border-[#D8DCE8] rounded-2xl p-6 sm:p-8 max-w-md mx-auto">
      <h2 className="text-xl font-bold text-center mb-6">
        {step === 3 ? "密码重置成功" : "找回密码"}
      </h2>

      {/* Step 1: 输入邮箱 */}
      {step === 1 && (
        <form onSubmit={handleSendCode} className="space-y-4">
          <p className="text-sm text-[#4B5A72] mb-4">
            请输入您绑定的邮箱地址，我们将发送验证码到您的邮箱。
          </p>
          <div>
            <label className="block text-sm text-[#4B5A72] mb-1">邮箱地址</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4B5A72]" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-[#EEF1F7] border border-[#D8DCE8] rounded-lg focus:outline-none focus:border-blue-500 text-[#0D2145]"
                placeholder="请输入绑定的邮箱"
                required
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-[#1B4FD8] hover:bg-[#163069] disabled:bg-[#E5E9F4] rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="animate-spin w-5 h-5 border-2 border-white/30 border-t-white rounded-full" />
            ) : (
              <>
                <Send className="w-4 h-4" />
                发送验证码
              </>
            )}
          </button>
        </form>
      )}

      {/* Step 2: 输入验证码 + 新密码 */}
      {step === 2 && (
        <form onSubmit={handleResetPassword} className="space-y-4">
          <p className="text-sm text-[#4B5A72] mb-4">
            验证码已发送至 <span className="text-blue-400">{email}</span>，请在 5 分钟内完成验证。
          </p>

          <div>
            <label className="block text-sm text-[#4B5A72] mb-1">验证码</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="flex-1 px-4 py-2 bg-[#EEF1F7] border border-[#D8DCE8] rounded-lg focus:outline-none focus:border-blue-500 text-[#0D2145] text-center tracking-widest"
                placeholder="6位验证码"
                maxLength={6}
                required
              />
              <button
                type="button"
                onClick={handleResend}
                disabled={countdown > 0 || loading}
                className="px-3 py-2 bg-[#E5E9F4] hover:bg-slate-600 disabled:opacity-50 rounded-lg text-sm whitespace-nowrap"
              >
                {countdown > 0 ? `${countdown}s` : "重新发送"}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm text-[#4B5A72] mb-1">新密码</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4B5A72]" />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-[#EEF1F7] border border-[#D8DCE8] rounded-lg focus:outline-none focus:border-blue-500 text-[#0D2145]"
                placeholder="至少6个字符"
                required
                minLength={6}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-[#4B5A72] mb-1">确认新密码</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#4B5A72]" />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-[#EEF1F7] border border-[#D8DCE8] rounded-lg focus:outline-none focus:border-blue-500 text-[#0D2145]"
                placeholder="再次输入新密码"
                required
                minLength={6}
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-[#1B4FD8] hover:bg-[#163069] disabled:bg-[#E5E9F4] rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="animate-spin w-5 h-5 border-2 border-white/30 border-t-white rounded-full" />
            ) : (
              <>
                <Lock className="w-4 h-4" />
                重置密码
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => { setStep(1); setError(""); setCode(""); }}
            className="w-full py-2 text-[#4B5A72] hover:text-[#0D2145] text-sm transition-colors"
          >
            更换邮箱
          </button>
        </form>
      )}

      {/* Step 3: 成功 */}
      {step === 3 && (
        <div className="text-center space-y-4">
          <CheckCircle className="w-16 h-16 text-green-400 mx-auto" />
          <p className="text-[#0F1C36]">密码已重置成功，请使用新密码登录。</p>
          <button
            onClick={() => navigate("/login")}
            className="w-full py-2.5 bg-[#1B4FD8] hover:bg-[#163069] rounded-lg font-medium transition-colors"
          >
            去登录
          </button>
        </div>
      )}

      {/* 返回登录 */}
      {step !== 3 && (
        <p className="text-center text-sm text-[#8E9BB0] mt-4">
          <button
            onClick={() => navigate("/login")}
            className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-3 h-3" />
            返回登录
          </button>
        </p>
      )}
    </div>
  );
}
