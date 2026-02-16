// ============================================================
// server/index.js — GarbageBPFilter 后端
// Express + multer 文件上传 + @anthropic-ai/sdk (MiniMax 兼容层)
// 辩证法裁决引擎: 提取诉求 → 联网搜索 → AkShare行业估值 → AI法官裁决 → 深度研究
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

/** 调用 Python AkShare 脚本获取行业市盈率 */
function fetchIndustryPE(industryKeyword) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, "..", "scripts", "industry_pe.py");
    const proc = spawn("python3", [scriptPath, industryKeyword], {
      timeout: 30_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code !== 0) {
        console.warn("AkShare 查询失败:", stderr);
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        resolve(null);
      }
    });
    proc.on("error", () => resolve(null));
  });
}

/** Serper.dev 搜索（批量） */
async function searchSerper(queries) {
  if (!SERPER_API_KEY) return queries.map((q) => ({ query: q, results: [], mock: true }));

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
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenced ? fenced[1].trim() : raw.trim();
  try {
    return JSON.parse(jsonStr);
  } catch {
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
同时，你需要识别出 BP 所属的行业，以便后续查询行业平均市盈率。

提取维度：
1. 市场规模 (TAM) — 市场有多大？
2. 估值/财务 — 融资金额、估值、收入数据
3. 核心技术/产品 — 技术路线、产品成熟度
4. 竞争对手 — 竞品分析、市场格局
5. 团队 — 创始人背景、核心团队

请严格返回以下 JSON 格式（不要加任何额外文字）：
{
  "industry": "BP所属行业关键词（如：人工智能、新能源、医疗器械、SaaS 等）",
  "claims": [
    {
      "dimension": "市场规模",
      "claim": "BP 中的具体声明",
      "search_query": "用于验证的 Google 搜索关键词"
    }
  ]
}`;

const AGENT_B_PROMPT = `你是一位铁面无私的 AI 法官（Agent B — 辩证裁决者）。

你将收到三份材料：
- 【原告陈述】= BP 中的诉求（Claims）
- 【被告证据】= 联网搜索结果（Evidence）
- 【行业基准】= 行业平均市盈率数据（Industry PE）

裁决规则：
- 如果 BP 市场规模 > 搜索证据的 5 倍 → 该维度 0 分（涉嫌欺诈）
- 如果 BP 估值 > 可比公司的 2 倍 → 该维度 20 分（严重高估）
- 如果技术仍在理论阶段但 BP 声称已量产 → 该维度 0 分
- 找不到相关证据支撑 → 该维度 30 分（存疑）
- 证据与声明基本吻合 → 该维度 70-90 分

估值对比规则：
- 使用提供的行业平均市盈率作为基准
- 计算 BP 声称的估值倍数（市盈率或市销率）
- 与行业平均水平进行对比，计算溢价百分比
- 如果行业平均市盈率数据不可用，根据搜索结果中的同行估值数据推断

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
    "overvalued_pct": 0,
    "industry_name": "行业名称",
    "data_source": "数据来源说明",
    "analysis": "估值对比分析说明"
  }
}`;

const DEEP_RESEARCH_PROMPT = `你是一位资深投资分析师，正在为投资委员会撰写深度研究报告。

你将收到一份商业计划书（BP）的原文、AI 法官的裁决结果、以及联网搜索的验证证据。

请基于所有这些信息，撰写一份结构化的深度研究报告（DeepResearch）。这不是简单复述 BP 内容，而是你的独立分析和调研发现。

报告结构：
1. **行业概况与市场验证** — 该行业的真实市场规模、增长趋势、关键驱动因素。引用搜索到的第三方数据源。
2. **竞争格局分析** — 主要竞争对手是谁？市场格局如何？BP 中声称的竞争优势是否成立？
3. **技术/产品可行性评估** — 核心技术的成熟度、技术路线是否合理、产品化风险。
4. **估值合理性深度分析** — 使用可比公司分析法（Comps），对比同行业上市公司/融资案例的估值水平。指出 BP 估值是否偏离合理区间。
5. **团队与执行力评估** — 创始团队背景是否匹配业务需求、执行风险。
6. **关键风险与红旗** — 识别出的主要风险点、数据矛盾、潜在欺诈信号。
7. **投资建议** — 综合以上分析，给出投资建议（推荐/观望/回避）和后续尽调方向。

