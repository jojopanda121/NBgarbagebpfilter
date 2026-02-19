import { useState, useRef, useEffect } from "react";
import * as pdfjsLib from "pdfjs-dist";

// PDF.js worker（必须设置，否则无法解析 PDF）
if (typeof window !== "undefined" && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
}

// ============================================================
// AI 垃圾 BP 过滤机 - 上传 BP 后由 MiniMax 模型 + 联网搜索分析
// ============================================================

const API_URL = "/api/chat";

// 在浏览器里从 PDF 文件提取纯文本（仅文字版 PDF，扫描版无效）
const extractTextFromPdf = async (file) => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const parts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = (content.items || []).map((it) => it.str || "").join(" ");
    parts.push(pageText);
  }
  return parts.join("\n").replace(/\s+/g, " ").trim();
};

// 优先用后端 Python 解析 PDF（支持 OCR 扫描版），失败则回退到浏览器解析
const extractTextFromPdfWithBackend = async (file, readB64) => {
  try {
    const base64 = await readB64(file);
    const resp = await fetch("/api/pdf-to-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdf: base64 })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `PDF 解析服务返回 ${resp.status}`);
    }
    const data = await resp.json();
    const text = (data.text || "").trim();
    if (text.length >= 30) return text;
  } catch (e) {
    console.warn("Python PDF/OCR 不可用，回退到浏览器解析:", e.message);
  }
  return extractTextFromPdf(file);
};

const C = {
  bg: "#08080d", card: "#111118", border: "#1c1c2e",
  red: "#ff3a3a", redGlow: "rgba(255,58,58,0.12)",
  green: "#00e676", yellow: "#ffd600", orange: "#ff9100",
  blue: "#448aff", purple: "#b388ff", cyan: "#00e5ff",
  text: "#e8e8ed", dim: "#8a8aa0", muted: "#4a4a62",
};

const getGrade = s => s >= 90 ? "A+" : s >= 85 ? "A" : s >= 80 ? "A-" : s >= 75 ? "B+" : s >= 70 ? "B" : s >= 65 ? "B-" : s >= 60 ? "C+" : s >= 55 ? "C" : s >= 50 ? "C-" : s >= 40 ? "D" : "F";
const getVerdict = s => s >= 85 ? "难得不是垃圾，值得深入看看" : s >= 70 ? "有点意思，建议约谈创始人" : s >= 60 ? "一般般，建议观望" : s >= 45 ? "风险较高，谨慎考虑" : "建议直接 Pass，下一个";

// ── 修复 LLM 生成 JSON 中常见的格式问题 ──
function repairJsonString(str) {
  let result = '';
  let inStr = false;
  let esc = false;

  for (let i = 0; i < str.length; i++) {
    const c = str[i];

    if (esc) {
      esc = false;
      if ('"\\\/bfnrtu'.includes(c)) {
        result += c;
      } else {
        result = result.slice(0, -1) + c;
      }
      continue;
    }

    if (c === '\\' && inStr) {
      esc = true;
      result += c;
      continue;
    }

    if (c === '"') {
      if (inStr) {
        let j = i + 1;
        while (j < str.length && str[j] === ' ') j++;
        const next = str[j];
        if (next && !':,]}\n\r'.includes(next)) {
          result += '\\"';
          continue;
        }
      }
      inStr = !inStr;
      result += c;
      continue;
    }

    if (inStr) {
      if (c === '\n') { result += '\\n'; continue; }
      if (c === '\r') { continue; }
      if (c === '\t') { result += '\\t'; continue; }
      if (c.charCodeAt(0) < 32) { continue; }
    }

    result += c;
  }

  result = result.replace(/,(\s*[}\]])/g, '$1');
  return result;
}

// 从 AI 返回中稳健解析报告 JSON
function parseReportJSON(raw) {
  if (!raw || typeof raw !== "string") throw new Error("AI 未返回内容，请重试");
  let str = raw.trim();
  const codeBlock = str.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) str = codeBlock[1].trim();
  const start = str.indexOf("{");
  if (start === -1) throw new Error("AI 返回格式异常，未找到 JSON，请重试");
  let depth = 0, inString = false, escape = false;
  let end = -1;
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (escape) { escape = false; continue; }
    if (c === "\\" && inString) { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (!inString) {
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
  }
  str = end >= 0 ? str.slice(start, end + 1) : str.slice(start);

  const tryParse = (s) => {
    try { return JSON.parse(s); } catch (e) { return null; }
  };

  let parsed = tryParse(str);
  if (parsed) return parsed;

  const repaired = repairJsonString(str);
  parsed = tryParse(repaired);
  if (parsed) return parsed;

  const fixes = ['"]}', '"]', '"}', '}', '"}]}', '"]}}', '"],"strengths":[],"risks":[],"finalScore":50}'];
  for (const fix of fixes) {
    parsed = tryParse(repaired + fix);
    if (parsed) return parsed;
  }
  for (const fix of fixes) {
    parsed = tryParse(str + fix);
    if (parsed) return parsed;
  }
  throw new Error("AI 返回的报告格式异常，无法解析为有效 JSON");
}

