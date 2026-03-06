import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Brain, ArrowLeft } from "lucide-react";
import LoginForm from "../components/auth/LoginForm";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center px-4">
      {/* 返回按钮 */}
      <button
        onClick={() => navigate(from, { replace: true })}
        className="absolute top-4 left-4 flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
      >
        <ArrowLeft className="w-5 h-5" />
        返回
      </button>

      <div className="flex items-center gap-3 mb-8">
        <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
          <Brain className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">BP过滤机</h1>
          <p className="text-sm text-slate-500">AI 大模型智能尽职调查</p>
        </div>
      </div>

      <LoginForm />

      <p className="mt-6 text-sm text-slate-600 text-center max-w-sm">
        注册即送免费 BP 深度分析额度
      </p>
    </div>
  );
}
