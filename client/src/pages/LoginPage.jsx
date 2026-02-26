import React from "react";
import { useNavigate } from "react-router-dom";
import { Gavel } from "lucide-react";
import LoginForm from "../components/auth/LoginForm";

export default function LoginPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col items-center justify-center px-4">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
          <Gavel className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">垃圾BP过滤机</h1>
          <p className="text-sm text-gray-500">AI 商业计划书深度评估系统</p>
        </div>
      </div>

      <LoginForm onSuccess={() => navigate("/")} />

      <p className="mt-6 text-sm text-gray-600 text-center max-w-sm">
        注册即送 3 次免费 BP 深度分析额度
      </p>
    </div>
  );
}
