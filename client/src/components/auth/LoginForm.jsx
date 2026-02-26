import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
        navigate(redirectUrl || defaultRedirect);
      }
    } catch (err) {
      setError(err.message || "操作失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 sm:p-8 max-w-md mx-auto">
      <h2 className="text-xl font-bold text-center mb-6">
        {isRegister ? "注册账号" : "登录"}
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">用户名</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500 text-white"
            placeholder="2-32个字符"
            required
            minLength={2}
            maxLength={32}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">密码</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500 text-white"
            placeholder="至少6个字符"
            required
            minLength={6}
          />
        </div>

        {isRegister && (
          <div>
            <label className="block text-sm text-gray-400 mb-1">确认密码</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500 text-white"
              placeholder="再次输入密码"
              required
              minLength={6}
            />
          </div>
        )}

        {error && (
          <p className="text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
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

      <p className="text-center text-sm text-gray-500 mt-4">
        {isRegister ? "已有账号？" : "没有账号？"}
        <button
          onClick={() => { setIsRegister(!isRegister); setError(""); setConfirmPassword(""); }}
          className="text-blue-400 hover:text-blue-300 ml-1"
        >
          {isRegister ? "去登录" : "注册"}
        </button>
      </p>
    </div>
  );
}
