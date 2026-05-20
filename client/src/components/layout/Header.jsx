import React, { useState, useRef, useEffect } from "react";
import { Download, LogOut, User, Zap, FileText, ChevronDown, Shield, Trophy, BarChart2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import useAuthStore from "../../store/useAuthStore";
import useAnalysisStore from "../../store/useAnalysisStore";
import { downloadReportAsPdf } from "../../utils/downloadReport";

// Logo E（与 Landing Page 一致）
const LogoE = ({ size = 32 }) => (
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

export default function Header() {
  const navigate = useNavigate();
  const result = useAnalysisStore((s) => s.result);
  const reset = useAnalysisStore((s) => s.reset);
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const quota = useAuthStore((s) => s.quota);
  const logout = useAuthStore((s) => s.logout);

  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <header className="border-b border-[#D8DCE8] bg-white/95 backdrop-blur-md sticky top-0 z-50" role="banner">
      <div className="max-w-6xl mx-auto px-3 py-2.5 sm:px-6 sm:py-3.5 flex items-center justify-between gap-2 sm:gap-3">
        <div
          className="flex items-center gap-2.5 min-w-0 cursor-pointer"
          onClick={() => { reset(); navigate(token ? "/app/dashboard" : "/"); }}
          role="button"
          tabIndex={0}
          aria-label="返回首页"
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { reset(); navigate(token ? "/app/dashboard" : "/"); } }}
        >
          <LogoE size={32} />
          <div className="min-w-0">
            <h1 className="text-base sm:text-[15px] font-bold tracking-wide truncate text-[#0D2145] font-serif-cn">
              BP过滤机
            </h1>
            <p className="text-[11px] text-[#8E9BB0] hidden sm:block font-mono-fin tracking-wide">
              AI Workspace for VC &amp; PE
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {token && quota && (
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-[#EEF1F7] border border-[#D8DCE8] rounded-[3px] text-[13px]" role="status">
              <Zap className="w-3.5 h-3.5 text-[#B45309]" aria-hidden="true" />
              <span className="text-[#0D2145] font-mono-fin">
                {(quota.free || 0) + (quota.paid || 0)}次
              </span>
            </div>
          )}

          {result && (
            <>
              <button
                onClick={() => downloadReportAsPdf(result)}
                className="px-3 py-1.5 sm:px-4 sm:py-2 text-sm bg-[#1B4FD8] hover:bg-[#163069] text-white rounded-[3px] transition-colors flex items-center gap-1.5"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                <span className="hidden sm:inline">下载报告</span>
              </button>
              <button
                onClick={reset}
                className="px-3 py-1.5 sm:px-4 sm:py-2 text-sm bg-white hover:bg-[#EEF1F7] border border-[#D8DCE8] text-[#0D2145] rounded-[3px] transition-colors"
              >
                <span className="hidden sm:inline">重新分析</span>
                <span className="sm:hidden">重置</span>
              </button>
            </>
          )}

          {token ? (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center gap-2 px-2 py-1.5 hover:bg-[#EEF1F7] rounded-[3px] transition-colors"
                aria-expanded={showDropdown}
                aria-haspopup="true"
              >
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-[#1B4FD8] flex items-center justify-center text-white font-medium text-sm">
                    {user?.username?.charAt(0).toUpperCase() || "U"}
                  </div>
                )}
                <span className="hidden sm:inline text-sm text-[#0D2145]">
                  {user?.username}
                </span>
                <ChevronDown className={`w-4 h-4 text-[#8E9BB0] transition-transform ${showDropdown ? "rotate-180" : ""}`} />
              </button>

              {showDropdown && (
                <div className="absolute right-0 mt-2 w-56 max-w-[calc(100vw-1rem)] bg-white border border-[#D8DCE8] rounded-[4px] shadow-[0_10px_36px_rgba(13,33,69,0.12)] overflow-hidden" role="menu">
                  <div className="py-1">
                    <button
                      onClick={() => { setShowDropdown(false); navigate("/settings"); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#0D2145] hover:bg-[#EEF1F7] transition-colors"
                      role="menuitem"
                    >
                      <User className="w-4 h-4" />
                      个人中心
                    </button>
                    <button
                      onClick={() => { setShowDropdown(false); navigate("/app/history"); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#0D2145] hover:bg-[#EEF1F7] transition-colors"
                      role="menuitem"
                    >
                      <FileText className="w-4 h-4" />
                      历史报告
                    </button>
                    <button
                      onClick={() => { setShowDropdown(false); navigate("/app/leaderboard"); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#0D2145] hover:bg-[#EEF1F7] transition-colors"
                      role="menuitem"
                    >
                      <Trophy className="w-4 h-4 text-[#B45309]" />
                      排行榜
                    </button>
                    <button
                      onClick={() => { setShowDropdown(false); navigate("/app/stats"); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#0D2145] hover:bg-[#EEF1F7] transition-colors"
                      role="menuitem"
                    >
                      <BarChart2 className="w-4 h-4 text-[#1B4FD8]" />
                      数据看板
                    </button>
                    <button
                      onClick={() => { setShowDropdown(false); navigate("/settings?tab=token"); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#0D2145] hover:bg-[#EEF1F7] transition-colors"
                      role="menuitem"
                    >
                      <Zap className="w-4 h-4 text-[#B45309]" />
                      兑换额度
                    </button>
                    {user?.role === "admin" && (
                      <button
                        onClick={() => { setShowDropdown(false); navigate("/admin"); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#B45309] hover:bg-[#EEF1F7] transition-colors"
                        role="menuitem"
                      >
                        <Shield className="w-4 h-4" />
                        管理员中心
                      </button>
                    )}
                    <div className="border-t border-[#D8DCE8] mt-1 pt-1">
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#B91C1C] hover:bg-[#EEF1F7] transition-colors"
                        role="menuitem"
                      >
                        <LogOut className="w-4 h-4" />
                        退出登录
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                onClick={() => navigate("/login")}
                className="px-2 py-1.5 sm:px-3 text-sm text-[#4B5A72] hover:text-[#0D2145] transition-colors"
              >
                登录
              </button>
              <button
                onClick={() => navigate("/login")}
                className="px-3 py-1.5 sm:px-4 sm:py-2 text-sm bg-[#1B4FD8] hover:bg-[#163069] text-white rounded-[3px] transition-colors font-semibold"
              >
                注册
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
