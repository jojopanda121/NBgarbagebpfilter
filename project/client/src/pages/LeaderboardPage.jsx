import React, { useState, useEffect } from "react";
import { Trophy, Medal, Crown, TrendingUp, FileText } from "lucide-react";
import api from "../services/api";

const RANK_ICONS = [Crown, Medal, Medal];
const RANK_COLORS = [
  "text-yellow-400",
  "text-slate-300",
  "text-amber-600",
  "text-slate-400",
  "text-slate-500",
];

function RankBadge({ rank }) {
  const Icon = RANK_ICONS[rank - 1] || null;
  return (
    <div className={`w-8 h-8 flex items-center justify-center font-bold text-lg ${RANK_COLORS[rank - 1] || "text-slate-500"}`}>
      {Icon ? <Icon className="w-5 h-5" /> : rank}
    </div>
  );
}

export default function LeaderboardPage() {
  const [period, setPeriod] = useState("weekly");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/api/leaderboard?period=${period}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [period]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Trophy className="w-7 h-7 text-yellow-400" />
          <h1 className="text-2xl font-bold">排行榜</h1>
        </div>
        <div className="flex gap-2">
          {["weekly", "monthly"].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                period === p
                  ? "bg-blue-500/20 text-blue-400 border-blue-500/40"
                  : "bg-slate-800 text-slate-400 border-white/10 hover:border-slate-500"
              }`}
            >
              {p === "weekly" ? "周榜" : "月榜"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 分析数量榜 */}
          <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <FileText className="w-5 h-5 text-blue-400" />
              <h2 className="text-lg font-semibold">分析 BP 最多</h2>
            </div>
            {data?.count_board?.length > 0 ? (
              <div className="space-y-3">
                {data.count_board.map((item) => (
                  <div
                    key={item.rank}
                    className={`flex items-center gap-3 p-3 rounded-lg ${
                      item.rank === 1 ? "bg-yellow-500/10 border border-yellow-500/20" : "bg-slate-800/50"
                    }`}
                  >
                    <RankBadge rank={item.rank} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{item.username}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-lg font-bold text-blue-400">{item.count}</span>
                      <span className="text-xs text-slate-500 ml-1">个BP</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-slate-500 py-8">暂无数据</p>
            )}
          </div>

          {/* 最高分数榜 */}
          <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              <h2 className="text-lg font-semibold">最高分数</h2>
            </div>
            {data?.score_board?.length > 0 ? (
              <div className="space-y-3">
                {data.score_board.map((item) => (
                  <div
                    key={item.rank}
                    className={`flex items-center gap-3 p-3 rounded-lg ${
                      item.rank === 1 ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-slate-800/50"
                    }`}
                  >
                    <RankBadge rank={item.rank} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{item.username}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-lg font-bold text-emerald-400">{item.max_score}</span>
                      <span className="text-xs text-slate-500 ml-1">分</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-slate-500 py-8">暂无数据</p>
            )}
          </div>
        </div>
      )}

      <p className="text-center text-xs text-slate-600 mt-6">
        {period === "weekly" ? "周榜每周一更新" : "月榜每月1号更新"} · 仅显示前5名 · 不泄露项目信息
      </p>
    </div>
  );
}
