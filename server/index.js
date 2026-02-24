// ============================================================
// server/index.js — GarbageBPFilter 后端
// Express + multer 文件上传 + @anthropic-ai/sdk (MiniMax 兼容层)
// 辩证法裁决引擎: 提取诉求 → MiniMax知识库深度研究 → AI法官裁决 → 深度研究报告
// ============================================================

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");
const Anthropic = require("@anthropic-ai/sdk").default;
const { scoreProject } = require("./scoring");

const app = express();
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 50 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: "50mb" }));

const PORT = parseInt(process.env.PORT, 10) || 3001;

// ============================================================
// 异步任务存储（内存）
//
// 架构：POST /api/analyze 立即返回 taskId，流水线后台运行；
//       前端轮询 GET /api/task/:taskId，每次请求毫秒级完成，
//       彻底绕开网关/浏览器对长连接的超时强杀。
// ============================================================

const tasks = new Map(); // taskId → TaskState

function createTask() {
  const id = crypto.randomBytes(16).toString("hex");
  const task = {
    id,
    status: "running",   // running | complete | error
    percentage: 0,
    stage: "queued",
    message: "任务已提交，等待处理...",
    result: null,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  tasks.set(id, task);
  return task;
}

function updateTask(taskId, fields) {
  const task = tasks.get(taskId);
  if (!task) return;
  Object.assign(task, fields, { updatedAt: Date.now() });
}

// 每 10 分钟清理超过 1 小时的旧任务
setInterval(() => {
  const cutoff = Date.now() - 3_600_000;
  for (const [id, t] of tasks) {
    if (t.createdAt < cutoff) tasks.delete(id);
  }
}, 600_000);

// ── MiniMax via Anthropic SDK 配置 ──
const anthropic = new Anthropic({
  apiKey: process.env.MINIMAX_API_KEY || "",
  baseURL: "https://api.minimax.io/anthropic",
});
const MODEL = process.env.MINIMAX_MODEL || "MiniMax-M2.5";

// ============================================================
// 工具函数
// ============================================================

/** 调用 Python 脚本提取文档文本（支持 PDF 和 PPTX） */
function extractDocText(filePath, mode) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "..", "scripts", "extract_doc.py");
    const proc = spawn("python3", [scriptPath, filePath, mode], {
      timeout: 120_000,
      maxBuffer: 30 * 1024 * 1024,
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

/** 调用 MiniMax LLM（普通模式） */
async function callLLM(systemPrompt, userContent, maxTokens = 8192) {
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

/** 调用 MiniMax LLM（深度思考模式，不支持时自动降级） */
async function callLLMWithThinking(systemPrompt, userContent, maxTokens = 16000, thinkingBudget = 8000) {
  // 先尝试 thinking 模式
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      thinking: { type: "enabled", budget_tokens: thinkingBudget },
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
  const text = await callLLM(systemPrompt, userContent, maxTokens);
  return { thinking: "", text };
}

/** 清理 LLM 输出中的非标准 JSON */
function sanitizeJsonString(str) {
  str = str.replace(/\/\/[^\n]*/g, "");
  str = str.replace(/\/\*[\s\S]*?\*\//g, "");
  str = str.replace(/,\s*([\]}])/g, "$1");
  return str.trim();
}

/** 尝试修复常见的 JSON 格式问题 */
function attemptJsonFix(str) {
  if (!str) return str;
  let fixed = str;
  fixed = fixed.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '');
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
  fixed = fixed.replace(/\/\/.*$/gm, '');
  fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, '');
  return fixed.trim();
}

/**
 * 修复被截断的 JSON 字符串：
 * 统计未闭合的 { [ "，按需补齐 ] } 使其成为合法 JSON。
 * 适用于 MiniMax 因 token 耗尽而在中途停止输出的场景。
 */
function repairTruncatedJson(str) {
  if (!str) return str;
  let braces = 0, brackets = 0, inStr = false, esc = false;
  for (const ch of str) {
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
  }
  // 已经完整，不需要修复
  if (braces === 0 && brackets === 0 && !inStr) return str;
  let repaired = str.trimEnd();
  // 闭合未关闭的字符串
  if (inStr) repaired += '"';
  // 移除末尾悬空逗号（截断时常见）
  repaired = repaired.replace(/,\s*$/, '');
  // 按需补全 ] }
  while (brackets > 0) { repaired += ']'; brackets--; }
  while (braces > 0) { repaired += '}'; braces--; }
  return repaired;
}

/**
 * 压缩声明核查结果：
 * - 去除冗长的 ai_research 字段（节省 Phase 2 输入 token）
 * - 按严重程度排序，保留最多 15 条最高影响的声明
 */
function compressVerdicts(verdicts) {
  if (!Array.isArray(verdicts)) return [];
  const severityOrder = { '严重': 0, '高': 0, '中': 1, '低': 2 };
  const sorted = [...verdicts].sort(
    (a, b) => (severityOrder[a.severity] ?? 1) - (severityOrder[b.severity] ?? 1)
  );
  return sorted.slice(0, 15).map(
    ({ category, original_claim, verdict, diff, severity, score_impact }) => ({
      category, original_claim, verdict, diff, severity, score_impact,
    })
  );
}

/**
 * 预处理 MiniMax DeepThink 输出：
 * 移除 <minimax:tool_call>...</minimax:tool_call> 等 XML 工具调用标签。
 * DeepThink 模式下 MiniMax 会在文本中插入内置搜索工具调用标记，
 * 这些标记通过 Anthropic SDK 兼容层无法执行，导致 JSON 解析失败。
 */
function preprocessMinimaxOutput(raw) {
  if (!raw || typeof raw !== 'string') return raw;
  let processed = raw;
  // 移除 minimax 工具调用块（含内部所有内容）
  processed = processed.replace(/<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/g, '');
  // 移除 minimax 工具结果块
  processed = processed.replace(/<minimax:tool_result>[\s\S]*?<\/minimax:tool_result>/g, '');
  // 移除孤立的 invoke / parameter XML 块
  processed = processed.replace(/<invoke[^>]*>[\s\S]*?<\/invoke>/g, '');
  processed = processed.replace(/<parameter[^>]*>[\s\S]*?<\/parameter>/g, '');
  return processed.trim();
}

