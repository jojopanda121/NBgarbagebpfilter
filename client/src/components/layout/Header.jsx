import React, { useState, useRef, useEffect } from "react";
import { Brain, Download, LogOut, User, Zap, FileText, ChevronDown, Shield, Trophy } from "lucide-react";
import { useNavigate } from "react-router-dom";
import useAuthStore from "../../store/useAuthStore";
import useAnalysisStore from "../../store/useAnalysisStore";
import { downloadReportAsPdf } from "../../utils/downloadReport";

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
    <header className="border-b border-white/10 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50" role="banner">
      <div className="max-w-6xl mx-auto px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between gap-3">
        {/* Logo */}
        <div
          className="flex items-center gap-2 sm:gap-3 min-w-0 cursor-pointer"
          onClick={() => { reset(); navigate(token ? "/app/dashboard" : "/"); }}
          role="button"
          tabIndex={0}
          aria-label="返回首页"
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { reset(); navigate(token ? "/app/dashboard" : "/"); } }}
        >
          <div className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <Brain className="w-5 h-5 sm:w-6 sm:h-6 text-white" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-bold tracking-tight truncate text-white">
              BP过滤机
            </h1>
            <p className="text-xs text-slate-500 hidden sm:block">
              AI 大模型智能尽职调查
            </p>
          </div>
        </div>

        {/* 右侧操作区 */}
        <div className="flex items-center gap-2 shrink-0">
          {/* 额度显示 */}
          {token && quota && (
            <div className="hidden sm:flex items-center gap-1 px-3 py-1.5 bg-slate-800/50 border border-white/10 rounded-lg text-sm" role="status">
              <Zap className="w-3.5 h-3.5 text-yellow-400" aria-hidden="true" />
              <span className="text-slate-300">
                {(quota.free || 0) + (quota.paid || 0)}次
              </span>
            </div>
          )}

          {/* 结果操作 */}
          {result && (
            <>
              <button
                onClick={() => downloadReportAsPdf(result)}
                className="px-3 py-1.5 sm:px-4 sm:py-2 text-sm bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                <span className="hidden sm:inline">下载报告</span>
              </button>
              <button
                onClick={reset}
                className="px-3 py-1.5 sm:px-4 sm:py-2 text-sm bg-slate-800 hover:bg-slate-700 border border-white/10 rounded-lg transition-colors"
              >
                <span className="hidden sm:inline">重新分析</span>
                <span className="sm:hidden">重置</span>
              </button>
            </>
          )}

          {/* 用户菜单 */}
          {token ? (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-800 rounded-lg transition-colors"
                aria-expanded={showDropdown}
                aria-haspopup="true"
              >
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-medium text-sm">
                    {user?.username?.charAt(0).toUpperCase() || "U"}
                  </div>
                )}
                <span className="hidden sm:inline text-sm text-slate-300">
                  {user?.username}
                </span>
                <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${showDropdown ? "rotate-180" : ""}`} />
              </button>

              {showDropdown && (
                <div className="absolute right-0 mt-2 w-48 bg-slate-900 border border-white/10 rounded-xl shadow-xl overflow-hidden" role="menu">
                  <div className="py-1">
                    <button
                      onClick={() => { setShowDropdown(false); navigate("/settings"); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800 transition-colors"
                      role="menuitem"
                    >
                      <User className="w-4 h-4" />
                      个人中心
                    </button>
                    <button
                      onClick={() => { setShowDropdown(false); navigate("/app/history"); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800 transition-colors"
                      role="menuitem"
                    >
                      <FileText className="w-4 h-4" />
                      历史报告
                    </button>
                    <button
                      onClick={() => { setShowDropdown(false); navigate("/app/leaderboard"); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800 transition-colors"
                      role="menuitem"
                    >
                      <Trophy className="w-4 h-4 text-yellow-400" />
                      排行榜
                    </button>
                    <button
                      onClick={() => { setShowDropdown(false); navigate("/settings?tab=token"); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800 transition-colors"
                      role="menuitem"
                    >
                      <Zap className="w-4 h-4 text-yellow-400" />
                      兑换额度
                    </button>
                    {user?.role === "admin" && (
                      <button
                        onClick={() => { setShowDropdown(false); navigate("/admin"); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-yellow-400 hover:bg-slate-800 transition-colors"
                        role="menuitem"
                      >
                        <Shield className="w-4 h-4" />
                        管理员中心
                      </button>
                    )}
                    <div className="border-t border-white/10 mt-1 pt-1">
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-slate-800 transition-colors"
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
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate("/login")}
                className="px-3 py-1.5 text-sm text-slate-300 hover:text-white transition-colors"
              >
                登录
              </button>
              <button
                onClick={() => navigate("/login")}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors font-medium"
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
