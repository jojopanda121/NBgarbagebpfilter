// ============================================================
// server/index.js — GarbageBPFilter 后端
// Express + multer 文件上传 + @anthropic-ai/sdk (MiniMax 兼容层)
// 辩证法裁决引擎: 提取诉求 → 联网搜索 → AI 法官裁决
// ============================================================

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const Anthropic = require("@anthropic-ai/sdk").default;

const app = express();
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 50 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: "50mb" }));

const PORT = parseInt(process.env.PORT, 10) || 3001;

// ── MiniMax via Anthropic SDK 配置 ──
const anthropic = new Anthropic({
  apiKey: process.env.MINIMAX_API_KEY || "",
  baseURL: "https://api.minimax.io/anthropic",
});
const MODEL = process.env.MINIMAX_MODEL || "MiniMax-M2.5";

// ── Serper.dev 搜索配置 ──
const SERPER_API_KEY = process.env.SERPER_API_KEY || "";

// ============================================================
// 工具函数
// ============================================================

/** 调用 Python 脚本提取 PDF 文本 */
function extractPdfText(pdfPath) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "..", "scripts", "extract_pdf.py");
    const proc = spawn("python3", [scriptPath, pdfPath], {
      timeout: 120_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr || `python 退出码 ${code}`));
      resolve(stdout.trim());
    });
    proc.on("error", reject);
  });
}

/** Serper.dev 搜索（批量） */
async function searchSerper(queries) {
  if (!SERPER_API_KEY) return queries.map(() => ({ results: [], mock: true }));

  const results = await Promise.all(
    queries.map(async (q) => {
      try {
        const resp = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: {
            "X-API-KEY": SERPER_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ q, num: 5 }),
        });
        if (!resp.ok) return { query: q, results: [], error: `HTTP ${resp.status}` };
        const data = await resp.json();
        const organic = (data.organic || []).slice(0, 5).map((r) => ({
          title: r.title,
          snippet: r.snippet,
          link: r.link,
        }));
        return { query: q, results: organic };
      } catch (err) {
        return { query: q, results: [], error: err.message };
      }
    })
  );
  return results;
}

/** 调用 MiniMax LLM（普通模式） */
async function callLLM(systemPrompt, userContent, maxTokens = 4096) {
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });
  // 拼接所有 text 块
  return resp.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** 调用 MiniMax LLM（思考模式 — Agent B 法官） */
async function callLLMWithThinking(systemPrompt, userContent) {
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8192,
    thinking: { type: "enabled", budget_tokens: 4096 },
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  let thinking = "";
  let text = "";
  for (const block of resp.content) {
    if (block.type === "thinking") thinking += block.thinking;
    if (block.type === "text") text += block.text;
  }
  return { thinking, text };
}