// 智能内容准备 — 保留头尾，超长时中间省略
function prepareContent(text, maxLen = 120000) {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  const headLen = Math.floor(maxLen * 0.8);
  const tailLen = Math.floor(maxLen * 0.15);
  return (
    text.substring(0, headLen) +
    "\n\n...(中间部分省略，原文共 " + text.length + " 字)...\n\n" +
    text.substring(text.length - tailLen)
  );
}

// ── Live Progress with ETA ──
function LiveProgress({ phaseName, phaseIdx, totalPhases, startTime, subText }) {
  const [elapsed, setElapsed] = useState(0);
  const estimatedTotalSec = [8, 15, 30, 55, 65, 75][Math.min(phaseIdx, 5)] || 75;

  useEffect(() => {
    const t = setInterval(() => setElapsed((Date.now() - startTime) / 1000), 200);
    return () => clearInterval(t);
  }, [startTime]);

  const rawPct = (elapsed / estimatedTotalSec) * 100;
  const pct = Math.min(95, rawPct < 80 ? rawPct : 80 + (rawPct - 80) * 0.15);
  const remaining = Math.max(0, Math.ceil(estimatedTotalSec - elapsed));
  const etaText = remaining > 60 ? `约 ${Math.ceil(remaining / 60)} 分 ${remaining % 60} 秒` : remaining > 0 ? `约 ${remaining} 秒` : "即将完成...";
  const phaseEmojis = ["📄", "🔍", "🌐", "🧪", "📊", "✅"];

  return (
    <div style={{ width: "100%", maxWidth: 480, margin: "0 auto", animation: "fadeUp 0.4s" }}>
      <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 24 }}>
        {Array.from({ length: totalPhases }, (_, i) => (
          <div key={i} style={{
            width: i === phaseIdx ? 32 : 10, height: 10, borderRadius: 5,
            background: i < phaseIdx ? C.green : i === phaseIdx ? C.red : C.border,
            transition: "all 0.5s", boxShadow: i === phaseIdx ? `0 0 10px ${C.red}66` : "none"
          }} />
        ))}
      </div>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 20, marginBottom: 8 }}>{phaseEmojis[phaseIdx] || "⏳"}</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 4 }}>{phaseName}</div>
        {subText && <div style={{ fontSize: 12, color: /⚠️|未配置|失败|不可用/.test(subText) ? C.orange : /✅/.test(subText) ? C.green : C.dim }}>{subText}</div>}
      </div>
      <div style={{ position: "relative", marginBottom: 10 }}>
        <div style={{ height: 12, borderRadius: 6, background: C.border, overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: 6,
            background: `linear-gradient(90deg, ${C.red}, ${C.orange}, ${C.yellow})`,
            width: `${pct}%`, transition: "width 0.4s ease-out",
            boxShadow: `0 0 12px ${C.red}44`
          }} />
        </div>
        <div style={{
          position: "absolute", top: 0, left: `${pct}%`, transform: "translateX(-50%)",
          width: 20, height: 12, borderRadius: 6,
          background: `radial-gradient(circle, ${C.red}66, transparent)`,
          animation: "blink 1s ease-in-out infinite"
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 12, color: C.dim }}>{Math.round(pct)}% 已完成</div>
        <div style={{ fontSize: 12, color: C.text, fontWeight: 600, background: C.card, padding: "4px 12px", borderRadius: 8, border: `1px solid ${C.border}` }}>
          ⏱️ {etaText}
        </div>
      </div>
      <div style={{ marginTop: 24 }}>
        {Array.from({ length: totalPhases }, (_, i) => {
          const names = ["解析文件内容", "提取关键信息", "联网搜索验证", "综合分析中", "AI 深度分析", "生成评估报告"];
          const done = i < phaseIdx;
          const active = i === phaseIdx;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", fontSize: 12.5, color: done ? C.green : active ? C.text : C.muted, fontWeight: active ? 600 : 400 }}>
              <span style={{ width: 18, textAlign: "center" }}>{done ? "✅" : active ? "⏳" : "○"}</span>
              <span>{names[i]}</span>
              {done && <span style={{ color: C.muted, marginLeft: "auto", fontSize: 10 }}>完成</span>}
              {active && (
                <span style={{ marginLeft: "auto", display: "flex", gap: 3 }}>
                  {[0, 1, 2].map(j => (<span key={j} style={{ width: 4, height: 4, borderRadius: 2, background: C.red, display: "inline-block", animation: `blink 1s ease-in-out ${j * 0.2}s infinite` }} />))}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Radar ──
function Radar({ scores, size = 290 }) {
  const lbl = ["市场", "估值", "技术", "壁垒", "团队", "时机"];
  const cx = size / 2, cy = size / 2, r = size * 0.35, n = 6;
  const step = (2 * Math.PI) / n, start = -Math.PI / 2;
  const pt = (i, v) => { const a = start + i * step, d = (v / 100) * r; return [cx + d * Math.cos(a), cy + d * Math.sin(a)]; };
  const data = scores.map((s, i) => pt(i, s));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: "visible" }}>
      <defs><radialGradient id="rf"><stop offset="0%" stopColor={C.red} stopOpacity=".25" /><stop offset="100%" stopColor={C.red} stopOpacity=".04" /></radialGradient></defs>
      {[20, 40, 60, 80, 100].map(lv => (<polygon key={lv} points={Array.from({ length: n }, (_, i) => pt(i, lv)).map(p => p.join(",")).join(" ")} fill="none" stroke={C.muted} strokeWidth=".5" opacity=".3" />))}
      {Array.from({ length: n }, (_, i) => (<line key={i} x1={cx} y1={cy} x2={pt(i, 100)[0]} y2={pt(i, 100)[1]} stroke={C.muted} strokeWidth=".5" opacity=".2" />))}
      <polygon points={data.map(p => p.join(",")).join(" ")} fill="url(#rf)" stroke={C.red} strokeWidth="2.5" strokeLinejoin="round" />
      {data.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4.5" fill={C.red} stroke={C.bg} strokeWidth="2" />)}
      {Array.from({ length: n }, (_, i) => { const [lx, ly] = pt(i, 128); return <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fill={C.text} fontSize="11" fontWeight="700">{lbl[i]} {scores[i]}</text>; })}
    </svg>
  );
}

// ── Thermometer ──
function Thermo({ bp, avg }) {
  const max = Math.max(bp * 1.6, avg * 2.2, 60);
  const pBP = Math.min((bp / max) * 100, 95);
  const pAvg = Math.min((avg / max) * 100, 95);
  const hot = pBP > pAvg * 1.25;
  return (
    <div style={{ width: "100%", marginTop: 8 }}>
      <div style={{ position: "relative", marginBottom: 32 }}>
        <div style={{ height: 16, borderRadius: 8, overflow: "hidden", background: `linear-gradient(90deg, ${C.green}cc, ${C.yellow}cc 45%, ${C.orange}cc 70%, ${C.red}cc)` }} />
        <div style={{ position: "absolute", left: `${pAvg}%`, top: -20, transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ fontSize: 10, color: C.dim, whiteSpace: "nowrap", fontWeight: 600 }}>行业均值 {avg}x</div>
          <div style={{ width: 2, height: 26, background: C.text + "66" }} />
        </div>
        <div style={{ position: "absolute", left: `${pBP}%`, bottom: -22, transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ width: 0, height: 0, borderLeft: "7px solid transparent", borderRight: "7px solid transparent", borderBottom: `9px solid ${hot ? C.red : C.green}` }} />
          <div style={{ fontSize: 11, fontWeight: 800, color: hot ? C.red : C.green, whiteSpace: "nowrap" }}>BP {bp}x</div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.muted, marginTop: 4 }}><span>低估</span><span>合理</span><span>高估</span></div>
    </div>
  );
}

// ── Score Ring ──
function Ring({ score, size = 105 }) {
  const color = score >= 80 ? C.green : score >= 60 ? C.yellow : score >= 40 ? C.orange : C.red;
  const r = (size - 12) / 2, circ = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.border} strokeWidth="7" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="7" strokeDasharray={circ} strokeDashoffset={circ * (1 - score / 100)} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: "stroke-dashoffset 1.2s ease-out", filter: `drop-shadow(0 0 6px ${color}55)` }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 30, fontWeight: 900, color, lineHeight: 1 }}>{score}</div>
        <div style={{ fontSize: 9, color: C.dim, marginTop: 2 }}>/ 100</div>
      </div>
    </div>
  );
}