/** 从 LLM 输出中提取 JSON（增强容错） */
function extractJson(raw) {
  if (!raw || typeof raw !== "string") {
    console.warn("[extractJson] 输入为空或非字符串");
    return null;
  }

  // 预处理：移除 MiniMax DeepThink 产生的 XML 工具调用标记
  raw = preprocessMinimaxOutput(raw);

  const candidates = [];

  // 1) 尝试提取 ```json ... ``` 代码块
  const fencedPatterns = [
    /```json\s*([\s\S]*?)```/,
    /```\s*([\s\S]*?)```/,
  ];
  for (const pattern of fencedPatterns) {
    const match = raw.match(pattern);
    if (match && match[1]) candidates.push(match[1].trim());
  }

  // 2) 找到最外层 { ... }
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1));

    // 用括号匹配找第一个完整 JSON 对象
    let braceCount = 0;
    for (let i = firstBrace; i < raw.length; i++) {
      if (raw[i] === "{") braceCount++;
      if (raw[i] === "}") braceCount--;
      if (braceCount === 0) {
        candidates.push(raw.slice(firstBrace, i + 1));
        break;
      }
    }
  }

  candidates.push(raw.trim());

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (!candidate) continue;

    try { return JSON.parse(candidate); } catch {}
    try { return JSON.parse(sanitizeJsonString(candidate)); } catch {}
    try { return JSON.parse(attemptJsonFix(candidate)); } catch {}
    try { return JSON.parse(attemptJsonFix(sanitizeJsonString(candidate))); } catch {}
    // 尝试修复截断的 JSON（MiniMax 因 token 耗尽而中途停止输出）
    try { return JSON.parse(repairTruncatedJson(candidate)); } catch {}
    try { return JSON.parse(repairTruncatedJson(sanitizeJsonString(candidate))); } catch {}
    try { return JSON.parse(repairTruncatedJson(attemptJsonFix(candidate))); } catch {}
  }

  console.error("[extractJson] 解析失败。原始输出前 500 字:", raw.slice(0, 500));
  return null;
}

/** 从 LLM 输出中提取 JSON 数组（供声明核查批次使用） */
function extractJsonArray(raw) {
  if (!raw || typeof raw !== "string") return null;

  raw = preprocessMinimaxOutput(raw);

  // 1) 尝试提取 ```json [...] ``` 代码块
  const fencedPatterns = [
    /```json\s*([\s\S]*?)```/,
    /```\s*([\s\S]*?)```/,
  ];
  for (const pattern of fencedPatterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].trim();
      try { return JSON.parse(candidate); } catch {}
      try { return JSON.parse(sanitizeJsonString(candidate)); } catch {}
      try { return JSON.parse(attemptJsonFix(candidate)); } catch {}
    }
  }

  // 2) 找最外层 [...]（精确括号匹配）
  const firstBracket = raw.indexOf("[");
  if (firstBracket !== -1) {
    // 精确匹配找到第一个完整数组
    let bracketCount = 0;
    let endIdx = -1;
    for (let i = firstBracket; i < raw.length; i++) {
      if (raw[i] === '[') bracketCount++;
      else if (raw[i] === ']') bracketCount--;
      if (bracketCount === 0) { endIdx = i; break; }
    }
    const fullCandidate = endIdx !== -1
      ? raw.slice(firstBracket, endIdx + 1)
      : raw.slice(firstBracket);
    try { return JSON.parse(fullCandidate); } catch {}
    try { return JSON.parse(sanitizeJsonString(fullCandidate)); } catch {}
    try { return JSON.parse(attemptJsonFix(fullCandidate)); } catch {}
    // 修复截断
    try { return JSON.parse(repairTruncatedJson(fullCandidate)); } catch {}
    try { return JSON.parse(repairTruncatedJson(sanitizeJsonString(fullCandidate))); } catch {}
  }

  console.error("[extractJsonArray] 解析失败，原始输出前500字:", raw.slice(0, 500));
  return null;
}

// ============================================================
// 系统提示词
// ============================================================

const AGENT_A_PROMPT = `你是一位顶级 VC 分析师（Agent A — 数据提取器）。
你的任务是从商业计划书（BP）文本中全面提取关键数据，供后续 AI 深度研究使用。

**一、结构化评分数据：**

**第一维度：时机与天花板**
- TAM: 目标可触达市场规模（数字，十亿人民币或亿美元）
- CAGR: 行业预期年复合增长率（%，数字）

**第二维度：产品与壁垒**
- TRL: 技术就绪水平（1-9级，9为可量产。1-3=概念/实验室，4-6=原型/小试，7-9=中试/量产）
- SC: 客户转换成本（0-100分，综合考虑数据迁移、学习成本、集成成本）

**第三维度：资本效率与规模效应（定性描述，供 Agent B 分析）**
- Business_Model: 商业模式特征（如"SaaS年付预收款/轻资产"、"硬件+服务/重资产"、"交易平台/双边市场"）
- Growth_Engine: 增长引擎类型（如"PLG产品驱动"、"销售驱动"、"投放驱动"、"口碑自传播"）
- Network_Effect: 网络效应声明（如有，描述是否存在双边/单边网络效应、数据飞轮；无则填"无明确网络效应"）

**第四维度：团队基因**
- Exp: 核心创始人行业相关经验（年）
- Equity: 最大股东持股比例（%）

**第五维度：外部风险与交易条件**
- Policy_Risk: 政策违规风险（0=极高风险，1=无明显风险）
- BP_Valuation: BP声称的估值（亿元或亿美元）
- BP_Revenue: BP声称的收入或ARR（亿元，无收入填0）

**二、关键声明提取（供 AI 深度核查，务必提取 15-25 条）：**
涵盖以下类别：
- market: 市场规模/增速声明（TAM/SAM 数字、CAGR 数据）
- tech: 技术声明（技术突破、专利、参数对比、SOTA 声称）
- product: 产品/用户声明（用户数、留存率、增长率、DAU/MAU）
- competition: 竞争声明（护城河、竞品对比、市场份额）
- team: 团队声明（创始人背景、过往成就、行业资源）
- financial: 财务声明（收入、毛利率、LTV/CAC、盈利时间）
- valuation: 估值声明（融资金额、估值依据、投资方）

同时识别：
- industry: 行业关键词
- company_name: 公司名称
- product_name: 产品/服务名称

【重要】只输出纯 JSON，不要任何其他文字，不要 markdown 代码块：
{
  "company_name": "XX科技",
  "industry": "人工智能",
  "product_name": "XX产品",
  "TAM": 100,
  "TAM_estimated": false,
  "CAGR": 25,
  "CAGR_estimated": true,
  "TRL": 7,
  "SC": 65,
  "Business_Model": "SaaS年付预收款，轻资产模式",
  "Growth_Engine": "产品驱动增长(PLG) + 销售驱动",
  "Network_Effect": "数据飞轮效应：用户越多，模型越准确，竞争壁垒越高",
  "Exp": 8,
  "Equity": 60,
  "Policy_Risk": 1,
  "BP_Valuation": 5,
  "BP_Revenue": 0.5,
  "key_claims": [
    {
      "category": "market",
      "claim": "中国AI市场规模2024年达1000亿元，年增速35%",
      "source_in_bp": "BP第3页"
    },
    {
      "category": "tech",
      "claim": "自研大语言模型参数量达1000亿，性能超GPT-4",
      "source_in_bp": "BP第5页"
    }
  ],
  "extraction_notes": "提取过程中的关键假设和推断"
}

注意：
- TAM/CAGR/TRL/SC/Exp/Equity/Policy_Risk/BP_Valuation/BP_Revenue 必须是数字类型
- Business_Model/Growth_Engine/Network_Effect 是文字描述字段，如BP未明确提及则根据商业模式特征合理推断
- 如某数值字段BP未明确披露，根据行业常识合理推断并标注 estimated: true
- key_claims 必须提取 15-25 条，覆盖所有类别`;

