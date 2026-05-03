// ============================================================
// client/src/pages/PlatformStatsPage.jsx — 平台数据看板
//
// 模块5: 平台公共数据（2.1）
// 模块6: 赛道情报（2.2）
// 模块7: 个人工作台数据（2.3）
// ============================================================

import React, { useEffect, useState, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart2, TrendingUp, Globe, Users, Zap,
  Loader2, RefreshCw, ChevronRight, Bell, MapPin,
} from "lucide-react";
import api from "../services/api";
import useAuthStore from "../store/useAuthStore";

const ChinaMap = lazy(() => import("../components/dashboard/ChinaMap"));

const GRADE_COLORS = {
  A: { bar: "bg-emerald-500", text: "text-emerald-400", label: "A级" },
  B: { bar: "bg-blue-500",    text: "text-blue-400",    label: "B级" },
  C: { bar: "bg-yellow-500",  text: "text-yellow-400",  label: "C级" },
  D: { bar: "bg-red-500",     text: "text-red-400",     label: "D级" },
};

const SECTOR_LIST = [
  "人工智能", "具身智能", "芯片半导体", "低空经济", "商业航天",
  "合成生物", "新能源", "生物医药", "先进制造", "企业服务/SaaS",
  "消费/零售", "金融科技",
];

const STAGE_CONFIG = {
  new:            { label: "新建",     color: "text-slate-400" },
  reviewed:       { label: "已评估",   color: "text-blue-400" },
  dd_pending:     { label: "待尽调",   color: "text-yellow-400" },
  dd_in_progress: { label: "尽调中",   color: "text-orange-400" },
  dd_done:        { label: "尽调完成", color: "text-purple-400" },
  decided:        { label: "已决策",   color: "text-emerald-400" },
  passed:         { label: "已投资",   color: "text-green-400" },
};

// 滚动计数器动画
function AnimatedNumber({ value, duration = 1200 }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (!value) return;
    let start = 0;
    const step = value / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= value) { setDisplay(value); clearInterval(timer); }
      else setDisplay(Math.floor(start));
    }, 16);
    return () => clearInterval(timer);
  }, [value, duration]);
  return <span>{display.toLocaleString()}</span>;
}

