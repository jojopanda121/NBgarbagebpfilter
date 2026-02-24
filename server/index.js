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

// ============================================================
// 工具函数
// ============================================================

/** 调用 Python 脚本提取 PDF 文本 */
function extractPdfText(pdfPath) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "..", "scripts", "extract_pdf.py");
    const proc = spawn("python3", [scriptPath, pdfPath], {
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
  }

  console.error("[extractJson] 解析失败。原始输出前 500 字:", raw.slice(0, 500));
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

**第三维度：商业验证与效率**
- LTV: 客户生命周期价值（人民币或美元）
- CAC: 客户获取成本（人民币或美元）
- Ratio: LTV/CAC 比值
- Margin: 毛利率（0-1之间的小数）

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
  "LTV": 50000,
  "CAC": 10000,
  "Ratio": 5,
  "Margin": 0.7,
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
- 所有数值字段必须是数字类型
- 如BP未明确提及某指标，根据行业常识合理推断并标注 estimated: true
- key_claims 必须提取 15-25 条，覆盖所有类别`;

const EXPERT_JUDGE_PROMPT = `你是一个融合了资深行业专家（10年+行业经验）和顶级投资分析师（曾管理10亿+美元基金）的 AI 研究员。你对中国各行业市场格局、技术发展趋势、一级市场投资逻辑有深刻理解。

你的使命：基于你的专业知识库，对这份商业计划书（BP）进行严格的深度尽职调查。你不是信息中继者，你是判断者和辩证者——你必须用真实的行业知识检验 BP 中的每一个声明。

你将收到：
1. 【BP提取数据】— AI从BP中提取的结构化数据和关键声明
2. 【BP原文节选】— 商业计划书原文

**分析任务（请用 DeepThink 模式，逐步推理）：**

**任务A：逐条核实关键声明（最重要的部分）**
对每条关键声明，基于你的专业知识：
1. 研究该领域的真实情况（引用具体数据：市场报告、可比公司数据、技术基准等）
2. 判断声明的真实性：
   - 【诚实】BP数据与行业真实情况基本吻合（±20%以内）
   - 【夸大】BP数据 > 真实数据 2-5倍
   - 【严重夸大】BP数据 > 真实数据 5倍以上
   - 【信息不对称】BP故意隐瞒重要竞争对手或负面信息
   - 【存疑】无法确认，数据存在但无法核实
   - 【证伪】技术不可行、市场不存在、声明明显错误
3. 量化差异（BP声称X，实际应为Y，夸大Z倍）

**任务B：五维度深度评分**

*第一维度：时机与天花板（满分100）*
- 该行业真实 TAM（引用权威报告、可比市场数据）
- CAGR 是否合理（对比行业历史增速、驱动因素是否成立）
- 入场时机判断（行业周期位置、竞争格局）

*第二维度：产品与壁垒（满分100）*
- TRL 评级（对比行业同类技术成熟度）
- 护城河深度（技术壁垒、数据壁垒、网络效应、品牌）
- 竞品分析（点名3-5个主要竞品，注明融资/估值情况）

*第三维度：商业验证与效率（满分100）*
- LTV/CAC 合理性（对比同行业平均数据）
- 毛利率真实性（对比同类型公司实际数据）
- 单位经济模型可持续性

*第四维度：团队基因（满分100）*
- 创始团队经验与赛道匹配度
- 股权结构合理性
- 关键能力覆盖情况

*第五维度：外部风险与交易条件（乘数0-1）*
- 政策合规风险（列举相关法规）
- 估值溢价倍数计算（与可比公司对比）

**任务C：估值深度分析（Comps Analysis）**
- 列举3-5个可比公司（上市公司或近期融资案例，注明具体估值倍数）
- 计算行业平均估值倍数（PS/PE/GMV倍数等，选择最合适的指标）
- 计算 Valuation_Gap = BP估值倍数 / 行业平均倍数
- 判断估值是否合理，给出合理估值区间

【重要输出要求】只输出纯 JSON，不要任何 markdown 代码块或其他文字：
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
  "claim_verdicts": [
    {
      "category": "market",
      "original_claim": "BP中的原始声明...",
      "bp_claim": "BP具体声称：...",
      "ai_research": "AI基于知识库的深度研究：该市场2024年实际规模约XX亿元，主要依据：（1）IDC/艾瑞/Frost&Sullivan 等机构报告；（2）可比市场参考：XX市场规模XX亿；（3）增速驱动因素分析...",
      "verdict": "夸大",
      "diff": "BP声称1000亿，实际约150亿，夸大约6.7倍",
      "severity": "高",
      "score_impact": "显著拉低时机与天花板维度得分"
    }
  ],
  "dimension_analysis": {
    "timing_ceiling": {
      "score": 70,
      "label": "时机与天花板",
      "subtitle": "市场规模 + 入场时机",
      "finding": "深度分析：真实TAM约XX亿元（BP声称XX亿，夸大X倍）。行业CAGR实际为XX%，主要驱动因素为：①... ②... ③...。入场时机评估：该行业目前处于[早期/高速增长/成熟]阶段，竞争格局为[分散/头部集中]，入场时机[合适/偏晚/偏早]。",
      "bp_claim": "BP声称市场规模XX亿，年增速XX%",
      "ai_finding": "AI研究发现：真实市场规模约XX亿（参考：IDC报告/艾瑞咨询/可比市场数据），增速约XX%，主要差异原因：BP使用了TAM口径而非SAM/SOM..."
    },
    "product_moat": {
      "score": 65,
      "label": "产品与壁垒",
      "subtitle": "技术可行性 + 竞争壁垒",
      "finding": "技术成熟度：TRL评级为X级，原因：...。竞争壁垒评估：主要护城河为[技术/数据/网络效应/品牌/规模经济]，深度[强/中/弱]。主要竞品：①XX公司（融资XX亿，估值XX亿）；②XX公司（上市，市值XX亿）。",
      "bp_claim": "BP声称技术领先同行2-3年，已获得XX项专利",
      "ai_finding": "AI研究发现：该技术路线已有XX家公司布局，其中头部竞品为XX（参数/性能数据），BP的技术声称[基本属实/有所夸大/明显夸大]..."
    },
    "business_validation": {
      "score": 60,
      "label": "商业验证与效率",
      "subtitle": "商业模式 + 增长 + 财务",
      "finding": "单位经济验证：LTV/CAC=XX（行业平均约为X-X），[合理/偏低/明显偏低]。毛利率验证：BP声称XX%，同类型公司（XX、XX）实际毛利率约XX-XX%，[基本合理/偏高/明显偏高]。商业模式分析：...",
      "bp_claim": "BP声称LTV/CAC=X，毛利率XX%",
      "ai_finding": "AI研究发现：同行业可比公司（XX/XX/XX）LTV/CAC实际约为X-X，毛利率约为XX-XX%..."
    },
    "team": {
      "score": 55,
      "label": "团队基因",
      "subtitle": "团队匹配度 + 股权结构",
      "finding": "团队匹配度：创始人XX年行业经验，[高度匹配/基本匹配/存在短板]。核心岗位覆盖：[技术/产品/销售/财务]均已覆盖/缺少XX岗位。股权结构：最大股东持股XX%，[合理/存在风险——原因：...]。",
      "bp_claim": "BP声称创始人有XX年行业经验，曾任职于XX",
      "ai_finding": "AI研究发现：该背景[可信/存疑/需核实]，类似背景在行业中属于[顶尖/中等/普通]水平..."
    },
    "external_risk": {
      "score": 50,
      "label": "外部风险与交易条件",
      "subtitle": "政策风险 + 估值合理性",
      "finding": "政策风险：涉及[XX监管领域]，相关法规[XX政策/XX条例]，风险等级[低/中/高]。估值合理性：BP估值XX亿，收入XX亿，PS=XXx；行业可比公司平均PS=XX，溢价倍数=XX。[合理/偏高/严重偏高]。",
      "bp_claim": "BP声称估值XX亿，融资XX亿",
      "ai_finding": "AI研究发现：可比公司估值水平：①XX（上市，PS=XX）；②XX（A轮，估值XX亿，收入XX亿，隐含PS=XX）；③XX（B轮，估值XX亿）。行业平均PS=XX，BP溢价=XX倍。",
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
      "evidence": "AI研究：该细分市场实际规模约150亿元，夸大约6.7倍，数据来源不可靠"
    },
    {
      "severity": "中等",
      "field": "Margin",
      "claim": "BP声称毛利率85%",
      "evidence": "AI研究：同类型SaaS公司实际毛利率约65-75%，BP数据明显偏高"
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
    "analysis": "BP要求估值20x PS，而行业可比公司中位数为10x PS，溢价约100%。考虑到BP项目处于早期阶段、收入尚未经过审计验证，建议将估值压缩至10-12x PS区间，即XX-XX亿元合理。"
  },
  "validation_notes": {
    "TAM": "BP声称1000亿，AI研究显示约150亿，主要原因：BP混用TAM/SAM口径",
    "CAGR": "BP声称35%，AI校准为20%，因成熟市场增速放缓",
    "TRL": "根据BP描述已有中试产线，判定TRL=6",
    "Valuation_Gap": "BP估值20x PS，行业平均10x，溢价倍数=2.0"
  }
}

分析要求：
- 每个维度分析至少200字，要有具体数据支撑
- claim_verdicts 对每条声明都要有具体的行业数据对比
- comparable_companies 要点名具体公司和估值数据
- 所有数值字段必须是数字类型，validated_data 中所有字段不能为 null`;

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
// API 路由
// ============================================================

/** 健康检查 */
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", model: MODEL, search: "minimax_builtin" });
});

/** 搜索状态（保持兼容，告知前端使用 MiniMax 内置知识） */
app.get("/api/search-status", (_req, res) => {
  res.json({ enabled: true, provider: "minimax_builtin" });
});

/** 核心分析端点 — 上传 PDF，完成完整流水线（SSE 进度推送） */
app.post("/api/analyze", upload.single("file"), async (req, res) => {
  const startTime = Date.now();
  let pdfText = "";

  // ── 阶段 0: 获取文本（SSE 启动前，验证错误以普通 JSON 返回）──
  try {
    if (req.file) {
      if (req.file.mimetype && req.file.mimetype !== "application/pdf" && !req.file.originalname?.endsWith(".pdf")) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: "请上传 PDF 格式的文件" });
      }
      try {
        pdfText = await extractPdfText(req.file.path);
      } catch (pyErr) {
        const errMsg = pyErr.message || "未知错误";
        console.warn("Python PDF 提取失败:", errMsg);
        let userMessage = errMsg;
        try {
          const parsed = JSON.parse(errMsg);
          if (parsed.error) userMessage = parsed.error;
        } catch {}
        return res.status(400).json({ error: "PDF 解析失败: " + userMessage });
      } finally {
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
  } catch (err) {
    return res.status(500).json({ error: err.message || "服务器内部错误" });
  }

  // ── 启动 SSE 流 ──
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // 禁用 nginx 缓冲

  let clientDisconnected = false;
  req.on("close", () => { clientDisconnected = true; });

  /** 向客户端推送 SSE 数据帧 */
  const sendSSE = (data) => {
    if (clientDisconnected) return;
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (_) {}
  };

  try {
    // 提取前 30000 字符供分析
    const maxChars = 30000;
    const bpText = pdfText.length > maxChars
      ? pdfText.slice(0, maxChars) + "\n...(文本已截断，共" + pdfText.length + "字符)"
      : pdfText;

    sendSSE({ type: "progress", stage: "pdf_done", percentage: 8, message: "PDF文本提取完成，准备开始数据分析..." });

    // ============================================================
    // 两步 Pipeline: 数据提取 → AI专家深度研究与评分
    // ============================================================

    // ── 第1步: 数据提取 — 从BP中提取评分数据和关键声明 ──
    console.log("[1/2] 数据提取: 从BP中提取关键数据和声明...");
    sendSSE({ type: "progress", stage: "data_extract", percentage: 12, message: "正在提取BP关键声明与评分数据（step 1/2）..." });

    let extractionRaw = await callLLM(
      AGENT_A_PROMPT,
      `以下是商业计划书全文（共提取 ${bpText.length} 字符）：\n\n${bpText}`,
      8192
    );
    let extractedData = extractJson(extractionRaw);

    // 首次提取失败，重试
    if (!extractedData || !extractedData.key_claims) {
      console.warn("[1/2] 首次数据提取 JSON 解析失败，重试中...");
      sendSSE({ type: "progress", stage: "data_extract_retry", percentage: 18, message: "数据提取重试中，请稍候..." });
      const retryPrompt = AGENT_A_PROMPT + "\n\n【紧急提醒】上次输出不是合法 JSON 导致解析失败。这次只输出 JSON 对象，从 { 开始到 } 结束，不加任何解释或 markdown。";
      extractionRaw = await callLLM(retryPrompt, `以下是商业计划书全文：\n\n${bpText}`, 8192);
      extractedData = extractJson(extractionRaw);
    }

    if (!extractedData) {
      console.error("[1/2] 数据提取两次均失败");
      sendSSE({ type: "error", error: "AI 数据提取失败，请重新分析" });
      res.end();
      return;
    }

    // 兼容旧格式：如果没有 key_claims 但有 search_queries，转换格式
    if (!extractedData.key_claims && extractedData.search_queries) {
      extractedData.key_claims = extractedData.search_queries.map(q => ({
        category: q.dimension || "other",
        claim: q.query || "",
        source_in_bp: "BP中",
      }));
    }

    const claimCount = (extractedData.key_claims || []).length;
    console.log(`  → 提取到 ${claimCount} 条关键声明，行业: ${extractedData.industry || "未识别"}`);
    console.log(`  → TAM: ${extractedData.TAM}, CAGR: ${extractedData.CAGR}%, TRL: ${extractedData.TRL}, Margin: ${extractedData.Margin}`);

    sendSSE({
      type: "progress",
      stage: "data_done",
      percentage: 28,
      message: `数据提取完成，共识别 ${claimCount} 条关键声明，启动AI深度研究...`,
    });

    // ── 第2步: AI专家深度研究与评分（DeepThink 模式）──
    console.log("[2/2] AI专家深度研究: MiniMax 知识库深度分析中（DeepThink模式）...");
    sendSSE({ type: "progress", stage: "ai_research", percentage: 32, message: "AI深度研究启动（DeepThink模式，预计3-5分钟）..." });

    // 释放已不再需要的大字符串，降低内存峰值
    extractionRaw = null;

    // 传给专家模型的 BP 节选缩减为 15000 字（提取阶段已拿到结构化数据，无需重复传全文）
    const judgeInput = [
      `【BP提取数据】\n${JSON.stringify(extractedData, null, 2)}`,
      `\n\n【BP原文节选（前15000字）】\n${bpText.slice(0, 15000)}`,
    ].join("");

    let thinking = "";
    let validationRaw = "";
    let validatedData = null;

    const judgeResult = await callLLMWithThinking(EXPERT_JUDGE_PROMPT, judgeInput, 16000, 8000);
    thinking = judgeResult.thinking;
    validationRaw = judgeResult.text;
    validatedData = extractJson(validationRaw);

    // 解析失败重试
    if (!validatedData || !validatedData.validated_data) {
      console.warn("[2/2] 首次专家分析 JSON 解析失败，重试...");
      sendSSE({ type: "progress", stage: "ai_research_retry", percentage: 75, message: "AI研究结果解析失败，重试中..." });
      const retryJudgePrompt = EXPERT_JUDGE_PROMPT + "\n\n【紧急提醒】上次输出不是合法 JSON。这次只输出 JSON 对象，从 { 开始到 } 结束。";
      validationRaw = await callLLM(retryJudgePrompt, judgeInput, 16000);
      validatedData = extractJson(validationRaw);
    }

    // 释放大字符串
    validationRaw = null;

    if (!validatedData || !validatedData.validated_data) {
      console.error("[2/2] 专家分析失败");
      sendSSE({ type: "error", error: "AI 专家分析失败，请重试" });
      res.end();
      return;
    }

    sendSSE({ type: "progress", stage: "ai_done", percentage: 82, message: "AI深度研究完成，正在计算五维评分..." });

    // ── 评分计算 ──
    const scoringInput = validatedData.validated_data;
    const scoringResult = scoreProject(scoringInput);

    console.log(`  → 评分完成: 总分 ${scoringResult.total_score}, 评级 ${scoringResult.grade}`);
    sendSSE({ type: "progress", stage: "scoring", percentage: 86, message: `评分完成（${scoringResult.total_score}分 / ${scoringResult.grade}），生成深度研究报告...` });

    // ── 构建维度数据（合并评分系统结果 + 专家分析结论）──
    const dimensionAnalysis = validatedData.dimension_analysis || {};

    const buildDimensionFinding = (key, dimResult) => {
      const expertDim = dimensionAnalysis[key] || {};
      return expertDim.finding || dimResult.label + " 评估完成";
    };

    const verdict = {
      total_score: scoringResult.total_score,
      grade: scoringResult.grade,
      verdict_summary: scoringResult.grade_label,
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
        bp_multiple: scoringInput.BP_Valuation && scoringInput.BP_Revenue
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
    console.log("  → 生成深度研究报告...");
    sendSSE({ type: "progress", stage: "report", percentage: 90, message: "正在生成深度研究报告（约1-2分钟）..." });

    const deepResearchInput = [
      `【商业计划书原文节选（前12000字）】\n${bpText.slice(0, 12000)}`,
      `\n\n【AI专家深度分析结果】\n${JSON.stringify({
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
      }, null, 2)}`,
    ].join("");

    const deepResearch = await callLLM(DEEP_RESEARCH_PROMPT, deepResearchInput, 8192);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✓ 完成！总耗时 ${elapsed}s`);

    sendSSE({ type: "progress", stage: "finalizing", percentage: 98, message: "报告生成完成，正在整理结果..." });

    // ── 发送最终结果 ──
    sendSSE({
      type: "complete",
      data: {
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

    res.end();
  } catch (err) {
    console.error("[分析错误]", err);
    sendSSE({ type: "error", error: err.message || "服务器内部错误" });
    res.end();
  }
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
  console.log(`   分析引擎: MiniMax 内置知识库 + DeepThink 深度研究\n`);
});

// 延长超时以支持长时间运行的 AI 分析流水线（约 6-10 分钟）
// Node.js 18+ 的 requestTimeout 默认值为 300s（5 分钟），需显式覆盖
const HTTP_TIMEOUT = 15 * 60 * 1000; // 15 分钟
server.timeout = HTTP_TIMEOUT;           // socket 空闲超时
server.requestTimeout = HTTP_TIMEOUT;    // 完整请求超时（Node.js 14.11+）
server.keepAliveTimeout = HTTP_TIMEOUT + 1000; // keep-alive 超时需略高于 requestTimeout
