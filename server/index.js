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
  if (!SERPER_API_KEY) {
    console.warn("  [搜索] SERPER_API_KEY 未配置，返回空结果（Mock模式）");
    return queries.map((q) => ({ query: q, results: [], mock: true }));
  }

  const results = await Promise.all(
    queries.map(async (q) => {
      try {
        const resp = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: {
            "X-API-KEY": SERPER_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ q, num: 5, gl: "cn", hl: "zh-cn" }),
        });
        if (!resp.ok) {
          console.warn(`  [搜索] 查询 "${q}" 失败: HTTP ${resp.status}`);
          return { query: q, results: [], error: `HTTP ${resp.status}` };
        }
        const data = await resp.json();
        const organic = (data.organic || []).slice(0, 5).map((r) => ({
          title: r.title,
          snippet: r.snippet,
          link: r.link,
        }));
        // 如果 organic 为空，尝试用 knowledgeGraph 或 answerBox 补充
        if (organic.length === 0) {
          if (data.knowledgeGraph) {
            organic.push({
              title: data.knowledgeGraph.title || q,
              snippet: data.knowledgeGraph.description || "",
              link: data.knowledgeGraph.website || "",
            });
          }
          if (data.answerBox) {
            organic.push({
              title: data.answerBox.title || q,
              snippet: data.answerBox.answer || data.answerBox.snippet || "",
              link: data.answerBox.link || "",
            });
          }
        }
        return { query: q, results: organic };
      } catch (err) {
        console.warn(`  [搜索] 查询 "${q}" 异常:`, err.message);
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

/** 调用 MiniMax LLM（思考模式 — Agent B 法官，不支持时自动降级） */
async function callLLMWithThinking(systemPrompt, userContent) {
  // 先尝试 thinking 模式
  try {
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
    if (text) return { thinking, text };
  } catch (thinkErr) {
    console.warn("Thinking 模式不可用，降级为普通模式:", thinkErr.message);
  }

  // 降级: 普通模式调用
  const text = await callLLM(systemPrompt, userContent, 8192);
  return { thinking: "", text };
}

/** 清理 LLM 输出中的非标准 JSON（尾逗号、注释等） */
function sanitizeJsonString(str) {
  // 去掉单行注释 // ...
  str = str.replace(/\/\/[^\n]*/g, "");
  // 去掉多行注释 /* ... */
  str = str.replace(/\/\*[\s\S]*?\*\//g, "");
  // 去掉尾逗号: ,} 或 ,]
  str = str.replace(/,\s*([\]}])/g, "$1");
  // 去掉 JSON 字符串外的控制字符（但保留字符串内的）
  // 先标记字符串位置，避免误删
  return str.trim();
}

/** 尝试修复常见的 JSON 格式问题 */
function attemptJsonFix(str) {
  if (!str) return str;
  
  let fixed = str;
  
  // 修复常见问题：
  // 1. 移除 BOM 和零宽字符
  fixed = fixed.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '');
  
  // 2. 修复单引号（JSON 必须用双引号）
  // 注意：这个正则可能不完美，但能处理大部分情况
  // fixed = fixed.replace(/'([^']*?)'/g, '"$1"');
  
  // 3. 移除对象/数组末尾的逗号
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
  
  // 4. 修复换行符问题（JSON 字符串内不能有未转义的换行）
  // 这个比较复杂，暂时跳过
  
  // 5. 移除注释
  fixed = fixed.replace(/\/\/.*$/gm, '');
  fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, '');
  
  return fixed.trim();
}

