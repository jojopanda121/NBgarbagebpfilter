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
const { scoreProject } = require("./scoring");

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

const AGENT_A_PROMPT = `你是一位顶级 VC 分析师（Agent A — 数据提取器）。
你的任务是从商业计划书（BP）文本中提取关键数据，用于后续的标准化评分。

你需要提取以下数据：

**第一维度：时机与天花板**
- TAM: 目标可触达市场规模（单位：十亿人民币或亿美元，仅提取数字）
- CAGR: 行业预期年复合增长率（%，仅提取数字）

**第二维度：产品与壁垒**
- TRL: 技术就绪水平（1-9级，9为可量产。根据BP描述判断：1-3为概念/实验室，4-6为原型/小试，7-9为中试/量产）
- SC: 客户转换成本评分（0-100分。评估用户切换到竞品的难度，考虑数据迁移成本、学习成本、集成成本等）

**第三维度：商业验证与效率**
- LTV: 客户生命周期价值（人民币或美元）
- CAC: 客户获客成本（人民币或美元）
- Ratio: LTV/CAC 比值（计算得出）
- Margin: 毛利率（%，0-1之间的小数，如 0.6 表示60%）

**第四维度：团队基因**
- Exp: 核心创始人行业相关经验（年）
- Equity: 最大股东持股比例（%，0-100之间的数字）

**第五维度：外部风险与交易条件**
- Policy_Risk: 政策违规风险（0或1，0表示极高风险如涉及政策禁止领域，1表示无明显政策风险）
- BP_Valuation: BP声称的估值（亿元或亿美元）
- BP_Revenue: BP声称的收入或ARR（亿元或亿美元，如果没有收入填0）

同时识别：
- industry: 行业关键词（如：人工智能、新能源、医疗器械、SaaS等）
- company_name: 公司名称

【重要】你必须严格按照以下要求输出：
1. 只输出纯 JSON，不要有任何其他文字
2. 不要使用 markdown 代码块（不要用 \`\`\`json 或 \`\`\`）
3. 不要添加任何注释（// 或 /* */）
4. 不要在 JSON 前后添加任何解释性文字
5. 确保 JSON 格式完全正确，没有尾逗号
6. 如果BP中没有明确提及某个数据，根据行业常识和BP描述进行合理推断，并标注 "estimated": true

输出格式示例：
{
  "company_name": "XX科技",
  "industry": "人工智能",
  "TAM": 100,
  "TAM_estimated": false,
  "CAGR": 25,
  "CAGR_estimated": true,
  "TRL": 7,
  "SC": 65,
  "LTV": 50000,
  "CAC": 10000,
  "Ratio": 5,
  "Margin": 0.7,
  "Exp": 8,
  "Equity": 60,
  "Policy_Risk": 1,
  "BP_Valuation": 5,
  "BP_Revenue": 0.5,
  "search_queries": [
    {"dimension": "市场规模", "query": "人工智能 市场规模 2024 TAM"},
    {"dimension": "行业增速", "query": "人工智能 CAGR 年复合增长率"},
    {"dimension": "竞品估值", "query": "人工智能 竞品公司 估值 融资"},
    {"dimension": "团队背景", "query": "创始人姓名 背景 经历"},
    {"dimension": "政策监管", "query": "人工智能 政策 监管 合规"}
  ],
  "extraction_notes": "简要说明数据提取过程中的关键假设和推断"
}

注意：所有数值字段必须是数字类型（不要加单位），search_queries 用于后续联网验证。`;