要求：
- 使用 Markdown 格式
- 引用具体的搜索结果作为证据
- 数据要具体，不要空泛
- 语气专业但直白，如实指出问题
- 中文输出`;

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

/** 核心分析端点 — 上传 PDF，完成完整流水线 */
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

    const maxChars = 30000;
    if (pdfText.length > maxChars) {
      pdfText = pdfText.slice(0, maxChars) + "\n...(文本已截断)";
    }

    // ── 阶段 1: Agent A — 提取诉求 ──
    console.log("[1/5] Agent A: 提取诉求...");
    const claimsRaw = await callLLM(
      AGENT_A_PROMPT,
      `以下是商业计划书全文：\n\n${pdfText}`,
      4096
    );
    const claimsData = extractJson(claimsRaw);
    if (!claimsData || !claimsData.claims) {
      return res.status(500).json({ error: "AI 提取诉求失败，请重试", raw: claimsRaw });
    }

    // ── 阶段 2: 联网搜索验证 + AkShare 行业估值（并行） ──
    console.log("[2/5] 联网搜索验证 + 行业估值查询...");
    const queries = claimsData.claims.map((c) => c.search_query).filter(Boolean);
    const industryKeyword = claimsData.industry || "";

    // 并行执行: Serper 搜索 + AkShare 行业 PE + 行业估值搜索
    const industryPESearchQuery = industryKeyword
      ? `${industryKeyword} 行业 上市公司 平均市盈率 PE 2024 2025`
      : "";
    const allQueries = industryPESearchQuery
      ? [...queries, industryPESearchQuery]
      : queries;

    const [searchResults, industryPEData] = await Promise.all([
      searchSerper(allQueries),
      industryKeyword ? fetchIndustryPE(industryKeyword) : Promise.resolve(null),
    ]);

    // 分离: 前 N 条是诉求验证结果，最后一条（如有）是行业估值搜索
    let claimSearchResults = searchResults;
    let industrySearchResult = null;
    if (industryPESearchQuery && searchResults.length > queries.length) {
      claimSearchResults = searchResults.slice(0, queries.length);
      industrySearchResult = searchResults[searchResults.length - 1];
    }

    // 组装证据文本
    const evidenceText = claimSearchResults
      .map((sr, i) => {
        const claim = claimsData.claims[i];
        const snippets = sr.results.map((r) => `  - ${r.title}: ${r.snippet}`).join("\n");
        return `【诉求 ${i + 1}: ${claim?.dimension || "未知"}】\nBP 声称: ${claim?.claim || "N/A"}\n搜索查询: ${sr.query || queries[i]}\n搜索结果:\n${snippets || "  (无搜索结果)"}`;
      })
      .join("\n\n");

    // 组装行业估值基准
    let industryPEText = "【行业基准 — 行业平均市盈率】\n";
    if (industryPEData && industryPEData.industry_pe) {
      industryPEText += `来源: AkShare (${industryPEData.source})\n`;
      industryPEText += `行业: ${industryPEData.industry_name || industryKeyword}\n`;
      industryPEText += `行业平均市盈率 (PE): ${industryPEData.industry_pe}\n`;
      if (industryPEData.details?.length > 0) {
        industryPEText += `详细数据: ${JSON.stringify(industryPEData.details.slice(0, 3), null, 2)}\n`;
      }
    } else {
      industryPEText += `AkShare 数据不可用\n`;
    }
    if (industrySearchResult && industrySearchResult.results?.length > 0) {
      industryPEText += `\n搜索补充（${industryKeyword} 行业估值）:\n`;
      industrySearchResult.results.forEach((r) => {
        industryPEText += `  - ${r.title}: ${r.snippet}\n`;
      });
    }

    console.log("[3/5] Agent B: AI 法官裁决...");
    const judgeInput = [
      `【原告陈述 — BP 诉求】\n${JSON.stringify(claimsData.claims, null, 2)}`,
      `\n\n【被告证据 — 搜索结果】\n${evidenceText}`,
      `\n\n${industryPEText}`,
    ].join("");

    const { thinking, text: verdictRaw } = await callLLMWithThinking(
      AGENT_B_PROMPT,
      judgeInput
    );
    const verdict = extractJson(verdictRaw);

    if (!verdict) {
      return res.status(500).json({ error: "AI 法官输出解析失败，请重试", raw: verdictRaw });
    }

    // ── 阶段 4: Deep Research — AI 深度研究报告 ──
    console.log("[4/5] 深度研究报告生成...");
    const deepResearchInput = [
      `【商业计划书原文（摘要）】\n${pdfText.slice(0, 10000)}`,
      `\n\n【AI 法官裁决】\n${JSON.stringify(verdict, null, 2)}`,
      `\n\n【搜索验证证据】\n${evidenceText}`,
      `\n\n${industryPEText}`,
    ].join("");

    const deepResearch = await callLLM(
      DEEP_RESEARCH_PROMPT,
      deepResearchInput,
      6144
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[5/5] 完成！总耗时 ${elapsed}s`);

    res.json({
      success: true,
      elapsed_seconds: parseFloat(elapsed),
      claims: claimsData.claims,
      industry: claimsData.industry,
      search_results: claimSearchResults,
      industry_pe: industryPEData,
      thinking,
      deep_research: deepResearch,
      verdict,
    });
  } catch (err) {
    console.error("[分析错误]", err);
    res.status(500).json({ error: err.message || "服务器内部错误" });
  }
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
