import React, { useState, memo } from "react";
import {
  FileText, Users, BarChart3, TrendingUp, AlertTriangle, DollarSign,
  ChevronDown, ChevronUp, CheckCircle2, XCircle, AlertCircle, Shield,
} from "lucide-react";

// ─── helpers ────────────────────────────────────────────────

function SectionCard({ title, icon: Icon, iconColor = "text-blue-400", children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-900/60 hover:bg-slate-800/60 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${iconColor} shrink-0`} />
          <span className="text-sm font-semibold text-slate-200">{title}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {open && <div className="px-4 pb-4 pt-3 bg-slate-950/40 space-y-3">{children}</div>}
    </div>
  );
}

function Tag({ text, color = "slate" }) {
  const colors = {
    slate:   "bg-slate-700/50 text-slate-300",
    blue:    "bg-blue-500/20 text-blue-300",
    emerald: "bg-emerald-500/20 text-emerald-300",
    red:     "bg-red-500/20 text-red-300",
    yellow:  "bg-yellow-500/20 text-yellow-300",
    orange:  "bg-orange-500/20 text-orange-300",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors[color] || colors.slate}`}>
      {text}
    </span>
  );
}

function InfoRow({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="text-slate-500 shrink-0 min-w-[90px]">{label}</span>
      <span className="text-slate-200">{String(value)}</span>
    </div>
  );
}

function BulletList({ items, color = "blue" }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const dotColors = { blue: "bg-blue-400", emerald: "bg-emerald-400", red: "bg-red-400", orange: "bg-orange-400", yellow: "bg-yellow-400" };
  return (
    <ul className="space-y-1">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
          <span className={`mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${dotColors[color] || dotColors.blue}`} />
          {String(item)}
        </li>
      ))}
    </ul>
  );
}

// ─── Section: 项目摘要 ───────────────────────────────────────

function ProjectSummarySection({ data }) {
  if (!data || data.partial) return <p className="text-sm text-slate-500">项目摘要分析未完成</p>;
  return (
    <div className="space-y-3">
      {data.one_line_pitch && (
        <p className="text-sm text-slate-200 font-medium border-l-2 border-blue-500 pl-3">
          {data.one_line_pitch}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <InfoRow label="赛道" value={data.industry} />
        <InfoRow label="二级赛道" value={data.sub_industry} />
        <InfoRow label="商业模式" value={data.business_model} />
        <InfoRow label="融资阶段" value={data.stage} />
        <InfoRow label="所在地区" value={data.region} />
        <InfoRow label="融资金额" value={data.funding_amount_rmb ? `${data.funding_amount_rmb} 亿元` : null} />
        <InfoRow label="声称估值" value={data.claimed_valuation_rmb ? `${data.claimed_valuation_rmb} 亿元` : null} />
        <InfoRow label="声称收入" value={data.claimed_revenue_rmb ? `${data.claimed_revenue_rmb} 亿元` : null} />
      </div>
      {Array.isArray(data.core_metrics) && data.core_metrics.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 mb-1.5 uppercase tracking-wide">核心指标亮点</p>
          <BulletList items={data.core_metrics} color="blue" />
        </div>
      )}
      {data.summary && <p className="text-sm text-slate-400 leading-relaxed">{data.summary}</p>}
    </div>
  );
}

// ─── Section: 创始人画像 ─────────────────────────────────────

function FounderSection({ data }) {
  if (!data || data.partial) return <p className="text-sm text-slate-500">创始人调查未完成</p>;
  const founders = data.founders || [];
  return (
    <div className="space-y-4">
      {founders.map((f, i) => (
        <div key={i} className="border border-white/5 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-200">{f.name || "未知"}</span>
            {f.title && <Tag text={f.title} color="blue" />}
            {f.relevant_years > 0 && <Tag text={`赛道经验 ${f.relevant_years}年`} color="emerald" />}
          </div>
          {f.background && <p className="text-sm text-slate-400">{f.background}</p>}
          {Array.isArray(f.notable_achievements) && f.notable_achievements.length > 0 && (
            <BulletList items={f.notable_achievements} color="emerald" />
          )}
          {Array.isArray(f.past_companies) && f.past_companies.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {f.past_companies.map((c, j) => <Tag key={j} text={c} color="slate" />)}
            </div>
          )}
        </div>
      ))}
      {Array.isArray(data.team_risk_flags) && data.team_risk_flags.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 mb-1.5 uppercase tracking-wide">团队风险提示</p>
          <BulletList items={data.team_risk_flags} color="orange" />
        </div>
      )}
      {data.team_strength_summary && (
        <p className="text-sm text-emerald-400/80">{data.team_strength_summary}</p>
      )}
    </div>
  );
}

// ─── Section: 财务核查 ───────────────────────────────────────

