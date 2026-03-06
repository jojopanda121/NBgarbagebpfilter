import React, { memo, useState } from "react";
import {
  AlertTriangle,
  Target,
  ChevronDown,
  ChevronUp,
  Microscope,
  CheckCircle,
  XCircle,
  HelpCircle,
  TrendingDown,
  Shield,
  Brain,
} from "lucide-react";
import { dimIcons } from "../../constants";
import { getScoreColor } from "../../utils/scoreHelpers";
import { renderMarkdown } from "../../utils/renderMarkdown";
import useAnalysisStore from "../../store/useAnalysisStore";

// ── 声明核查结论标签 ──
function VerdictBadge({ verdict }) {
  const map = {
    "诚实":      { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30", icon: <CheckCircle className="w-3 h-3" /> },
    "保守低估":  { bg: "bg-teal-500/15",    text: "text-teal-400",    border: "border-teal-500/30",    icon: <CheckCircle className="w-3 h-3" /> },
    "夸大":      { bg: "bg-yellow-500/15",  text: "text-yellow-400",  border: "border-yellow-500/30",  icon: <TrendingDown className="w-3 h-3" /> },
    "严重夸大":  { bg: "bg-orange-500/15",  text: "text-orange-400",  border: "border-orange-500/30",  icon: <AlertTriangle className="w-3 h-3" /> },
    "信息不对称":{ bg: "bg-red-500/15",     text: "text-red-400",     border: "border-red-500/30",     icon: <Shield className="w-3 h-3" /> },
    "存疑":      { bg: "bg-blue-500/15",    text: "text-blue-400",    border: "border-blue-500/30",    icon: <HelpCircle className="w-3 h-3" /> },
    "证伪":      { bg: "bg-red-600/20",     text: "text-red-500",     border: "border-red-600/40",     icon: <XCircle className="w-3 h-3" /> },
  };
  const style = map[verdict] || { bg: "bg-slate-700/50", text: "text-slate-400", border: "border-gray-600/30", icon: <HelpCircle className="w-3 h-3" /> };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${style.bg} ${style.text} ${style.border}`}>
      {style.icon}{verdict || "未判定"}
    </span>
  );
}

// ── 严重程度徽章 ──
function SeverityBadge({ severity }) {
  const map = {
    "严重": "bg-red-500/20 text-red-400 border-red-500/30",
    "高":   "bg-red-500/20 text-red-400 border-red-500/30",
    "中":   "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    "中等": "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    "低":   "bg-blue-500/20 text-blue-400 border-blue-500/30",
  };
  const cls = map[severity] || "bg-slate-700/50 text-slate-400 border-gray-600/30";
  return (
    <span className={`px-2 py-0.5 text-xs font-bold rounded border ${cls}`}>{severity}</span>
  );
}

// ── 类别标签 ──
function CategoryBadge({ category }) {
  const map = {
    market:       { label: "市场规模", cls: "bg-purple-500/15 text-purple-400" },
    tech:         { label: "技术",     cls: "bg-cyan-500/15 text-cyan-400" },
    product:      { label: "产品",     cls: "bg-blue-500/15 text-blue-400" },
    competition:  { label: "竞争",     cls: "bg-orange-500/15 text-orange-400" },
    team:         { label: "团队",     cls: "bg-green-500/15 text-green-400" },
    financial:    { label: "财务",     cls: "bg-yellow-500/15 text-yellow-400" },
    valuation:    { label: "估值",     cls: "bg-red-500/15 text-red-400" },
    policy:       { label: "政策",     cls: "bg-gray-500/15 text-slate-400" },
  };
  const m = map[category] || { label: category, cls: "bg-slate-700/50 text-slate-400" };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${m.cls}`}>{m.label}</span>;
}