/** 从 LLM 输出中提取 JSON */
function extractJson(raw) {
  // 尝试从 ```json ... ``` 中提取
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenced ? fenced[1].trim() : raw.trim();
  try {
    return JSON.parse(jsonStr);
  } catch {
    // 尝试找到第一个 { 和最后一个 }
    const start = jsonStr.indexOf("{");
    const end = jsonStr.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(jsonStr.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ============================================================
// 系统提示词
// ============================================================

const AGENT_A_PROMPT = `你是一位顶级 VC 分析师（Agent A — 诉求提取器）。
你的任务是从商业计划书（BP）文本中提取 5 条关键诉求，并为每条生成一个用于验证的搜索查询。

提取维度：
1. 市场规模 (TAM) — 市场有多大？
2. 估值/财务 — 融资金额、估值、收入数据
3. 核心技术/产品 — 技术路线、产品成熟度
4. 竞争对手 — 竞品分析、市场格局
5. 团队 — 创始人背景、核心团队

请严格返回以下 JSON 格式（不要加任何额外文字）：
{
  "claims": [
    {
      "dimension": "市场规模",
      "claim": "BP 中的具体声明",
      "search_query": "用于验证的 Google 搜索关键词"
    }
  ]
}`;

const AGENT_B_PROMPT = `你是一位铁面无私的 AI 法官（Agent B — 辩证裁决者）。

你将收到两份材料：
- 【原告陈述】= BP 中的诉求（Claims）
- 【被告证据】= 联网搜索结果（Evidence）

裁决规则：
- 如果 BP 市场规模 > 搜索证据的 5 倍 → 该维度 0 分（涉嫌欺诈）
- 如果 BP 估值 > 可比公司的 2 倍 → 该维度 20 分（严重高估）
- 如果技术仍在理论阶段但 BP 声称已量产 → 该维度 0 分
- 找不到相关证据支撑 → 该维度 30 分（存疑）
- 证据与声明基本吻合 → 该维度 70-90 分

输出要求（严格 JSON，不要加额外文字）：
{
  "total_score": 0-100,
  "grade": "A+/A/A-/B+/B/B-/C+/C/C-/D/F",
  "verdict_summary": "一句话裁决",
  "dimensions": {
    "market": { "score": 0-100, "label": "市场规模", "finding": "裁决说明" },
    "valuation": { "score": 0-100, "label": "估值合理性", "finding": "裁决说明" },
    "tech": { "score": 0-100, "label": "技术可行性", "finding": "裁决说明" },
    "moat": { "score": 0-100, "label": "竞争壁垒", "finding": "裁决说明" },
    "team": { "score": 0-100, "label": "团队匹配度", "finding": "裁决说明" },
    "timing": { "score": 0-100, "label": "入场时机", "finding": "裁决说明" }
  },
  "risk_flags": ["风险1", "风险2"],
  "strengths": ["优点1", "优点2"],
  "conflicts": [
    { "claim": "BP 声称...", "evidence": "搜索发现...", "severity": "严重/中等/轻微" }
  ],
  "valuation_comparison": {
    "bp_multiple": 0,
    "industry_avg_multiple": 0,
    "overvalued_pct": 0
  }
}`;

// ============================================================
// API 路由
// ============================================================

/** 健康检查 */
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", model: MODEL, search: !!SERPER_API_KEY });
});

/** 搜索状态 */
app.get("/api/search-status", (_req, res) => {
  res.json({ enabled: !!SERPER_API_KEY });
});

/** 核心分析端点 — 上传 PDF，完成 3 步流水线 */
app.post("/api/analyze", upload.single("file"), async (req, res) => {
  const startTime = Date.now();
  let pdfText = "";

  try {
    // ── 阶段 0: 获取文本 ──
    if (req.file) {
      try {
        pdfText = await extractPdfText(req.file.path);
      } catch (pyErr) {
        console.warn("Python PDF 提取失败:", pyErr.message);
        return res.status(400).json({ error: "PDF 解析失败: " + pyErr.message });
      } finally {
        // 清理临时文件
        fs.unlink(req.file.path, () => {});
      }
    } else if (req.body && req.body.text) {
      pdfText = req.body.text;
    } else {
      return res.status(400).json({ error: "请上传 PDF 文件或提供文本" });
    }

    if (pdfText.length < 50) {
      return res.status(400).json({ error: "提取的文本过短，请检查 PDF 是否有效" });
    }

    // 截断过长文本
    const maxChars = 30000;
    if (pdfText.length > maxChars) {
      pdfText = pdfText.slice(0, maxChars) + "\n...(文本已截断)";
    }

    // ── 阶段 1: Agent A — 提取诉求 ──
    console.log("[1/3] Agent A: 提取诉求...");
    const claimsRaw = await callLLM(
      AGENT_A_PROMPT,
      `以下是商业计划书全文：\n\n${pdfText}`,
      4096
    );
    const claimsData = extractJson(claimsRaw);
    if (!claimsData || !claimsData.claims) {
      return res.status(500).json({ error: "AI 提取诉求失败，请重试", raw: claimsRaw });
    }

    // ── 阶段 2: 联网搜索验证 ──
    console.log("[2/3] 联网搜索验证...");
    const queries = claimsData.claims.map((c) => c.search_query).filter(Boolean);
    const searchResults = await searchSerper(queries);

    // 组装证据文本
    const evidenceText = searchResults
      .map((sr, i) => {
        const claim = claimsData.claims[i];
        const snippets = sr.results.map((r) => `  - ${r.title}: ${r.snippet}`).join("\n");
        return `【诉求 ${i + 1}: ${claim?.dimension || "未知"}】\nBP 声称: ${claim?.claim || "N/A"}\n搜索查询: ${sr.query || queries[i]}\n搜索结果:\n${snippets || "  (无搜索结果)"}`;
      })
      .join("\n\n");

    // ── 阶段 3: Agent B — AI 法官裁决 ──
    console.log("[3/3] Agent B: AI 法官裁决...");
    const judgeInput = `【原告陈述 — BP 诉求】\n${JSON.stringify(claimsData.claims, null, 2)}\n\n【被告证据 — 搜索结果】\n${evidenceText}`;

    const { thinking, text: verdictRaw } = await callLLMWithThinking(
      AGENT_B_PROMPT,
      judgeInput
    );
    const verdict = extractJson(verdictRaw);

    if (!verdict) {
      return res.status(500).json({ error: "AI 法官输出解析失败，请重试", raw: verdictRaw });
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[完成] 总耗时 ${elapsed}s`);

    res.json({
      success: true,
      elapsed_seconds: parseFloat(elapsed),
      claims: claimsData.claims,
      search_results: searchResults,
      thinking,
      verdict,
    });
  } catch (err) {
    console.error("[分析错误]", err);
    res.status(500).json({ error: err.message || "服务器内部错误" });
  }
});

/** 纯文本分析（无需上传文件） */
app.post("/api/analyze-text", async (req, res) => {
  // 复用 analyze 逻辑
  req.body = { text: req.body.text };
  req.file = null;
  // 手动触发 analyze 处理
  app.handle(
    Object.assign(req, { url: "/api/analyze", method: "POST" }),
    res
  );
});

// ── 静态文件服务（生产模式） ──
const clientBuildDir = path.join(__dirname, "..", "client", "build");
if (fs.existsSync(clientBuildDir)) {
  app.use(express.static(clientBuildDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientBuildDir, "index.html"));
  });
}

// ── 启动 ──
app.listen(PORT, () => {
  console.log(`\n🚀 GarbageBPFilter 后端已启动: http://localhost:${PORT}`);
  console.log(`   模型: ${MODEL}`);
  console.log(`   搜索: ${SERPER_API_KEY ? "Serper.dev ✓" : "未配置 (Mock 模式)"}\n`);
});
