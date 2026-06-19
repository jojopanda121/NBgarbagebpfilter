import React, { memo } from "react";
import {
  getGradeColor,
  getGradeStyle,
  getScoreColor,
  getScoreBg,
} from "../utils/scoreHelpers";
import ensureStringArray from "../utils/ensureStringArray";

// ── 报告质量降级警示：后端 quality.flags → 投资人可读的警示文案 ──
// 原则：投资人必须能区分"AI 认真分析后的结论"和"AI 部分失败后的兜底结论"。
const QUALITY_FLAG_COPY = {
  scoring_fallback_agent_a: {
    level: "critical",
    text: "评分模型多次失败，当前分数基于系统默认中性值估算，不可作为投资决策依据，建议重新分析",
  },
  prompt_injection_suspected: {
    level: "critical",
    text: "BP 文本疑似包含操纵 AI 分析的指令（prompt injection），本报告所有结论请人工复核",
  },
  multiagent_unavailable: {
    level: "warn",
    text: "多专家分析（财务/估值/竞品/团队核查）本次不可用，报告缺少专家交叉验证",
  },
  deep_research_unavailable: {
    level: "warn",
    text: "深度研究报告生成失败，本报告缺少联网深度研究内容",
  },
  scoring_search_unavailable: {
    level: "warn",
    text: "评分接地检索未取得结果，竞品/市场评分主要依赖 AI 知识库而非实时检索，可信度下降",
  },
  dimension_analysis_supplemented: {
    level: "info",
    text: "五维详细分析由降级路径补充生成，深度可能不及完整版",
  },
  dimension_analysis_missing: {
    level: "warn",
    text: "五维详细分析生成失败，仅有数值评分",
  },
  tam_estimated_discounted: {
    level: "info",
    text: "BP 未披露市场规模（TAM），AI 推断值已按缺失处理，S1 取中性分",
  },
  cagr_estimated_discounted: {
    level: "info",
    text: "BP 未披露行业增速（CAGR），AI 推断值未计入评分",
  },
};

function describeQualityFlag(flag) {
  if (QUALITY_FLAG_COPY[flag]) return QUALITY_FLAG_COPY[flag];
  const partial = flag.match(/^claim_verify_partial:(\d+)$/);
  if (partial) {
    return {
      level: "warn",
      text: `${partial[1]} 条声明核查失败，已按"存疑"处理，可能影响诚信度评分精度`,
    };
  }
  return { level: "info", text: `分析过程存在降级（${flag}）` };
}

const LEVEL_STYLES = {
  critical: "bg-red-500/10 border-red-500/40 text-red-500",
  warn: "bg-yellow-500/10 border-yellow-500/40 text-yellow-600",
  info: "bg-blue-500/10 border-blue-500/30 text-blue-500",
};

function QualityBanner({ quality }) {
  if (!quality?.degraded || !Array.isArray(quality.flags) || quality.flags.length === 0) return null;
  const items = quality.flags.map(describeQualityFlag);
  const worst = items.some((i) => i.level === "critical")
    ? "critical"
    : items.some((i) => i.level === "warn") ? "warn" : "info";
  return (
    <div className={`mb-4 border rounded-xl p-4 text-sm ${LEVEL_STYLES[worst]}`}>
      <div className="font-bold mb-1">
        ⚠ 本报告部分内容由降级路径生成，结论可信度受限
      </div>
      <ul className="list-disc pl-5 space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className={LEVEL_STYLES[item.level].split(" ").pop()}>{item.text}</li>
        ))}
      </ul>
    </div>
  );
}

