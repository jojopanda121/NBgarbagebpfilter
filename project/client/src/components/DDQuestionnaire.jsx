import React, { useState } from "react";
import {
  ClipboardList, CheckCircle2, AlertTriangle,
  Loader2, RefreshCw, ChevronDown, ChevronUp
} from "lucide-react";
import api from "../services/api";

const VERDICT_COLOR = {
  "存疑":       "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
  "夸大":       "text-orange-400 bg-orange-500/10 border-orange-500/30",
  "严重夸大":   "text-red-400 bg-red-500/10 border-red-500/30",
  "信息不对称": "text-purple-400 bg-purple-500/10 border-purple-500/30",
  "证伪":       "text-red-500 bg-red-500/15 border-red-500/40",
};

const OPTION_COLORS = {
  A: "border-emerald-500/50 bg-emerald-500/10 text-emerald-300",
  B: "border-blue-500/50 bg-blue-500/10 text-blue-300",
  C: "border-red-500/50 bg-red-500/10 text-red-300",
};
const OPTION_SELECTED_COLORS = {
  A: "border-emerald-400 bg-emerald-500/20 ring-1 ring-emerald-400/50",
  B: "border-blue-400 bg-blue-500/20 ring-1 ring-blue-400/50",
  C: "border-red-400 bg-red-500/20 ring-1 ring-red-400/50",
};

