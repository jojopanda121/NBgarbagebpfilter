import React, { memo } from "react";
import {
  Search,
  AlertTriangle,
  Target,
  ChevronDown,
  ChevronUp,
  Microscope,
  BarChart3,
} from "lucide-react";
import { dimIcons } from "../../constants";
import { getScoreColor } from "../../utils/scoreHelpers";
import { renderMarkdown } from "../../utils/renderMarkdown";
import useAnalysisStore from "../../store/useAnalysisStore";

// ── 联网取证摘要 ──
const SearchResultsPanel = memo(function SearchResultsPanel({ result }) {
  if (!result.search_results) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-6">
      <h4 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Search className="w-5 h-5 text-cyan-400" />
        联网取证摘要
        {result.search_summary && (
          <span className="text-sm font-normal text-gray-500 ml-2">
            {result.search_summary.mock
              ? "(搜索未启用 — Mock模式)"
              : `共 ${result.search_summary.total_results} 条搜索结果`}
          </span>
        )}
      </h4>
      <div className="space-y-3">
        {result.search_results.map((sr, i) => {
          const query_item = result.extracted_data?.search_queries?.[i];
          return (
            <div
              key={i}
              className="p-3 rounded-xl bg-gray-800/50 border border-gray-700"
            >
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="px-2 py-0.5 text-xs font-bold rounded bg-blue-500/20 text-blue-400 shrink-0">
                  {query_item?.dimension || `维度${i + 1}`}
                </span>
                <span className="text-sm text-gray-400 truncate min-w-0 flex-1">
                  {sr.query}
                </span>
                <span
                  className={`text-xs font-mono shrink-0 ${
                    sr.results?.length > 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {sr.results?.length || 0} 条结果
                </span>
              </div>
              {sr.results?.length > 0 ? (
                <div className="space-y-1 ml-4">
                  {sr.results.slice(0, 3).map((r, j) => (
                    <div key={j} className="text-xs text-gray-500">
                      <span className="text-gray-400">{r.title}</span>
                      {r.snippet && (
                        <span className="ml-1">
                          — {r.snippet.slice(0, 80)}
                        </span>
                      )}
                    </div>
                  ))}
                  {sr.results.length > 3 && (
                    <span className="text-xs text-gray-600">
                      ... 还有 {sr.results.length - 3} 条
                    </span>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-600 ml-4">
                  {sr.mock
                    ? "搜索未启用（需配置 SERPER_API_KEY）"
                    : sr.error
                    ? `搜索出错: ${sr.error}`
                    : "未找到相关结果"}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* 行业 PE 数据状态 */}
      {result.industry_pe && (
        <div className="mt-3 p-3 rounded-xl bg-gray-800/30 border border-gray-700/50 flex items-center gap-3">
          <BarChart3 className="w-4 h-4 text-orange-400 shrink-0" />
          <span className="text-sm text-gray-400">
            行业估值数据：
            {result.industry_pe.industry_pe ? (
              <span className="text-orange-400 font-mono ml-1">
                {result.industry_pe.industry_name} 平均PE{" "}
                {result.industry_pe.industry_pe}x
                <span className="text-gray-600 ml-1">
                  (来源: {result.industry_pe.source})
                </span>
              </span>
            ) : (
              <span className="text-gray-600 ml-1">AkShare 数据不可用</span>
            )}
          </span>
        </div>
      )}
    </div>
  );
});

// ── 冲突分析 ──
const ConflictsPanel = memo(function ConflictsPanel({ conflicts }) {
  if (!conflicts?.length) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-6">
      <h4 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-yellow-400" />
        冲突分析（BP 诉求 vs 搜索证据）
      </h4>
      <div className="space-y-4">
        {conflicts.map((c, i) => (
          <div
            key={i}
            className="p-4 rounded-xl bg-gray-800/50 border border-gray-700"
          >
            <div className="flex items-start gap-3">
              <span
                className={`px-2 py-0.5 text-xs font-bold rounded shrink-0 ${
                  c.severity === "严重"
                    ? "bg-red-500/20 text-red-400"
                    : c.severity === "中等"
                    ? "bg-yellow-500/20 text-yellow-400"
                    : "bg-blue-500/20 text-blue-400"
                }`}
              >
                {c.severity}
              </span>
              <div className="flex-1 space-y-2">
                <p className="text-sm">
                  <span className="text-red-400 font-medium">BP 声称：</span>
                  {c.claim}
                </p>
                <p className="text-sm">
                  <span className="text-emerald-400 font-medium">
                    搜索发现：
                  </span>
                  {c.evidence}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

// ── 五维评分详情 ──
const DimensionsDetail = memo(function DimensionsDetail({ dimensions }) {
  if (!dimensions) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-6">
      <h4 className="text-lg font-semibold mb-4">五维评分详情</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.entries(dimensions).map(([key, dim]) => {
          const Icon = dimIcons[key] || Target;
          return (
            <div
              key={key}
              className="p-4 rounded-xl bg-gray-800/50 border border-gray-700"
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon className="w-4 h-4 text-gray-400" />
                <div className="flex-1">
                  <span className="font-medium block">{dim.label || key}</span>
                  {dim.subtitle && (
                    <span className="text-xs text-gray-500">{dim.subtitle}</span>
                  )}
                </div>
                <span
                  className={`ml-auto text-lg font-bold ${getScoreColor(
                    dim.score
                  )}`}
                >
                  {dim.score}
                </span>
              </div>
              <p className="text-sm text-gray-400">{dim.finding}</p>
              {key === "external_risk" && dim.multiplier !== undefined && (
                <p className="text-xs text-gray-500 mt-2">
                  乘数效果: ×{dim.multiplier.toFixed(2)}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ── Extended Thinking / 深度研究（可折叠）──
const DeepResearchPanel = memo(function DeepResearchPanel({
  deepResearch,
  thinking,
}) {
  const showResearch = useAnalysisStore((s) => s.showResearch);
  const setShowResearch = useAnalysisStore((s) => s.setShowResearch);

  const hasContent = deepResearch || thinking;
  if (!hasContent) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-6">
      <button
        onClick={() => setShowResearch(!showResearch)}
        className="flex items-center gap-2 text-lg font-semibold w-full"
      >
        <Microscope className="w-5 h-5 text-purple-400" />
        AI 深度研究报告（DeepResearch）
        {showResearch ? (
          <ChevronUp className="w-5 h-5 ml-auto text-gray-500" />
        ) : (
          <ChevronDown className="w-5 h-5 ml-auto text-gray-500" />
        )}
      </button>

      {showResearch && (
        <div className="mt-4 space-y-4">
          {/* Extended Thinking 过程（折叠内部再分区块） */}
          {thinking && (
            <div className="p-4 sm:p-6 bg-purple-900/10 border border-purple-500/20 rounded-xl max-h-[400px] overflow-y-auto">
              <p className="text-xs text-purple-400 font-semibold mb-3 uppercase tracking-wider">
                Extended Thinking 过程
              </p>
              {renderMarkdown(thinking)}
            </div>
          )}

          {/* 深度研究正文 */}
          {deepResearch && (
            <div className="p-4 sm:p-6 bg-gray-800/50 rounded-xl max-h-[600px] overflow-y-auto overflow-x-auto">
              {renderMarkdown(deepResearch)}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

/**
 * DetailedReport
 *
 * 职责：渲染完整分析报告——取证摘要、冲突分析、五维详情、深度研究。
 *
 * 性能策略：
 *   - memo 阻断与 result 无关的父层更新（如 currentStep 变化）。
 *   - 子面板各自 memo，showResearch 切换只重渲染 DeepResearchPanel。
 *   - 仅在 result 非空时挂载，分析中完全不渲染。
 */
const DetailedReport = memo(function DetailedReport({ result }) {
  if (!result) return null;

  return (
    <div className="space-y-6">
      <SearchResultsPanel result={result} />
      <ConflictsPanel conflicts={result.verdict?.conflicts} />
      <DimensionsDetail dimensions={result.verdict?.dimensions} />
      <DeepResearchPanel
        deepResearch={result.deep_research}
        thinking={result.thinking}
      />
    </div>
  );
});

export default DetailedReport;
