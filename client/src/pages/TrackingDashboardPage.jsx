import React, { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import useAuthStore from "../store/useAuthStore";
import api from "../services/api";
import {
  Database, Building2, Activity, Download, RefreshCw,
  ChevronLeft, ChevronRight, Search, ToggleLeft, ToggleRight,
  AlertTriangle, CheckCircle2, XCircle, Clock, BarChart3,
  Eye, Play, FileJson, TrendingUp, Shield,
} from "lucide-react";

// ── 统计卡片 ──
function StatCard({ icon: Icon, label, value, sub, color = "blue" }) {
  const colors = {
    blue: "from-blue-500/20 to-blue-600/10 border-blue-500/30 text-blue-400",
    green: "from-emerald-500/20 to-emerald-600/10 border-emerald-500/30 text-emerald-400",
    amber: "from-amber-500/20 to-amber-600/10 border-amber-500/30 text-amber-400",
    purple: "from-purple-500/20 to-purple-600/10 border-purple-500/30 text-purple-400",
    red: "from-red-500/20 to-red-600/10 border-red-500/30 text-red-400",
  };
  return (
    <div className={`bg-gradient-to-br ${colors[color]} border rounded-xl p-4`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 opacity-80" />
        <span className="text-xs text-slate-400">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white">{value ?? "—"}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

// ── 状态徽标 ──
function StatusBadge({ status }) {
  const map = {
    active: { label: "正常运营", cls: "bg-emerald-500/20 text-emerald-400", icon: CheckCircle2 },
    operating: { label: "正常运营", cls: "bg-emerald-500/20 text-emerald-400", icon: CheckCircle2 },
    unknown: { label: "未知", cls: "bg-slate-500/20 text-slate-400", icon: Clock },
    suspended: { label: "异常", cls: "bg-amber-500/20 text-amber-400", icon: AlertTriangle },
    abnormal: { label: "异常", cls: "bg-amber-500/20 text-amber-400", icon: AlertTriangle },
    defunct: { label: "已注销", cls: "bg-red-500/20 text-red-400", icon: XCircle },
    liquidated: { label: "已清算", cls: "bg-red-500/20 text-red-400", icon: XCircle },
    dissolved: { label: "已解散", cls: "bg-red-500/20 text-red-400", icon: XCircle },
  };
  const info = map[status] || map.unknown;
  const Icon = info.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${info.cls}`}>
      <Icon className="w-3 h-3" /> {info.label}
    </span>
  );
}

// ── Tab 组件 ──
const TABS = [
  { key: "overview", label: "数据总览", icon: BarChart3 },
  { key: "companies", label: "企业列表", icon: Building2 },
  { key: "validations", label: "预测回测", icon: TrendingUp },
  { key: "export", label: "数据导出", icon: Download },
];

// ════════════════════════════════════════════════════════════
// 主组件
// ════════════════════════════════════════════════════════════
export default function TrackingDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState("overview");

  if (user?.role !== "admin") {
    return <Navigate to="/app/dashboard" replace />;
  }

  return (
    <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-blue-500/20 rounded-lg">
          <Database className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">训练数据看板</h1>
          <p className="text-sm text-slate-400">企业追踪 · 预测回测 · 数据导出</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-900/50 border border-white/10 rounded-xl p-1 mb-6 overflow-x-auto">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
              tab === key
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                : "text-slate-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && <OverviewTab />}
      {tab === "companies" && <CompaniesTab />}
      {tab === "validations" && <ValidationsTab />}
      {tab === "export" && <ExportTab />}
    </main>
  );
}

// ════════════════════════════════════════════════════════════
// Tab 1: 数据总览
// ════════════════════════════════════════════════════════════
function OverviewTab() {
  const [data, setData] = useState(null);
  const [qccStatus, setQccStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get("/api/admin/tracking/dashboard"),
      api.get("/api/admin/tracking/qcc-status"),
    ])
      .then(([dash, qcc]) => {
        setData(dash.data);
        setQccStatus(qcc);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner />;
  if (!data) return <EmptyState message="暂无追踪数据" />;

  const { total_companies, status_distribution, prediction_accuracy, recent_snapshots, corpus_stats } = data;

  return (
    <div className="space-y-6">
      {/* 核心指标 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard icon={Building2} label="追踪企业" value={total_companies} color="blue" />
        <StatCard icon={Database} label="BP 语料" value={corpus_stats.total_bp_records} sub={`${(corpus_stats.total_characters / 10000).toFixed(1)} 万字`} color="purple" />
        <StatCard icon={TrendingUp} label="验证次数" value={prediction_accuracy.total_validations} color="green" />
        <StatCard
          icon={Activity}
          label="平均误差"
          value={prediction_accuracy.avg_score_error ?? "—"}
          sub="预测分 vs 实际分"
          color={prediction_accuracy.avg_score_error > 30 ? "red" : "amber"}
        />
        <StatCard
          icon={Shield}
          label="企查查"
          value={qccStatus?.enabled ? "已连接" : "未配置"}
          color={qccStatus?.enabled ? "green" : "red"}
        />
      </div>

      {/* 状态分布 + 评级分布 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-4">
          <h3 className="text-sm font-medium text-white mb-3">企业状态分布</h3>
          {Object.keys(status_distribution).length === 0 ? (
            <p className="text-sm text-slate-500">暂无数据</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(status_distribution).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <StatusBadge status={status} />
                  <span className="text-white font-medium">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-4">
          <h3 className="text-sm font-medium text-white mb-3">预测评级分布</h3>
          {Object.keys(prediction_accuracy.grade_distribution).length === 0 ? (
            <p className="text-sm text-slate-500">暂无回测数据</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(prediction_accuracy.grade_distribution).map(([grade, count]) => {
                const gradeColors = { A: "text-emerald-400", B: "text-blue-400", C: "text-amber-400", D: "text-red-400" };
                return (
                  <div key={grade} className="flex items-center justify-between">
                    <span className={`font-bold ${gradeColors[grade] || "text-slate-400"}`}>评级 {grade}</span>
                    <span className="text-white font-medium">{count} 次</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 最近快照 */}
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-4">
        <h3 className="text-sm font-medium text-white mb-3">最近快照</h3>
        {recent_snapshots.length === 0 ? (
          <p className="text-sm text-slate-500">暂无快照数据</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-left">
                  <th className="pb-2 pr-4">企业名称</th>
                  <th className="pb-2 pr-4">快照时间</th>
                  <th className="pb-2 pr-4">运营状态</th>
                  <th className="pb-2">置信度</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {recent_snapshots.map((s) => (
                  <tr key={s.id} className="border-t border-white/5">
                    <td className="py-2 pr-4 text-white">{s.company_name}</td>
                    <td className="py-2 pr-4">{s.snapshot_date?.slice(0, 10)}</td>
                    <td className="py-2 pr-4"><StatusBadge status={s.operating_status} /></td>
                    <td className="py-2">{s.confidence ? `${(s.confidence * 100).toFixed(0)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Tab 2: 企业列表
// ════════════════════════════════════════════════════════════
function CompaniesTab() {
  const [companies, setCompanies] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [runningQuarterly, setRunningQuarterly] = useState(false);
  const [quarterlyResult, setQuarterlyResult] = useState(null);
  const pageSize = 15;

  const fetchCompanies = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page, pageSize });
    if (search) params.set("search", search);
    api.get(`/api/admin/tracking/companies?${params}`)
      .then((res) => {
        setCompanies(res.data);
        setTotal(res.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, search]);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  const toggleTracking = async (id) => {
    try {
      await api.post(`/api/admin/tracking/companies/${id}/toggle`);
      fetchCompanies();
    } catch {}
  };

  const viewDetail = async (id) => {
    try {
      const res = await api.get(`/api/admin/tracking/companies/${id}`);
      setDetail(res.data);
    } catch {}
  };

  const runQuarterly = async () => {
    setRunningQuarterly(true);
    setQuarterlyResult(null);
    try {
      const res = await api.post("/api/admin/tracking/run-quarterly");
      setQuarterlyResult(res.stats);
      fetchCompanies();
    } catch (err) {
      setQuarterlyResult({ error: err.message || "执行失败" });
    } finally {
      setRunningQuarterly(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      {/* 搜索栏 + 操作按钮 */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="搜索企业名称或行业..."
            className="w-full pl-9 pr-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white text-sm placeholder-slate-500 focus:border-blue-500/50 focus:outline-none"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <button
          onClick={runQuarterly}
          disabled={runningQuarterly}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm text-white font-medium transition"
        >
          {runningQuarterly ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          {runningQuarterly ? "执行中..." : "运行季度追踪"}
        </button>
      </div>

      {/* 季度追踪结果 */}
      {quarterlyResult && (
        <div className={`rounded-lg p-3 text-sm ${quarterlyResult.error ? "bg-red-500/10 border border-red-500/20 text-red-400" : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"}`}>
          {quarterlyResult.error ? (
            <span>执行失败：{quarterlyResult.error}</span>
          ) : (
            <span>
              追踪完成：共 {quarterlyResult.total_companies} 家企业，
              创建 {quarterlyResult.snapshots_created} 个快照，
              生成 {quarterlyResult.validations_generated} 条验证，
              {quarterlyResult.errors > 0 ? `${quarterlyResult.errors} 个错误` : "无错误"}
            </span>
          )}
        </div>
      )}

      {/* 企业详情弹层 */}
      {detail && (
        <CompanyDetailModal detail={detail} onClose={() => setDetail(null)} />
      )}

      {/* 企业列表 */}
      {loading ? <LoadingSpinner /> : (
        <>
          <div className="bg-slate-900/50 border border-white/10 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 text-left bg-slate-800/30">
                    <th className="p-3">企业名称</th>
                    <th className="p-3">行业</th>
                    <th className="p-3">状态</th>
                    <th className="p-3">BP 数</th>
                    <th className="p-3">快照数</th>
                    <th className="p-3">追踪</th>
                    <th className="p-3">操作</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {companies.length === 0 ? (
                    <tr><td colSpan={7} className="p-8 text-center text-slate-500">暂无企业数据</td></tr>
                  ) : companies.map((c) => (
                    <tr key={c.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                      <td className="p-3 text-white font-medium">{c.company_name}</td>
                      <td className="p-3 text-xs">{c.industry_tags || "—"}</td>
                      <td className="p-3"><StatusBadge status={c.current_status} /></td>
                      <td className="p-3">{c.bp_count}</td>
                      <td className="p-3">{c.snapshot_count}</td>
                      <td className="p-3">
                        <button onClick={() => toggleTracking(c.id)} className="text-slate-400 hover:text-white transition">
                          {c.tracking_enabled ? (
                            <ToggleRight className="w-5 h-5 text-emerald-400" />
                          ) : (
                            <ToggleLeft className="w-5 h-5" />
                          )}
                        </button>
                      </td>
                      <td className="p-3">
                        <button
                          onClick={() => viewDetail(c.id)}
                          className="flex items-center gap-1 text-blue-400 hover:text-blue-300 text-xs transition"
                        >
                          <Eye className="w-3.5 h-3.5" /> 详情
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">共 {total} 家企业</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 text-slate-300 transition"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-slate-300">{page} / {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 text-slate-300 transition"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── 企业详情弹层 ──
function CompanyDetailModal({ detail, onClose }) {
  const { company, snapshots, bp_links, validations } = detail;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-slate-900 border border-white/10 rounded-2xl max-w-3xl w-full max-h-[80vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-white">{company.company_name}</h2>
            <p className="text-sm text-slate-400">{company.industry_tags || "未分类"} · {company.city || "未知地区"}</p>
          </div>
          <StatusBadge status={company.current_status} />
        </div>

        {/* 基本信息 */}
        <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
          <div className="bg-white/5 rounded-lg p-3">
            <span className="text-slate-400">统一社会信用代码</span>
            <p className="text-white mt-1">{company.credit_code || "—"}</p>
          </div>
          <div className="bg-white/5 rounded-lg p-3">
            <span className="text-slate-400">创始人</span>
            <p className="text-white mt-1">{company.founder_names || "—"}</p>
          </div>
        </div>

        {/* BP 链接 */}
        {bp_links.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-medium text-white mb-2">关联 BP 分析 ({bp_links.length})</h3>
            <div className="space-y-1">
              {bp_links.map((link) => (
                <div key={link.id} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 text-sm">
                  <span className="text-slate-300">任务 {link.task_id?.slice(0, 8)}</span>
                  <span className="text-white font-medium">{link.ai_total_score ? `${link.ai_total_score} 分` : "—"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 快照时间线 */}
        {snapshots.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-medium text-white mb-2">快照时间线 ({snapshots.length})</h3>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {snapshots.map((snap) => (
                <div key={snap.id} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 text-sm">
                  <span className="text-slate-300">{snap.snapshot_date?.slice(0, 10)}</span>
                  <StatusBadge status={snap.operating_status} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 验证记录 */}
        {validations.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-white mb-2">预测验证 ({validations.length})</h3>
            <div className="space-y-1">
              {validations.map((v) => (
                <div key={v.id} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 text-sm">
                  <div>
                    <span className="text-slate-300">预测 {v.prediction_score} → 实际 {v.outcome_score}</span>
                    <span className="text-slate-500 ml-2">({v.months_elapsed} 个月后)</span>
                  </div>
                  <span className={`font-medium ${v.score_error > 30 ? "text-red-400" : v.score_error > 15 ? "text-amber-400" : "text-emerald-400"}`}>
                    误差 {v.score_error?.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <button onClick={onClose} className="mt-4 w-full py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm text-white transition">
          关闭
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Tab 3: 预测回测
// ════════════════════════════════════════════════════════════
function ValidationsTab() {
  const [validations, setValidations] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 20;

  useEffect(() => {
    setLoading(true);
    api.get(`/api/admin/tracking/validations?page=${page}&pageSize=${pageSize}`)
      .then((res) => {
        setValidations(res.data);
        setTotal(res.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page]);

  const totalPages = Math.ceil(total / pageSize);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="bg-slate-900/50 border border-white/10 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-left bg-slate-800/30">
                <th className="p-3">企业名称</th>
                <th className="p-3">预测分</th>
                <th className="p-3">评级</th>
                <th className="p-3">实际分</th>
                <th className="p-3">实际状态</th>
                <th className="p-3">误差</th>
                <th className="p-3">经过月数</th>
                <th className="p-3">验证时间</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {validations.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-slate-500">暂无回测数据，请先运行季度追踪</td></tr>
              ) : validations.map((v) => (
                <tr key={v.id} className="border-t border-white/5">
                  <td className="p-3 text-white">{v.company_name}</td>
                  <td className="p-3 font-medium">{v.prediction_score}</td>
                  <td className="p-3">
                    <span className={`font-bold ${
                      v.prediction_grade === "A" ? "text-emerald-400" :
                      v.prediction_grade === "B" ? "text-blue-400" :
                      v.prediction_grade === "C" ? "text-amber-400" : "text-red-400"
                    }`}>{v.prediction_grade}</span>
                  </td>
                  <td className="p-3">{v.outcome_score}</td>
                  <td className="p-3"><StatusBadge status={v.outcome_status} /></td>
                  <td className="p-3">
                    <span className={`font-medium ${v.score_error > 30 ? "text-red-400" : v.score_error > 15 ? "text-amber-400" : "text-emerald-400"}`}>
                      {v.score_error?.toFixed(1)}
                    </span>
                  </td>
                  <td className="p-3">{v.months_elapsed}</td>
                  <td className="p-3 text-xs">{v.validation_date?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">共 {total} 条记录</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 text-slate-300 transition">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-slate-300">{page} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 text-slate-300 transition">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Tab 4: 数据导出
// ════════════════════════════════════════════════════════════
function ExportTab() {
  const [months, setMonths] = useState(12);
  const [format, setFormat] = useState("jsonl");
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(
        `${window.__API_BASE || ""}/api/admin/tracking/export?months=${months}&format=${format}`,
        {
          headers: {
            Authorization: `Bearer ${useAuthStore.getState().token}`,
          },
        }
      );

      if (!res.ok) throw new Error("导出失败");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `training_data_${months}m.${format === "jsonl" ? "jsonl" : "json"}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("导出失败，请稍后重试");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="max-w-lg">
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-2 mb-2">
          <FileJson className="w-5 h-5 text-blue-400" />
          <h3 className="text-white font-medium">导出训练数据</h3>
        </div>
        <p className="text-sm text-slate-400">
          导出 BP 文本 + AI 预测分 + 实际结果三元组，用于模型微调。
        </p>

        <div>
          <label className="block text-sm text-slate-400 mb-1">时间窗口</label>
          <select
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm focus:border-blue-500/50 focus:outline-none"
          >
            <option value={3}>最近 3 个月</option>
            <option value={6}>最近 6 个月</option>
            <option value={12}>最近 12 个月</option>
            <option value={24}>最近 24 个月</option>
            <option value={9999}>全部数据</option>
          </select>
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-1">导出格式</label>
          <div className="flex gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="format" value="jsonl" checked={format === "jsonl"} onChange={(e) => setFormat(e.target.value)} className="accent-blue-500" />
              <span className="text-sm text-white">JSONL（微调推荐）</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="format" value="json" checked={format === "json"} onChange={(e) => setFormat(e.target.value)} className="accent-blue-500" />
              <span className="text-sm text-white">JSON</span>
            </label>
          </div>
        </div>

        <button
          onClick={handleExport}
          disabled={exporting}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm text-white font-medium transition"
        >
          {exporting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {exporting ? "导出中..." : "下载训练数据"}
        </button>
      </div>
    </div>
  );
}

// ── 通用组件 ──
function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-slate-500">
      <Database className="w-8 h-8 mb-2 opacity-50" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