/** 从 LLM 输出中提取 JSON（增强容错） */
function extractJson(raw) {
  if (!raw || typeof raw !== "string") {
    console.warn("[extractJson] 输入为空或非字符串");
    return null;
  }

  const candidates = [];

  // 1) 尝试提取 ```json ... ``` 或 ``` ... ``` 代码块（支持多种格式）
  const fencedPatterns = [
    /```json\s*([\s\S]*?)```/,
    /```\s*([\s\S]*?)```/,
    /`{3,}\s*json\s*([\s\S]*?)`{3,}/,
  ];
  
  for (const pattern of fencedPatterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      candidates.push(match[1].trim());
    }
  }

  // 2) 找到最外层 { ... } 边界（更精确的匹配）
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const jsonCandidate = raw.slice(firstBrace, lastBrace + 1);
    candidates.push(jsonCandidate);
    
    // 尝试找到第一个完整的 JSON 对象（处理嵌套大括号）
    let braceCount = 0;
    let startIdx = firstBrace;
    for (let i = firstBrace; i < raw.length; i++) {
      if (raw[i] === "{") braceCount++;
      if (raw[i] === "}") braceCount--;
      if (braceCount === 0) {
        candidates.push(raw.slice(startIdx, i + 1));
        break;
      }
    }
  }

  // 3) 原始文本本身
  candidates.push(raw.trim());

  // 逐个候选尝试解析
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (!candidate) continue;

    // 尝试 1: 直接解析
    try {
      const parsed = JSON.parse(candidate);
      console.log(`[extractJson] ✓ 成功解析（候选 ${i + 1}/${candidates.length}，直接解析）`);
      return parsed;
    } catch (e) {
      if (i === 0) {
        console.warn(`[extractJson] 候选 ${i + 1} 直接解析失败:`, e.message);
      }
    }

    // 尝试 2: sanitize 后解析
    try {
      const cleaned = sanitizeJsonString(candidate);
      const parsed = JSON.parse(cleaned);
      console.log(`[extractJson] ✓ 成功解析（候选 ${i + 1}/${candidates.length}，sanitize 后）`);
      return parsed;
    } catch (e) {
      if (i === 0) {
        console.warn(`[extractJson] 候选 ${i + 1} sanitize 后解析失败:`, e.message);
      }
    }

    // 尝试 3: 修复常见问题后解析
    try {
      const fixed = attemptJsonFix(candidate);
      const parsed = JSON.parse(fixed);
      console.log(`[extractJson] ✓ 成功解析（候选 ${i + 1}/${candidates.length}，修复后）`);
      return parsed;
    } catch (e) {
      if (i === 0) {
        console.warn(`[extractJson] 候选 ${i + 1} 修复后解析失败:`, e.message);
      }
    }

    // 尝试 4: 组合修复
    try {
      const fixed = attemptJsonFix(sanitizeJsonString(candidate));
      const parsed = JSON.parse(fixed);
      console.log(`[extractJson] ✓ 成功解析（候选 ${i + 1}/${candidates.length}，组合修复）`);
      return parsed;
    } catch (e) {
      if (i === 0) {
        console.warn(`[extractJson] 候选 ${i + 1} 组合修复后解析失败:`, e.message);
      }
    }
  }

  // 所有尝试都失败，输出详细调试信息
  console.error("[extractJson] ========== 解析失败详情 ==========");
  console.error("[extractJson] 原始输出长度:", raw.length);
  console.error("[extractJson] 原始输出前 800 字符:");
  console.error(raw.slice(0, 800));
  console.error("[extractJson] 原始输出后 200 字符:");
  console.error(raw.slice(-200));
  console.error("[extractJson] 候选数量:", candidates.length);
  candidates.forEach((c, i) => {
    if (c) {
      console.error(`[extractJson] 候选 ${i + 1} 前 200 字符:`, c.slice(0, 200));
    }
  });
  console.error("[extractJson] =====================================");
  
  return null;
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

【重要】你必须严格按照以下要求输出：
1. 只输出纯 JSON，不要有任何其他文字
2. 不要使用 markdown 代码块（不要用 \`\`\`json 或 \`\`\`）
3. 不要添加任何注释（// 或 /* */）
4. 不要在 JSON 前后添加任何解释性文字
5. 确保 JSON 格式完全正确，没有尾逗号

输出格式示例：
{
  "industry": "人工智能",
  "claims": [
    {
      "dimension": "市场规模",
      "claim": "BP 中的具体声明原文",
      "search_query": "用于 Google 验证的搜索关键词"
    },
    {
      "dimension": "估值/财务",
      "claim": "BP 中关于融资或收入的声明",
      "search_query": "验证用搜索关键词"
    },
    {
      "dimension": "核心技术/产品",
      "claim": "BP 中关于技术的声明",
      "search_query": "验证用搜索关键词"
    },
    {
      "dimension": "竞争对手",
      "claim": "BP 中关于竞争的声明",
      "search_query": "验证用搜索关键词"
    },
    {
      "dimension": "团队",
      "claim": "BP 中关于团队的声明",
      "search_query": "验证用搜索关键词"
    }
  ]
}

注意：claims 数组必须包含 5 个对象，分别对应上述 5 个维度。industry 填写行业关键词（如：人工智能、新能源、医疗器械、SaaS 等）。`;

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

