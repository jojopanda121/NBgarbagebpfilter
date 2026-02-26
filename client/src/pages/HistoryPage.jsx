import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Clock, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import api from "../services/api";

export default function HistoryPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tasks, setTasks] = useState([]);

  const fetchTasks = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const data = await api.get("/api/task/list");
      setTasks(data?.tasks || []);
    } catch (err) {
      console.error("加载历史记录失败:", err);
    } finally {
      setLoading(false);
      if (isRefresh) setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  // 格式化时间
  const formatTime = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;

    // 小于 1 分钟
    if (diff < 60000) return "刚刚";
    // 小于 1 小时
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    // 小于 1 天
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    // 小于 7 天
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
    // 超过 7 天
    return date.toLocaleDateString("zh-CN");
  };

  // 获取状态标签
  const getStatusBadge = (status) => {
    switch (status) {
      case "running":
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            分析中
          </span>
        );
      case "complete":
        return (
          <span className="px-2 py-0.5 rounded text-xs bg-green-500/20 text-green-400">
            已完成
          </span>
        );
      case "error":
        return (
          <span className="px-2 py-0.5 rounded text-xs bg-red-500/20 text-red-400">
            失败
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-xs bg-gray-500/20 text-gray-400">
            {status}
          </span>
        );
    }
  };

  // 查看报告详情
  const handleViewReport = (task) => {
    if (task.status === "complete") {
      navigate(`/report/${task.id}`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">历史报告</h1>
        <button
          onClick={() => fetchTasks(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>

      {tasks.length === 0 ? (
        <div className="text-center py-16 bg-gray-900/50 rounded-xl border border-gray-800">
          <FileText className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 mb-4">暂无分析记录</p>
          <button
            onClick={() => navigate("/app/dashboard")}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors"
          >
            开始第一次分析
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <div
              key={task.id}
              onClick={() => handleViewReport(task)}
              className={`p-4 bg-gray-900 border border-gray-800 rounded-xl transition-colors ${
                task.status === "complete"
                  ? "cursor-pointer hover:border-gray-700 hover:bg-gray-800/50"
                  : "opacity-75"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center">
                    <FileText className="w-5 h-5 text-gray-400" />
                  </div>
                  <div>
                    <div className="font-medium mb-1">BP 尽调分析</div>
                    <div className="flex items-center gap-3 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTime(task.created_at)}
                      </span>
                      {task.stage && <span>{task.message}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {getStatusBadge(task.status)}
                  {task.status === "complete" && (
                    <ChevronRight className="w-5 h-5 text-gray-500" />
                  )}
                </div>
              </div>

              {/* 进度条 */}
              {task.status === "running" && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                    <span>{task.message}</span>
                    <span>{task.percentage || 0}%</span>
                  </div>
                  <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${task.percentage || 0}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