// ============================================================
// Agent B — 两阶段提示词（取代原单体 EXPERT_JUDGE_PROMPT）
//
// 架构说明：
//   Phase 1 (微观): CLAIM_VERDICT_BATCH_PROMPT
//     → 对 key_claims 分批并发核查，输出每条声明的真实核查结论
//   Phase 2 (宏观): EXPERT_JUDGE_STRUCTURAL_PROMPT
//     → 在 Phase 1 全部完成后启动，将已核查的声明结论作为评分依据，
//       进行五维结构化打分与估值分析
//
// 时序依赖：Phase 2 必须等待 Phase 1 的所有批次全部落地，
//   评分才能基于已验证的真实数据，而非 BP 原始（可能夸大的）声称。
// ============================================================

const CLAIM_VERDICT_BATCH_PROMPT = `你是一位精确的事实核查专家（Fact-Checker），专门基于行业真实知识对商业计划书中的声明进行逐条核实。

你将收到一批关键声明（JSON数组格式），全部来自同一份商业计划书。

对每条声明，请：
1. 基于你的专业知识研究该声明的真实情况（引用具体数据：权威报告、可比公司数据、技术基准等）
2. 给出核查结论（从以下选项中选一个）：
   - 【诚实】数据与真实情况基本吻合（±20%以内）
   - 【夸大】BP存在夸大行为（见下方方向性判定规则）
   - 【严重夸大】BP存在严重夸大行为（差距5倍以上，见下方规则）
   - 【信息不对称】BP故意隐瞒重要竞争对手或负面信息
   - 【存疑】无法确认，数据不可验证
   - 【证伪】技术不可行、市场不存在、声明明显错误

   【重要——夸大判定的方向性规则（正反向指标）】
   - 正向指标（越大越好，如：市场规模、收入、用户数、增速、毛利率、专利数量）：
     只有当 BP 声称值 > 真实值时，才判"夸大"或"严重夸大"；
     若 BP 声称值 < 真实值（即低估了市场/潜力），应判"诚实"，不得判"夸大"。
   - 反向指标（越小越好，如：CAC、研发周期、亏损额、成本、烧钱速度）：
     只有当 BP 声称值 < 真实值时（即刻意低报了负面数据），才判"夸大"；
     若 BP 声称值 > 真实值（即高估了成本/困难），应判"诚实"，不得判"夸大"。

3. 量化差异（BP声称X，实际应为Y，差距Z）

【重要】只输出 JSON 数组，不加任何 markdown 代码块或解释文字：
[
  {
    "category": "market",
    "original_claim": "声明原文",
    "bp_claim": "BP具体声称的内容",
    "ai_research": "AI基于知识库的研究：真实情况约为...（引用：某报告/可比公司数据）",
    "verdict": "夸大",
    "diff": "BP声称1000亿，实际约150亿，夸大约6.7倍",
    "severity": "高",
    "score_impact": "显著拉低时机与天花板维度得分"
  }
]`;

