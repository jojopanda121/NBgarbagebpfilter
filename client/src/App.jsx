import { useState, useRef, useCallback } from "react";
import {
  Upload,
  FileText,
  Search,
  Gavel,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Brain,
  Shield,
  TrendingUp,
  Target,
  Users,
  Clock,
  Loader2,
  BarChart3,
} from "lucide-react";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

// ── API 地址 ──
const API_BASE = process.env.REACT_APP_API_URL || "";

// ── 辅助函数 ──
const getGrade = (s) =>
  s >= 90 ? "A+" : s >= 85 ? "A" : s >= 80 ? "A-" :
  s >= 75 ? "B+" : s >= 70 ? "B" : s >= 65 ? "B-" :
  s >= 60 ? "C+" : s >= 55 ? "C" : s >= 50 ? "C-" :
  s >= 40 ? "D" : "F";

const getGradeColor = (grade) => {
  if (grade.startsWith("A")) return "text-emerald-400";
  if (grade.startsWith("B")) return "text-blue-400";
  if (grade.startsWith("C")) return "text-yellow-400";
  if (grade.startsWith("D")) return "text-orange-400";
  return "text-red-400";
};

const getScoreColor = (s) =>
  s >= 70 ? "text-emerald-400" : s >= 50 ? "text-yellow-400" : "text-red-400";

const getVerdict = (s) =>
  s >= 85 ? "难得不是垃圾，值得深入看看" :
  s >= 70 ? "有点意思，建议约谈创始人" :
  s >= 60 ? "一般般，建议观望" :
  s >= 45 ? "风险较高，谨慎考虑" :
  "建议直接 Pass，下一个";

const dimIcons = {
  market: TrendingUp,
  valuation: BarChart3,
  tech: Brain,
  moat: Shield,
  team: Users,
  timing: Clock,
};

// ── 分析步骤定义 ──
const STEPS = [
  { key: "extract", label: "提取关键诉求", icon: FileText },
  { key: "search", label: "联网搜索验证", icon: Search },
  { key: "judge", label: "AI 法官裁决中", icon: Gavel },
];