export default function PlatformStatsPage() {
  const user = useAuthStore(s => s.user);
  const navigate = useNavigate();
  const [platform, setPlatform] = useState(null);
  const [personal, setPersonal] = useState(null);
  const [sectorData, setSectorData] = useState(null);
  const [selectedSector, setSelectedSector] = useState("人工智能");
  const [loadingPlatform, setLoadingPlatform] = useState(true);
  const [loadingSector, setLoadingSector] = useState(false);
  const [loadingPersonal, setLoadingPersonal] = useState(false);
  const [mapData, setMapData] = useState(null);
  const [selectedProvince, setSelectedProvince] = useState(null);

  const fetchPlatform = async () => {
    setLoadingPlatform(true);
    try {
      const data = await api.get("/api/stats/platform");
      setPlatform(data);
    } catch (e) {
      console.error("平台统计加载失败:", e.message);
    } finally {
      setLoadingPlatform(false);
    }
  };

  const fetchSector = async (sector) => {
    setLoadingSector(true);
    setSectorData(null);
    try {
      const data = await api.get(`/api/stats/sector?sector=${encodeURIComponent(sector)}`);
      setSectorData(data);
    } catch (e) {
      console.error("赛道数据加载失败:", e.message);
    } finally {
      setLoadingSector(false);
    }
  };

  const fetchPersonal = async () => {
    if (!user) return;
    setLoadingPersonal(true);
    try {
      const data = await api.get("/api/stats/personal");
      setPersonal(data);
    } catch (e) {
      console.error("个人统计加载失败:", e.message);
    } finally {
      setLoadingPersonal(false);
    }
  };

  const fetchMapData = async () => {
    if (!user) return;
    try {
      const data = await api.get("/api/user/map-data");
      setMapData(data);
    } catch (e) {
      console.error("地图数据加载失败:", e.message);
    }
  };

  useEffect(() => {
    fetchPlatform();
    fetchPersonal();
    fetchMapData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchSector(selectedSector);
  }, [selectedSector]);

  // 计算评级分布百分比
  const calcGradePercents = (dist) => {
    if (!dist) return {};
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    if (total === 0) return { A: 0, B: 0, C: 0, D: 0 };
    return {
      A: Math.round((dist.A / total) * 100),
      B: Math.round((dist.B / total) * 100),
      C: Math.round((dist.C / total) * 100),
      D: Math.round((dist.D / total) * 100),
    };
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart2 className="w-6 h-6 text-blue-400" />
          数据看板
        </h1>
        <button
          onClick={() => { fetchPlatform(); fetchPersonal(); fetchSector(selectedSector); fetchMapData(); }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-slate-800 hover:bg-slate-700 rounded-lg"
        >
          <RefreshCw className="w-4 h-4" />
          刷新
        </button>
      </div>

      {/* ── 个人工作台（2.3）── */}
      {user && (
        <section>
          <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-3">我的工作台</h2>
          {loadingPersonal ? (
            <div className="h-32 flex items-center justify-center bg-slate-900 rounded-xl border border-white/10">
              <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
            </div>
          ) : personal ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <StatCard label="本月分析" value={personal.month_count} unit="份" icon={<FileCountIcon />} />
              <StatCard label="本季度分析" value={personal.quarter_count} unit="份" icon={<TrendingUp className="w-5 h-5 text-blue-400" />} />
              <StatCard label="平均评分" value={personal.avg_score ?? "—"} unit="分" icon={<BarChart2 className="w-5 h-5 text-yellow-400" />} />
              <StatCard label="最高评分" value={personal.top_score ?? "—"} unit="分" icon={<Zap className="w-5 h-5 text-emerald-400" />} />
            </div>
          ) : null}

          {/* 项目管道 */}
          {personal && (
            <div className="bg-slate-900 border border-white/10 rounded-xl p-4">
              <p className="text-sm font-medium text-slate-400 mb-3 flex items-center gap-1.5">
                <Users className="w-4 h-4" />
                项目管道
              </p>
              <div className="flex flex-wrap gap-3">
                {Object.entries(STAGE_CONFIG).map(([key, cfg]) => {
                  const count = personal.pipeline?.[key] || 0;
                  if (count === 0) return null;
                  return (
                    <div key={key} className="flex items-center gap-2 px-3 py-2 bg-slate-800 rounded-lg">
                      <span className={`text-sm font-bold ${cfg.color}`}>{count}</span>
                      <span className="text-xs text-slate-400">{cfg.label}</span>
                    </div>
                  );
                })}
                {Object.values(personal.pipeline || {}).every(v => v === 0) && (
                  <span className="text-sm text-slate-500">暂无项目数据</span>
                )}
              </div>

              {/* 即将到期跟进 */}
              {personal.upcoming_followups?.length > 0 && (
                <div className="mt-4 pt-3 border-t border-white/5">
                  <p className="text-xs text-slate-500 mb-2 flex items-center gap-1">
                    <Bell className="w-3 h-3" />
                    近期跟进提醒
                  </p>
                  {personal.upcoming_followups.map(f => (
                    <div key={f.id} className="flex items-center justify-between py-1.5 text-sm">
                      <span className="text-slate-300">{f.title || "BP项目"}</span>
                      <span className="text-yellow-400 text-xs">{f.date}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 项目地理分布地图 */}
          {mapData && (
            <div className="bg-slate-900 border border-white/10 rounded-xl p-4 mt-4">
              <p className="text-sm font-medium text-slate-400 mb-3 flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-red-400" />
                项目地理分布
              </p>
              <Suspense fallback={
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                </div>
              }>
                <ChinaMap
                  provinces={mapData.provinces || []}
                  details={mapData.details || {}}
                  onProvinceClick={(province) => setSelectedProvince(selectedProvince === province ? null : province)}
                />
              </Suspense>

              {/* 省份标签 */}
              {mapData.provinces?.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {mapData.provinces.map((p) => (
                    <button
                      key={p.province}
                      onClick={() => setSelectedProvince(selectedProvince === p.province ? null : p.province)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                        selectedProvince === p.province
                          ? "bg-blue-500/20 border border-blue-500/40 text-blue-300"
                          : "bg-slate-800 border border-white/10 text-slate-400 hover:text-slate-200 hover:bg-slate-700"
                      }`}
                    >
                      {p.province} ({p.count})
                    </button>
                  ))}
                </div>
              )}

              {/* 选中省份的项目列表 */}
              {selectedProvince && mapData?.details?.[selectedProvince] && (
                <div className="bg-slate-800 rounded-lg p-4 mt-3">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-blue-300">{selectedProvince} — 项目列表</h4>
                    <button onClick={() => setSelectedProvince(null)} className="text-xs text-slate-500 hover:text-slate-300">关闭</button>
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {mapData.details[selectedProvince].map((proj) => (
                      <div
                        key={proj.id}
                        onClick={() => navigate(`/project/${proj.id}`)}
                        className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0 cursor-pointer hover:bg-slate-700/50 rounded px-2 -mx-2 transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-sm truncate">{proj.title || "BP分析"}</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 ml-3">
                          {proj.total_score != null && (
                            <span className={`text-sm font-bold ${
                              proj.total_score >= 75 ? "text-emerald-400" : proj.total_score >= 50 ? "text-yellow-400" : "text-red-400"
                            }`}>{Math.round(proj.total_score)}分</span>
                          )}
                          <span className="text-xs text-slate-500">{new Date(proj.created_at).toLocaleDateString("zh-CN")}</span>
                          <ChevronRight className="w-4 h-4 text-slate-600" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!mapData.provinces?.length && (
                <p className="text-sm text-slate-500 text-center py-6">暂无项目地理数据，在历史报告中为项目选择省份后将显示分布</p>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── 平台公共数据（2.1）── */}
      <section>
        <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-3">平台数据</h2>
        {loadingPlatform ? (
          <div className="h-48 flex items-center justify-center bg-slate-900 rounded-xl border border-white/10">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : platform ? (
          <div className="space-y-4">
            {/* 核心指标卡片 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-slate-900 border border-white/10 rounded-xl p-4 text-center">
                <p className="text-3xl font-black text-white">
                  <AnimatedNumber value={platform.total_count} />
                </p>
                <p className="text-xs text-slate-400 mt-1">累计分析 BP</p>
              </div>
              <div className="bg-slate-900 border border-white/10 rounded-xl p-4 text-center">
                <p className="text-3xl font-black text-blue-400">
                  +<AnimatedNumber value={platform.weekly_new_display} />
                </p>
                <p className="text-xs text-slate-400 mt-1">本周新增</p>
              </div>
              <div className="bg-slate-900 border border-white/10 rounded-xl p-4 text-center">
                <p className="text-3xl font-black text-yellow-400">{platform.avg_score ?? "—"}</p>
                <p className="text-xs text-slate-400 mt-1">平均评分</p>
              </div>
              <div className="bg-slate-900 border border-white/10 rounded-xl p-4 text-center">
                <p className="text-3xl font-black text-emerald-400">{platform.top_score ?? "—"}</p>
                <p className="text-xs text-slate-400 mt-1">历史最高分</p>
              </div>
            </div>

            {/* 评级分布 + 赛道热度 */}
            <div className="grid md:grid-cols-2 gap-4">
              {/* 评级分布 */}
              <div className="bg-slate-900 border border-white/10 rounded-xl p-4">
                <p className="text-sm font-medium text-slate-300 mb-4">评级分布</p>
                <div className="space-y-3">
                  {Object.entries(GRADE_COLORS).map(([grade, cfg]) => {
                    const pct = calcGradePercents(platform.grade_distribution)[grade] || 0;
                    const count = platform.grade_distribution[grade] || 0;
                    return (
                      <div key={grade} className="flex items-center gap-3">
                        <span className={`w-6 text-sm font-bold ${cfg.text}`}>{grade}</span>
                        <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${cfg.bar} rounded-full transition-all duration-700`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-400 w-12 text-right">{pct}%</span>
                        <span className="text-xs text-slate-600 w-10 text-right">{count}份</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 赛道热度 */}
              <div className="bg-slate-900 border border-white/10 rounded-xl p-4">
                <p className="text-sm font-medium text-slate-300 mb-4">赛道热度 Top 10</p>
                {platform.sector_top10?.length > 0 ? (
                  <div className="space-y-2">
                    {platform.sector_top10.map((s, i) => {
                      const maxCount = platform.sector_top10[0]?.count || 1;
                      const pct = Math.round((s.count / maxCount) * 100);
                      return (
                        <div key={s.sector} className="flex items-center gap-2">
                          <span className="text-xs text-slate-600 w-4">{i + 1}</span>
                          <span className="text-xs text-slate-300 w-24 truncate">{s.sector}</span>
                          <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-500 w-10 text-right">{s.count}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">暂无数据</p>
                )}
              </div>
            </div>

            {/* 地域分布 */}
            {platform.location_top10?.length > 0 && (
              <div className="bg-slate-900 border border-white/10 rounded-xl p-4">
                <p className="text-sm font-medium text-slate-300 mb-4 flex items-center gap-1.5">
                  <Globe className="w-4 h-4" />
                  地域分布
                </p>
                <div className="flex flex-wrap gap-2">
                  {platform.location_top10.map(l => (
                    <div key={l.location} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 rounded-lg">
                      <span className="text-sm text-slate-200">{l.location}</span>
                      <span className="text-xs text-slate-500">{l.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 月度趋势 */}
            {platform.monthly_trend?.length > 0 && (
              <div className="bg-slate-900 border border-white/10 rounded-xl p-4">
                <p className="text-sm font-medium text-slate-300 mb-4 flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4" />
                  月度新增趋势（近6个月）
                </p>
                <div className="flex items-end gap-2 h-20">
                  {(() => {
                    const maxVal = Math.max(...platform.monthly_trend.map(m => m.count), 1);
                    return platform.monthly_trend.map(m => {
                      const h = Math.max(8, Math.round((m.count / maxVal) * 64));
                      return (
                        <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                          <span className="text-xs text-slate-500">{m.count}</span>
                          <div
                            className="w-full bg-blue-500/60 rounded-t"
                            style={{ height: `${h}px` }}
                          />
                          <span className="text-xs text-slate-600">{m.month.slice(5)}</span>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-slate-500 text-sm">暂无平台数据</p>
        )}
      </section>

      {/* ── 赛道情报（2.2）── */}
      <section>
        <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-3">赛道情报</h2>
        <div className="bg-slate-900 border border-white/10 rounded-xl overflow-hidden">
          {/* 赛道选择器 */}
          <div className="p-4 border-b border-white/5 overflow-x-auto">
            <div className="flex gap-2 min-w-max">
              {SECTOR_LIST.map(s => (
                <button
                  key={s}
                  onClick={() => setSelectedSector(s)}
                  className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
                    selectedSector === s
                      ? "bg-blue-600 text-white"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* 赛道数据 */}
          <div className="p-4">
            {loadingSector ? (
              <div className="flex items-center gap-3 py-4">
                <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                <span className="text-slate-400 text-sm">加载{selectedSector}赛道数据...</span>
              </div>
            ) : sectorData ? (
              <div>
                <p className="text-lg font-semibold text-slate-200 mb-1">
                  {sectorData.sector}
                </p>
                <p className="text-sm text-slate-400 mb-4">
                  平台本周新增 <strong className="text-blue-400">{sectorData.weekly_new_display}</strong> 份{sectorData.sector} BP，
                  平均评分 <strong className="text-yellow-400">{sectorData.avg_score ?? "—"}</strong> 分，
                  最高分 <strong className="text-emerald-400">{sectorData.top_score ?? "—"}</strong> 分
                </p>
                {/* 评级分布 */}
                {sectorData.grade_distribution && (
                  <div className="grid grid-cols-4 gap-2">
                    {["A", "B", "C", "D"].map(g => {
                      const cfg = GRADE_COLORS[g];
                      const count = sectorData.grade_distribution[g] || 0;
                      return (
                        <div key={g} className="text-center py-3 bg-slate-800 rounded-lg">
                          <p className={`text-2xl font-bold ${cfg.text}`}>{count}</p>
                          <p className="text-xs text-slate-500 mt-1">{cfg.label}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-slate-500 text-sm py-2">暂无该赛道数据</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, unit, icon }) {
  return (
    <div className="bg-slate-900 border border-white/10 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs text-slate-500">{label}</span></div>
      <p className="text-2xl font-bold text-slate-100">
        {typeof value === "number" ? value.toLocaleString() : value}
        {value !== "—" && <span className="text-sm font-normal text-slate-500 ml-1">{unit}</span>}
      </p>
    </div>
  );
}

function FileCountIcon() {
  return <BarChart2 className="w-5 h-5 text-slate-400" />;
}
