import React from "react";
import { useNavigate } from "react-router-dom";
import { Brain, ArrowLeft } from "lucide-react";
import ForgotPasswordForm from "../components/auth/ForgotPasswordForm";

export default function ForgotPasswordPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#F6F7FA] text-[#0D2145] flex flex-col items-center justify-center px-4">
      <button
        onClick={() => navigate("/login")}
        className="absolute top-4 left-4 flex items-center gap-2 text-[#4B5A72] hover:text-[#0D2145] transition-colors"
      >
        <ArrowLeft className="w-5 h-5" />
        返回登录
      </button>

      <div className="flex items-center gap-3 mb-8">
        <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
          <Brain className="w-6 h-6 text-[#0D2145]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[#0D2145]">BP过滤机</h1>
          <p className="text-sm text-[#8E9BB0]">AI 大模型智能尽职调查</p>
        </div>
      </div>

      <ForgotPasswordForm />
    </div>
  );
}
