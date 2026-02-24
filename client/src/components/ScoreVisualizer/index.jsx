import React, { memo } from "react";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Target, BarChart3 } from "lucide-react";
import { dimLabelsMap, dimIcons } from "../../constants";
import { getScoreColor } from "../../utils/scoreHelpers";

// ── 雷达图 ──
const RadarChartPanel = memo(function RadarChartPanel({ dimensions }) {
  if (!dimensions) {
    return <p className="text-gray-500 text-sm">暂无数据</p>;
  }

  const data = Object.entries(dimensions).map(([key, dim]) => ({
    dimension: dim.label || dimLabelsMap[key] || key,
    score: dim.score || 0,
    fullMark: 100,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <RadarChart data={data} cx="50%" cy="50%" outerRadius="75%">
        <PolarGrid stroke="#374151" />
        <PolarAngleAxis
          dataKey="dimension"
          tick={{ fill: "#9ca3af", fontSize: 12 }}
        />
        <PolarRadiusAxis
          angle={90}
          domain={[0, 100]}
          tick={{ fill: "#6b7280", fontSize: 10 }}
        />
        <Radar
          name="得分"
          dataKey="score"
          stroke="#3b82f6"
          fill="#3b82f6"
          fillOpacity={0.2}
          strokeWidth={2}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#1f2937",
            border: "1px solid #374151",
            borderRadius: "8px",
          }}
          labelStyle={{ color: "#e5e7eb" }}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
});

// ── 估值温度计 ──
const ValuationThermometer = memo(function ValuationThermometer({ data }) {
  if (!data || (!data.bp_multiple && !data.industry_avg_multiple)) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-gray-500 text-sm">
        <BarChart3 className="w-8 h-8 mb-2 opacity-30" />
        估值对比数据不可用
      </div>
    );
  }

  const bp = data.bp_multiple || 0;
  const avg = data.industry_avg_multiple || 1;
  const overvalued =
    data.overvalued_pct ?? Math.round(((bp - avg) / avg) * 100);
  const maxVal = Math.max(bp, avg) * 1.3;
  const bpPct = Math.min((bp / maxVal) * 100, 100);
  const avgPct = Math.min((avg / maxVal) * 100, 100);

  return (
    <div className="space-y-5">
      {/* BP 估值倍数 */}
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-400">BP 声称估值倍数</span>
          <span className="font-mono font-bold text-orange-400">{bp}x</span>
        </div>
        <div className="h-4 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-orange-500 to-red-500 rounded-full transition-all duration-700"
            style={{ width: `${bpPct}%` }}
          />
        </div>
      </div>

      {/* 行业平均 */}
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-400">
            行业平均估值倍数
            {data.industry_name && (
              <span className="text-gray-600 ml-1">
                ({data.industry_name})
              </span>
            )}
          </span>
          <span className="font-mono font-bold text-blue-400">{avg}x</span>
        </div>
        <div className="h-4 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full transition-all duration-700"
            style={{ width: `${avgPct}%` }}
          />
        </div>
      </div>

      {/* 溢价比例 */}
      <div
        className={`text-center p-3 rounded-xl ${
          overvalued > 100
            ? "bg-red-500/10 border border-red-500/20"
            : overvalued > 50
            ? "bg-yellow-500/10 border border-yellow-500/20"
            : "bg-emerald-500/10 border border-emerald-500/20"
        }`}
      >
        <span className="text-sm text-gray-400">溢价程度：</span>
        <span
          className={`text-lg font-bold ml-2 ${
            overvalued > 100
              ? "text-red-400"
              : overvalued > 50
              ? "text-yellow-400"
              : "text-emerald-400"
          }`}
        >
          {overvalued > 0 ? `+${overvalued}%` : `${overvalued}%`}
        </span>
      </div>

      {data.data_source && (
        <p className="text-xs text-gray-600 text-center">数据来源：{data.data_source}</p>
      )}
      {data.analysis && (
        <p className="text-xs text-gray-500 leading-relaxed">{data.analysis}</p>
      )}
    </div>
  );
});

// ── 维度进度条列表 ──
const DimensionBars = memo(function DimensionBars({ dimensions }) {
  if (!dimensions) return null;
  return (
    <div className="mt-6 space-y-3">
      {Object.entries(dimensions).map(([key, dim]) => {
        const Icon = dimIcons[key] || Target;

        // 外部风险维度：显示乘数效果
        if (key === "external_risk" && dim.multiplier !== undefined) {
          return (
            <div key={key} className="flex items-center gap-3">
              <Icon className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="text-sm text-gray-400 w-20 sm:w-32 shrink-0 truncate">
                {dim.label || key}
              </span>
              <div className="flex-1 flex items-center gap-2">
                <span className="text-sm text-gray-500">乘数效果:</span>
                <span
                  className={`text-sm font-mono font-bold ${
                    dim.multiplier >= 0.9
                      ? "text-emerald-400"
                      : dim.multiplier >= 0.5
                      ? "text-yellow-400"
                      : "text-red-400"
                  }`}
                >
                  ×{dim.multiplier.toFixed(1)}
                </span>
              </div>
            </div>
          );
        }

        return (
          <div key={key} className="flex items-center gap-3">
            <Icon className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="text-sm text-gray-400 w-20 sm:w-32 shrink-0 truncate">
              {dim.label || key}
            </span>
            <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  dim.score >= 70
                    ? "bg-emerald-500"
                    : dim.score >= 50
                    ? "bg-yellow-500"
                    : "bg-red-500"
                }`}
                style={{ width: `${dim.score}%` }}
              />
            </div>
            <span
              className={`text-sm font-mono font-bold w-8 text-right ${getScoreColor(
                dim.score
              )}`}
            >
              {dim.score}
            </span>
          </div>
        );
      })}
    </div>
  );
});

/**
 * ScoreVisualizer
 *
 * 职责：展示五维雷达图 + 估值温度计 + 各维度进度条。
 *
 * 性能策略：
 *   - memo 阻断父组件无关更新。
 *   - 仅在 result.verdict 实际变化时重渲染（引用稳定）。
 */
const ScoreVisualizer = memo(function ScoreVisualizer({ verdict }) {
  if (!verdict) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 雷达图 */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-6">
        <h4 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Target className="w-5 h-5 text-blue-400" />
          五维雷达图
        </h4>
        <RadarChartPanel dimensions={verdict.dimensions} />
      </div>

      {/* 估值温度计 + 维度进度条 */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-6">
        <h4 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-orange-400" />
          估值温度计
        </h4>
        <ValuationThermometer data={verdict.valuation_comparison} />
      </div>
    </div>
  );
});

export default ScoreVisualizer;
