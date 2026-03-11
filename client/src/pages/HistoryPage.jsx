import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileText,
  Clock,
  ChevronRight,
  Loader2,
  RefreshCw,
  ArrowUpDown,
  Filter,
} from "lucide-react";
import api from "../services/api";

const INDUSTRY_FILTERS = [
  "全部",
  "人工智能",
  "具身智能",
  "芯片半导体",
  "低空经济",
  "商业航天",
  "合成生物",
  "新能源",
  "生物医药",
  "先进制造",
  "企业服务/SaaS",
  "消费/零售",
  "金融科技",
  "其他",
];

// 评分圆圈组件
function ScoreCircle({ score }) {
  if (score == null) return null;
  const color =
    score >= 75
      ? "text-emerald-400 border-emerald-500/40"
      : score >= 50
      ? "text-yellow-400 border-yellow-500/40"
      : "text-red-400 border-red-500/40";
  return (
    <div
      className={`w-10 h-10 rounded-full border-2 flex items-center justify-center text-sm font-bold ${color}`}
    >
      {score}
    </div>
  );
}

export default function HistoryPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [sortBy, setSortBy] = useState("time"); // "time" | "score"
  const [filterIndustry, setFilterIndustry] = useState("全部");

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

  // 筛选 + 排序
  const filteredTasks = useMemo(() => {
    let list = [...tasks];

    // 行业筛选（支持多标签 JSON 数组格式）
    if (filterIndustry !== "全部") {
      list = list.filter((t) => {
        const cat = t.industry_category || "";
        const ind = t.industry || "";
        // 支持 JSON 数组格式: ["人工智能", "芯片半导体"]
        let categories = [];
        try { categories = JSON.parse(cat); } catch { categories = [cat]; }
        return categories.some(c => c.includes(filterIndustry)) || ind.includes(filterIndustry);
      });
    }

    // 排序
    if (sortBy === "score") {
      list.sort((a, b) => (b.total_score ?? -1) - (a.total_score ?? -1));
    }
    // sortBy === "time" 默认已按 created_at DESC

    return list;
  }, [tasks, sortBy, filterIndustry]);

  // 格式化时间
  const formatTime = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
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
          <span className="px-2 py-0.5 rounded text-xs bg-gray-500/20 text-slate-400">
            {status}
          </span>
        );
    }
  };

  // 查看报告详情 / 恢复分析进度
  const handleViewReport = (task) => {
    if (task.status === "complete") {
      navigate(`/report/${task.id}`);
    } else if (task.status === "running") {
      const currentUser = JSON.parse(localStorage.getItem("bp_user") || "null");
      const pendingData = { taskId: task.id, userId: currentUser?.id || null };
      localStorage.setItem("bp_pending_task", JSON.stringify(pendingData));
      navigate("/app/dashboard");
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
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">历史报告</h1>
        <button
          onClick={() => fetchTasks(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-slate-800 hover:bg-gray-700 rounded-lg transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>

      {/* 排序 + 筛选栏 */}
      {tasks.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-5">
          {/* 排序切换 */}
          <div className="flex items-center gap-1.5 text-sm">
            <ArrowUpDown className="w-4 h-4 text-slate-500" />
            <button
              onClick={() => setSortBy("time")}
              className={`px-3 py-1 rounded-full border transition-colors ${
                sortBy === "time"
                  ? "bg-blue-500/20 text-blue-400 border-blue-500/40"
                  : "bg-slate-800 text-slate-500 border-white/10 hover:border-gray-500"
              }`}
            >
              按时间
            </button>
            <button
              onClick={() => setSortBy("score")}
              className={`px-3 py-1 rounded-full border transition-colors ${
                sortBy === "score"
                  ? "bg-blue-500/20 text-blue-400 border-blue-500/40"
                  : "bg-slate-800 text-slate-500 border-white/10 hover:border-gray-500"
              }`}
            >
              按评分
            </button>
          </div>

          {/* 行业筛选 */}
          <div className="flex items-center gap-1.5 text-sm ml-auto">
            <Filter className="w-4 h-4 text-slate-500" />
            <select
              value={filterIndustry}
              onChange={(e) => setFilterIndustry(e.target.value)}
              className="bg-slate-800 border border-white/10 text-gray-300 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500"
            >
              {INDUSTRY_FILTERS.map((ind) => (
                <option key={ind} value={ind}>
                  {ind}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="text-center py-16 bg-slate-900/50 rounded-xl border border-white/10">
          <FileText className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 mb-4">暂无分析记录</p>
          <button
            onClick={() => navigate("/app/dashboard")}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors"
          >
            开始第一次分析
          </button>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="text-center py-12 bg-slate-900/50 rounded-xl border border-white/10">
          <p className="text-slate-400">当前筛选条件下无匹配报告</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTasks.map((task) => (
            <div
              key={task.id}
              onClick={() => handleViewReport(task)}
              className={`p-4 bg-slate-900 border border-white/10 rounded-xl transition-colors ${
                task.status === "complete" || task.status === "running"
                  ? "cursor-pointer hover:border-white/10 hover:bg-slate-800/50"
                  : "opacity-75"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  {/* 评分圆圈 or 文件图标 */}
                  {task.status === "complete" && task.total_score != null ? (
                    <ScoreCircle score={task.total_score} />
                  ) : (
                    <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5 text-slate-400" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="font-medium mb-1 truncate">
                      {task.title || "BP 尽调分析"}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap text-sm text-slate-500">
                      {task.archive_number && (
                        <span className="px-2 py-0.5 rounded text-xs bg-slate-700 text-slate-300 font-mono">
                          {task.archive_number}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTime(task.created_at)}
                      </span>
                      {/* 赛道标签（支持多标签） */}
                      {task.industry_category && (() => {
                        let cats = [];
                        try { cats = JSON.parse(task.industry_category); } catch { cats = [task.industry_category]; }
                        return cats.map((c, idx) => (
                          <span key={idx} className="px-2 py-0.5 rounded text-xs bg-purple-500/15 text-purple-400">
                            {c}
                          </span>
                        ));
                      })()}
                      {/* 细分行业标签 */}
                      {task.industry && task.industry !== task.industry_category && (
                        <span className="px-2 py-0.5 rounded text-xs bg-cyan-500/15 text-cyan-400">
                          {task.industry}
                        </span>
                      )}
                      {task.stage && task.status === "running" && (
                        <span>{task.message}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {getStatusBadge(task.status)}
                  {(task.status === "complete" || task.status === "running") && (
                    <ChevronRight className="w-5 h-5 text-slate-500" />
                  )}
                </div>
              </div>

              {/* 进度条 */}
              {task.status === "running" && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                    <span>{task.message}</span>
                    <span>{task.percentage || 0}%</span>
                  </div>
                  <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
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