// ── 单条声明核查卡片 ──
function ClaimVerdictCard({ item }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="border border-white/10 rounded-xl overflow-hidden cursor-pointer hover:border-white/10 transition-colors"
      onClick={() => setOpen(!open)}
    >
      <div className="flex items-start gap-3 p-3 bg-slate-800/30">
        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
          <CategoryBadge category={item.category} />
          <span className="text-sm text-slate-300 flex-1 min-w-0 truncate">
            {item.original_claim || item.bp_claim || item.claim || "—"}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <VerdictBadge verdict={item.verdict} />
          {open
            ? <ChevronUp className="w-3 h-3 text-slate-500" />
            : <ChevronDown className="w-3 h-3 text-slate-500" />}
        </div>
      </div>

      {open && (
        <div className="border-t border-white/10">
          {/* BP 声称 vs AI 研究 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-800">
            <div className="p-3">
              <div className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-2">📄 BP 声称</div>
              <p className="text-sm text-slate-400 leading-relaxed">{item.bp_claim || item.original_claim || "—"}</p>
            </div>
            <div className="p-3">
              <div className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-2">🔬 AI 研究发现</div>
              <p className="text-sm text-slate-400 leading-relaxed">{item.ai_research || "—"}</p>
            </div>
          </div>

          {/* 差异量化 & 影响 */}
          {(item.diff || item.severity || item.score_impact) && (
            <div className="px-3 py-2 bg-slate-900/50 border-t border-white/10 flex flex-wrap items-center gap-3">
              {item.diff && (
                <span className="text-xs text-orange-400">
                  <span className="font-bold">差异：</span>{item.diff}
                </span>
              )}
              {item.severity && (
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  影响程度：<SeverityBadge severity={item.severity} />
                </span>
              )}
              {item.score_impact && (
                <span className="text-xs text-slate-500 italic">{item.score_impact}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── AI 声明核查面板 ──
const ClaimVerdictsPanel = memo(function ClaimVerdictsPanel({ claimVerdicts }) {
  const [expanded, setExpanded] = useState(true);
  const [filter, setFilter] = useState("all");

  if (!claimVerdicts?.length) return null;

  const filtered = filter === "all"
    ? claimVerdicts
    : filter === "夸大"
    ? claimVerdicts.filter(c => ["夸大", "严重夸大"].includes(c.verdict))
    : filter === "证伪"
    ? claimVerdicts.filter(c => ["证伪", "信息不对称"].includes(c.verdict))
    : claimVerdicts.filter(c => c.verdict === filter);

  const stats = {
    total: claimVerdicts.length,
    honest: claimVerdicts.filter(c => c.verdict === "诚实").length,
    conservative: claimVerdicts.filter(c => c.verdict === "保守低估").length,
    exaggerated: claimVerdicts.filter(c => ["夸大", "严重夸大"].includes(c.verdict)).length,
    questionable: claimVerdicts.filter(c => c.verdict === "存疑").length,
    disproved: claimVerdicts.filter(c => ["证伪", "信息不对称"].includes(c.verdict)).length,
  };

  const FILTERS = [
    { key: "all",    label: `全部 (${stats.total})` },
    { key: "诚实",   label: `诚实 (${stats.honest})` },
    { key: "保守低估", label: `保守 (${stats.conservative})` },
    { key: "夸大",   label: `夸大 (${stats.exaggerated})` },
    { key: "存疑",   label: `存疑 (${stats.questionable})` },
    { key: "证伪",   label: `证伪/信息不对称 (${stats.disproved})` },
  ];

  return (
    <div className="bg-slate-900 border border-white/10 rounded-2xl p-4 sm:p-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-lg font-semibold w-full mb-1"
      >
        <Brain className="w-5 h-5 text-purple-400" />
        AI 逐条声明核查
        <span className="ml-auto flex items-center gap-3 text-sm font-normal">
          <span className="text-emerald-400">{stats.honest} 诚实</span>
          <span className="text-teal-400">{stats.conservative} 保守</span>
          <span className="text-yellow-400">{stats.exaggerated} 夸大</span>
          <span className="text-blue-400">{stats.questionable} 存疑</span>
          <span className="text-red-400">{stats.disproved} 证伪</span>
          {expanded
            ? <ChevronUp className="w-4 h-4 text-slate-500" />
            : <ChevronDown className="w-4 h-4 text-slate-500" />}
        </span>
      </button>
      <p className="text-xs text-slate-600 mb-4 ml-7">
        MiniMax AI 基于知识库对每条 BP 声明进行独立核查，点击展开查看详情
      </p>

      {expanded && (
        <>
          {/* 筛选 */}
          <div className="flex flex-wrap gap-2 mb-4">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={(e) => { e.stopPropagation(); setFilter(f.key); }}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  filter === f.key
                    ? "bg-blue-500/20 text-blue-400 border-blue-500/40"
                    : "bg-slate-800 text-slate-500 border-white/10 hover:border-gray-500"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {filtered.map((item, i) => (
              <ClaimVerdictCard key={i} item={item} />
            ))}
            {filtered.length === 0 && (
              <p className="text-sm text-slate-600 text-center py-4">该类别下暂无声明</p>
            )}
          </div>
        </>
      )}
    </div>
  );
});

// ── 核心冲突汇总 ──
const ConflictsPanel = memo(function ConflictsPanel({ conflicts }) {
  if (!conflicts?.length) return null;

  return (
    <div className="bg-slate-900 border border-white/10 rounded-2xl p-4 sm:p-6">
      <h4 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-yellow-400" />
        核心冲突汇总（BP 诉求 vs AI 研究结论）
      </h4>
      <div className="space-y-3">
        {conflicts.map((c, i) => (
          <div key={i} className="p-4 rounded-xl bg-slate-800/50 border border-white/10">
            <div className="flex items-start gap-3">
              <SeverityBadge severity={c.severity} />
              <div className="flex-1 space-y-2 min-w-0">
                {c.field && (
                  <span className="text-xs text-slate-500 font-mono">[{c.field}]</span>
                )}
                <p className="text-sm">
                  <span className="text-orange-400 font-medium">BP 声称：</span>
                  <span className="text-slate-300">{c.claim}</span>
                </p>
                <p className="text-sm">
                  <span className="text-blue-400 font-medium">AI 研究：</span>
                  <span className="text-slate-400">{c.evidence}</span>
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

// ── 五维评分详情（含 BP vs AI 对比 + 丰富化分析）──
function DimensionDetailCard({ dimKey, dim, Icon }) {
  const [open, setOpen] = useState(false);
  const hasBpVsAi = dim.bp_claim || dim.ai_finding;
  const hasEnrichedData = dim.bp_key_points?.length || dim.ai_research_findings?.length || dim.comprehensive_analysis;

  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <div
        className="flex items-center gap-3 p-4 bg-slate-800/30 cursor-pointer hover:bg-slate-800/50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-slate-800">
          <Icon className="w-5 h-5 text-slate-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{dim.label || dimKey}</span>
            {dim.subtitle && (
              <span className="text-xs text-slate-500 hidden sm:inline">{dim.subtitle}</span>
            )}
            {dimKey === "external_risk" && dim.multiplier !== undefined && (
              <span className={`text-xs font-mono font-bold ${
                dim.multiplier >= 0.95 ? "text-emerald-400" :
                dim.multiplier >= 0.85 ? "text-yellow-400" : "text-red-400"
              }`}>
                ×{dim.multiplier.toFixed(2)} 乘数
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <span className={`text-2xl font-bold ${getScoreColor(dim.score)}`}>{dim.score}</span>
            <span className="text-xs text-slate-600 ml-0.5">/100</span>
          </div>
          <div className="w-14 h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                dim.score >= 70 ? "bg-emerald-500" :
                dim.score >= 50 ? "bg-yellow-500" : "bg-red-500"
              }`}
              style={{ width: `${dim.score}%` }}
            />
          </div>
          {open
            ? <ChevronUp className="w-4 h-4 text-slate-500" />
            : <ChevronDown className="w-4 h-4 text-slate-500" />}
        </div>
      </div>

      {open && (
        <div className="border-t border-white/10 p-4 space-y-4">
          {/* BP 核心声明列表 */}
          {dim.bp_key_points?.length > 0 && (
            <div>
              <div className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-2">📄 BP 核心声明</div>
              <ul className="space-y-1">
                {dim.bp_key_points.map((point, i) => (
                  <li key={i} className="text-sm text-slate-400 leading-relaxed bg-slate-900/50 rounded-lg px-3 py-2 border-l-2 border-blue-500/40">
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* AI 研究发现（逐条对应） */}
          {dim.ai_research_findings?.length > 0 && (
            <div>
              <div className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-2">🔬 AI 研究发现</div>
              <ul className="space-y-1">
                {dim.ai_research_findings.map((finding, i) => (
                  <li key={i} className="text-sm text-slate-400 leading-relaxed bg-slate-900/50 rounded-lg px-3 py-2 border-l-2 border-purple-500/40">
                    {finding}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 综合分析结论 */}
          {dim.comprehensive_analysis && (
            <div>
              <div className="text-xs font-bold text-orange-400 uppercase tracking-wider mb-2">📋 综合分析</div>
              <p className="text-sm text-slate-400 leading-relaxed bg-slate-900/50 rounded-lg p-3 border-l-2 border-orange-500/40">
                {dim.comprehensive_analysis}
              </p>
            </div>
          )}

          {/* 评分理由 */}
          {dim.score_rationale && (
            <div>
              <div className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-2">💡 评分理由</div>
              <p className="text-sm text-slate-400 leading-relaxed bg-slate-900/50 rounded-lg p-3 border-l-2 border-cyan-500/40">
                {dim.score_rationale}
              </p>
            </div>
          )}

          {/* 风险与亮点标签 */}
          {(dim.risk_factors?.length > 0 || dim.positive_signals?.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {dim.risk_factors?.map((risk, i) => (
                <span key={`risk-${i}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-red-500/10 text-red-400 border border-red-500/20">
                  <AlertTriangle className="w-3 h-3" />{risk}
                </span>
              ))}
              {dim.positive_signals?.map((signal, i) => (
                <span key={`pos-${i}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <CheckCircle className="w-3 h-3" />{signal}
                </span>
              ))}
            </div>
          )}

          {/* Fallback: 旧版 AI 分析结论 (when enriched data is unavailable) */}
          {!hasEnrichedData && dim.finding && (
            <div>
              <div className="text-xs font-bold text-orange-400 uppercase tracking-wider mb-2">📋 AI 分析结论</div>
              <p className="text-sm text-slate-400 leading-relaxed bg-slate-900/50 rounded-lg p-3 border-l-2 border-orange-500/40">
                {dim.finding}
              </p>
            </div>
          )}

          {/* Fallback: 旧版 BP 声称 vs AI 发现 */}
          {!hasEnrichedData && hasBpVsAi && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {dim.bp_claim && (
                <div>
                  <div className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-2">📄 BP 声称</div>
                  <p className="text-sm text-slate-400 leading-relaxed bg-slate-900/50 rounded-lg p-3 border-l-2 border-blue-500/40">
                    {dim.bp_claim}
                  </p>
                </div>
              )}
              {dim.ai_finding && (
                <div>
                  <div className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-2">🔬 AI 专家研究</div>
                  <p className="text-sm text-slate-400 leading-relaxed bg-slate-900/50 rounded-lg p-3 border-l-2 border-purple-500/40">
                    {dim.ai_finding}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const DimensionsDetail = memo(function DimensionsDetail({ dimensions }) {
  if (!dimensions) return null;

  return (
    <div className="bg-slate-900 border border-white/10 rounded-2xl p-4 sm:p-6">
      <h4 className="text-lg font-semibold mb-2 flex items-center gap-2">
        <Target className="w-5 h-5 text-blue-400" />
        五维评分详情
      </h4>
      <p className="text-xs text-slate-600 mb-4 ml-7">
        点击每个维度查看 BP 声明 vs AI 专家研究对比
      </p>
      <div className="space-y-3">
        {Object.entries(dimensions).map(([key, dim]) => {
          const Icon = dimIcons[key] || Target;
          return <DimensionDetailCard key={key} dimKey={key} dim={dim} Icon={Icon} />;
        })}
      </div>
    </div>
  );
});

// ── AI 深度研究报告（可折叠）──
const DeepResearchPanel = memo(function DeepResearchPanel({ deepResearch, thinking }) {
  const showResearch = useAnalysisStore((s) => s.showResearch);
  const setShowResearch = useAnalysisStore((s) => s.setShowResearch);

  const hasContent = deepResearch || thinking;
  if (!hasContent) return null;

  return (
    <div className="bg-slate-900 border border-white/10 rounded-2xl p-4 sm:p-6">
      <button
        onClick={() => setShowResearch(!showResearch)}
        className="flex items-center gap-2 text-lg font-semibold w-full"
      >
        <Microscope className="w-5 h-5 text-purple-400" />
        AI 深度研究报告（DeepResearch）
        {showResearch
          ? <ChevronUp className="w-5 h-5 ml-auto text-slate-500" />
          : <ChevronDown className="w-5 h-5 ml-auto text-slate-500" />}
      </button>
      <p className="text-xs text-slate-600 mt-1 ml-7">
        MiniMax M2.5 知识库全量分析 · 市场数据 · 可比公司 · 估值分析 · 投资建议
      </p>

      {showResearch && (
        <div className="mt-4 space-y-4">
          {/* DeepThink 推理过程 */}
          {thinking && (
            <div className="p-4 sm:p-5 bg-purple-900/10 border border-purple-500/20 rounded-xl max-h-96 overflow-y-auto">
              <p className="text-xs text-purple-400 font-semibold mb-3 uppercase tracking-wider flex items-center gap-2">
                <Brain className="w-4 h-4" />
                DeepThink 推理过程（AI 专家团队分析思路）
              </p>
              <div className="text-sm text-slate-400 leading-relaxed whitespace-pre-wrap font-mono">
                {thinking}
              </div>
            </div>
          )}

          {/* 深度研究正文 */}
          {deepResearch && (
            <div className="p-4 sm:p-6 bg-slate-800/50 rounded-xl overflow-x-auto">
              {renderMarkdown(deepResearch)}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

/**
 * DetailedReport — 完整分析报告
 *
 * 展示顺序：AI声明核查 → 核心冲突 → 五维评分详情（含BP vs AI对比）→ 深度研究报告
 */
const DetailedReport = memo(function DetailedReport({ result }) {
  if (!result) return null;

  return (
    <div className="space-y-6">
      <ClaimVerdictsPanel claimVerdicts={result.verdict?.claim_verdicts} />
      <DimensionsDetail dimensions={result.verdict?.dimensions} />
      <DeepResearchPanel
        deepResearch={result.deep_research}
        thinking={result.thinking}
      />
    </div>
  );
});

export default DetailedReport;