// ── 冲突级别标签 ──
function ConflictBadge({ level }) {
  const map = {
    "诚实": { color: C.green, icon: "✅", bg: `${C.green}15` },
    "夸大": { color: C.yellow, icon: "⚠️", bg: `${C.yellow}15` },
    "严重夸大": { color: C.orange, icon: "🔴", bg: `${C.orange}15` },
    "欺诈": { color: C.red, icon: "☠️", bg: `${C.red}15` },
    "信息不对称": { color: C.red, icon: "🚨", bg: `${C.red}15` },
    "技术证伪": { color: C.red, icon: "💀", bg: `${C.red}18` },
    "证伪": { color: C.red, icon: "💀", bg: `${C.red}18` },
    "存疑": { color: C.blue, icon: "❓", bg: `${C.blue}15` },
  };
  const m = map[level] || { color: C.dim, icon: "❓", bg: `${C.dim}15` };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 700,
      color: m.color, background: m.bg, border: `1px solid ${m.color}33`,
    }}>
      {m.icon} {level || "未判定"}
    </span>
  );
}

// ── Dimension Card（BP 声明 vs 本机器分析） ──
function Dim({ dim }) {
  const [open, setOpen] = useState(false);
  const color = dim.score >= 8 ? C.green : dim.score >= 5 ? C.yellow : C.red;
  const hasSources = dim.sources && dim.sources.length > 0;
  // 兼容新旧字段名
  const evidenceText = dim.searchEvidence || dim.aiFindings || "";
  const claimText = dim.bpClaim || "";
  const conflictLevel = dim.conflictLevel || "";
  const diffText = dim.diff || dim.diffMultiple || "";
  const verdictText = dim.verdict || "";

  return (
    <div style={{ background: C.card, border: `1px solid ${open ? color + "44" : C.border}`, borderRadius: 14, padding: "13px 16px", marginBottom: 8, cursor: "pointer", transition: "all 0.2s" }} onClick={() => setOpen(!open)}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ minWidth: 38, height: 38, borderRadius: 10, background: `${color}12`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 900, color, lineHeight: 1 }}>{dim.score}</div>
          <div style={{ fontSize: 7, color: C.muted }}>/10</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{dim.name}</span>
            {conflictLevel && <ConflictBadge level={conflictLevel} />}
          </div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 1 }}>
            {dim.subtitle}
            {diffText && <span style={{ marginLeft: 8, color: C.orange, fontWeight: 600 }}>差异: {diffText}</span>}
          </div>
        </div>
        <div style={{ width: 72, height: 5, borderRadius: 3, background: C.border, overflow: "hidden", marginRight: 6 }}>
          <div style={{ width: `${dim.score * 10}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.5s" }} />
        </div>
        <span style={{ fontSize: 13, color: C.muted, transform: open ? "rotate(180deg)" : "", transition: "0.2s" }}>▾</span>
      </div>
      {open && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
          {/* 甲方 vs 乙方对抗展示 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.blue, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>📄 BP 声明</div>
              <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.75, padding: "10px 12px", background: "#0c0c14", borderRadius: 10, borderLeft: `3px solid ${C.blue}44`, minHeight: 60 }}>
                {claimText || "未找到相关声称"}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.purple, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>🔍 本机器指出</div>
              <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.75, padding: "10px 12px", background: "#0c0c14", borderRadius: 10, borderLeft: `3px solid ${C.purple}44`, minHeight: 60 }}>
                {evidenceText || "未找到相关证据"}
              </div>
            </div>
          </div>
          {/* 差异量化 */}
          {diffText && (
            <div style={{ marginBottom: 12, padding: "8px 14px", background: `${C.orange}08`, borderRadius: 10, border: `1px solid ${C.orange}22` }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.orange }}>📐 差异量化: </span>
              <span style={{ fontSize: 12, color: C.dim }}>{diffText}</span>
            </div>
          )}
          {/* 法官裁决 */}
          {verdictText && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.red, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>⚖️ 分析结论</div>
              <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.85, padding: "12px 14px", background: "#0c0c14", borderRadius: 10, borderLeft: `3px solid ${C.red}44` }}>
                {verdictText}
              </div>
            </div>
          )}
          {/* 评分理由 */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.orange, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>📋 评分依据</div>
            <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.85, padding: "12px 14px", background: "#0c0c14", borderRadius: 10, borderLeft: `3px solid ${C.orange}44` }}>
              {dim.reasoning || "未提供评分理由"}
            </div>
          </div>
          {/* 证据来源 */}
          {hasSources && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.cyan, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>📎 参考来源</div>
              {dim.sources.map((s, i) => (
                <a
                  key={i}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: "block", fontSize: 11.5, color: C.cyan, marginBottom: 4,
                    textDecoration: "none", padding: "8px 12px", background: "#0c0c14",
                    borderRadius: 8, borderLeft: `2px solid ${C.cyan}33`, transition: "background 0.2s"
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = "#12121f"}
                  onMouseOut={(e) => e.currentTarget.style.background = "#0c0c14"}
                >
                  <span style={{ fontWeight: 600 }}>🔗 {s.title || "来源链接"}</span>
                  {s.snippet && <span style={{ display: "block", fontSize: 10.5, color: C.dim, marginTop: 3, lineHeight: 1.5 }}>{s.snippet.length > 120 ? s.snippet.slice(0, 120) + "..." : s.snippet}</span>}
                  <span style={{ display: "block", fontSize: 9.5, color: C.muted, marginTop: 2 }}>{s.url}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 深度思考过程展示 ──
function ThinkingPanel({ thinking }) {
  const [expanded, setExpanded] = useState(false);
  if (!thinking) return null;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: "18px 22px", marginBottom: 20 }}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
        onClick={() => setExpanded(!expanded)}
      >
        <div>
          <span style={{ fontSize: 14, fontWeight: 700 }}>🧠 AI 分析推理过程</span>
          <span style={{ fontSize: 11, color: C.dim, marginLeft: 10 }}>点击展开查看 AI 的完整分析思路</span>
        </div>
        <span style={{ fontSize: 13, color: C.muted, transform: expanded ? "rotate(180deg)" : "", transition: "0.2s" }}>▾</span>
      </div>
      {expanded && (
        <div style={{
          marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}`,
          maxHeight: 500, overflowY: "auto",
        }}>
          <div style={{
            fontSize: 12, color: C.dim, lineHeight: 2, padding: "14px 16px",
            background: "#0a0a12", borderRadius: 12, borderLeft: `3px solid ${C.purple}44`,
            whiteSpace: "pre-wrap", fontFamily: "'Noto Sans SC', monospace",
          }}>
            {thinking}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  const [file, setFile] = useState(null);
  const [stage, setStage] = useState("upload");
  const [phase, setPhase] = useState(0);
  const [phaseText, setPhaseText] = useState("");
  const [phaseSub, setPhaseSub] = useState("");
  const [phaseStart, setPhaseStart] = useState(Date.now());
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);
  const TOTAL_PHASES = 6;

  const goPhase = (idx, text, sub) => {
    setPhase(idx); setPhaseText(text); setPhaseSub(sub || ""); setPhaseStart(Date.now());
  };

  const handleFile = (f) => {
    const ext = f.name.split('.').pop().toLowerCase();
    if (!["pdf", "docx", "doc", "pptx", "ppt", "txt"].includes(ext)) { setError("格式不对，请上传 PDF / Word / PPT 文件"); return; }
    setError(null); setFile(f);
  };

  const readText = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(f); });
  const readB64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(f); });

  const callAPI = async (messages, system, options = {}) => {
    const { timeoutMs, max_tokens } = options;
    const ctrl = timeoutMs ? new AbortController() : null;
    const tid = timeoutMs ? setTimeout(() => ctrl?.abort(), timeoutMs) : null;
    try {
      const resp = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, system, ...(max_tokens ? { max_tokens } : {}) }),
        signal: ctrl?.signal
      });
      if (tid) clearTimeout(tid);
      if (!resp.ok) {
        const raw = await resp.text().catch(() => "");
        try {
          const j = JSON.parse(raw);
          if (j.error) throw new Error(j.error);
        } catch (e) {
          if (e.message && e.message !== raw) throw e;
        }
        throw new Error(raw || `请求失败 ${resp.status}，请稍后重试`);
      }
      const data = await resp.json();
      return data.text || "";
    } catch (e) {
      if (tid) clearTimeout(tid);
      if (e.name === "AbortError") throw new Error("解析超时（约 3 分钟）。请稍后重试或换用 .txt。");
      throw e;
    }
  };

  // ════════════════════════════════════════════════════════════
  // 三步走分析架构
  // Step 1: 提取关键信息 — /api/extract-claims
  // Step 2: 联网搜索验证 — /api/web-search
  // Step 3: AI 深度分析 — /api/verdict
  // 前端只负责传结构化数据，服务端负责格式化 Prompt
  // ════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════
  // 核心分析流程：提取 → 搜索 → 分析 → 报告
  // ════════════════════════════════════════════════════════════
  const startAnalysis = async () => {
    setStage("processing"); setError(null);
    try {
      const ext = file.name.split('.').pop().toLowerCase();
      const MAX_FILE_MB = 25;
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        throw new Error(`文件请不超过 ${MAX_FILE_MB}MB。`);
      }

      // ═══ Phase 0: 解析文件内容 ═══
      goPhase(0, "解析文件内容", ext === "txt" ? `正在读取 ${file.name}...` : ext === "pdf" ? "正在用 Python 解析 PDF（含 OCR）..." : `Word/PPT 由 MiniMax 解析，请耐心等待`);
      let textContent = "";

      if (ext === "txt") {
        textContent = await readText(file);
        setPhaseSub(`提取了 ${textContent.length} 个字符`);
        await new Promise(r => setTimeout(r, 500));
      } else if (ext === "pdf") {
        setPhaseSub(`文件 ${(file.size / 1024).toFixed(0)}KB，Python 解析 PDF 中...`);
        textContent = await extractTextFromPdfWithBackend(file, readB64);
        setPhaseSub(`成功提取 ${textContent.length} 个字符`);
        await new Promise(r => setTimeout(r, 500));
      } else {
        const base64 = await readB64(file);
        setPhaseSub(`文件 ${(file.size / 1024).toFixed(0)}KB，由 MiniMax 解析文档中...`);
        const mimeMap = { docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", doc: "application/msword", ppt: "application/vnd.ms-powerpoint" };
        textContent = await callAPI([{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: mimeMap[ext] || "application/pdf", data: base64 } },
            { type: "text", text: "请完整提取这份商业计划书(BP)的所有内容。输出纯文本，保留所有数字、团队信息、财务数据。" }
          ]
        }], "你是文档提取专家。提取所有内容为纯文本。", { timeoutMs: 180000 });
        const noContent = /没有提供|未提供|请(上传|提供)|无法(读取|解析)|未收到|无.*内容/i.test(textContent);
        if (noContent && textContent.length < 500) throw new Error("当前接口无法解析该 Word/PPT，请先另存为 PDF 或 .txt 再上传。");
      }

      if (!textContent || textContent.length < 30) throw new Error("无法解析文件。请上传 PDF（支持扫描版，需后端 Python）、文字版 PDF 或 .txt。");
      setPhaseSub(`成功提取 ${textContent.length} 个字符`);
      await new Promise(r => setTimeout(r, 600));

      const bpContent = prepareContent(textContent);

      // ═══ Phase 1: 提取关键声明 ═══
      goPhase(1, "提取关键信息", "AI 正在识别 BP 中需要验证的关键信息...");
      let claims = { companyName: "", industry: "", searchQueries: [] };
      try {
        const claimsResp = await fetch("/api/extract-claims", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bpText: bpContent }),
        });
        if (claimsResp.ok) {
          const claimsData = await claimsResp.json();
          claims = claimsData.claims || claims;
          const queryCount = (claims.searchQueries || []).length;
          setPhaseSub(`识别到 ${queryCount} 个待验证声明` + (claims.companyName ? `（${claims.companyName}）` : ""));
        }
      } catch (e) {
        console.warn("提取声明失败，继续分析:", e.message);
        setPhaseSub("声明提取跳过，继续分析...");
      }
      await new Promise(r => setTimeout(r, 500));

      const queries = (claims.searchQueries || []).map(q => q.query).filter(Boolean);

      // ═══ Phase 2: 联网搜索验证 ═══
      let searchResults = {};
      let searchEnabled = false;
      if (queries.length > 0) {
        const queryPreview = queries.slice(0, 2).map(q => q.length > 18 ? q.slice(0, 16) + "…" : q).join(" · ");
        goPhase(2, "联网搜索验证", `正在搜索 ${queries.length} 条关键信息…`);
        setPhaseSub(queryPreview ? `关键词：${queryPreview}${queries.length > 2 ? " 等" : ""}` : "");
        try {
          const searchResp = await fetch("/api/web-search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ queries }),
          });
          if (searchResp.ok) {
            const searchData = await searchResp.json();
            searchResults = searchData.results || {};
            searchEnabled = searchData.searchEnabled;
            const totalHits = Object.values(searchResults).reduce((sum, r) => sum + r.length, 0);
            const hitCount = Object.values(searchResults).filter(r => r.length > 0).length;
            const totalQueries = Object.keys(searchResults).length;
            if (!searchEnabled) {
              setPhaseSub("⚠️ 未配置 SERPER_API_KEY，跳过联网验证（分析仍继续）");
            } else if (totalHits === 0) {
              setPhaseSub("⚠️ 搜索 API 已连接，但未找到任何结果（网络或 Key 问题）");
            } else {
              setPhaseSub(`✅ 搜索完成：共 ${totalHits} 条结果，${hitCount}/${totalQueries} 个查询有命中`);
            }
          }
        } catch (e) {
          console.warn("联网搜索失败，继续分析:", e.message);
          setPhaseSub("⚠️ 搜索服务不可用，跳过联网验证");
        }
      } else {
        goPhase(2, "联网搜索验证", "跳过（未提取到可搜索的声明）");
      }
      await new Promise(r => setTimeout(r, 800));

      // ═══ Phase 3: 构建辩证法输入 ═══
      goPhase(3, "综合分析中", "正在分析您的 BP，对比搜索结果...");

      const totalResults = Object.values(searchResults).reduce((sum, r) => sum + r.length, 0);
      // 直接传结构化数据给后端，后端负责格式化 Prompt
      const bpClaimsArray = (claims.searchQueries || []).map(q => ({
        category: q.category || "other",
        claim: q.claim || q.query || "",
      }));

      setPhaseSub(`甲方声明 ${bpClaimsArray.length} 条 | 乙方证据 ${totalResults} 条`);
      await new Promise(r => setTimeout(r, 800));

      // ═══ Phase 4: 调用后端辩证法裁决（深度思考模式）═══
      goPhase(4, "AI 深度分析", "正在分析您的 BP，请耐心等待...");

      // 自动推进进度条
      const phaseTimer = setInterval(() => {
        setPhase(prev => {
          if (prev >= 5) { clearInterval(phaseTimer); return 5; }
          if (prev === 4) {
            setPhaseText("生成评估报告");
            setPhaseSub("汇总分析结果，生成报告...");
            setPhaseStart(Date.now());
            return 5;
          }
          return prev;
        });
      }, 15000);

      // ── 带自动重试的裁决 ──
      let parsed = null;
      let thinkingContent = "";
      let verdictSearchUsed = false;
      let lastError = null;
      const retryConfigs = [
        { bp: bpContent },
        { bp: prepareContent(textContent, 60000) },
        { bp: prepareContent(textContent, 30000) },
      ];

      for (let attempt = 0; attempt < retryConfigs.length; attempt++) {
        try {
          if (attempt > 0) {
            goPhase(5, "重新分析", `解析异常，第 ${attempt + 1} 次尝试中...`);
          }
          const cfg = retryConfigs[attempt];

          const verdictResp = await fetch("/api/verdict", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              bpClaims: bpClaimsArray,                     // 数组格式
              searchEvidence: totalResults > 0 ? searchResults : null,  // 原始搜索结果对象
              bpFullText: cfg.bp,                          // BP 全文
            }),
          });

          if (!verdictResp.ok) {
            const errData = await verdictResp.json().catch(() => ({}));
            throw new Error(errData.error || `裁决请求失败 ${verdictResp.status}`);
          }

          const verdictData = await verdictResp.json();
          thinkingContent = verdictData.thinking || "";
          verdictSearchUsed = verdictData.searchUsed || false;

          if (thinkingContent) {
            console.log("[Verdict] 深度思考内容:", thinkingContent.slice(0, 500) + "...");
          }

          // 后端已经解析好 JSON，直接用；如果失败则 fallback 解析 rawText
          if (verdictData.verdict && typeof verdictData.verdict === "object") {
            parsed = verdictData.verdict;
          } else if (verdictData.rawText) {
            parsed = parseReportJSON(verdictData.rawText);
          } else {
            throw new Error("后端返回格式异常");
          }
          break;
        } catch (e) {
          lastError = e;
          console.warn(`裁决尝试 ${attempt + 1}/${retryConfigs.length} 失败:`, e.message);
          if (attempt < retryConfigs.length - 1) {
            await new Promise(r => setTimeout(r, 1500));
          }
        }
      }

      if (!parsed) throw lastError || new Error("裁决失败，请重试");

      clearInterval(phaseTimer);
      parsed.grade = parsed.knockout ? "F" : getGrade(parsed.finalScore || 0);
      parsed.searchEnabled = searchEnabled || verdictSearchUsed;
      parsed.searchResultCount = totalResults;
      parsed.thinkingProcess = thinkingContent;
      setResult(parsed);
      setStage("result");
    } catch (err) {
      console.error(err);
      setError(err.message || "分析失败，请重试");
      setStage("upload");
    }
  };

  // ════════════════ RENDER ════════════════
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Noto Sans SC','SF Pro Display',-apple-system,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700;900&display=swap');
        @keyframes blink{0%,100%{opacity:.2}50%{opacity:1}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
        @keyframes scan{0%{transform:translateY(-100%)}100%{transform:translateY(100vh)}}
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:${C.bg}}
        ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}
      `}</style>

      {/* ═══ UPLOAD ═══ */}
      {stage === "upload" && (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20, animation: "fadeUp 0.5s", position: "relative" }}>
          <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
            <div style={{ width: "100%", height: 1, background: `linear-gradient(90deg, transparent, ${C.red}22, transparent)`, animation: "scan 5s linear infinite" }} />
          </div>
          <div style={{ position: "relative", zIndex: 1, textAlign: "center", maxWidth: 480, width: "100%" }}>
            <div style={{ fontSize: 52, marginBottom: 12, animation: "float 3s ease-in-out infinite" }}>🗑️</div>
            <h1 style={{ fontSize: 38, fontWeight: 900, letterSpacing: -1, lineHeight: 1.15, marginBottom: 6, background: `linear-gradient(135deg, ${C.red}, #ff7043, ${C.orange})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              AI 垃圾 BP 过滤机
            </h1>
            <p style={{ fontSize: 13, color: C.dim, marginBottom: 32, lineHeight: 1.6 }}>联网搜索验证 · 深度分析 · 10维评分 · 一票否决 · 秒级过滤垃圾 BP</p>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); e.dataTransfer.files[0] && handleFile(e.dataTransfer.files[0]); }}
              onClick={() => inputRef.current?.click()}
              style={{ border: `2px dashed ${dragOver ? C.red : C.border}`, borderRadius: 18, padding: "44px 28px", cursor: "pointer", background: dragOver ? C.redGlow : C.card, transition: "all 0.3s", marginBottom: 16 }}
            >
              <input ref={inputRef} type="file" style={{ display: "none" }} accept=".pdf,.doc,.docx,.ppt,.pptx,.txt" onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
              <div style={{ fontSize: 32, marginBottom: 10 }}>📎</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 5 }}>点击上传，让我看看你又收到什么垃圾 BP</div>
              <div style={{ fontSize: 11.5, color: C.muted }}>支持 PDF / Word / PPT / TXT · 也可以直接拖进来</div>
            </div>
            {file && (
              <div style={{ background: C.card, border: `1px solid ${C.green}33`, borderRadius: 12, padding: "12px 18px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", animation: "fadeUp 0.3s" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 18 }}>📄</span>
                  <div><div style={{ fontSize: 13, fontWeight: 600 }}>{file.name}</div><div style={{ fontSize: 11, color: C.dim }}>{(file.size / 1024).toFixed(0)} KB</div></div>
                </div>
                <button onClick={e => { e.stopPropagation(); setFile(null); }} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 15 }}>✕</button>
              </div>
            )}
            {error && (<div style={{ background: `${C.red}12`, border: `1px solid ${C.red}33`, borderRadius: 12, padding: "10px 16px", marginBottom: 14, fontSize: 13, color: C.red, textAlign: "left" }}>⚠️ {error}</div>)}
            <button disabled={!file} onClick={startAnalysis} style={{ width: "100%", padding: "15px 0", borderRadius: 14, border: "none", cursor: file ? "pointer" : "not-allowed", background: file ? `linear-gradient(135deg, ${C.red}, #e53935)` : C.border, color: file ? "#fff" : C.muted, fontSize: 15, fontWeight: 700, transition: "all 0.3s", boxShadow: file ? `0 6px 28px ${C.red}33` : "none" }}>
              {file ? "🚀 开始过滤" : "先上传文件"}
            </button>
            <div style={{ marginTop: 20, fontSize: 10.5, color: C.muted }}>Powered by MiniMax M2.5 · 提取关键信息 → 联网搜索验证 → AI 深度分析 → 生成评估报告</div>
          </div>
        </div>
      )}

      {/* ═══ PROCESSING ═══ */}
      {stage === "processing" && (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <LiveProgress phaseName={phaseText} phaseIdx={phase} totalPhases={TOTAL_PHASES} startTime={phaseStart} subText={phaseSub} />
        </div>
      )}

      {/* ═══ RESULT ═══ */}
      {stage === "result" && result && (
        <div style={{ maxWidth: 740, margin: "0 auto", padding: "28px 16px 48px", animation: "fadeUp 0.5s" }}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: 3, marginBottom: 10, fontWeight: 600 }}>AI 垃圾 BP 过滤机</div>
            <h1 style={{ fontSize: 26, fontWeight: 900, marginBottom: 5 }}>{result.projectName || "未知项目"}</h1>
            <p style={{ fontSize: 14, color: C.dim, marginBottom: 12 }}>{result.oneLiner}</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <span style={{ padding: "4px 14px", borderRadius: 20, background: `${C.cyan}15`, color: C.cyan, fontSize: 12, fontWeight: 600 }}>📍 {result.stage}</span>
              {result.stageReason && <span style={{ padding: "4px 14px", borderRadius: 20, background: `${C.purple}12`, color: C.purple, fontSize: 11 }}>{result.stageReason}</span>}
              {result.searchEnabled && result.searchResultCount > 0 ? (
                <span style={{ padding: "4px 14px", borderRadius: 20, background: `${C.green}15`, color: C.green, fontSize: 11, fontWeight: 600 }}>🌐 已联网验证（{result.searchResultCount} 条结果）</span>
              ) : result.searchEnabled ? (
                <span style={{ padding: "4px 14px", borderRadius: 20, background: `${C.yellow}15`, color: C.yellow, fontSize: 11 }}>🌐 搜索已连接（0 条结果，疑似 Key 或网络问题）</span>
              ) : (
                <span style={{ padding: "4px 14px", borderRadius: 20, background: `${C.orange}15`, color: C.orange, fontSize: 11 }}>⚠️ 未联网验证（需配置 SERPER_API_KEY）</span>
              )}
            </div>
          </div>
          {result.knockout && (
            <div style={{ background: `${C.red}0e`, border: `2px solid ${C.red}`, borderRadius: 18, padding: 28, marginBottom: 24, textAlign: "center" }}>
              <div style={{ fontSize: 52 }}>☠️</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: C.red, marginTop: 8 }}>熔断！一票否决</div>
              <div style={{ fontSize: 13, color: C.dim, marginTop: 8 }}>{result.knockoutReason || "触发红线条件"}</div>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 18 }}>
                <Ring score={result.knockout ? 0 : result.finalScore} />
                <div>
                  <div style={{ fontSize: 30, fontWeight: 900, lineHeight: 1, color: (result.finalScore >= 70 ? C.green : result.finalScore >= 50 ? C.yellow : C.red) }}>{result.knockout ? "F" : result.grade}</div>
                  <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>{result.knockout ? "已触发熔断" : getVerdict(result.finalScore)}</div>
                </div>
              </div>
              {result.strengths?.map((s, i) => (<div key={`s${i}`} style={{ display: "flex", gap: 7, marginBottom: 5, fontSize: 12.5 }}><span style={{ color: C.green, flexShrink: 0 }}>✅</span><span style={{ color: C.dim }}>{s}</span></div>))}
              {result.risks?.map((r, i) => (<div key={`r${i}`} style={{ display: "flex", gap: 7, marginBottom: 5, fontSize: 12.5 }}><span style={{ color: C.red, flexShrink: 0 }}>⚠️</span><span style={{ color: C.dim }}>{r}</span></div>))}
            </div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: 16, display: "flex", justifyContent: "center", alignItems: "center" }}>
              <Radar scores={result.radarScores ? [result.radarScores.market, result.radarScores.valuation, result.radarScores.tech, result.radarScores.moat, result.radarScores.team, result.radarScores.timing] : [50, 50, 50, 50, 50, 50]} />
            </div>
          </div>
          {/* 判决总结 */}
          {result.verdictSummary && (
            <div style={{ background: `${C.card}`, border: `1px solid ${C.border}`, borderRadius: 18, padding: "18px 22px", marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>📋 综合评估结论</div>
              <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.9, padding: "12px 16px", background: "#0a0a12", borderRadius: 12, borderLeft: `4px solid ${C.red}55` }}>
                {result.verdictSummary}
              </div>
            </div>
          )}
          {/* 深度思考过程 */}
          <ThinkingPanel thinking={result.thinkingProcess} />
          {result.valuationData && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: "22px 24px 28px", marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>📊 估值温度计</div>
              <div style={{ fontSize: 11, color: C.dim, marginBottom: 14 }}>BP 报价 vs 同行业估值倍数</div>
              <Thermo bp={result.valuationData.bpMultiple || 30} avg={result.valuationData.industryAvgMultiple || 20} />
            </div>
          )}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>🔍 10维评估详情 <span style={{ fontSize: 11.5, fontWeight: 400, color: C.dim }}>点击展开查看 BP 声明与本机器分析对比</span></div>
            {result.dimensions?.map((d, i) => <Dim key={i} dim={d} />)}
          </div>
          <div style={{ textAlign: "center" }}>
            <button onClick={() => { setStage("upload"); setFile(null); setResult(null); setError(null); }} style={{ padding: "14px 36px", borderRadius: 14, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              🗑️ 再过滤一份垃圾 BP
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