const AGENT_B_PROMPT = `你是一位铁面无私的 AI 法官（Agent B — 数据验证与校准者）。

你将收到：
- 【BP提取数据】= Agent A 从 BP 中提取的原始数据
- 【搜索证据】= 联网搜索的验证结果
- 【行业基准】= 行业平均市盈率数据

你的任务是：
1. 验证 BP 提取数据的真实性，与搜索证据对比
2. 校准可能被夸大的数据（如市场规模、增长率等）
3. 补充缺失的数据（如果BP未提及，根据搜索证据和行业常识推断）
4. 计算估值溢价倍数 Valuation_Gap = BP估值倍数 / 行业平均倍数

验证规则：
- TAM: 如果 BP 声称的市场规模 > 搜索证据的 3倍，应校准为搜索证据的值
- CAGR: 如果 BP 声称的增速明显高于行业平均，应保守调整
- TRL: 根据 BP 描述和搜索到的技术成熟度判断（1-9级）
- SC: 根据行业特性评估客户转换成本（0-100分）
- LTV/CAC: 如果 BP 未提供，根据搜索到的行业平均客单价和获客成本估算
- Margin: 如果 BP 未提供，根据行业平均毛利率估算
- Exp: 验证创始人背景的真实性
- Equity: 检查股权结构是否合理
- Policy_Risk: 检查是否涉及政策禁止或高风险领域（如P2P、虚拟货币挖矿等）
- Valuation_Gap: 计算 BP 估值相对行业可比公司的溢价倍数

【重要】你必须严格按照以下要求输出：
1. 只输出纯 JSON，不要有任何其他文字
2. 不要使用 markdown 代码块（不要用 \`\`\`json 或 \`\`\`）
3. 不要添加任何注释（// 或 /* */）
4. 不要在 JSON 前后添加任何解释性文字
5. 确保 JSON 格式完全正确，没有尾逗号
6. 所有数值字段必须是数字类型

输出格式示例：
{
  "validated_data": {
    "TAM": 80,
    "CAGR": 20,
    "TRL": 6,
    "SC": 55,
    "Ratio": 2.5,
    "Margin": 0.6,
    "Exp": 8,
    "Equity": 55,
    "Policy_Risk": 1,
    "Valuation_Gap": 1.8
  },
  "validation_notes": {
    "TAM": "BP声称100亿，搜索显示市场规模约80亿，已校准",
    "CAGR": "BP声称30%，行业平均20%，保守调整",
    "TRL": "BP描述已有中试产线，判定为6级",
    "SC": "SaaS产品，数据迁移成本中等，评55分",
    "Ratio": "根据行业平均LTV 5万、CAC 2万计算，比值2.5",
    "Margin": "BP声称70%，行业平均60%，保守取60%",
    "Valuation_Gap": "BP估值5亿，收入0.5亿，PS=10x；行业平均PS=5.5x，溢价1.8倍"
  },
  "conflicts": [
    { "field": "TAM", "bp_claim": "100亿", "evidence": "搜索显示80亿", "severity": "中等" },
    { "field": "CAGR", "bp_claim": "30%", "evidence": "行业平均20%", "severity": "轻微" }
  ],
  "risk_flags": ["估值偏高", "技术尚未量产"],
  "strengths": ["团队经验丰富", "市场空间大"],
  "industry_comparison": {
    "bp_valuation": 5,
    "bp_revenue": 0.5,
    "bp_multiple": 10,
    "industry_avg_multiple": 5.5,
    "comparable_companies": ["竞品A: PS 6x", "竞品B: PS 5x"],
    "data_source": "搜索结果 + AkShare行业数据"
  }
}

注意：validated_data 中的所有字段都必须有值（不能为null），如果无法确定则使用行业平均值或保守估计。`;

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

    // ── 第1步: 数据提取 — 从BP中提取评分所需数据 ──
    console.log("[1/3] 数据提取: 从BP中提取评分所需数据...");
    let extractionRaw = await callLLM(
      AGENT_A_PROMPT,
      `以下是商业计划书全文：\n\n${pdfText}`,
      4096
    );
    let extractedData = extractJson(extractionRaw);
    
    // 如果首次提取失败，重试一次（添加更严格的提示）
    if (!extractedData || !extractedData.search_queries) {
      console.warn("[1/3] 首次数据提取 JSON 解析失败，重试中...");
      const retryPrompt = AGENT_A_PROMPT + "\n\n【紧急提醒】你上一次的输出不是合法 JSON，导致解析失败。这次请务必：\n1. 只输出 JSON 对象，从 { 开始，到 } 结束\n2. 不要添加任何解释、标题或 markdown 标记\n3. 确保所有字符串用双引号包裹\n4. 不要有尾逗号";
      extractionRaw = await callLLM(retryPrompt, `以下是商业计划书全文：\n\n${pdfText}`, 4096);
      extractedData = extractJson(extractionRaw);
    }
    
    if (!extractedData || !extractedData.search_queries) {
      console.error("[1/3] 数据提取两次均失败");
      return res.status(500).json({ 
        error: "AI 数据提取失败（已重试 2 次），请重新分析。如果问题持续，请检查 PDF 内容是否为有效的商业计划书。", 
        raw: extractionRaw?.slice(0, 2000),
        debug: "extractJson 返回 null，请查看服务器日志了解详情"
      });
    }
    
    // 验证 search_queries 数组的完整性
    if (!Array.isArray(extractedData.search_queries) || extractedData.search_queries.length === 0) {
      console.error("[1/3] search_queries 数组为空或格式错误");
      return res.status(500).json({ 
        error: "AI 提取的数据格式错误，请重试", 
        raw: extractionRaw?.slice(0, 2000) 
      });
    }
    
    console.log(`  → 提取到 ${extractedData.search_queries.length} 条搜索查询，行业: ${extractedData.industry || "未识别"}`);
    console.log(`  → TAM: ${extractedData.TAM}亿, CAGR: ${extractedData.CAGR}%, TRL: ${extractedData.TRL}, Ratio: ${extractedData.Ratio}`);

    // ── 第2步: 联网取证 — Serper搜索 + AkShare行业估值（并行） ──
    console.log("[2/3] 联网取证: 搜索验证 + 行业估值查询...");
    const queries = extractedData.search_queries.map((q) => q.query).filter(Boolean);
    const industryKeyword = extractedData.industry || "";

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
        const query_item = extractedData.search_queries[i];
        const snippets = sr.results.map((r) => `  - ${r.title}: ${r.snippet}`).join("\n");
        return `【搜索 ${i + 1}: ${query_item?.dimension || "未知"}】\n搜索查询: ${sr.query || queries[i]}\n搜索结果（${sr.results?.length || 0} 条）:\n${snippets || "  (无搜索结果)"}`;
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

    // ── 第3步: 数据验证与评分计算 ──
    console.log("[3/3] 数据验证与评分计算...");
    const judgeInput = [
      `【BP提取数据】\n${JSON.stringify(extractedData, null, 2)}`,
      `\n\n【搜索证据】\n${evidenceText}`,
      `\n\n${industryPEText}`,
    ].join("");

    let thinking = "";
    let validationRaw = "";
    let validatedData = null;

    // 首次尝试（使用 thinking 模式）
    const result1 = await callLLMWithThinking(AGENT_B_PROMPT, judgeInput);
    thinking = result1.thinking;
    validationRaw = result1.text;
    validatedData = extractJson(validationRaw);

    // 解析失败时重试
    if (!validatedData || !validatedData.validated_data) {
      console.warn("[3/3] 首次数据验证 JSON 解析失败，重试...");
      const retryPrompt = AGENT_B_PROMPT + "\n\n【紧急提醒】你上一次的输出不是合法 JSON，导致解析失败。这次请务必只输出JSON。";
      validationRaw = await callLLM(retryPrompt, judgeInput, 8192);
      validatedData = extractJson(validationRaw);
    }

    if (!validatedData || !validatedData.validated_data) {
      console.error("[3/3] 数据验证失败");
      return res.status(500).json({ 
        error: "AI 数据验证失败，请重试", 
        raw: validationRaw?.slice(0, 2000)
      });
    }

    // 使用验证后的数据进行评分
    const scoringInput = validatedData.validated_data;
    const scoringResult = scoreProject(scoringInput);
    
    console.log(`  → 评分完成: 总分 ${scoringResult.total_score}, 评级 ${scoringResult.grade}`);
    console.log(`  → 五维得分: S1=${scoringResult.dimensions.timing_ceiling.score}, S2=${scoringResult.dimensions.product_moat.score}, S3=${scoringResult.dimensions.business_validation.score}, S4=${scoringResult.dimensions.team.score}, V5=${scoringResult.dimensions.external_risk.multiplier}`);

    // 构造最终裁决结果（兼容前端格式）
    const verdict = {
      total_score: scoringResult.total_score,
      grade: scoringResult.grade,
      verdict_summary: scoringResult.grade_label,
      dimensions: {
        timing_ceiling: {
          score: scoringResult.dimensions.timing_ceiling.score,
          label: scoringResult.dimensions.timing_ceiling.label,
          subtitle: scoringResult.dimensions.timing_ceiling.subtitle,
          finding: validatedData.validation_notes?.TAM || validatedData.validation_notes?.CAGR || "市场规模与增速评估"
        },
        product_moat: {
          score: scoringResult.dimensions.product_moat.score,
          label: scoringResult.dimensions.product_moat.label,
          subtitle: scoringResult.dimensions.product_moat.subtitle,
          finding: validatedData.validation_notes?.TRL || validatedData.validation_notes?.SC || "技术成熟度与竞争壁垒评估"
        },
        business_validation: {
          score: scoringResult.dimensions.business_validation.score,
          label: scoringResult.dimensions.business_validation.label,
          subtitle: scoringResult.dimensions.business_validation.subtitle,
          finding: validatedData.validation_notes?.Ratio || validatedData.validation_notes?.Margin || "商业模式与单位经济评估"
        },
        team: {
          score: scoringResult.dimensions.team.score,
          label: scoringResult.dimensions.team.label,
          subtitle: scoringResult.dimensions.team.subtitle,
          finding: validatedData.validation_notes?.Exp || validatedData.validation_notes?.Equity || "团队经验与股权结构评估"
        },
        external_risk: {
          score: scoringResult.dimensions.external_risk.score,
          label: scoringResult.dimensions.external_risk.label,
          subtitle: scoringResult.dimensions.external_risk.subtitle,
          finding: validatedData.validation_notes?.Policy_Risk || validatedData.validation_notes?.Valuation_Gap || "政策风险与估值合理性评估",
          multiplier: scoringResult.dimensions.external_risk.multiplier
        }
      },
      risk_flags: validatedData.risk_flags || [],
      strengths: validatedData.strengths || [],
      conflicts: validatedData.conflicts || [],
      valuation_comparison: validatedData.industry_comparison || {
        bp_multiple: scoringInput.BP_Valuation && scoringInput.BP_Revenue ? scoringInput.BP_Valuation / scoringInput.BP_Revenue : 0,
        industry_avg_multiple: industryPEData?.industry_pe || 0,
        overvalued_pct: scoringInput.Valuation_Gap ? Math.round((scoringInput.Valuation_Gap - 1) * 100) : 0,
        industry_name: industryKeyword,
        data_source: "搜索结果 + AkShare + AI分析",
        analysis: `${scoringResult.grade_action}`
      }
    };

    // 生成深度研究报告
    const deepResearchInput = [
      `【商业计划书原文（摘要）】\n${pdfText.slice(0, 10000)}`,
      `\n\n【评分结果】\n总分: ${scoringResult.total_score}\n评级: ${scoringResult.grade} - ${scoringResult.grade_label}\n\n五维得分:\n${JSON.stringify(scoringResult.dimensions, null, 2)}`,
      `\n\n【数据验证】\n${JSON.stringify(validatedData, null, 2)}`,
      `\n\n【搜索证据】\n${evidenceText}`,
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
      extracted_data: extractedData,
      validated_data: scoringInput,
      industry: extractedData.industry,
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
