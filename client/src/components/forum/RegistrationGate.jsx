// RegistrationGate — 游客软墙：盖在内容下方/上方，引导注册
import React from "react";
import { useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";

export default function RegistrationGate({ message = "登录后查看完整内容、参与讨论与撮合" }) {
  const navigate = useNavigate();
  return (
    <div className="relative">
      {/* 渐变遮罩，制造"下面还有内容"的暗示 */}
      <div className="absolute -top-24 left-0 right-0 h-24 bg-gradient-to-b from-transparent to-[#F6F7FA] pointer-events-none" />
      <div className="bg-white border border-[#D8DCE8] rounded-lg px-6 py-8 text-center">
        <div className="w-11 h-11 mx-auto rounded-full bg-[#EEF1F7] flex items-center justify-center mb-3">
          <Lock className="w-5 h-5 text-[#1B4FD8]" />
        </div>
        <p className="text-sm text-[#0D2145] font-medium">{message}</p>
        <p className="text-xs text-[#8E9BB0] mt-1">注册免费，立即解锁论坛全部项目与互动</p>
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => navigate("/login")}
            className="px-5 py-2 text-sm bg-[#1B4FD8] hover:bg-[#163069] text-white rounded-lg font-semibold transition-colors"
          >
            注册 / 登录
          </button>
        </div>
      </div>
    </div>
  );
}
