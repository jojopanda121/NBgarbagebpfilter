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
  ClipboardList,
  Calendar,
  MapPin,
  Trash2,
} from "lucide-react";

const STAGE_CONFIG = {
  new:            { label: "新建",     color: "bg-slate-500/20 text-[#4B5A72] border-slate-500/30" },
  reviewed:       { label: "已评估",   color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  dd_pending:     { label: "待尽调",   color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  dd_in_progress: { label: "尽调中",   color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  dd_done:        { label: "尽调完成", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  decided:        { label: "已决策",   color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  passed:         { label: "已投资",   color: "bg-green-500/20 text-green-400 border-green-500/30" },
  rejected:       { label: "已否决",   color: "bg-red-500/20 text-red-400 border-red-500/30" },
};
import api from "../services/api";

const PROVINCE_OPTIONS = [
  "", "北京", "天津", "上海", "重庆",
  "河北", "山西", "辽宁", "吉林", "黑龙江",
  "江苏", "浙江", "安徽", "福建", "江西",
  "山东", "河南", "湖北", "湖南", "广东",
  "海南", "四川", "贵州", "云南", "陕西",
  "甘肃", "青海", "台湾", "内蒙古", "广西",
  "西藏", "宁夏", "新疆", "香港", "澳门",
];

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

// 省份选择下拉组件
function ProvinceSelector({ taskId, currentLocation, onUpdate }) {
  const [saving, setSaving] = useState(false);

  const handleChange = async (e) => {
    e.stopPropagation();
    const location = e.target.value;
    setSaving(true);
    try {
      await api.put(`/api/projects/${taskId}/location`, { location: location || null });
      onUpdate(taskId, location || null);
    } catch (err) {
      console.error("更新省份失败:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <MapPin className="w-3 h-3 text-[#8E9BB0] shrink-0" />
      <select
        value={currentLocation || ""}
        onChange={handleChange}
        disabled={saving}
        className="bg-[#EEF1F7] border border-[#D8DCE8] text-[#0F1C36] text-xs rounded px-1.5 py-0.5 focus:outline-none focus:border-blue-500 cursor-pointer hover:border-[#BFC5D6] transition-colors"
      >
        <option value="">选择省份</option>
        {PROVINCE_OPTIONS.filter(Boolean).map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      {saving && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
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
  const [deleteConfirm, setDeleteConfirm] = useState(null); // taskId to confirm delete

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

  // 更新单个任务的省份（本地状态同步）
  const handleProvinceUpdate = (taskId, location) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, project_location: location } : t))
    );
  };

  const handleDeleteTask = async (taskId) => {
    try {
      await api.delete(`/api/task/${taskId}`);
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } catch (err) {
      alert("删除失败：" + (err.message || "未知错误"));
    } finally {
      setDeleteConfirm(null);
    }
  };

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
          <span className="px-2 py-0.5 rounded text-xs bg-gray-500/20 text-[#4B5A72]">
            {status}
          </span>
        );
    }
  };

  // 查看报告详情 / 恢复分析进度
  const handleViewReport = (task) => {
    if (task.status === "complete") {
      // 已完成的项目进入 ProjectPage（三 Tab 项目视图）
      navigate(`/project/${task.id}`);
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
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-[#EEF1F7] hover:bg-[#E5E9F4] rounded-lg transition-colors"
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
            <ArrowUpDown className="w-4 h-4 text-[#8E9BB0]" />
            <button
              onClick={() => setSortBy("time")}
              className={`px-3 py-1 rounded-full border transition-colors ${
                sortBy === "time"
                  ? "bg-blue-500/20 text-blue-400 border-blue-500/40"
                  : "bg-[#EEF1F7] text-[#8E9BB0] border-[#D8DCE8] hover:border-[#BFC5D6]"
              }`}
            >
              按时间
            </button>
            <button
              onClick={() => setSortBy("score")}
              className={`px-3 py-1 rounded-full border transition-colors ${
                sortBy === "score"
                  ? "bg-blue-500/20 text-blue-400 border-blue-500/40"
                  : "bg-[#EEF1F7] text-[#8E9BB0] border-[#D8DCE8] hover:border-[#BFC5D6]"
              }`}
            >
              按评分
            </button>
          </div>

          {/* 行业筛选 */}
          <div className="flex items-center gap-1.5 text-sm ml-auto">
            <Filter className="w-4 h-4 text-[#8E9BB0]" />
            <select
              value={filterIndustry}
              onChange={(e) => setFilterIndustry(e.target.value)}
              className="bg-[#EEF1F7] border border-[#D8DCE8] text-[#0F1C36] text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500"
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
        <div className="text-center py-16 bg-white rounded-xl border border-[#D8DCE8]">
          <FileText className="w-12 h-12 text-[#8E9BB0] mx-auto mb-4" />
          <p className="text-[#4B5A72] mb-4">暂无分析记录</p>
          <button
            onClick={() => navigate("/app/dashboard")}
            className="px-4 py-2 bg-[#1B4FD8] hover:bg-[#163069] rounded-lg font-medium transition-colors"
          >
            开始第一次分析
          </button>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-[#D8DCE8]">
          <p className="text-[#4B5A72]">当前筛选条件下无匹配报告</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTasks.map((task) => (
            <div
              key={task.id}
              onClick={() => handleViewReport(task)}
              className={`p-4 bg-white border border-[#D8DCE8] rounded-xl transition-colors ${
                task.status === "complete" || task.status === "running"
                  ? "cursor-pointer hover:border-[#D8DCE8] hover:bg-[#EEF1F7]"
                  : "opacity-75"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  {/* 评分圆圈 or 文件图标 */}
                  {task.status === "complete" && task.total_score != null ? (
                    <ScoreCircle score={task.total_score} />
                  ) : (
                    <div className="w-10 h-10 bg-[#EEF1F7] rounded-lg flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5 text-[#4B5A72]" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="font-medium mb-1 truncate">
                      {task.title || "BP 尽调分析"}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap text-sm text-[#8E9BB0]">
                      {task.archive_number && (
                        <span className="px-2 py-0.5 rounded text-xs bg-[#E5E9F4] text-[#0F1C36] font-mono">
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
                      {task.status === "complete" && (
                        <ProvinceSelector
                          taskId={task.id}
                          currentLocation={task.project_location}
                          onUpdate={handleProvinceUpdate}
                        />
                      )}
                      {task.stage && task.status === "running" && (
                        <span>{task.message}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* 投资流程阶段 badge（已完成任务） */}
                  {task.status === "complete" && task.project_stage && task.project_stage !== "new" && (
                    <span className={`px-2 py-0.5 rounded border text-xs font-medium ${
                      STAGE_CONFIG[task.project_stage]?.color || "bg-slate-500/20 text-[#4B5A72] border-slate-500/30"
                    }`}>
                      {STAGE_CONFIG[task.project_stage]?.label || task.project_stage}
                    </span>
                  )}
                  {/* 尽调中有问卷图标 */}
                  {["dd_pending","dd_in_progress","dd_done"].includes(task.project_stage) && (
                    <ClipboardList className="w-3.5 h-3.5 text-orange-400" />
                  )}
                  {/* 跟进日期提醒 */}
                  {task.next_followup_date && new Date(task.next_followup_date) <= new Date(Date.now() + 7*24*60*60*1000) && (
                    <Calendar className="w-3.5 h-3.5 text-yellow-400" title={`跟进日期：${task.next_followup_date}`} />
                  )}
                  {/* 调整后分数提示 */}
                  {task.adjusted_score != null && task.adjusted_score !== task.total_score && (
                    <span className="text-xs text-purple-400">→{Math.round(task.adjusted_score)}</span>
                  )}
                  {getStatusBadge(task.status)}
                  {task.status === "complete" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteConfirm(task.id); }}
                      className="p-1 text-[#8E9BB0] hover:text-red-400 transition-colors"
                      title="删除报告"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  {(task.status === "complete" || task.status === "running") && (
                    <ChevronRight className="w-5 h-5 text-[#8E9BB0]" />
                  )}
                </div>
              </div>

              {/* 进度条 */}
              {task.status === "running" && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-[#8E9BB0] mb-1">
                    <span>{task.message}</span>
                    <span>{task.percentage || 0}%</span>
                  </div>
                  <div className="h-1 bg-[#EEF1F7] rounded-full overflow-hidden">
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

      {/* 删除确认弹窗 */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white border border-[#D8DCE8] rounded-xl p-6 max-w-sm mx-4 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <h3 className="text-lg font-bold">确认删除</h3>
            </div>
            <p className="text-[#4B5A72] text-sm mb-6">
              删除后该报告将从您的列表中移除，<strong className="text-red-400">此操作不可恢复</strong>。确定要继续吗？
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm bg-[#EEF1F7] hover:bg-[#E5E9F4] rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => handleDeleteTask(deleteConfirm)}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 rounded-lg transition-colors font-medium"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
