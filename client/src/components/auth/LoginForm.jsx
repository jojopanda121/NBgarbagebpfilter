import React, { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { LogIn, UserPlus } from "lucide-react";
import api from "../../services/api";
import useAuthStore from "../../store/useAuthStore";

export default function LoginForm({ onSuccess, defaultRedirect = "/app/dashboard" }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    // 注册模式下校验两次密码一致
    if (isRegister && password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }

    setLoading(true);

    try {
      const url = isRegister ? "/api/auth/register" : "/api/auth/login";
      const body = { username, password };
      if (isRegister) {
        const ref = searchParams.get("ref");
        if (ref) body.invite_code = ref;
      }
      const data = await api.post(url, body);
      setAuth(data.token, data.user, data.quota);
      // 登录成功后跳转到指定页面或默认页面
      if (onSuccess) {
        onSuccess();
      } else {
        const redirectUrl = new URLSearchParams(window.location.search).get("redirect");
        // 安全校验：只允许相对路径跳转，防止开放重定向攻击
        const safeRedirect = redirectUrl && redirectUrl.startsWith("/") && !redirectUrl.startsWith("//")
          ? redirectUrl
          : defaultRedirect;
        navigate(safeRedirect);
      }
    } catch (err) {
      setError(err.message || "操作失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border border-[#D8DCE8] rounded-[6px] p-6 sm:p-8 max-w-md mx-auto shadow-[0_10px_36px_rgba(13,33,69,0.08)]">
      <h2 className="text-xl font-bold text-center mb-6 text-[#0D2145] font-serif-cn">
        {isRegister ? "注册账号" : "登录"}
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-[#4B5A72] mb-1.5">用户名</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-4 py-2 bg-white border border-[#D8DCE8] rounded-[3px] focus:outline-none focus:border-[#1B4FD8] text-[#0D2145] placeholder:text-[#8E9BB0]"
            placeholder="2-32个字符"
            required
            minLength={2}
            maxLength={32}
          />
        </div>

        <div>
          <label className="block text-sm text-[#4B5A72] mb-1.5">密码</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2 bg-white border border-[#D8DCE8] rounded-[3px] focus:outline-none focus:border-[#1B4FD8] text-[#0D2145] placeholder:text-[#8E9BB0]"
            placeholder="至少6个字符"
            required
            minLength={6}
          />
        </div>

        {!isRegister && (
          <div className="flex justify-end -mt-1">
            <Link
              to="/forgot-password"
              className="text-xs text-[#8E9BB0] hover:text-[#1B4FD8] transition-colors"
            >
              忘记密码？
            </Link>
          </div>
        )}

        {isRegister && (
          <div>
            <label className="block text-sm text-[#4B5A72] mb-1.5">确认密码</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-2 bg-white border border-[#D8DCE8] rounded-[3px] focus:outline-none focus:border-[#1B4FD8] text-[#0D2145] placeholder:text-[#8E9BB0]"
              placeholder="再次输入密码"
              required
              minLength={6}
            />
          </div>
        )}

        {error && (
          <p className="text-sm text-[#B91C1C] bg-[#FEF2F2] border border-[rgba(185,28,28,0.2)] px-3 py-2 rounded-[3px]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-[#1B4FD8] hover:bg-[#163069] disabled:bg-[#BFC5D6] text-white rounded-[3px] font-semibold transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <span className="animate-spin w-5 h-5 border-2 border-white/30 border-t-white rounded-full" />
          ) : isRegister ? (
            <>
              <UserPlus className="w-4 h-4" />
              注册
            </>
          ) : (
            <>
              <LogIn className="w-4 h-4" />
              登录
            </>
          )}
        </button>
      </form>

      <p className="text-center text-sm text-[#8E9BB0] mt-4">
        {isRegister ? "已有账号？" : "没有账号？"}
        <button
          onClick={() => { setIsRegister(!isRegister); setError(""); setConfirmPassword(""); }}
          className="text-[#1B4FD8] hover:text-[#163069] ml-1 font-medium"
        >
          {isRegister ? "去登录" : "注册"}
        </button>
      </p>
    </div>
  );
}
