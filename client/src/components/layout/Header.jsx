import React, { useState, useRef, useEffect } from "react";
import { Gavel, Download, LogOut, User, Zap, Settings, FileText, ChevronDown } from "lucide-react";
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
  const setRequirePayment = useAuthStore((s) => s.setRequirePayment);

  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);

  // 点击外部关闭下拉菜单
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
    <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between gap-3">
        {/* Logo */}
        <div
          className="flex items-center gap-2 sm:gap-3 min-w-0 cursor-pointer"
          onClick={() => { reset(); navigate(token ? "/app/dashboard" : "/"); }}
        >
          <div className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
            <Gavel className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-bold tracking-tight truncate">
              垃圾BP过滤机
            </h1>
            <p className="text-xs text-gray-500 hidden sm:block">
              MiniMax 知识库深度研究 · DeepThink 辩证法尽调
            </p>
          </div>
        </div>

        {/* 右侧操作区 */}
        <div className="flex items-center gap-2 shrink-0">
          {/* 额度显示 */}
          {token && quota && (
            <div className="hidden sm:flex items-center gap-1 px-3 py-1.5 bg-gray-800 rounded-lg text-sm">
              <Zap className="w-3.5 h-3.5 text-yellow-400" />
              <span className="text-gray-300">
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
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">下载报告</span>
              </button>
              <button
                onClick={reset}
                className="px-3 py-1.5 sm:px-4 sm:py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
              >
                <span className="hidden sm:inline">重新分析</span>
                <span className="sm:hidden">重置</span>
              </button>
            </>
          )}

          {/* 用户菜单 */}
          {token ? (
            <div className="flex items-center gap-2">
              {/* 充值按钮 - 高亮 */}
              <button
                onClick={() => setRequirePayment(true)}
                className="px-3 py-1.5 sm:px-4 sm:py-2 text-sm bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-400 hover:to-orange-400 rounded-lg transition-colors flex items-center gap-1.5 font-medium text-gray-900"
              >
                <Zap className="w-4 h-4" />
                <span className="hidden sm:inline">充值</span>
              </button>

              {/* 头像下拉菜单 */}
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-800 rounded-lg transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-medium text-sm">
                    {user?.username?.charAt(0).toUpperCase() || "U"}
                  </div>
                  <span className="hidden sm:inline text-sm text-gray-300">
                    {user?.username}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${showDropdown ? "rotate-180" : ""}`} />
                </button>

                {/* 下拉菜单 */}
                {showDropdown && (
                  <div className="absolute right-0 mt-2 w-48 bg-gray-900 border border-gray-700 rounded-xl shadow-xl overflow-hidden">
                    <div className="py-1">
                      <button
                        onClick={() => { setShowDropdown(false); navigate("/settings"); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 transition-colors"
                      >
                        <User className="w-4 h-4" />
                        个人中心
                      </button>
                      <button
                        onClick={() => { setShowDropdown(false); navigate("/app/history"); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 transition-colors"
                      >
                        <FileText className="w-4 h-4" />
                        历史报告
                      </button>
                      <button
                        onClick={() => { setShowDropdown(false); navigate("/settings?tab=recharge"); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 transition-colors"
                      >
                        <Zap className="w-4 h-4 text-yellow-400" />
                        充值额度
                      </button>
                      <div className="border-t border-gray-800 mt-1 pt-1">
                        <button
                          onClick={handleLogout}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-gray-800 transition-colors"
                        >
                          <LogOut className="w-4 h-4" />
                          退出登录
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate("/login", { state: { from: location } })}
                className="px-3 py-1.5 text-sm text-gray-300 hover:text-white transition-colors"
              >
                登录
              </button>
              <button
                onClick={() => navigate("/login", { state: { from: location } })}
                className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors font-medium"
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