const EXPERT_JUDGE_STRUCTURAL_PROMPT = `你是一个融合了资深行业专家（10年+行业经验）和顶级投资分析师（曾管理10亿+美元基金）的 AI 研究员。你对中国各行业市场格局、技术发展趋势、一级市场投资逻辑有深刻理解。

【重要前提】你将收到：
1. 【BP提取数据】— AI从BP中提取的原始结构化数据
2. 【微观声明核查报告】— 已完成的全部声明逐条核查结论（这是你五维评分的唯一真实依据！）
3. 【BP原文节选】— 商业计划书原文

你的评分必须以【微观声明核查报告】中已验证的结论为准，而非BP原始（可能夸大的）数据。

**任务A：五维度深度评分（基于核查后的真实数据）**

*第一维度：时机与天花板（满分100）*
- 参考核查报告中 category=market 的核查结论，使用已验证的真实TAM/CAGR，不采信BP原始数字
- CAGR 是否合理（对比行业历史增速、驱动因素是否成立）
- 入场时机判断（行业周期位置、竞争格局）

*第二维度：产品与壁垒（满分100）*
- 参考核查报告中 category=tech/product/competition 的核查结论
- 基于已核查的技术真实性重新评定TRL级别
- 竞品分析（点名3-5个主要竞品，注明融资/估值情况）

*第三维度：资本效率与规模效应（满分100）*
- 参考 Agent A 提取的 Business_Model、Growth_Engine、Network_Effect，以及 category=financial 的核查结论
- 输出两个子维度的定性打分（1-10 分制），并放入 validated_data：
  子维度1: Capital_Efficiency（资本效率）
  - [10-8分] 极高（负营运资本）：客户预付资金扩张（无息杠杆），CAC 回收期 <12个月，不依赖融资内生增长
  - [7-5分] 中等（合理投入）：LTV/CAC 在 3-5x，有库存或供应链投入但周转快，单客模型健康
  - [4-1分] 极低（资本绞肉机）：增长依赖同比例垫资/堆人，资金沉淀在固定资产/应收账款，停止输血即休克
  子维度2: Scale_Effect（规模效应）
  - [10-8分] 赢家通吃：双边网络效应（需求侧）或绝对规模经济（供给侧，如晶圆厂极高固定成本摊薄）
  - [7-5分] 强者恒强：单边网络效应、数据飞轮、品牌壁垒或供应链议价权
  - [4-1分] 规模不经济：收入与人力/履约成本呈线性关系，规模越大管理越难（如咨询、非标定制）
  【重要】若BP未披露足够数据，Capital_Efficiency 和 Scale_Effect 各默认打5分（行业中立基准），并在 finding 中注明"由于数据缺失，采用行业中立基准分"，禁止打0分或极低分

*第四维度：团队基因（满分100）*
- 参考核查报告中 category=team 的核查结论
- 核实后的创始人背景与赛道匹配度、股权结构合理性

*第五维度：外部风险与交易条件（乘数0-1）*
- 参考核查报告中 category=valuation 的核查结论
- 政策合规风险（列举相关法规）
- 基于核查后的真实收入数据重新计算估值溢价倍数

**任务B：估值深度分析（Comps Analysis）**
- 列举3-5个可比公司（上市公司或近期融资案例，注明具体估值倍数）
- 计算行业平均估值倍数（PS/PE/GMV倍数等）
- 计算 Valuation_Gap = BP估值倍数 / 行业平均倍数（分母使用核查后真实收入）
- 判断估值是否合理，给出合理估值区间

【缺失数据处理原则（Req 5 关键）】
- 若 BP 未披露某维度的关键数据，且 AI 知识库中亦无足够的行业对比数据，禁止给出0分或极低分
- 应给出行业中性分（50-60分），并在 finding 中注明"由于数据缺失，采用行业中立基准分"
- 此原则适用于所有维度，防止因信息不全导致总分雪崩，避免误杀早期项目
- Capital_Efficiency 和 Scale_Effect 数据缺失时各默认5分，不得低于4分

【重要输出要求】只输出纯 JSON，不要任何 markdown 代码块或其他文字：
{
  "one_line_summary": "AI SaaS赛道（自然语言处理），A轮早期阶段，技术路线清晰但市场数据夸大严重",
  "validated_data": {
    "TAM": 80,
    "CAGR": 20,
    "TRL": 6,
    "SC": 55,
    "Capital_Efficiency": 6,
    "Scale_Effect": 7,
    "Exp": 8,
    "Equity": 55,
    "Policy_Risk": 1,
    "Valuation_Gap": 1.8
  },
  "dimension_analysis": {
    "timing_ceiling": {
      "score": 70,
      "label": "时机与天花板",
      "subtitle": "市场规模 + 入场时机",
      "finding": "深度分析：基于核查报告，真实TAM约XX亿元（BP声称XX亿，核查结论：夸大X倍）。行业CAGR实际为XX%，主要驱动因素为：①... ②... ③...。入场时机评估：该行业目前处于[早期/高速增长/成熟]阶段，入场时机[合适/偏晚/偏早]。",
      "bp_claim": "BP声称市场规模XX亿，年增速XX%",
      "ai_finding": "核查结论：真实市场规模约XX亿（参考：IDC报告/艾瑞咨询），增速约XX%，主要差异原因：BP使用了TAM口径而非SAM/SOM..."
    },
    "product_moat": {
      "score": 65,
      "label": "产品与壁垒",
      "subtitle": "技术可行性 + 竞争壁垒",
      "finding": "技术成熟度：基于核查结论，TRL评级为X级，原因：...。竞争壁垒评估：主要护城河为[技术/数据/网络效应]，深度[强/中/弱]。主要竞品：①XX公司（融资XX亿，估值XX亿）；②XX公司（上市，市值XX亿）。",
      "bp_claim": "BP声称技术领先同行2-3年，已获得XX项专利",
      "ai_finding": "核查结论：该技术路线已有XX家公司布局，BP的技术声称[基本属实/有所夸大/明显夸大]..."
    },
    "business_validation": {
      "score": 65,
      "label": "资本效率与规模效应",
      "subtitle": "资本效率 + 规模效应",
      "Capital_Efficiency": 6,
      "Scale_Effect": 7,
      "finding": "资本效率：基于Business_Model和核查结论，该商业模式属于[极高/中等/极低]资本效率。原因：[具体分析，如预付款模式/垫资模式/库存占用...]。规模效应：[赢家通吃/强者恒强/规模不经济]，核心依据：[网络效应/数据飞轮/线性成本结构...]。若数据缺失：本维度因BP未披露详细数据，采用行业中立基准分5分。",
      "bp_claim": "BP声称的商业模式：Business_Model=XX，增长引擎=XX，网络效应=XX",
      "ai_finding": "核查结论：该商业模式的资本效率属于[高/中/低]水平，对比可比公司[XX/XX]的资本效率表现：...规模效应评估：..."
    },
    "team": {
      "score": 55,
      "label": "团队基因",
      "subtitle": "团队匹配度 + 股权结构",
      "finding": "团队匹配度：基于核查结论，创始人XX年行业经验，[高度匹配/基本匹配/存在短板]。股权结构：最大股东持股XX%，[合理/存在风险——原因：...]。",
      "bp_claim": "BP声称创始人有XX年行业经验，曾任职于XX",
      "ai_finding": "核查结论：该背景[可信/存疑/需核实]，类似背景在行业中属于[顶尖/中等/普通]水平..."
    },
    "external_risk": {
      "score": 50,
      "label": "外部风险与交易条件",
      "subtitle": "政策风险 + 估值合理性",
      "finding": "政策风险：涉及[XX监管领域]，相关法规[XX政策/XX条例]，风险等级[低/中/高]。估值合理性：基于核查后真实收入数据，BP估值XX亿，核查后收入XX亿，隐含PS=XXx；行业平均PS=XX，溢价倍数=XX。",
      "bp_claim": "BP声称估值XX亿，融资XX亿",
      "ai_finding": "核查结论：可比公司估值水平：①XX（上市，PS=XX）；②XX（A轮，估值XX亿，隐含PS=XX）。行业平均PS=XX，BP溢价=XX倍。",
      "multiplier": 0.5
    }
  },
  "risk_flags": [
    "市场规模夸大6.7倍，存在数据虚构嫌疑",
    "技术声称超越GPT-4，与行业公认基准严重不符",
    "LTV/CAC数据明显偏高，单位经济模型难以复现",
    "估值溢价3倍以上，要求投资者承担过高溢价"
  ],
  "strengths": [
    "团队背景扎实，创始人具有10年+行业经验",
    "产品已实现商业化，有真实收入验证",
    "赛道处于政策红利期，监管友好"
  ],
  "conflicts": [
    {
      "severity": "严重",
      "field": "TAM",
      "claim": "BP声称市场规模1000亿元",
      "evidence": "核查结论：该细分市场实际规模约150亿元，夸大约6.7倍"
    },
    {
      "severity": "中等",
      "field": "Margin",
      "claim": "BP声称毛利率85%",
      "evidence": "核查结论：同类型SaaS公司实际毛利率约65-75%，BP数据明显偏高"
    }
  ],
  "valuation_comparison": {
    "bp_multiple": 20,
    "industry_avg_multiple": 10,
    "overvalued_pct": 100,
    "industry_name": "AI SaaS",
    "comparable_companies": [
      "商汤科技（港股）：PS约 8x（2024年）",
      "声网Agora（美股）：PS约 5x",
      "同类A轮案例：融资1亿，ARR 1000万，隐含PS 10x",
      "同类B轮案例：融资3亿，ARR 5000万，隐含PS 6x"
    ],
    "data_source": "MiniMax AI 知识库综合分析（截至训练数据时间）",
    "analysis": "BP要求估值20x PS，而行业可比公司中位数为10x PS，溢价约100%。考虑到BP项目处于早期阶段、收入尚未经过审计验证，建议将估值压缩至10-12x PS区间。"
  },
  "validation_notes": {
    "TAM": "BP声称1000亿，核查结论显示约150亿，主要原因：BP混用TAM/SAM口径",
    "CAGR": "BP声称35%，核查校准为20%，因成熟市场增速放缓",
    "TRL": "根据核查结论，已有中试产线，判定TRL=6",
    "Capital_Efficiency": "商业模式为SaaS年付预收款，负营运资本特征明显，判定Capital_Efficiency=8",
    "Scale_Effect": "存在数据飞轮效应，但仍为单边网络效应，判定Scale_Effect=7",
    "Valuation_Gap": "BP估值20x PS，行业平均10x，溢价倍数=2.0"
  }
}

分析要求：
- 每个维度分析至少200字，要有具体数据支撑
- validated_data 必须基于核查报告的已验证数据，不得直接采信BP原始夸大数字
- comparable_companies 要点名具体公司和估值数据
- 所有数值字段必须是数字类型，validated_data 中所有字段不能为 null
- one_line_summary 格式：项目定位（赛道/技术）+ 当前所处阶段 + 核心亮点或致命缺陷，严禁使用固定模板文案
- Capital_Efficiency 和 Scale_Effect 必须是1-10之间的整数，数据缺失时默认5，不得输出0或null`;