// ============================================================
// 主组件
// ============================================================
export default function App() {
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [showThinking, setShowThinking] = useState(false);
  const fileInputRef = useRef(null);

  // ── 文件选择 ──
  const handleFile = useCallback((f) => {
    if (f && f.type === "application/pdf") {
      setFile(f);
      setError("");
      setResult(null);
    } else {
      setError("请上传 PDF 文件");
    }
  }, []);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      handleFile(f);
    },
    [handleFile]
  );

  // ── 开始分析 ──
  const startAnalysis = async () => {
    if (!file) return;
    setAnalyzing(true);
    setError("");
    setResult(null);
    setCurrentStep(0);

    try {
      const formData = new FormData();
      formData.append("file", file);

      // 模拟步骤进度（实际是单个请求）
      const stepTimer1 = setTimeout(() => setCurrentStep(1), 3000);
      const stepTimer2 = setTimeout(() => setCurrentStep(2), 8000);

      const resp = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        body: formData,
      });

      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `服务器错误 ${resp.status}`);
      }

      const data = await resp.json();
      setCurrentStep(3); // 完成
      setResult(data);
    } catch (err) {
      setError(err.message || "分析失败，请重试");
    } finally {
      setAnalyzing(false);
    }
  };

  // ── 重置 ──
  const reset = () => {
    setFile(null);
    setResult(null);
    setError("");
    setCurrentStep(-1);
    setShowThinking(false);
  };

  const verdict = result?.verdict;
  const totalScore = verdict?.total_score ?? 0;
  const grade = verdict?.grade || getGrade(totalScore);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
              <Gavel className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">垃圾BP过滤机</h1>
              <p className="text-xs text-gray-500">AI 辩证法尽调 · 辨伪识真</p>
            </div>
          </div>
          {result && (
            <button
              onClick={reset}
              className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
            >
              重新分析
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* ── 上传区域 ── */}
        {!result && (
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold mb-2">上传商业计划书</h2>
              <p className="text-gray-400">
                AI 将作为铁面法官，对 BP 进行辩证法三角验证
              </p>
            </div>

            {/* 拖拽上传 */}
            <div
              onDrop={onDrop}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
              className={`
                border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer
                transition-all duration-200
                ${dragOver
                  ? "border-blue-500 bg-blue-500/5"
                  : file
                  ? "border-emerald-500/50 bg-emerald-500/5"
                  : "border-gray-700 hover:border-gray-500 bg-gray-900/50"
                }
              `}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => handleFile(e.target.files[0])}
              />
              {file ? (
                <div className="flex flex-col items-center gap-3">
                  <FileText className="w-12 h-12 text-emerald-400" />
                  <p className="text-lg font-medium text-emerald-400">
                    {file.name}
                  </p>
                  <p className="text-sm text-gray-500">
                    {(file.size / 1024 / 1024).toFixed(2)} MB · 点击更换文件
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <Upload className="w-12 h-12 text-gray-500" />
                  <p className="text-lg text-gray-400">
                    拖拽 PDF 到此处，或点击选择文件
                  </p>
                  <p className="text-sm text-gray-600">支持文字版和扫描版 PDF</p>
                </div>
              )}
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3">
                <XCircle className="w-5 h-5 text-red-400 shrink-0" />
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {/* 分析按钮 */}
            <button
              onClick={startAnalysis}
              disabled={!file || analyzing}
              className={`
                mt-6 w-full py-4 rounded-xl text-lg font-semibold transition-all
                ${file && !analyzing
                  ? "bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white shadow-lg shadow-red-500/20"
                  : "bg-gray-800 text-gray-500 cursor-not-allowed"
                }
              `}
            >
              {analyzing ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  分析中...
                </span>
              ) : (
                "开始辩证分析"
              )}
            </button>

            {/* 步骤指示器 */}
            {analyzing && (
              <div className="mt-8 space-y-3">
                {STEPS.map((step, i) => {
                  const Icon = step.icon;
                  const active = currentStep === i;
                  const done = currentStep > i;
                  return (
                    <div
                      key={step.key}
                      className={`
                        flex items-center gap-4 p-4 rounded-xl transition-all duration-300
                        ${active ? "bg-blue-500/10 border border-blue-500/30" : ""}
                        ${done ? "bg-emerald-500/5 border border-emerald-500/20" : ""}
                        ${!active && !done ? "opacity-40" : ""}
                      `}
                    >
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          done
                            ? "bg-emerald-500/20"
                            : active
                            ? "bg-blue-500/20"
                            : "bg-gray-800"
                        }`}
                      >
                        {done ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                        ) : active ? (
                          <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                        ) : (
                          <Icon className="w-5 h-5 text-gray-500" />
                        )}
                      </div>
                      <span
                        className={`font-medium ${
                          done
                            ? "text-emerald-400"
                            : active
                            ? "text-blue-400"
                            : "text-gray-500"
                        }`}
                      >
                        {step.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── 结果面板 ── */}
        {result && verdict && (
          <div className="space-y-6">
            {/* 裁决卡片 */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
              <div className="flex flex-col md:flex-row items-center gap-8">
                {/* 分数 */}
                <div className="text-center">
                  <div className="relative w-36 h-36">
                    <svg className="w-36 h-36 -rotate-90" viewBox="0 0 120 120">
                      <circle
                        cx="60" cy="60" r="52"
                        fill="none" stroke="#1f2937" strokeWidth="8"
                      />
                      <circle
                        cx="60" cy="60" r="52"
                        fill="none"
                        stroke={totalScore >= 70 ? "#34d399" : totalScore >= 50 ? "#fbbf24" : "#f87171"}
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={`${(totalScore / 100) * 327} 327`}
                        className="transition-all duration-1000"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className={`text-4xl font-bold ${getScoreColor(totalScore)}`}>
                        {totalScore}
                      </span>
                      <span className="text-xs text-gray-500">/ 100</span>
                    </div>
                  </div>
                  <div className={`text-3xl font-black mt-2 ${getGradeColor(grade)}`}>
                    {grade}
                  </div>
                </div>

                {/* 裁决摘要 */}
                <div className="flex-1 text-center md:text-left">
                  <h3 className="text-xl font-bold mb-2">裁决结果</h3>
                  <p className="text-lg text-gray-300 mb-3">
                    {verdict.verdict_summary || getVerdict(totalScore)}
                  </p>
                  {result.elapsed_seconds && (
                    <p className="text-sm text-gray-500">
                      分析耗时 {result.elapsed_seconds}s
                    </p>
                  )}

                  {/* 优势标签 */}
                  {verdict.strengths?.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-4">
                      {verdict.strengths.map((s, i) => (
                        <span
                          key={i}
                          className="px-3 py-1 text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 风险标签 */}
                  {verdict.risk_flags?.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {verdict.risk_flags.map((r, i) => (
                        <span
                          key={i}
                          className="px-3 py-1 text-xs bg-red-500/10 text-red-400 border border-red-500/20 rounded-full"
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 雷达图 + 估值温度计 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 雷达图 */}
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <h4 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Target className="w-5 h-5 text-blue-400" />
                  六维雷达图
                </h4>
                <RadarChartPanel dimensions={verdict.dimensions} />
              </div>

              {/* 估值温度计 */}
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <h4 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-orange-400" />
                  估值温度计
                </h4>
                <ValuationThermometer data={verdict.valuation_comparison} />

                {/* 各维度得分 */}
                <div className="mt-6 space-y-3">
                  {verdict.dimensions &&
                    Object.entries(verdict.dimensions).map(([key, dim]) => {
                      const Icon = dimIcons[key] || Target;
                      return (
                        <div key={key} className="flex items-center gap-3">
                          <Icon className="w-4 h-4 text-gray-400 shrink-0" />
                          <span className="text-sm text-gray-400 w-20 shrink-0">
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
              </div>
            </div>

            {/* 冲突分析 */}
            {verdict.conflicts?.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <h4 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-yellow-400" />
                  冲突分析（BP 诉求 vs 搜索证据）
                </h4>
                <div className="space-y-4">
                  {verdict.conflicts.map((c, i) => (
                    <div
                      key={i}
                      className="p-4 rounded-xl bg-gray-800/50 border border-gray-700"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`px-2 py-0.5 text-xs font-bold rounded ${
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
            )}

            {/* 各维度详细裁决 */}
            {verdict.dimensions && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <h4 className="text-lg font-semibold mb-4">各维度详细裁决</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(verdict.dimensions).map(([key, dim]) => {
                    const Icon = dimIcons[key] || Target;
                    return (
                      <div
                        key={key}
                        className="p-4 rounded-xl bg-gray-800/50 border border-gray-700"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Icon className="w-4 h-4 text-gray-400" />
                          <span className="font-medium">{dim.label || key}</span>
                          <span
                            className={`ml-auto text-lg font-bold ${getScoreColor(
                              dim.score
                            )}`}
                          >
                            {dim.score}
                          </span>
                        </div>
                        <p className="text-sm text-gray-400">{dim.finding}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* AI 思考过程 */}
            {result.thinking && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <button
                  onClick={() => setShowThinking(!showThinking)}
                  className="flex items-center gap-2 text-lg font-semibold w-full"
                >
                  <Brain className="w-5 h-5 text-purple-400" />
                  AI 法官思考过程
                  {showThinking ? (
                    <ChevronUp className="w-5 h-5 ml-auto text-gray-500" />
                  ) : (
                    <ChevronDown className="w-5 h-5 ml-auto text-gray-500" />
                  )}
                </button>
                {showThinking && (
                  <pre className="mt-4 p-4 bg-gray-800/50 rounded-xl text-sm text-gray-400 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
                    {result.thinking}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 mt-16 py-6 text-center text-sm text-gray-600">
        垃圾BP过滤机 v2.0 · 辩证法三角验证引擎 · MiniMax M2.5
      </footer>
    </div>
  );
}

// ============================================================
// 子组件
// ============================================================

/** 雷达图 */
function RadarChartPanel({ dimensions }) {
  if (!dimensions) return <p className="text-gray-500 text-sm">暂无数据</p>;

  const data = Object.entries(dimensions).map(([key, dim]) => ({
    dimension: dim.label || key,
    score: dim.score || 0,
    fullMark: 100,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
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
}

/** 估值温度计 */
function ValuationThermometer({ data }) {
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
  const overvalued = data.overvalued_pct || Math.round(((bp - avg) / avg) * 100);
  const maxVal = Math.max(bp, avg) * 1.3;
  const bpPct = Math.min((bp / maxVal) * 100, 100);
  const avgPct = Math.min((avg / maxVal) * 100, 100);

  return (
    <div className="space-y-6">
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
          <span className="text-gray-400">行业平均估值倍数</span>
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
    </div>
  );
}