const SEVERITY_COLORS = { 1: "emerald", 2: "yellow", 3: "red" };
const VERDICT_ICONS = {
  "自洽": <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />,
  "存疑": <AlertCircle className="w-3.5 h-3.5 text-yellow-400 shrink-0" />,
  "矛盾": <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />,
};

function FinancialSection({ data }) {
  if (!data || data.partial) return <p className="text-sm text-slate-500">财务核查未完成</p>;
  return (
    <div className="space-y-3">
      {data.financial_summary && (
        <p className="text-sm text-slate-300 border-l-2 border-emerald-500 pl-3">{data.financial_summary}</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <InfoRow label="当前收入" value={data.revenue_data?.current_arr ? `${data.revenue_data.current_arr} 亿元` : null} />
        <InfoRow label="增速" value={data.revenue_data?.growth_rate_pct ? `${data.revenue_data.growth_rate_pct}%` : null} />
        <InfoRow label="毛利率" value={data.cost_structure?.gross_margin_pct ? `${data.cost_structure.gross_margin_pct}%` : null} />
        <InfoRow label="LTV/CAC" value={data.efficiency_metrics?.ltv_cac_ratio} />
        <InfoRow label="月烧钱" value={data.efficiency_metrics?.burn_rate_rmb ? `${data.efficiency_metrics.burn_rate_rmb} 万元` : null} />
        <InfoRow label="数据完整性" value={data.data_quality} />
      </div>
      {Array.isArray(data.financial_consistency_check) && data.financial_consistency_check.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 mb-1.5 uppercase tracking-wide">自洽性核查</p>
          <ul className="space-y-1.5">
            {data.financial_consistency_check.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                {VERDICT_ICONS[c.verdict] || <AlertCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
                <span className="text-slate-300">{c.item}</span>
                {c.detail && <span className="text-slate-500">— {c.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {Array.isArray(data.anomalies) && data.anomalies.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 mb-1.5 uppercase tracking-wide">异常点</p>
          <ul className="space-y-1.5">
            {data.anomalies.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Tag text={`严重度 ${a.severity}`} color={SEVERITY_COLORS[a.severity] || "yellow"} />
                <span className="text-slate-300">{a.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Section: 竞品分析 ───────────────────────────────────────

function CompetitorSection({ data }) {
  if (!data || data.partial) return <p className="text-sm text-slate-500">竞品分析未完成</p>;
  const competitors = data.competitors || [];
  return (
    <div className="space-y-3">
      {data.competitive_landscape_summary && (
        <p className="text-sm text-slate-300 border-l-2 border-orange-500 pl-3">{data.competitive_landscape_summary}</p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        {data.subject_competitive_position && <Tag text={data.subject_competitive_position} color="blue" />}
        {data.moat_assessment && <Tag text={`护城河：${data.moat_assessment}`} color="emerald" />}
      </div>
      {competitors.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-white/5">
                <th className="text-left pb-2 pr-3 font-medium">竞品</th>
                <th className="text-left pb-2 pr-3 font-medium">阶段</th>
                <th className="text-left pb-2 pr-3 font-medium">威胁</th>
                <th className="text-left pb-2 font-medium">差异点</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {competitors.map((c, i) => (
                <tr key={i} className="text-slate-300">
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">{c.name}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{c.funding_stage || "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <Tag text={c.threat_level || "—"} color={c.threat_level === "高" ? "red" : c.threat_level === "中" ? "yellow" : "emerald"} />
                  </td>
                  <td className="py-2 text-slate-400 max-w-[200px] truncate">{c.key_differentiator || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {Array.isArray(data.key_competitive_risks) && data.key_competitive_risks.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 mb-1.5 uppercase tracking-wide">竞争风险</p>
          <BulletList items={data.key_competitive_risks} color="orange" />
        </div>
      )}
    </div>
  );
}

// ─── Section: 红旗扫描 ───────────────────────────────────────

const RISK_LEVEL_STYLE = {
  "绿灯": "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  "黄灯": "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  "红灯": "bg-red-500/20 text-red-300 border-red-500/30",
};

function RedFlagSection({ data }) {
  if (!data || data.partial) return <p className="text-sm text-slate-500">红旗扫描未完成</p>;
  const flags = data.red_flags || [];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {data.overall_risk_level && (
          <span className={`px-3 py-1 rounded-full text-sm font-semibold border ${RISK_LEVEL_STYLE[data.overall_risk_level] || "bg-slate-700 text-slate-300 border-slate-600"}`}>
            {data.overall_risk_level}
          </span>
        )}
        {data.risk_summary && <p className="text-sm text-slate-400 flex-1">{data.risk_summary}</p>}
      </div>
      {Array.isArray(data.critical_issues) && data.critical_issues.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 mb-1.5 uppercase tracking-wide">核心关注点</p>
          <BulletList items={data.critical_issues} color="red" />
        </div>
      )}
      {flags.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500 uppercase tracking-wide">风险清单（{flags.length} 项）</p>
          {flags.map((f, i) => (
            <div key={i} className="border border-white/5 rounded-lg p-3 space-y-1">
              <div className="flex items-center gap-2">
                <Tag text={f.flag_type} color={f.severity >= 4 ? "red" : f.severity >= 3 ? "orange" : "yellow"} />
                <Tag text={`严重度 ${f.severity}`} color={f.severity >= 4 ? "red" : f.severity >= 3 ? "orange" : "yellow"} />
              </div>
              <p className="text-sm text-slate-300">{f.description}</p>
              {f.suggested_dd_question && (
                <p className="text-xs text-slate-500 italic">追问：{f.suggested_dd_question}</p>
              )}
            </div>
          ))}
        </div>
      )}
      {Array.isArray(data.positive_signals) && data.positive_signals.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 mb-1.5 uppercase tracking-wide">正面信号</p>
          <BulletList items={data.positive_signals} color="emerald" />
        </div>
      )}
    </div>
  );
}

// ─── Section: 估值合理性 ─────────────────────────────────────

const VALUATION_VERDICT_COLOR = {
  "低估": "emerald", "合理": "blue", "略高": "yellow", "明显高估": "red", "无法判断": "slate",
};

function ValuationSection({ data }) {
  if (!data || data.partial) return <p className="text-sm text-slate-500">估值分析未完成</p>;
  const ba = data.benchmark_analysis || {};
  return (
    <div className="space-y-3">
      {data.valuation_summary && (
        <p className="text-sm text-slate-300 border-l-2 border-yellow-500 pl-3">{data.valuation_summary}</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <InfoRow label="声称估值" value={data.claimed_valuation_rmb ? `${data.claimed_valuation_rmb} 亿元` : "未披露"} />
        <InfoRow label="估值方法" value={data.valuation_methodology} />
        <InfoRow label="行业均PS" value={ba.industry_avg_ps_multiple ? `${ba.industry_avg_ps_multiple}x` : null} />
        <InfoRow label="项目PS" value={ba.subject_ps_multiple ? `${ba.subject_ps_multiple}x` : null} />
      </div>
      {ba.valuation_vs_benchmark && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">估值评级：</span>
          <Tag text={ba.valuation_vs_benchmark} color={VALUATION_VERDICT_COLOR[ba.valuation_vs_benchmark] || "slate"} />
        </div>
      )}
      {data.suggested_valuation_range_rmb?.low != null && (
        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-3">
          <p className="text-xs text-slate-500 mb-1">建议估值区间</p>
          <p className="text-sm font-semibold text-yellow-300">
            {data.suggested_valuation_range_rmb.low} — {data.suggested_valuation_range_rmb.high} 亿元
          </p>
        </div>
      )}
      {Array.isArray(data.key_valuation_drivers) && data.key_valuation_drivers.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 mb-1.5 uppercase tracking-wide">估值支撑因素</p>
          <BulletList items={data.key_valuation_drivers} color="emerald" />
        </div>
      )}
      {Array.isArray(data.valuation_risks) && data.valuation_risks.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 mb-1.5 uppercase tracking-wide">估值风险</p>
          <BulletList items={data.valuation_risks} color="red" />
        </div>
      )}
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────

/**
 * MultiagentReport — 渲染 6 个 Agent 的完整输出，每个可折叠
 * @param {object} multiagent — task.result.multiagent
 */
const MultiagentReport = memo(function MultiagentReport({ multiagent }) {
  if (!multiagent) return null;

  const hasAny = Object.values(multiagent).some((v) => v && !v.partial);
  if (!hasAny) return null;

  return (
    <div className="mt-6 space-y-2">
      <h2 className="text-base font-bold text-slate-200 mb-3 flex items-center gap-2">
        <Shield className="w-5 h-5 text-blue-400" />
        AI 深度尽调报告
      </h2>

      <SectionCard title="项目摘要" icon={FileText} iconColor="text-blue-400" defaultOpen>
        <ProjectSummarySection data={multiagent.project_summary} />
      </SectionCard>

      <SectionCard title="创始人画像" icon={Users} iconColor="text-purple-400">
        <FounderSection data={multiagent.founder_profile} />
      </SectionCard>

      <SectionCard title="财务核查" icon={BarChart3} iconColor="text-emerald-400">
        <FinancialSection data={multiagent.financial_analysis} />
      </SectionCard>

      <SectionCard title="竞品分析" icon={TrendingUp} iconColor="text-orange-400">
        <CompetitorSection data={multiagent.competitor_analysis} />
      </SectionCard>

      <SectionCard title="红旗扫描" icon={AlertTriangle} iconColor="text-red-400">
        <RedFlagSection data={multiagent.red_flags} />
      </SectionCard>

      <SectionCard title="估值合理性" icon={DollarSign} iconColor="text-yellow-400">
        <ValuationSection data={multiagent.valuation_analysis} />
      </SectionCard>
    </div>
  );
});

export default MultiagentReport;