/**
 * EXPERT_JUDGE_MINIMAL_PROMPT — 精简评分提示词（终极兜底）
 *
 * 设计原则：
 *   1. 所有文本字段限制在50字以内，将输出 token 控制在 ~2000 以内
 *   2. JSON 结构与完整版完全兼容，可直接被下游代码消费
 *   3. 仅在完整版和第一次普通模式重试均失败时使用
 */
const EXPERT_JUDGE_MINIMAL_PROMPT = `你是一位顶级投资分析师。基于提供的BP提取数据和声明核查报告进行五维评分。

【核心要求】
- 所有文本字段严格不超过50字，确保JSON完整输出不被截断
- 数值字段必须是数字类型，不得为null
- Capital_Efficiency和Scale_Effect必须是1-10的整数，无数据默认5

只输出以下结构的JSON，不加任何markdown或解释：
{
  "one_line_summary": "赛道+阶段+核心判断（30字内）",
  "validated_data": {
    "TAM": 0, "CAGR": 0, "TRL": 0, "SC": 0,
    "Capital_Efficiency": 5, "Scale_Effect": 5,
    "Exp": 0, "Equity": 0, "Policy_Risk": 1,
    "Valuation_Gap": 1.0
  },
  "dimension_analysis": {
    "timing_ceiling": {
      "score": 60, "label": "时机与天花板", "subtitle": "市场规模+入场时机",
      "finding": "核查结论摘要（50字内）", "bp_claim": "BP声称（30字内）", "ai_finding": "核查结论（30字内）"
    },
    "product_moat": {
      "score": 60, "label": "产品与壁垒", "subtitle": "技术可行性+竞争壁垒",
      "finding": "核查结论摘要（50字内）", "bp_claim": "BP声称（30字内）", "ai_finding": "核查结论（30字内）"
    },
    "business_validation": {
      "score": 60, "label": "资本效率与规模效应", "subtitle": "资本效率+规模效应",
      "Capital_Efficiency": 5, "Scale_Effect": 5,
      "finding": "核查结论摘要（50字内）", "bp_claim": "BP声称（30字内）", "ai_finding": "核查结论（30字内）"
    },
    "team": {
      "score": 60, "label": "团队基因", "subtitle": "团队匹配度+股权结构",
      "finding": "核查结论摘要（50字内）", "bp_claim": "BP声称（30字内）", "ai_finding": "核查结论（30字内）"
    },
    "external_risk": {
      "score": 50, "label": "外部风险与交易条件", "subtitle": "政策风险+估值合理性",
      "finding": "核查结论摘要（50字内）", "bp_claim": "BP声称（30字内）", "ai_finding": "核查结论（30字内）",
      "multiplier": 0.5
    }
  },
  "risk_flags": ["风险1", "风险2", "风险3"],
  "strengths": ["优势1", "优势2"],
  "conflicts": [
    {"severity": "高", "field": "字段名", "claim": "BP声称", "evidence": "核查结论"}
  ],
  "valuation_comparison": {
    "bp_multiple": 0, "industry_avg_multiple": 0, "overvalued_pct": 0,
    "industry_name": "行业名称",
    "comparable_companies": ["可比公司1", "可比公司2"],
    "data_source": "MiniMax知识库",
    "analysis": "估值分析（50字内）"
  },
  "validation_notes": {
    "TAM": "说明", "CAGR": "说明", "TRL": "说明",
    "Capital_Efficiency": "说明", "Scale_Effect": "说明", "Valuation_Gap": "说明"
  }
}`;

const DEEP_RESEARCH_PROMPT = `你是一位资深投资分析师，正在为投资委员会撰写深度研究报告。

你将收到：
1. 商业计划书（BP）原文节选
2. AI 专家团队的深度分析结果（包含声明核查、五维评分、估值分析）

请基于所有材料，撰写一份完整的深度研究报告。这不是简单复述，而是你作为顶级分析师的独立判断和深度洞察。

**报告结构（每节内容充实，总字数不低于3000字）：**

## 一、项目概况与核心判断

## 二、行业与市场深度分析
- 真实市场规模与增速（引用具体数据来源）
- 行业发展阶段与周期判断
- 主要增长驱动因素与抑制因素
- 与BP声称市场数据的对比与验证

## 三、技术与产品可行性深度评估
- 核心技术路线的行业地位（与同类方案横向对比）
- 技术成熟度（TRL）客观评级及依据
- 产品差异化分析——护城河深度评估
- BP技术声称的真实性核查

## 四、竞争格局深度分析
- 主要竞争对手全景（点名3-5家，注明融资/市值）
- 市场格局判断（分散/寡头/垄断）
- BP竞争优势声称的客观评估
- 潜在颠覆性风险

## 五、商业模式与单位经济验证
- LTV/CAC 行业对比（引用可比公司真实数据）
- 毛利率真实性验证（对比上市公司财报数据）
- 盈利路径清晰度分析
- 现金流健康度判断

## 六、估值合理性深度分析（Comparable Company Analysis）
- 可比公司分析表（3-5家，包含估值倍数）
- BP估值隐含的增长预期合理性
- 合理估值区间推算方法论
- 投资机构谈判建议

## 七、团队与执行力评估
- 创始团队背景与赛道契合度分析
- 关键人才风险识别
- 治理结构与股权分布评估

## 八、风险矩阵（按严重程度 × 发生概率排列）
- 核心风险清单（至少5条，含应对建议）
- 数据真实性红旗信号
- 政策合规风险分析

## 九、BP声明 vs AI研究结论对比表

| 声明类别 | BP声称内容 | AI研究发现 | 核查结论 | 影响程度 |
|---------|-----------|-----------|---------|---------|
| 市场规模 | ... | ... | 夸大X倍 | 高 |

## 十、投资建议与尽调方向
- 综合投资建议（推荐/观望/回避）及核心理由
- 如决定投资：关键条款谈判要点
- 必须核查的尽调清单（至少8项）
- 关键里程碑与退出路径

**格式要求：**
- 使用 Markdown，层次分明
- 数据要具体（引用真实公司名、市场报告数据）
- 语气专业直白，如实指出问题，不粉饰
- 中文输出
- 总字数不低于3000字，尽量详细`;

// ============================================================
// Agent B 核心调度（重构版）
//
// 时序设计：
//   Phase 1 — 微观声明核查（CLAIM_VERDICT_BATCH_PROMPT）
//     将 key_claims 按 BATCH_SIZE 分组，各批次之间并发执行，
//     但整体上须等全部批次完成后才能进入 Phase 2。
//
//   Phase 2 — 宏观五维结构化打分（EXPERT_JUDGE_STRUCTURAL_PROMPT）
//     在 Phase 1 全部落地后启动。
//     将完整的核查结论（allClaimVerdicts）作为上下文注入打分提示词，
//     确保五维评分基于已验证的真实数据，而非 BP 原始（可能夸大的）声称。
// ============================================================

const CLAIM_BATCH_SIZE = 3; // 每批核查声明数，控制单次 token 量