【重要】你必须严格按照以下要求输出：
1. 只输出纯 JSON，不要有任何其他文字
2. 不要使用 markdown 代码块（不要用 \`\`\`json 或 \`\`\`）
3. 不要添加任何注释（// 或 /* */）
4. 不要在 JSON 前后添加任何解释性文字
5. 确保 JSON 格式完全正确，没有尾逗号
6. 所有字符串值中的引号必须正确转义

输出格式示例：
{
  "total_score": 65,
  "grade": "B",
  "verdict_summary": "一句话裁决总结",
  "dimensions": {
    "market": { "score": 70, "label": "市场规模", "finding": "具体裁决说明" },
    "valuation": { "score": 50, "label": "估值合理性", "finding": "具体裁决说明" },
    "tech": { "score": 60, "label": "技术可行性", "finding": "具体裁决说明" },
    "moat": { "score": 55, "label": "竞争壁垒", "finding": "具体裁决说明" },
    "team": { "score": 75, "label": "团队匹配度", "finding": "具体裁决说明" },
    "timing": { "score": 65, "label": "入场时机", "finding": "具体裁决说明" }
  },
  "risk_flags": ["风险点1", "风险点2"],
  "strengths": ["优势1", "优势2"],
  "conflicts": [
    { "claim": "BP 声称...", "evidence": "搜索发现...", "severity": "严重" }
  ],
  "valuation_comparison": {
    "bp_multiple": 40,
    "industry_avg_multiple": 25,
    "overvalued_pct": 60,
    "industry_name": "行业名称",
    "data_source": "数据来源说明",
    "analysis": "估值对比分析说明"
  }
}

注意：score 字段必须是 0 到 100 之间的整数，severity 只能是 "严重"、"中等"、"轻微" 之一。`;

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
      // 验证文件类型
      if (req.file.mimetype && req.file.mimetype !== "application/pdf" && !req.file.originalname?.endsWith(".pdf")) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: "请上传 PDF 格式的文件" });
      }
      try {
        pdfText = await extractPdfText(req.file.path);
      } catch (pyErr) {
        const errMsg = pyErr.message || "未知错误";
        console.warn("Python PDF 提取失败:", errMsg);
        // 尝试解析 Python 返回的 JSON 错误
        let userMessage = errMsg;
        try {
          const parsed = JSON.parse(errMsg);
          if (parsed.error) userMessage = parsed.error;
        } catch {}
        return res.status(400).json({ error: "PDF 解析失败: " + userMessage });
      } finally {
        // 安全清理临时文件
        try { fs.unlinkSync(req.file.path); } catch {}
      }
    } else if (req.body && req.body.text) {
      pdfText = req.body.text;
    } else {
      return res.status(400).json({ error: "请上传 PDF 文件或提供文本" });
    }

    if (pdfText.length < 50) {
      return res.status(400).json({
        error: "提取的文本过短（仅 " + pdfText.length + " 字符），请检查 PDF 是否为有效的商业计划书",
      });
    }

    const maxChars = 30000;
    if (pdfText.length > maxChars) {
      pdfText = pdfText.slice(0, maxChars) + "\n...(文本已截断)";
    }

    // ============================================================
    // 三步 Pipeline: Claim提取 → 联网取证 → 对比打假
    // ============================================================

    // ── 第1步: Claim提取 — 从BP中提取关键诉求 ──
    console.log("[1/3] Claim提取: 从BP中提取关键诉求...");
    let claimsRaw = await callLLM(
      AGENT_A_PROMPT,
      `以下是商业计划书全文：\n\n${pdfText}`,
      4096
    );
    let claimsData = extractJson(claimsRaw);
    
    // 如果首次提取失败，重试一次（添加更严格的提示）
    if (!claimsData || !claimsData.claims) {
      console.warn("[1/3] 首次 Claim 提取 JSON 解析失败，重试中...");
      const retryPrompt = AGENT_A_PROMPT + "\n\n【紧急提醒】你上一次的输出不是合法 JSON，导致解析失败。这次请务必：\n1. 只输出 JSON 对象，从 { 开始，到 } 结束\n2. 不要添加任何解释、标题或 markdown 标记\n3. 确保所有字符串用双引号包裹\n4. 不要有尾逗号";
      claimsRaw = await callLLM(retryPrompt, `以下是商业计划书全文：\n\n${pdfText}`, 4096);
      claimsData = extractJson(claimsRaw);
    }
    
    if (!claimsData || !claimsData.claims) {
      console.error("[1/3] Claim 提取两次均失败");
      return res.status(500).json({ 
        error: "AI 提取诉求失败（已重试 2 次），请重新分析。如果问题持续，请检查 PDF 内容是否为有效的商业计划书。", 
        raw: claimsRaw?.slice(0, 2000),
        debug: "extractJson 返回 null，请查看服务器日志了解详情"
      });
    }
    
    // 验证 claims 数组的完整性
    if (!Array.isArray(claimsData.claims) || claimsData.claims.length === 0) {
      console.error("[1/3] claims 数组为空或格式错误");
      return res.status(500).json({ 
        error: "AI 提取的诉求格式错误，请重试", 
        raw: claimsRaw?.slice(0, 2000) 
      });
    }
    
    console.log(`  → 提取到 ${claimsData.claims.length} 条诉求，行业: ${claimsData.industry || "未识别"}`);

    // ── 第2步: 联网取证 — Serper搜索 + AkShare行业估值（并行） ──
    console.log("[2/3] 联网取证: 搜索验证 + 行业估值查询...");
    const queries = claimsData.claims.map((c) => c.search_query).filter(Boolean);
    const industryKeyword = claimsData.industry || "";

    // 为行业估值单独构造搜索词
    const industryPESearchQuery = industryKeyword
      ? `${industryKeyword} 行业 上市公司 平均市盈率 PE 2024 2025`
      : "";

    // 分开执行诉求搜索和行业估值搜索（避免数组拼接导致的 bug）
    const [claimSearchResults, industrySearchResults, industryPEData] = await Promise.all([
      searchSerper(queries),
      industryPESearchQuery ? searchSerper([industryPESearchQuery]) : Promise.resolve([]),
      industryKeyword ? fetchIndustryPE(industryKeyword) : Promise.resolve(null),
    ]);

    const industrySearchResult = industrySearchResults[0] || null;

    // 统计搜索结果
    const totalSearchResults = claimSearchResults.reduce((sum, sr) => sum + (sr.results?.length || 0), 0);
    const searchEnabled = !!SERPER_API_KEY;
    const isMockSearch = claimSearchResults.some((sr) => sr.mock);
    console.log(`  → 搜索${searchEnabled ? "已启用" : "未启用(Mock模式)"}: 共 ${totalSearchResults} 条结果`);
    console.log(`  → AkShare 行业PE: ${industryPEData?.industry_pe ?? "不可用"}`);

    // 组装证据文本
    const evidenceText = claimSearchResults
      .map((sr, i) => {
        const claim = claimsData.claims[i];
        const snippets = sr.results.map((r) => `  - ${r.title}: ${r.snippet}`).join("\n");
        return `【诉求 ${i + 1}: ${claim?.dimension || "未知"}】\nBP 声称: ${claim?.claim || "N/A"}\n搜索查询: ${sr.query || queries[i]}\n搜索结果（${sr.results?.length || 0} 条）:\n${snippets || "  (无搜索结果)"}`;
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

    // ── 第3步: 对比打假 — AI法官裁决 + 深度研究报告 ──
    console.log("[3/3] 对比打假: AI法官裁决 + 深度研究报告...");
    const judgeInput = [
      `【原告陈述 — BP 诉求】\n${JSON.stringify(claimsData.claims, null, 2)}`,
      `\n\n【被告证据 — 搜索结果】\n${evidenceText}`,
      `\n\n${industryPEText}`,
    ].join("");

    let thinking = "";
    let verdictRaw = "";
    let verdict = null;

    // 首次尝试（使用 thinking 模式）
    const result1 = await callLLMWithThinking(AGENT_B_PROMPT, judgeInput);
    thinking = result1.thinking;
    verdictRaw = result1.text;
    verdict = extractJson(verdictRaw);

    // 解析失败时重试第一次（用普通模式 + 更严格的提示）
    if (!verdict) {
      console.warn("[3/3] 首次裁决 JSON 解析失败，重试 1/2...");
      const retryPrompt = AGENT_B_PROMPT + "\n\n【紧急提醒】你上一次的输出不是合法 JSON，导致解析失败。这次请务必：\n1. 只输出 JSON 对象，从 { 开始，到 } 结束\n2. 不要添加任何解释、标题或 markdown 标记\n3. 确保所有字符串用双引号包裹\n4. 不要有尾逗号";
      verdictRaw = await callLLM(retryPrompt, judgeInput, 8192);
      verdict = extractJson(verdictRaw);
    }

    // 如果还是失败，再重试一次（简化输出要求）
    if (!verdict) {
      console.warn("[3/3] 第二次裁决 JSON 解析失败，重试 2/2（简化模式）...");
      const simplifiedPrompt = `你是 AI 法官，请根据以下材料输出裁决结果。

【关键要求】只输出 JSON，格式如下（不要有任何其他文字）：
{
  "total_score": 65,
  "grade": "B",
  "verdict_summary": "一句话总结",
  "dimensions": {
    "market": {"score": 70, "label": "市场规模", "finding": "分析"},
    "valuation": {"score": 50, "label": "估值合理性", "finding": "分析"},
    "tech": {"score": 60, "label": "技术可行性", "finding": "分析"},
    "moat": {"score": 55, "label": "竞争壁垒", "finding": "分析"},
    "team": {"score": 75, "label": "团队匹配度", "finding": "分析"},
    "timing": {"score": 65, "label": "入场时机", "finding": "分析"}
  },
  "risk_flags": ["风险1"],
  "strengths": ["优势1"],
  "conflicts": [],
  "valuation_comparison": {
    "bp_multiple": 40,
    "industry_avg_multiple": 25,
    "overvalued_pct": 60,
    "industry_name": "行业",
    "data_source": "来源",
    "analysis": "分析"
  }
}`;
      verdictRaw = await callLLM(simplifiedPrompt, judgeInput, 8192);
      verdict = extractJson(verdictRaw);
    }

    if (!verdict) {
      console.error("[3/3] 三次裁决均解析失败");
      console.error("[3/3] 最后一次原始输出:", verdictRaw?.slice(0, 1000));
      return res.status(500).json({ 
        error: "AI 法官输出解析失败（已重试 3 次），请重新分析。建议：1) 检查网络连接 2) 稍后重试 3) 如果问题持续，可能是 API 服务异常", 
        raw: verdictRaw?.slice(0, 2000),
        debug: "extractJson 返回 null，请查看服务器日志了解详情"
      });
    }
    
    // 验证必要字段
    if (typeof verdict.total_score !== 'number') {
      console.warn("[3/3] total_score 缺失，使用默认值 50");
      verdict.total_score = 50;
    }
    if (!verdict.dimensions || typeof verdict.dimensions !== 'object') {
      console.warn("[3/3] dimensions 缺失，使用默认值");
      verdict.dimensions = {
        market: {score: 50, label: "市场规模", finding: "数据不足"},
        valuation: {score: 50, label: "估值合理性", finding: "数据不足"},
        tech: {score: 50, label: "技术可行性", finding: "数据不足"},
        moat: {score: 50, label: "竞争壁垒", finding: "数据不足"},
        team: {score: 50, label: "团队匹配度", finding: "数据不足"},
        timing: {score: 50, label: "入场时机", finding: "数据不足"}
      };
    }

    // 生成深度研究报告
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
    console.log(`✓ 完成！总耗时 ${elapsed}s`);

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
      // 新增搜索摘要信息，方便前端展示
      search_summary: {
        enabled: searchEnabled,
        mock: isMockSearch,
        total_results: totalSearchResults,
        queries_count: queries.length,
        industry_pe_available: !!(industryPEData?.industry_pe),
      },
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
