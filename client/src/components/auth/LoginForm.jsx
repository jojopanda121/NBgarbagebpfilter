import React, { useState } from "react";
import { LogIn, UserPlus } from "lucide-react";
import api from "../../services/api";
import useAuthStore from "../../store/useAuthStore";

export default function LoginForm({ onSuccess }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const setAuth = useAuthStore((s) => s.setAuth);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const url = isRegister ? "/api/auth/register" : "/api/auth/login";
      const data = await api.post(url, { username, password });
      setAuth(data.token, data.user, data.quota);
      onSuccess?.();
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
          onClick={() => { setIsRegister(!isRegister); setError(""); }}
          className="text-blue-400 hover:text-blue-300 ml-1"
        >
          {isRegister ? "去登录" : "注册"}
        </button>
      </p>
    </div>
  );
}