function IntegrityVetoBanner({ veto, overriddenFrom }) {
  if (!veto?.triggered) return null;
  return (
    <div className="mb-4 border border-red-600/50 bg-red-600/10 rounded-xl p-4 text-sm text-red-600">
      <div className="font-bold mb-1">
        ⛔ 诚信一票否决（Integrity Veto）：重大类别声明被证伪或严重夸大
      </div>
      <p className="mb-1">
        财务/估值/合规类核心声明核查不通过。
        {overriddenFrom ? `原始评分对应 ${overriddenFrom} 级，已强制降至 C 级。` : ""}
        在公司就以下问题提供原始凭证（审计报告、银行流水、合同原件）之前，不建议推进投资流程。
      </p>
      {Array.isArray(veto.reasons) && veto.reasons.length > 0 && (
        <ul className="list-disc pl-5 space-y-0.5">
          {veto.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
    </div>
  );
}

// 判断卡 v3：总分分布 + 政策契合度 + 敏感性 + 触发规则（SCORING_AGG=on 时后端下发）
function JudgmentCardV3({ verdict }) {
  const dist = verdict.total_distribution;
  if (!dist) return null; // shadow/off：不下发，自动隐藏
  const [lo, hi] = Array.isArray(dist.range) ? dist.range : [dist.median, dist.median];
  const policy = verdict.policy_fit;
  const sens = Array.isArray(verdict.sensitivity) ? verdict.sensitivity : [];
  const rules = Array.isArray(verdict.triggered_rules) ? verdict.triggered_rules : [];
  const confColor = dist.confidence === "高" ? "text-emerald-500"
    : dist.confidence === "中" ? "text-amber-500" : "text-red-500";

  return (
    <div className="mt-6 pt-6 border-t border-[#D8DCE8]">
      {/* 总分以分布呈现，不是单一数字 */}
      <div className="mb-5">
        <div className="flex items-baseline gap-3 mb-2">
          <span className="text-sm font-bold text-[#0F1C36]">总分分布</span>
          <span className="text-base font-bold">{dist.median}</span>
          <span className="text-sm text-[#8E9BB0]">区间 {lo}–{hi}</span>
          <span className={`text-sm font-semibold ${confColor}`}>置信度 {dist.confidence}</span>
        </div>
        <div className="relative h-2 bg-[#EEF1F7] rounded-full">
          <div className="absolute h-2 bg-[#3b82f6]/30 rounded-full"
            style={{ left: `${lo}%`, width: `${Math.max(2, hi - lo)}%` }} />
          <div className="absolute w-1 h-3 -top-0.5 bg-[#0F1C36] rounded"
            style={{ left: `calc(${dist.median}% - 2px)` }} />
        </div>
        <p className="text-xs text-[#8E9BB0] mt-1">早期项目存在固有不确定性，总分以中位+区间呈现；区间越宽=信息覆盖越低。</p>
      </div>

      {/* 政策契合度（融入 S1/S3，不进加权平均） */}
      {policy?.tier && (
        <div className="mb-5 p-3 rounded-xl bg-[#F6F8FC] border border-[#E3E8F2]">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-bold text-[#0F1C36]">政策契合度</span>
            <span className="px-2 py-0.5 rounded-full bg-[#3b82f6]/10 text-[#3b82f6] text-xs font-semibold">
              {policy.tier}{policy.tier_label ? ` · ${policy.tier_label}` : ""}
            </span>
            {policy.readout_score != null && (
              <span className="text-[#8E9BB0] text-xs">readout {policy.readout_score}/100</span>
            )}
          </div>
          <p className="text-xs text-[#8E9BB0] mt-1">
            融入 S1 需求侧 {policy.s1_demand_adj >= 0 ? "+" : ""}{policy.s1_demand_adj}
            ，S3 资本侧 {policy.s3_capital_adj >= 0 ? "+" : ""}{policy.s3_capital_adj}
            （政策不设独立维度、不直接进总分平均，仅作 readout 与回测）。
          </p>
        </div>
      )}

      {/* 敏感性：对总分影响最大的维度 */}
      {sens.length > 0 && (
        <div className="mb-5">
          <div className="text-sm font-bold text-[#0F1C36] mb-2">敏感性（哪个假设最影响总分）</div>
          <div className="flex flex-wrap gap-2">
            {sens.map((s, i) => (
              <span key={i} className="px-3 py-1 text-xs bg-[#F6F8FC] border border-[#E3E8F2] rounded-full text-[#0F1C36]">
                {s.label}：变动10分 ≈ 总分±{s.impact}（当前 {s.score}）
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 触发的评分规则（每条可解释逻辑） */}
      {rules.length > 0 && (
        <div>
          <div className="text-sm font-bold text-[#0F1C36] mb-2">触发的评分规则</div>
          <ul className="space-y-1.5">
            {rules.map((r, i) => (
              <li key={i} className="text-xs text-[#475569]">
                <span className="font-semibold text-[#0F1C36]">{r.label}</span>
                {r.logic ? <span className="text-[#8E9BB0]"> — {r.logic}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const VerdictCard = memo(function VerdictCard({ result }) {
  if (!result?.verdict) return null;
  const verdict = result.verdict;
  const totalScore = verdict.total_score ?? 0;
  // 评级与文案以后端为唯一权威，前端只做样式映射
  const grade = verdict.grade || "";
  const gradeColor = getGradeColor(grade);
  const gradeStyle = getGradeStyle(grade);
  const displayLabel = verdict.grade_label || "";
  const displayAction = verdict.grade_action || "";

  return (
    <div>
    <QualityBanner quality={result.quality} />
    <IntegrityVetoBanner veto={verdict.integrity_veto} overriddenFrom={verdict.grade_overridden_from} />
    <div className="bg-white border border-[#D8DCE8] rounded-2xl p-5 sm:p-8">
      <div className="flex flex-col md:flex-row items-center gap-6 sm:gap-8">
        <div className="text-center">
          <div className="relative w-36 h-36 mx-auto">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="52" fill="none" stroke="#1f2937" strokeWidth="8" />
              <circle
                cx="60" cy="60" r="52" fill="none"
                stroke={getScoreBg(totalScore)}
                strokeWidth="8" strokeLinecap="round"
                strokeDasharray={`${(totalScore / 100) * 327} 327`}
                className="transition-all duration-1000"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-4xl font-bold ${getScoreColor(totalScore)}`}>{totalScore}</span>
              <span className="text-xs text-[#8E9BB0]">/ 100</span>
            </div>
          </div>
          <div className={`text-3xl font-black mt-2 ${gradeColor}`}>{grade}</div>
        </div>

        <div className="flex-1 text-center md:text-left">
          <h3 className="text-xl font-bold mb-2">评分结果</h3>
          <div className={`text-2xl font-bold mb-2 ${gradeColor}`}>
            {grade} - {displayLabel}
          </div>
          <p className="text-base text-[#0F1C36] mb-3">
            {verdict.verdict_summary || ""}
          </p>
          <div className={`p-4 rounded-xl text-sm leading-relaxed border ${gradeStyle.bg} ${gradeStyle.border} ${gradeColor}`}>
            <span className="font-bold mr-2">行动建议:</span>
            {displayAction}
          </div>
          {result.elapsed_seconds && (
            <p className="text-sm text-[#8E9BB0] mt-2">分析耗时 {result.elapsed_seconds}s</p>
          )}

          {verdict.strengths?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {ensureStringArray(verdict.strengths).map((s, i) => (
                <span key={i} className="px-3 py-1 text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full">
                  {s}
                </span>
              ))}
            </div>
          )}

          {verdict.risk_flags?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {ensureStringArray(verdict.risk_flags).map((r, i) => (
                <span key={i} className="px-3 py-1 text-xs bg-red-500/10 text-red-400 border border-red-500/20 rounded-full">
                  {r}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <JudgmentCardV3 verdict={verdict} />
    </div>
    </div>
  );
});

export default VerdictCard;
