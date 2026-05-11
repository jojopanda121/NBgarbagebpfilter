import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import LoginForm from "../components/auth/LoginForm";

const LogoE = ({ size = 48 }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" rx="6" fill="#1B4FD8" />
    <circle cx="10" cy="10" r="4.5" fill="white" opacity="0.2" />
    <circle cx="30" cy="10" r="4.5" fill="white" opacity="0.2" />
    <circle cx="10" cy="30" r="4.5" fill="white" opacity="0.2" />
    <circle cx="30" cy="30" r="4.5" fill="white" opacity="0.2" />
    <line x1="10" y1="10" x2="20" y2="20" stroke="white" strokeWidth="1.4" opacity="0.28" />
    <line x1="30" y1="10" x2="20" y2="20" stroke="white" strokeWidth="1.4" opacity="0.28" />
    <line x1="10" y1="30" x2="20" y2="20" stroke="white" strokeWidth="1.4" opacity="0.28" />
    <line x1="30" y1="30" x2="20" y2="20" stroke="white" strokeWidth="1.4" opacity="0.28" />
    <rect x="5" y="6.5" width="30" height="3.5" rx="1.75" fill="white" opacity="0.88" />
    <rect x="8" y="18" width="24" height="3.5" rx="1.75" fill="white" opacity="0.88" />
    <rect x="12" y="29.5" width="16" height="3.5" rx="1.75" fill="white" opacity="0.88" />
    <circle cx="20" cy="20" r="3" fill="#C9A84C" />
  </svg>
);

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/";

  return (
    <div className="min-h-screen bg-[#F4F6FB] text-[#0C1A30] flex flex-col items-center justify-center px-4 relative">
      <div className="absolute -top-[100px] -right-[60px] w-[700px] h-[700px] pointer-events-none"
           style={{ background: "radial-gradient(ellipse, rgba(27,79,216,.08) 0%, transparent 65%)" }} />
      <div className="absolute -bottom-[80px] -left-[80px] w-[400px] h-[400px] pointer-events-none"
           style={{ background: "radial-gradient(ellipse, rgba(13,33,69,.05) 0%, transparent 65%)" }} />

      <button
        onClick={() => navigate(from, { replace: true })}
        className="absolute top-4 left-4 flex items-center gap-2 text-[#2D3D54] hover:text-[#0C1A30] transition-colors"
      >
        <ArrowLeft className="w-5 h-5" />
        返回
      </button>

      <div className="flex items-center gap-3 mb-8 relative z-10">
        <LogoE size={48} />
        <div>
          <h1 className="text-2xl font-bold text-[#0C1A30] font-serif-cn">BP过滤机</h1>
          <p className="text-[12px] text-[#526078] font-mono-fin tracking-wide">
            AI Workspace for VC &amp; PE
          </p>
        </div>
      </div>

      <div className="relative z-10 w-full max-w-md">
        <LoginForm />
      </div>

      <p className="mt-6 text-sm text-[#526078] text-center max-w-sm relative z-10">
        注册即送免费 BP 深度分析额度
      </p>
    </div>
  );
}
