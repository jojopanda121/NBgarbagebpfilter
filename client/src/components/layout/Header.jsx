import React from "react";
import { Gavel, Download, LogOut, User, Zap } from "lucide-react";
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

  return (
    <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between gap-3">
        {/* Logo */}
        <div
          className="flex items-center gap-2 sm:gap-3 min-w-0 cursor-pointer"
          onClick={() => { reset(); navigate("/"); }}
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
              <span className="hidden sm:inline text-sm text-gray-400">
                <User className="w-3.5 h-3.5 inline mr-1" />
                {user?.username}
              </span>
              <button
                onClick={() => { logout(); navigate("/login"); }}
                className="p-1.5 text-gray-500 hover:text-white rounded-lg transition-colors"
                title="退出登录"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => navigate("/login")}
              className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
            >
              登录
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