export default function DDQuestionnaire({ taskId, questionnaire, initialAnswers = {}, onRescore, onAnswersChange }) {
  const [answers, setAnswers] = useState(initialAnswers);
  const [saving, setSaving] = useState(false);
  const [rescoring, setRescoring] = useState(false);
  const [rescoreResult, setRescoreResult] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [saveMsg, setSaveMsg] = useState("");

  if (!questionnaire || questionnaire.length === 0) {
    return (
      <div className="text-center py-12 text-[#2D3D54]">
        <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-emerald-500/50" />
        <p className="font-medium">本项目无需重点尽调核实</p>
        <p className="text-sm mt-1">所有关键声明均经核查，未发现需重点验证的存疑事项。</p>
      </div>
    );
  }

  const answeredCount = Object.keys(answers).length;
  const progress = Math.round((answeredCount / questionnaire.length) * 100);

  const handleChoose = (claimIndex, choice) => {
    const updated = { ...answers, [String(claimIndex)]: choice };
    setAnswers(updated);
    // 通知父组件更新，防止切换 tab 后丢失
    if (onAnswersChange) onAnswersChange(updated);
    // 自动保存到后端
    api.put(`/api/projects/${taskId}/dd/answers`, { answers: updated }).catch(() => {});
  };

  const toggleExpand = (idx) => {
    setExpanded(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const handleSave = async () => {
    if (Object.keys(answers).length === 0) return;
    setSaving(true);
    setSaveMsg("");
    try {
      await api.put(`/api/projects/${taskId}/dd/answers`, { answers });
      setSaveMsg("已保存");
      setTimeout(() => setSaveMsg(""), 2000);
    } catch (e) {
      setSaveMsg("保存失败：" + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRescore = async () => {
    if (answeredCount === 0) return;
    setRescoring(true);
    try {
      // 先保存答案
      await api.put(`/api/projects/${taskId}/dd/answers`, { answers });
      // 再触发重新评分
      const result = await api.post(`/api/projects/${taskId}/dd/rescore`, {});
      setRescoreResult(result);
      if (onRescore) onRescore(result, answers);
    } catch (e) {
      alert("重新评分失败：" + e.message);
    } finally {
      setRescoring(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 进度条 */}
      <div className="bg-white border border-[#CBD1E0] rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-medium">尽调核查问卷</span>
          </div>
          <span className="text-sm text-[#2D3D54]">{answeredCount} / {questionnaire.length} 条已填写</span>
        </div>
        <div className="h-1.5 bg-[#E9EDF6] rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* 重新评分结果 */}
      {rescoreResult && (
        <div className="bg-white border border-[#CBD1E0] rounded-xl p-4">
          <p className="text-sm font-medium mb-2 text-[#0C1A30]">尽调校正结果</p>
          <div className="flex items-center gap-6">
            <div>
              <p className="text-xs text-[#526078] mb-0.5">原始评分</p>
              <p className="text-2xl font-bold text-[#2D3D54]">{rescoreResult.originalTotal}</p>
            </div>
            <div className="text-2xl text-[#526078]">→</div>
            <div>
              <p className="text-xs text-[#526078] mb-0.5">校正后评分</p>
              <p className={`text-2xl font-bold ${rescoreResult.delta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {rescoreResult.newTotal}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#526078] mb-0.5">变化</p>
              <p className={`text-lg font-semibold ${rescoreResult.delta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {rescoreResult.delta >= 0 ? "+" : ""}{rescoreResult.delta} 分
              </p>
            </div>
            <div>
              <p className="text-xs text-[#526078] mb-0.5">新评级</p>
              <p className="text-lg font-bold text-blue-400">{rescoreResult.newGrade}</p>
            </div>
          </div>
        </div>
      )}

      {/* 问卷列表 */}
      {questionnaire.map((item, i) => {
        const currentAnswer = answers[String(item.claim_index)];
        const isExpanded = expanded[i] !== false; // 默认展开
        const verdictStyle = VERDICT_COLOR[item.original_verdict] || "text-[#2D3D54] bg-slate-500/10 border-slate-500/30";

        return (
          <div key={i} className="bg-white border border-[#CBD1E0] rounded-xl overflow-hidden">
            {/* 声明头部 */}
            <button
              className="w-full text-left p-4 flex items-start justify-between gap-3"
              onClick={() => toggleExpand(i)}
            >
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5 ${
                  currentAnswer ? "bg-blue-500" : "bg-[#DDE3F0]"
                }`}>
                  {currentAnswer
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-[#0C1A30]" />
                    : <span className="text-xs text-[#2D3D54]">{i + 1}</span>
                  }
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 rounded text-xs border font-medium ${verdictStyle}`}>
                      {item.original_verdict}
                    </span>
                    {item.category && (
                      <span className="px-2 py-0.5 rounded text-xs bg-[#E9EDF6] text-[#2D3D54]">
                        {item.category}
                      </span>
                    )}
                    {currentAnswer && (
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        currentAnswer === "A" ? "text-emerald-400 bg-emerald-500/10" :
                        currentAnswer === "B" ? "text-blue-400 bg-blue-500/10" :
                        "text-red-400 bg-red-500/10"
                      }`}>
                        已选 {currentAnswer}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-[#0C1A30] font-medium leading-relaxed">
                    {item.original_claim}
                  </p>
                  {item.diff && (
                    <p className="text-xs text-[#526078] mt-0.5">{item.diff}</p>
                  )}
                </div>
              </div>
              {isExpanded
                ? <ChevronUp className="w-4 h-4 text-[#526078] shrink-0 mt-1" />
                : <ChevronDown className="w-4 h-4 text-[#526078] shrink-0 mt-1" />
              }
            </button>

            {/* 展开内容 */}
            {isExpanded && (
              <div className="px-4 pb-4 space-y-4 border-t border-[#EEF1F7]">
                {/* 核实方法 */}
                {item.dd_methods?.length > 0 && (
                  <div className="pt-3">
                    <p className="text-xs font-medium text-[#2D3D54] mb-2 flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3" />
                      核实方法
                    </p>
                    <ul className="space-y-1.5">
                      {item.dd_methods.map((m, mi) => (
                        <li key={mi} className="flex items-start gap-2 text-sm text-[#0C1A30]">
                          <span className="shrink-0 w-4 h-4 rounded-full bg-[#DDE3F0] text-xs flex items-center justify-center mt-0.5">
                            {mi + 1}
                          </span>
                          {m}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 选项 A/B/C */}
                <div>
                  <p className="text-xs font-medium text-[#2D3D54] mb-2">尽调结论</p>
                  <div className="grid grid-cols-1 gap-2">
                    {Object.entries(item.options).map(([choice, label]) => {
                      const isSelected = currentAnswer === choice;
                      return (
                        <button
                          key={choice}
                          onClick={() => handleChoose(item.claim_index, choice)}
                          className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-all ${
                            isSelected
                              ? OPTION_SELECTED_COLORS[choice]
                              : "border-[#CBD1E0] bg-[#E9EDF6] hover:border-[#A8B0C8]"
                          }`}
                        >
                          <div className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 ${
                            isSelected ? "border-current bg-current/20" : "border-slate-600"
                          }`}>
                            {isSelected && <div className="w-2 h-2 rounded-full bg-current" />}
                          </div>
                          <div>
                            <span className="text-xs font-bold mr-2 opacity-70">{choice}.</span>
                            <span className={`text-sm ${isSelected ? OPTION_COLORS[choice] : "text-[#0C1A30]"}`}>
                              {label}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* 底部操作栏 */}
      <div className="flex items-center justify-between p-4 bg-white border border-[#CBD1E0] rounded-xl">
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || answeredCount === 0}
            className="px-4 py-2 text-sm bg-[#DDE3F0] hover:bg-slate-600 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            保存进度
          </button>
          {saveMsg && (
            <span className="text-sm text-[#2D3D54]">{saveMsg}</span>
          )}
        </div>
        <button
          onClick={handleRescore}
          disabled={rescoring || answeredCount === 0}
          className="px-5 py-2 text-sm bg-[#1749C9] hover:bg-[#0A1F3D] disabled:opacity-50 rounded-lg font-medium transition-colors flex items-center gap-1.5"
        >
          {rescoring
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <RefreshCw className="w-4 h-4" />
          }
          完成填写，重新评分
        </button>
      </div>
    </div>
  );
}