/**
 * Agent B 核心调度函数
 * @param {Object}   extractedData  Agent A 输出的结构化数据（含 key_claims）
 * @param {string}   bpText         BP 原文（用于给打分阶段提供原文上下文）
 * @param {Function} sendSSE        SSE 推送函数
 * @returns {{ claimVerdicts, structuralResult, thinking }}
 */
async function runAgentBWithBatching(extractedData, bpText, onProgress) {
  const claims = extractedData.key_claims || [];

  // ── Phase 1: 微观声明核查（各批次并发，整体串行于 Phase 2 之前）──
  const batches = [];
  for (let i = 0; i < claims.length; i += CLAIM_BATCH_SIZE) {
    batches.push(claims.slice(i, i + CLAIM_BATCH_SIZE));
  }

  const batchCount = batches.length;
  console.log(`[B.1] 声明核查: ${claims.length} 条 → ${batchCount} 批并发`);
  onProgress({
    type: "progress",
    stage: "claim_verify",
    percentage: 35,
    message: `核查 ${claims.length} 条关键声明（${batchCount} 批并发）...`,
  });

  const bpContext = `行业：${extractedData.industry || "未知"}，公司：${extractedData.company_name || "未知"}，产品：${extractedData.product_name || "未知"}`;

  // 各批次之间可并发（声明间无依赖），整体结果须全部就绪后才进入 Phase 2
  const batchResults = await Promise.all(
    batches.map((batch, batchIdx) =>
      callLLM(
        CLAIM_VERDICT_BATCH_PROMPT,
        `${bpContext}\n\n待核查声明批次 ${batchIdx + 1}/${batchCount}：\n${JSON.stringify(batch, null, 2)}`,
        8192
      ).then((raw) => {
        const parsed = extractJsonArray(raw);
        if (!parsed) {
          // 降级：解析失败时将原始声明包装为"存疑"结论，保证 Phase 2 仍有数据
          console.warn(`[B.1] 批次 ${batchIdx + 1} JSON 解析失败，降级为存疑`);
          return batch.map((c) => ({
            category: c.category,
            original_claim: c.claim,
            bp_claim: c.claim,
            ai_research: "核查批次解析失败，无法提供核查结论",
            verdict: "存疑",
            diff: "核查失败，数据不可信",
            severity: "中",
            score_impact: "无法评估",
          }));
        }
        return parsed;
      })
    )
  );

  // 此时 Phase 1 全部批次已完成，汇总所有核查结论
  const allClaimVerdicts = batchResults.flat();
  console.log(`[B.1] 声明核查完成: 共 ${allClaimVerdicts.length} 条核查结论`);
  onProgress({
    type: "progress",
    stage: "claims_verified",
    percentage: 62,
    message: `声明核查完成（${allClaimVerdicts.length} 条），现基于核查结果进行五维评分...`,
  });

  // ── Phase 2: 宏观五维结构化打分（严格在 Phase 1 完成后启动）──
  //
  // 输入压缩策略（解决 token 截断的根本原因）：
  //   1. 去除 ai_research 冗长字段，按严重度排序，保留 top-15 核查结论
  //   2. BP 原文由 12000 → 3000 字（Agent A 已提取结构化数据，此处无需全文）
  //   3. thinking 预算由 8000 → 3000（输出空间由 ~8000 → ~17000 tokens）
  //
  // 三层重试阶梯（确保极端场景下仍能返回合法数据）：
  //   层1: DeepThink，压缩输入，max_tokens=20000
  //   层2: 普通模式，同等压缩输入，max_tokens=20000
  //   层3: 精简提示词（EXPERT_JUDGE_MINIMAL_PROMPT），最小化输入，max_tokens=8192
  console.log("[B.2] 五维评分: 基于核查结论启动结构化评分（DeepThink模式）...");

  // 压缩核查结论：去除冗长 ai_research，按严重程度排序，最多保留 15 条
  const compressedVerdicts = compressVerdicts(allClaimVerdicts);

  const structuralInput = [
    `【BP提取数据（原始）】\n${JSON.stringify(extractedData, null, 2)}`,
    `\n\n【微观声明核查报告（已验证，请以此作为评分依据，不得直接采信BP原始数字）】\n${JSON.stringify(compressedVerdicts, null, 2)}`,
    `\n\n【BP原文节选（前3000字）】\n${bpText.slice(0, 3000)}`,
  ].join("");

  // 层1: DeepThink 模式，降低 thinking 预算以留出更多输出空间
  const judgeResult = await callLLMWithThinking(
    EXPERT_JUDGE_STRUCTURAL_PROMPT,
    structuralInput,
    20000, // 从 16000 → 20000（输出空间更大）
    3000   // 从 8000 → 3000（节省 5000 token 给输出）
  );

  let structuralResult = extractJson(judgeResult.text);

  // 层2: 普通模式重试（移除 thinking，省去 3000 token 开销，全部给输出）
  if (!structuralResult || !structuralResult.validated_data) {
    console.warn("[B.2] 首次 JSON 解析失败，重试层2（普通模式，相同压缩输入）...");
    onProgress({
      type: "progress",
      stage: "scoring_retry",
      percentage: 74,
      message: "评分结果解析失败，重试中（普通模式）...",
    });
    const retry1Raw = await callLLM(
      EXPERT_JUDGE_STRUCTURAL_PROMPT +
        "\n\n【紧急提醒】只输出 JSON 对象，从 { 开始到 } 结束，不加任何 markdown 代码块或解释文字。",
      structuralInput,
      20000
    );
    structuralResult = extractJson(retry1Raw);
  }

  // 层3: 精简提示词 + 最小输入（兜底方案，输出 token < 2000，极难截断）
  if (!structuralResult || !structuralResult.validated_data) {
    console.warn("[B.2] 重试层2仍失败，启用兜底层3（精简模式）...");
    onProgress({
      type: "progress",
      stage: "scoring_retry2",
      percentage: 78,
      message: "评分结果解析失败，启用精简模式重试（兜底层3）...",
    });
    // 精简输入：去掉 BP 原文，核查结论只保留 top-10
    const minimalInput = [
      `【BP提取数据】\n${JSON.stringify(extractedData, null, 2)}`,
      `\n\n【声明核查报告（top-10，已按严重程度排序）】\n${JSON.stringify(compressedVerdicts.slice(0, 10), null, 2)}`,
    ].join("");
    const retry2Raw = await callLLM(EXPERT_JUDGE_MINIMAL_PROMPT, minimalInput, 8192);
    structuralResult = extractJson(retry2Raw);
  }

  return {
    claimVerdicts: allClaimVerdicts,
    structuralResult,
    thinking: judgeResult.thinking || "",
  };
}

// ============================================================
// API 路由
// ============================================================

// ============================================================
// 后台流水线函数 — 不持有 HTTP 连接，进度写入 tasks Map
// ============================================================

/**
 * 完整分析流水线（异步后台执行）
 * @param {string} taskId  任务 ID
 * @param {string} bpText  已提取的 BP 原文
 */
async function runPipelineBackground(taskId, bpText) {
  const startTime = Date.now();

  const onProgress = ({ type, stage, percentage, message }) => {
    if (type === "progress") updateTask(taskId, { stage, percentage, message });
  };

  const maxChars = 30000;
  const truncatedText =
    bpText.length > maxChars
      ? bpText.slice(0, maxChars) + "\n...(文本已截断，共" + bpText.length + "字符)"
      : bpText;

  onProgress({ type: "progress", stage: "pdf_done", percentage: 8, message: "文档解析完成，准备开始数据分析..." });

  // ── 第1步: 数据提取 ──
  console.log(`[${taskId.slice(0, 8)}] [1/2] 数据提取...`);
  onProgress({ type: "progress", stage: "data_extract", percentage: 12, message: "正在提取BP关键声明与评分数据（step 1/2）..." });

  let extractionRaw = await callLLM(
    AGENT_A_PROMPT,
    `以下是商业计划书全文（共提取 ${truncatedText.length} 字符）：\n\n${truncatedText}`,
    8192
  );
  let extractedData = extractJson(extractionRaw);

  if (!extractedData || !extractedData.key_claims) {
    console.warn(`[${taskId.slice(0, 8)}] [1/2] 首次数据提取失败，重试...`);
    onProgress({ type: "progress", stage: "data_extract_retry", percentage: 18, message: "数据提取重试中，请稍候..." });
    const retryPrompt =
      AGENT_A_PROMPT +
      "\n\n【紧急提醒】上次输出不是合法 JSON 导致解析失败。这次只输出 JSON 对象，从 { 开始到 } 结束，不加任何解释或 markdown。";
    extractionRaw = await callLLM(retryPrompt, `以下是商业计划书全文：\n\n${truncatedText}`, 8192);
    extractedData = extractJson(extractionRaw);
  }

  if (!extractedData) throw new Error("AI 数据提取失败，请重新分析");

  if (!extractedData.key_claims && extractedData.search_queries) {
    extractedData.key_claims = extractedData.search_queries.map((q) => ({
      category: q.dimension || "other",
      claim: q.query || "",
      source_in_bp: "BP中",
    }));
  }

  const claimCount = (extractedData.key_claims || []).length;
  console.log(`[${taskId.slice(0, 8)}]   → 提取到 ${claimCount} 条关键声明，行业: ${extractedData.industry || "未识别"}`);

  onProgress({
    type: "progress",
    stage: "data_done",
    percentage: 28,
    message: `数据提取完成，共识别 ${claimCount} 条关键声明，启动AI深度研究...`,
  });

  // ── 第2步: Agent B ──
  console.log(`[${taskId.slice(0, 8)}] [2/2] Agent B 启动...`);
  onProgress({ type: "progress", stage: "agent_b_start", percentage: 32, message: "Agent B 启动（声明核查先行，评分随后）..." });

  extractionRaw = null;

  const { claimVerdicts, structuralResult, thinking } = await runAgentBWithBatching(
    extractedData,
    truncatedText,
    onProgress
  );

  if (!structuralResult || !structuralResult.validated_data) {
    throw new Error("AI 专家评分失败，请重试");
  }

  const validatedData = { ...structuralResult, claim_verdicts: claimVerdicts };
  onProgress({ type: "progress", stage: "ai_done", percentage: 82, message: "AI深度研究完成，正在计算五维评分..." });

  // ── 评分计算 ──
  const scoringInput = validatedData.validated_data;
  const scoringResult = scoreProject(scoringInput);
  console.log(`[${taskId.slice(0, 8)}]   → 评分完成: 总分 ${scoringResult.total_score}, 评级 ${scoringResult.grade}`);

  onProgress({
    type: "progress",
    stage: "scoring",
    percentage: 86,
    message: `评分完成（${scoringResult.total_score}分 / ${scoringResult.grade}），生成深度研究报告...`,
  });

  // ── 构建维度数据 ──
  const dimensionAnalysis = validatedData.dimension_analysis || {};
  const buildDimensionFinding = (key, dimResult) => {
    const expertDim = dimensionAnalysis[key] || {};
    return expertDim.finding || dimResult.label + " 评估完成";
  };

  const verdict = {
    total_score: scoringResult.total_score,
    grade: scoringResult.grade,
    verdict_summary: structuralResult?.one_line_summary || scoringResult.grade_label,
    dimensions: {
      timing_ceiling: {
        score: scoringResult.dimensions.timing_ceiling.score,
        label: scoringResult.dimensions.timing_ceiling.label,
        subtitle: scoringResult.dimensions.timing_ceiling.subtitle,
        finding: buildDimensionFinding("timing_ceiling", scoringResult.dimensions.timing_ceiling),
        bp_claim: dimensionAnalysis.timing_ceiling?.bp_claim || "",
        ai_finding: dimensionAnalysis.timing_ceiling?.ai_finding || "",
      },
      product_moat: {
        score: scoringResult.dimensions.product_moat.score,
        label: scoringResult.dimensions.product_moat.label,
        subtitle: scoringResult.dimensions.product_moat.subtitle,
        finding: buildDimensionFinding("product_moat", scoringResult.dimensions.product_moat),
        bp_claim: dimensionAnalysis.product_moat?.bp_claim || "",
        ai_finding: dimensionAnalysis.product_moat?.ai_finding || "",
      },
      business_validation: {
        score: scoringResult.dimensions.business_validation.score,
        label: scoringResult.dimensions.business_validation.label,
        subtitle: scoringResult.dimensions.business_validation.subtitle,
        finding: buildDimensionFinding("business_validation", scoringResult.dimensions.business_validation),
        bp_claim: dimensionAnalysis.business_validation?.bp_claim || "",
        ai_finding: dimensionAnalysis.business_validation?.ai_finding || "",
      },
      team: {
        score: scoringResult.dimensions.team.score,
        label: scoringResult.dimensions.team.label,
        subtitle: scoringResult.dimensions.team.subtitle,
        finding: buildDimensionFinding("team", scoringResult.dimensions.team),
        bp_claim: dimensionAnalysis.team?.bp_claim || "",
        ai_finding: dimensionAnalysis.team?.ai_finding || "",
      },
      external_risk: {
        score: scoringResult.dimensions.external_risk.score,
        label: scoringResult.dimensions.external_risk.label,
        subtitle: scoringResult.dimensions.external_risk.subtitle,
        finding: buildDimensionFinding("external_risk", scoringResult.dimensions.external_risk),
        bp_claim: dimensionAnalysis.external_risk?.bp_claim || "",
        ai_finding: dimensionAnalysis.external_risk?.ai_finding || "",
        multiplier: scoringResult.dimensions.external_risk.multiplier,
      },
    },
    risk_flags: validatedData.risk_flags || [],
    strengths: validatedData.strengths || [],
    conflicts: validatedData.conflicts || [],
    claim_verdicts: validatedData.claim_verdicts || [],
    valuation_comparison: validatedData.valuation_comparison || {
      bp_multiple:
        scoringInput.BP_Valuation && scoringInput.BP_Revenue
          ? Math.round(scoringInput.BP_Valuation / scoringInput.BP_Revenue)
          : 0,
      industry_avg_multiple: 0,
      overvalued_pct: scoringInput.Valuation_Gap
        ? Math.round((scoringInput.Valuation_Gap - 1) * 100)
        : 0,
      industry_name: extractedData.industry || "",
      data_source: "MiniMax AI 知识库分析",
      analysis: scoringResult.grade_action,
    },
  };

  // ── 生成深度研究报告 ──
  console.log(`[${taskId.slice(0, 8)}]   → 生成深度研究报告...`);
  onProgress({ type: "progress", stage: "report", percentage: 90, message: "正在生成深度研究报告（约1-2分钟）..." });

  const deepResearchInput = [
    `【商业计划书原文节选（前12000字）】\n${truncatedText.slice(0, 12000)}`,
    `\n\n【AI专家深度分析结果】\n${JSON.stringify(
      {
        scoring: {
          total_score: scoringResult.total_score,
          grade: scoringResult.grade,
          grade_label: scoringResult.grade_label,
          dimensions: scoringResult.dimensions,
        },
        claim_verdicts: validatedData.claim_verdicts?.slice(0, 15),
        dimension_analysis: validatedData.dimension_analysis,
        risk_flags: validatedData.risk_flags,
        strengths: validatedData.strengths,
        conflicts: validatedData.conflicts,
        valuation_comparison: validatedData.valuation_comparison,
        validation_notes: validatedData.validation_notes,
      },
      null,
      2
    )}`,
  ].join("");

  const deepResearch = await callLLM(DEEP_RESEARCH_PROMPT, deepResearchInput, 8192);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[${taskId.slice(0, 8)}] ✓ 完成！总耗时 ${elapsed}s`);

  onProgress({ type: "progress", stage: "finalizing", percentage: 98, message: "报告生成完成，正在整理结果..." });

  // ── 写入最终结果（前端下次轮询即可获取）──
  updateTask(taskId, {
    status: "complete",
    percentage: 100,
    stage: "complete",
    message: "分析完成！",
    result: {
      success: true,
      elapsed_seconds: parseFloat(elapsed),
      extracted_data: extractedData,
      validated_data: scoringInput,
      industry: extractedData.industry,
      thinking,
      deep_research: deepResearch,
      verdict,
      search_summary: {
        enabled: true,
        mock: false,
        total_results: 0,
        queries_count: claimCount,
        industry_pe_available: false,
        provider: "minimax_builtin_knowledge",
      },
    },
  });
}

// ============================================================
// API 路由
// ============================================================

/** 健康检查 */
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", model: MODEL, search: "minimax_builtin" });
});

/** 搜索状态（保持兼容） */
app.get("/api/search-status", (_req, res) => {
  res.json({ enabled: true, provider: "minimax_builtin" });
});

/**
 * 核心分析端点 — 接收上传，立即返回 taskId，后台异步执行流水线。
 *
 * 重构说明：
 *   原实现使用长连接 SSE（约 7 分钟），被网关/负载均衡器强制断开。
 *   新实现将流水线完全移入后台，HTTP 请求在 <1 秒内返回 taskId，
 *   前端通过 GET /api/task/:taskId 每 2.5 秒轮询一次，
 *   每次轮询均为短生命周期请求，不受任何网关超时限制。
 */
app.post("/api/analyze", upload.single("file"), (req, res) => {
  // 同步输入验证（快速失败）
  if (!req.file && !(req.body && req.body.text)) {
    return res.status(400).json({ error: "请上传 PDF 文件或提供文本" });
  }
  if (req.file) {
    const mime = req.file.mimetype || "";
    const name = (req.file.originalname || "").toLowerCase();
    const isPdf = mime === "application/pdf" || name.endsWith(".pdf");
    const isPptx =
      mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      name.endsWith(".pptx");
    if (!isPdf && !isPptx) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "请上传 PDF 或 PPTX 格式的文件" });
    }
  }

  // 创建任务，立即返回 taskId
  const task = createTask();
  res.json({ taskId: task.id });

  // 后台异步执行完整流水线
  const filePath = req.file ? req.file.path : null;
  const fileMode = req.file
    ? ((req.file.originalname || "").toLowerCase().endsWith(".pptx") ? "pptx" : "pdf")
    : null;
  const directText = req.body?.text || null;

  (async () => {
    let bpText = "";
    try {
      if (filePath) {
        try {
          bpText = await extractDocText(filePath, fileMode);
        } catch (pyErr) {
          const errMsg = pyErr.message || "未知错误";
          let userMessage = errMsg;
          try {
            const p = JSON.parse(errMsg);
            if (p.error) userMessage = p.error;
          } catch {}
          throw new Error("文档解析失败: " + userMessage);
        } finally {
          try { fs.unlinkSync(filePath); } catch {}
        }
      } else {
        bpText = directText;
      }

      if (!bpText || bpText.length < 50) {
        throw new Error(
          "提取的文本过短（仅 " + (bpText?.length || 0) + " 字符），请检查 PDF 是否为有效的商业计划书"
        );
      }

      await runPipelineBackground(task.id, bpText);
    } catch (err) {
      console.error(`[任务 ${task.id.slice(0, 8)}] 错误:`, err.message);
      updateTask(task.id, { status: "error", error: err.message || "服务器内部错误" });
    }
  })();
});

/**
 * 任务状态轮询端点
 * 前端每 2.5 秒请求一次，获取进度和最终结果。
 * 每次请求毫秒级完成，完全不受网关超时影响。
 */
app.get("/api/task/:taskId", (req, res) => {
  const task = tasks.get(req.params.taskId);
  if (!task) {
    return res.status(404).json({ error: "任务不存在或已过期（超过1小时自动清理）" });
  }
  res.json(task);
});

// ── 静态文件服务（生产模式） ──
const clientBuildDir = path.join(__dirname, "..", "client", "build");
if (fs.existsSync(clientBuildDir)) {
  app.use(express.static(clientBuildDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientBuildDir, "index.html"));
  });
} else {
  app.get("*", (_req, res) => {
    res.status(503).send(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>前端未构建</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0}.box{text-align:center;padding:2rem;border:1px solid #334155;border-radius:1rem;max-width:480px}h1{color:#f87171;margin-bottom:1rem}code{background:#1e293b;padding:.2em .5em;border-radius:.3em;font-size:.95em}</style></head><body><div class="box"><h1>前端尚未构建</h1><p>请在项目根目录执行：</p><pre><code>npm run build</code></pre><p>然后重启服务器。</p></div></body></html>`);
  });
}

// ── 启动 ──
const server = app.listen(PORT, () => {
  console.log(`\n🚀 GarbageBPFilter 后端已启动: http://localhost:${PORT}`);
  console.log(`   模型: ${MODEL}`);
  console.log(`   分析引擎: MiniMax 内置知识库 + DeepThink 深度研究`);
  console.log(`   通信模式: 异步任务轮询（POST /api/analyze → GET /api/task/:taskId）\n`);
});

// 所有 HTTP 请求均为短生命周期（上传 + 轮询），2 分钟超时足够
const HTTP_TIMEOUT = 2 * 60 * 1000;
server.timeout = HTTP_TIMEOUT;
server.requestTimeout = HTTP_TIMEOUT;
server.keepAliveTimeout = HTTP_TIMEOUT + 1000;
