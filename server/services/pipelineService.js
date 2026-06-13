// ============================================================
// server/services/pipelineService.js — 分析流水线服务
// 从 index.js 提取的核心 AI 分析逻辑
// ============================================================

const pLimit = require("p-limit");
const { callLLM, callLLMWithThinking, callLLMWithSearch, getModelName } = require("./llmService");
const { extractJson, extractJsonArray, extractPartialResult, ensureStringArray } = require("../utils/jsonParser");
const { scoreProject, assessIntegrityVeto } = require("../scoring");
const { mergeSpecialistEvidence, financialToVerdicts, valuationToVerdicts } = require("../scoringEvidence");
const { runWebSearch, formatSearchContext, kimiAgenticChatWithSearch } = require("./webSearchService");
const logger = require("../utils/logger");
const trackingService = require("./trackingService");
const agentRuntime = require("./agentRuntime");
const dataLakeService = require("./dataLakeService");
const crossMatchService = require("./crossMatchService");
const { PIPELINE_VERSION } = require("../config/versions");
const { scoringHarnessMode } = require("../config/featureFlags");
const {
  AGENT_A_PROMPT,
  CLAIM_VERDICT_BATCH_PROMPT,
  buildStructuralPrompt,
  buildDimensionAnalysisPrompt,
  EXPERT_JUDGE_MINIMAL_PROMPT,
  DEEP_RESEARCH_PROMPT,
  DIMENSION_ANALYSIS_PROMPT,
} = require("../utils/prompts");

const MAX_CLAIMS_PER_BATCH = 6; // 每批最多6条声明，防止输出截断导致JSON解析失败
const MAX_CONCURRENT_BATCHES = 5; // 最多5个并发批次
const PARALLEL_TASK_TIMEOUT_MS = 8 * 60 * 1000; // 单路并行任务上限 8min，避免一路 hang 拖死整个分析

// ── 不可信文档边界（与 prompts.js 的 UNTRUSTED_DOC_GUARD 配对）──────
// BP 原文进入任何 prompt 前必须包裹，防止文档内指令越权成为模型指令。
function wrapBpDocument(text) {
  const cleaned = String(text || "").replace(/<\/?BP_DOCUMENT>/g, "");
  return `<BP_DOCUMENT>\n${cleaned}\n</BP_DOCUMENT>`;
}

// 高置信注入特征预扫（保守的高精度模式，宁缺毋滥——命中即打质量旗+风险旗）
const INJECTION_PATTERNS = [
  /忽略(之前|以上|前面|上面)的?(所有|全部)?(指令|提示|规则|要求)/,
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i,
  /(请|必须)?给?(本|该|此)项目(打)?\s*(满分|高分|100\s*分|[9八九]\d\s*分以上)/,
  /verdict\s*[=:：]\s*["']?(诚实|保守低估)/,
  /(不要|无需|跳过|禁止)(核查|核实|验证)(以下|这些|上述)?(声明|内容|数据)/,
  /\bsystem\s*(prompt|message)\s*[:：]/i,
  /你(现在)?是.{0,12}(系统|管理员|开发者模式)/,
];

function detectInjectionHints(bpText) {
  const text = String(bpText || "");
  const hits = [];
  for (const re of INJECTION_PATTERNS) {
    const m = text.match(re);
    if (m) hits.push(m[0].slice(0, 60));
  }
  return hits;
}

// ── 评分接地检索：给"评分数据"调用注入真实外部证据 ─────────────
// 投资人要的是"BP 说技术牛逼 → AI 客观发现市场上很多类似的"。
// 该能力的前提是产出 TRL/竞品排名/护城河/TAM 的那次调用见过真实检索结果，
// 而不是只凭模型记忆+BP 自报。查询聚焦竞品格局与市场规模两类客观事实。
function buildScoringSearchQueries(extractedData = {}) {
  const industry = String(extractedData.industry || "").trim();
  const product = String(extractedData.product_name || "").trim();
  const company = String(extractedData.company_name || "").trim();
  return [
    industry || product ? [industry, product, "竞品 同类产品 公司 对比"].filter(Boolean).join(" ") : "",
    industry ? `${industry} 市场规模 CAGR 增速 研报` : "",
    company ? [company, product, "融资 客户 技术"].filter(Boolean).join(" ") : "",
  ].filter(Boolean);
}

async function fetchScoringEvidence(extractedData) {
  try {
    const rows = await runWebSearch(buildScoringSearchQueries(extractedData));
    if (!rows.length) return "";
    return [
      "\n\n【服务端联网检索证据】",
      formatSearchContext(rows),
      "",
      "重要：评定 TRL、Competitor_Rank_Score、Moat_Rubric、竞争密度、TAM、CAGR 时，",
      "必须优先依据上方检索证据与微观声明核查报告；检索证据与 BP 自报冲突时，以检索证据为准并压低对应评分。",
      "检索发现同类竞品较多/技术非独家时，competitive_density 与 differentiation 不得给高分。",
    ].join("\n");
  } catch (err) {
    logger.warn("[B.scoring] 评分接地检索失败，评分将退回模型知识:", err.message);
    return "";
  }
}

function withTaskTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} 任务超时（${PARALLEL_TASK_TIMEOUT_MS / 1000}s）`)), PARALLEL_TASK_TIMEOUT_MS).unref()
    ),
  ]);
}

/** 行业大类映射 — 通过关键词匹配将细分行业归类到统计大类（支持多标签） */
const INDUSTRY_CATEGORIES = [
  { category: "人工智能", keywords: ["AI", "人工智能", "机器学习", "深度学习", "NLP", "自然语言", "计算机视觉", "大模型", "LLM", "GPT", "智能"] },
  { category: "具身智能", keywords: ["具身智能", "人形机器人", "灵巧手", "运动控制", "embodied", "具身"] },
  { category: "芯片半导体", keywords: ["芯片", "半导体", "IC设计", "晶圆", "EDA", "封装测试", "光刻", "FPGA", "GPU", "处理器", "SoC", "存储芯片"] },
  { category: "低空经济", keywords: ["低空", "eVTOL", "无人机", "UAV", "飞行汽车", "空中交通", "通航", "飞行器"] },
  { category: "商业航天", keywords: ["航天", "火箭", "卫星", "太空", "空间站", "遥感", "商业发射", "轨道"] },
  { category: "合成生物", keywords: ["合成生物", "基因编辑", "CRISPR", "生物制造", "发酵工程", "细胞工厂", "合成生物学"] },
  { category: "新能源", keywords: ["新能源", "光伏", "储能", "锂电", "氢能", "风电", "电池", "充电", "碳中和", "清洁能源", "电动"] },
  { category: "生物医药", keywords: ["医药", "医疗", "制药", "临床", "诊断", "创新药", "医疗器械", "健康", "药物"] },
  { category: "先进制造", keywords: ["制造", "机器人", "自动化", "工业", "材料", "3D打印", "精密"] },
  { category: "企业服务/SaaS", keywords: ["SaaS", "企业服务", "B2B", "云计算", "ERP", "CRM", "协同", "办公", "数据服务", "PaaS"] },
  { category: "消费/零售", keywords: ["消费", "零售", "电商", "品牌", "餐饮", "食品", "快消", "DTC", "新零售"] },
  { category: "金融科技", keywords: ["金融", "支付", "保险", "银行", "区块链", "数字货币", "信贷", "风控", "FinTech"] },
];

/** 多标签行业分类 — 返回匹配的所有类别数组 */
function classifyIndustryMulti(industryStr) {
  if (!industryStr) return ["其他"];
  const upper = industryStr.toUpperCase();
  const matched = [];
  for (const { category, keywords } of INDUSTRY_CATEGORIES) {
    for (const kw of keywords) {
      if (upper.includes(kw.toUpperCase())) {
        matched.push(category);
        break;
      }
    }
  }
  return matched.length > 0 ? matched : ["其他"];
}

/** 兼容旧接口：返回第一个匹配类别（字符串） */
function classifyIndustry(industryStr) {
  return classifyIndustryMulti(industryStr)[0];
}

function buildDefaultVerificationHarness(claim = {}, extractedData = {}) {
  const category = String(claim.category || "other").toLowerCase();
  const company = extractedData.company_name || "目标公司";
  const industry = extractedData.industry || "所在赛道";
  const claimText = claim.claim || claim.original_claim || "";

  let preferredSources = ["web_search", "uploaded_material"];
  let expectedFields = ["来源", "年份", "口径"];
  let sourceType = claim.source_type || "bp_self_report";

  if (["financial", "valuation"].includes(category)) {
    preferredSources = ["ifind", "annual_report", "exchange_filing", "web_search", "uploaded_material"];
    expectedFields = ["收入", "毛利率", "净利润", "融资金额", "估值", "年份", "口径"];
    sourceType = category === "financial" ? "financial_statement" : "market_report";
  } else if (["legal_compliance", "team"].includes(category)) {
    preferredSources = ["tianyancha", "business_registry", "law", "patent", "web_search"];
    expectedFields = ["注册资本", "法定代表人", "股东", "司法风险", "行政处罚", "知识产权"];
    sourceType = category === "legal_compliance" ? "legal" : "public_registry";
  } else if (["tech", "product"].includes(category)) {
    preferredSources = ["scholar", "arxiv", "patent", "web_search", "uploaded_material"];
    expectedFields = ["技术指标", "专利", "论文", "客户案例", "产品参数"];
    sourceType = "academic_or_patent";
  } else if (["market", "competition", "macro_academic"].includes(category)) {
    preferredSources = ["ifind", "imf", "world_bank", "scholar", "web_search"];
    expectedFields = ["市场规模", "CAGR", "竞品名单", "政策", "统计口径", "年份"];
    sourceType = category === "macro_academic" ? "news_or_policy" : "market_report";
  }

  return {
    preferred_sources: preferredSources,
    kimi_research_prompt:
      `请核验 ${company}（${industry}）BP 声明：“${claimText}”。` +
      "优先尝试同花顺/iFinD、天眼查、工商信息、财报、IMF、Scholar、arXiv、元典法律等可用能力；" +
      "若专业数据不可用，请用公开网页/用户材料/自身知识辅助，并明确标注缺口和置信度。",
    expected_fields: expectedFields,
    failure_mode: "标注为 BP 自报或待核实，进入尽调清单，不得编造。",
    _generated: true,
    source_type: sourceType,
  };
}

function normalizeKeyClaimsForResearch(extractedData = {}) {
  const claims = Array.isArray(extractedData.key_claims) ? extractedData.key_claims : [];
  extractedData.key_claims = claims.map((claim) => {
    const normalized = { ...claim };
    if (!normalized.priority) {
      normalized.priority = /估值|收入|ARR|毛利|利润|注册|诉讼|处罚|专利|第一|唯一|市占率|融资|客户/i.test(normalized.claim || "")
        ? "high"
        : "medium";
    }
    if (!normalized.verification_harness || typeof normalized.verification_harness !== "object") {
      const harness = buildDefaultVerificationHarness(normalized, extractedData);
      normalized.verification_harness = {
        preferred_sources: harness.preferred_sources,
        kimi_research_prompt: harness.kimi_research_prompt,
        expected_fields: harness.expected_fields,
        failure_mode: harness.failure_mode,
        _generated: true,
      };
      normalized.source_type = normalized.source_type || harness.source_type;
    }
    return normalized;
  });
  return extractedData;
}

/** 压缩声明核查结果 */
function compressVerdicts(verdicts) {
  if (!Array.isArray(verdicts)) return [];
  const severityOrder = { "严重": 0, "高": 0, "中": 1, "低": 2 };
  const sorted = [...verdicts].sort(
    (a, b) => (severityOrder[a.severity] ?? 1) - (severityOrder[b.severity] ?? 1)
  );
  return sorted.slice(0, 15).map(
    ({
      category, original_claim, verdict, diff, severity, score_impact,
      evidence_status, attempted_sources, source_boundary, missing_fields, next_dd_action,
    }) => ({
      category, original_claim, verdict, diff, severity, score_impact,
      evidence_status, attempted_sources, source_boundary, missing_fields, next_dd_action,
    })
  );
}

/** 单条声明核查（批次失败后的逐条降级） */
async function verifySingleClaim(claim, bpContext, batchLabel) {
  try {
    const raw = await callLLM(
      CLAIM_VERDICT_BATCH_PROMPT + "\n\n【重要】请严格只输出 JSON 数组，数组中只有一个元素。",
      `${bpContext}\n\n待核查声明：\n${JSON.stringify([claim], null, 2)}`,
      4096
    );
    const parsed = extractJsonArray(raw);
    if (parsed && parsed.length > 0) return parsed[0];
  } catch (err) {
    logger.warn(`[B.1] ${batchLabel} 单条核查失败: ${err.message}`);
  }
  // 最终降级
  return {
    category: claim.category, original_claim: claim.claim, bp_claim: claim.claim,
    ai_research: "核查失败，无法验证", verdict: "存疑",
    diff: "核查失败", severity: "中", score_impact: "无法评估",
  };
}

/** Agent B 核心调度函数 + 深度研究并行 */
async function runAgentBWithBatchingAndResearch(extractedData, bpText, onProgress) {
  const claims = extractedData.key_claims || [];

  // 评分接地检索与 Phase 1 并行启动（不阻塞声明核查），Phase 2 评分前就绪
  const scoringEvidencePromise = fetchScoringEvidence(extractedData);

  // Phase 1: 微观声明核查 — 每批最多 MAX_CLAIMS_PER_BATCH 条，防止输出过长被截断
  const batches = [];
  for (let i = 0; i < claims.length; i += MAX_CLAIMS_PER_BATCH) {
    batches.push(claims.slice(i, i + MAX_CLAIMS_PER_BATCH));
  }

  const batchCount = batches.length;
  logger.info("[B.1] 声明核查启动", { claimCount: claims.length, batchCount });
  onProgress({ type: "progress", stage: "claim_verify", percentage: 35, message: `核查 ${claims.length} 条关键声明（${batchCount} 批并发）...` });

  const bpContext = `请对处于 ${extractedData.industry || "未知"} 赛道的 ${extractedData.company_name || "未知公司"} 进行核查。产品：${extractedData.product_name || "未知"}。`;

  const limit = pLimit(MAX_CONCURRENT_BATCHES);
  // 含 critical/high 声明的批次走真实联网检索，让"事实核查"对关键声明有
  // 外部证据，而不是纯模型记忆自我背书。三级降级：
  //   ① Kimi 原生 agentic 检索（builtin $web_search，Kimi 按每条声明自主
  //     决定搜什么、搜几轮——检索针对性最强，深挖 Kimi 自带能力）
  //   ② 服务端预检索注入（callLLMWithSearch + verification_harness 查询）
  //   ③ 纯模型知识（callLLM，verdict 受证据纪律约束只能给存疑）
  const verifyBatch = async (batch, batchIdx) => {
    const sysPrompt = CLAIM_VERDICT_BATCH_PROMPT + "\n\n【重要】请严格只输出 JSON 数组，不要使用 markdown 代码块。";
    const userInput = `${bpContext}\n\n待核查声明批次 ${batchIdx + 1}/${batchCount}：\n${JSON.stringify(batch, null, 2)}`;
    const hasPriorityClaim = batch.some((c) =>
      ["critical", "high"].includes(String(c?.priority || "").toLowerCase())
    );
    if (!hasPriorityClaim) return callLLM(sysPrompt, userInput, 6144);

    // ① Kimi 原生自主检索
    try {
      const r = await kimiAgenticChatWithSearch({
        system: sysPrompt +
          "\n\n你拥有联网搜索工具。对每条 critical/high 声明，按其 verification_harness.kimi_research_prompt 主动检索核验；" +
          "ai_research 中必须写明检索到的来源（媒体/机构名 + URL + 日期）。",
        user: userInput,
        maxTokens: 6144,
      });
      logger.info(`[B.1] 批次 ${batchIdx + 1} Kimi 原生检索完成`, { searchRounds: r.searchRounds });
      return r.text;
    } catch (err) {
      logger.warn(`[B.1] 批次 ${batchIdx + 1} Kimi 原生检索失败，降级预检索: ${err.message}`);
    }
    // ② 服务端预检索注入
    const preSearchQueries = batch
      .filter((c) => ["critical", "high"].includes(String(c?.priority || "").toLowerCase()))
      .map((c) => c?.verification_harness?.kimi_research_prompt)
      .filter(Boolean)
      .slice(0, 3);
    return callLLMWithSearch(sysPrompt, userInput, { maxTokens: 6144, preSearchQueries })
      .then((r) => r.text);
  };

  // M8: 外层 try/catch 兜底 Promise.all 内部不可达异常（如 p-limit 自身错误）
  let batchResults;
  try {
    batchResults = await Promise.all(
      batches.map((batch, batchIdx) =>
        limit(() =>
          verifyBatch(batch, batchIdx).then((raw) => {
            const parsed = extractJsonArray(raw);
            if (!parsed) {
              return { failed: true, batch, batchIdx };
            }
            return { failed: false, results: parsed };
          }).catch(() => {
            return { failed: true, batch, batchIdx };
          })
        )
      )
    );
  } catch (err) {
    logger.error("[B.1] 批量并发调度本身异常，全部降级为失败批次:", err.message);
    batchResults = batches.map((batch, batchIdx) => ({ failed: true, batch, batchIdx }));
  }

  // Phase 1.5: 失败批次重试 — 先整体重试，再逐条降级
  const allClaimVerdicts = [];
  const failedBatches = [];

  for (const br of batchResults) {
    if (br.failed) {
      failedBatches.push(br);
    } else {
      allClaimVerdicts.push(...br.results);
    }
  }

  if (failedBatches.length > 0) {
    logger.warn(`[B.1] ${failedBatches.length} 个批次解析失败，启动重试...`);
    onProgress({ type: "progress", stage: "claim_verify", percentage: 50, message: `${failedBatches.length} 个批次核查失败，重试中...` });

    for (const fb of failedBatches) {
      // 整体重试一次
      let retrySuccess = false;
      try {
        const retryRaw = await callLLM(
          CLAIM_VERDICT_BATCH_PROMPT + "\n\n【紧急提醒】请严格只输出 JSON 数组，不要输出任何其他内容。",
          `${bpContext}\n\n待核查声明批次 ${fb.batchIdx + 1}/${batchCount}（重试）：\n${JSON.stringify(fb.batch, null, 2)}`,
          8192
        );
        const retryParsed = extractJsonArray(retryRaw);
        if (retryParsed) {
          allClaimVerdicts.push(...retryParsed);
          retrySuccess = true;
        }
      } catch (err) {
        logger.warn(`[B.1] 批次 ${fb.batchIdx + 1} 整体重试失败: ${err.message}`);
      }

      // 整体重试仍失败，逐条核查
      if (!retrySuccess) {
        logger.warn(`[B.1] 批次 ${fb.batchIdx + 1} 整体重试失败，拆分为单条核查...`);
        for (const claim of fb.batch) {
          const singleResult = await verifySingleClaim(claim, bpContext, `批次${fb.batchIdx + 1}`);
          allClaimVerdicts.push(singleResult);
        }
      }
    }
  }
  logger.info("[B.1] 声明核查完成", { total: allClaimVerdicts.length });
  onProgress({ type: "progress", stage: "claims_verified", percentage: 55, message: `声明核查完成（${allClaimVerdicts.length} 条），并行启动评分+深度研究...` });

  // Phase 2: 三路并行：评分数据（小输出） + 五维深度分析（专注大输出） + 深度研究报告
  const compressedVerdicts = compressVerdicts(allClaimVerdicts);
  const scoringPrompt = buildStructuralPrompt(extractedData);
  const dimAnalysisPrompt = buildDimensionAnalysisPrompt(extractedData);

  // 评分接地证据（与 Phase 1 并行检索，此处就绪；失败返回空串不阻塞）
  const scoringEvidence = await scoringEvidencePromise;

  // 评分和维度分析共用同一组输入（BP 原文必须包裹不可信文档边界）
  const structuralInput = [
    `【BP提取数据（原始）】\n${JSON.stringify(extractedData, null, 2)}`,
    `\n\n【微观声明核查报告】\n${JSON.stringify(compressedVerdicts, null, 2)}`,
    `\n\n【BP原文节选（前3000字）】\n${wrapBpDocument(bpText.slice(0, 3000))}`,
    scoringEvidence,
  ].join("");

  // 深度研究使用更多原文
  const earlyDeepResearchInput = [
    `【商业计划书原文节选（前12000字）】\n${wrapBpDocument(bpText.slice(0, 12000))}`,
    `\n\n【项目基本信息】\n公司：${extractedData.company_name || "未知"}，赛道：${extractedData.industry || "未知"}`,
    `\n\n【声明核查结果】\n${JSON.stringify(compressedVerdicts, null, 2)}`,
    `\n\n【BP提取数据】\n${JSON.stringify(extractedData, null, 2)}`,
  ].join("");

  onProgress({ type: "progress", stage: "report_parallel", percentage: 58, message: "三路并行：评分数据 + 五维深度分析 + 深度研究报告..." });

  const settled = await Promise.allSettled([
    withTaskTimeout((async () => {
      // 层1: DeepThink（评分数据输出小，12000 足够）
      const judgeResult = await callLLMWithThinking(scoringPrompt, structuralInput, 12000, 5000);
      let result = extractJson(judgeResult.text);

      // 层1.5: 抢救
      if (!result || !result.validated_data) {
        const rescued = extractPartialResult(judgeResult.text);
        if (rescued && rescued.validated_data) {
          logger.info("[B.scoring] 整体JSON截断，成功抢救 validated_data");
          result = rescued;
        }
      }

      // 层2: 普通模式
      if (!result || !result.validated_data) {
        logger.warn("[B.scoring] 层1解析失败，切换普通模式...");
        onProgress({ type: "progress", stage: "scoring_retry", percentage: 72, message: "正在优化评分精度..." });
        const retry1Raw = await callLLM(scoringPrompt + "\n\n【紧急提醒】只输出 JSON 对象，不要 markdown 代码块。", structuralInput, 8192);
        result = extractJson(retry1Raw);

        if (!result || !result.validated_data) {
          const rescued2 = extractPartialResult(retry1Raw);
          if (rescued2 && rescued2.validated_data) {
            logger.info("[B.scoring] 层2截断，成功抢救 validated_data");
            result = rescued2;
          }
        }
      }

      // 层3: 精简模式
      if (!result || !result.validated_data) {
        logger.warn("[B.scoring] 层2仍失败，启用精简模式...");
        onProgress({ type: "progress", stage: "scoring_retry2", percentage: 76, message: "精简模式评分中..." });
        const minimalInput = [
          `【BP提取数据】\n${JSON.stringify(extractedData, null, 2)}`,
          `\n\n【声明核查报告（top-10）】\n${JSON.stringify(compressedVerdicts.slice(0, 10), null, 2)}`,
        ].join("");
        const retry2Raw = await callLLM(EXPERT_JUDGE_MINIMAL_PROMPT, minimalInput, 4096);
        result = extractJson(retry2Raw);

        if (!result || !result.validated_data) {
          const rescued3 = extractPartialResult(retry2Raw);
          if (rescued3 && rescued3.validated_data) {
            logger.info("[B.scoring] 层3截断，抢救 validated_data");
            result = rescued3;
          }
        }
      }

      return { structuralResult: result, thinking: judgeResult.thinking || "" };
    })(), "评分"),

    // Task B: 五维深度分析（专用调用，给足 token 空间输出完整分析）
    withTaskTimeout((async () => {
      try {
        // 普通模式（不用 thinking，把 token 全给输出）
        const dimRaw = await callLLM(dimAnalysisPrompt, structuralInput, 16000);
        const dimResult = extractJson(dimRaw);
        if (dimResult && dimResult.dimension_analysis) {
          logger.info("[B.dim] 五维深度分析完成");
          return dimResult.dimension_analysis;
        }
        // 抢救：尝试定向提取 dimension_analysis
        const { extractNestedJson } = require("../utils/jsonParser");
        const rescued = extractNestedJson(dimRaw, "dimension_analysis");
        if (rescued) {
          logger.info("[B.dim] 五维分析JSON截断，成功抢救 dimension_analysis");
          return rescued;
        }
        // 重试
        logger.warn("[B.dim] 首次解析失败，重试...");
        const dimRaw2 = await callLLM(dimAnalysisPrompt + "\n\n【紧急提醒】只输出 JSON 对象，不要 markdown 代码块，只要 dimension_analysis 字段。", structuralInput, 16000);
        const dimResult2 = extractJson(dimRaw2);
        if (dimResult2 && dimResult2.dimension_analysis) return dimResult2.dimension_analysis;
        const rescued2 = extractNestedJson(dimRaw2, "dimension_analysis");
        if (rescued2) return rescued2;

        logger.warn("[B.dim] 五维分析获取失败，将由补充调用处理");
        return null;
      } catch (err) {
        logger.warn("[B.dim] 五维分析调用异常:", err.message);
        return null;
      }
    })(), "五维分析"),

    // Task C: 深度研究报告。三级降级：
    // Kimi 原生 agentic 检索（自主多轮搜市场/竞品/政策/创始人）→ 兼容层
    // web_search → 纯模型。原生路径要求报告中的外部事实带来源 URL+日期。
    withTaskTimeout((async () => {
      try {
        const r = await kimiAgenticChatWithSearch({
          system: DEEP_RESEARCH_PROMPT +
            "\n\n你拥有联网搜索工具。撰写前请主动检索：行业规模与增速、主要竞品及其融资、相关政策、公司与创始人公开信息。" +
            "报告中引用的外部事实必须标注来源（媒体/机构名 + URL + 日期）；检索不到的写明待核实。",
          user: earlyDeepResearchInput,
          maxTokens: 16000,
          maxRounds: 10,
        });
        logger.info("[B.deep] 深度研究 Kimi 原生检索完成", { searchRounds: r.searchRounds });
        return r.text;
      } catch (nativeErr) {
        logger.warn("[B.deep] Kimi 原生检索失败，降级兼容层 web_search:", nativeErr.message);
      }
      try {
        const { text, searchUsed } = await callLLMWithSearch(
          DEEP_RESEARCH_PROMPT,
          earlyDeepResearchInput,
          { maxTokens: 16000 }
        );
        if (searchUsed) logger.info("[B.deep] 深度研究已使用 web_search 增强");
        return text;
      } catch (e) {
        logger.warn("[B.deep] web_search 调用失败，降级普通模式:", e.message);
        return await callLLM(DEEP_RESEARCH_PROMPT, earlyDeepResearchInput, 16000);
      }
    })(), "深度研究"),
  ]);

  const [scoringSettled, dimSettled, researchSettled] = settled;
  // 评分失败时不能继续（核心数据），抛出由上游处理；其他两路失败则降级为 null
  if (scoringSettled.status === "rejected") {
    logger.warn("[Pipeline] 评分任务失败/超时", { reason: scoringSettled.reason?.message });
  }
  const structuralOutcome = scoringSettled.status === "fulfilled"
    ? scoringSettled.value
    : { structuralResult: null, thinking: "" };
  const dimensionAnalysisResult = dimSettled.status === "fulfilled" ? dimSettled.value : null;
  if (dimSettled.status === "rejected") {
    logger.warn("[Pipeline] 五维分析失败/超时", { reason: dimSettled.reason?.message });
  }
  const deepResearch = researchSettled.status === "fulfilled" ? researchSettled.value : "";
  if (researchSettled.status === "rejected") {
    logger.warn("[Pipeline] 深度研究失败/超时", { reason: researchSettled.reason?.message });
  }

  onProgress({ type: "progress", stage: "parallel_done", percentage: 84, message: "评分、维度分析与深度研究均已完成..." });

  return {
    claimVerdicts: allClaimVerdicts,
    structuralResult: structuralOutcome.structuralResult,
    thinking: structuralOutcome.thinking,
    dimensionAnalysisResult,
    deepResearch,
    scoringEvidenceUsed: !!scoringEvidence,
  };
}

/**
 * 基于声明核查结果生成诚信度维度的分析摘要（纯 JS，不依赖 LLM）
 * @param {Array} claimVerdicts
 * @returns {{ finding, comprehensive_analysis, score_rationale, risk_factors, positive_signals }}
 */
function buildIntegrityDimAnalysis(claimVerdicts) {
  if (!Array.isArray(claimVerdicts) || claimVerdicts.length === 0) {
    return {
      finding: "暂无声明核查数据",
      comprehensive_analysis: "暂无声明核查数据，诚信度取中性偏上默认分（没有声明可核查不代表不诚信）。",
      score_rationale: "无核查数据，取中性默认分 70",
      risk_factors: [],
      positive_signals: [],
    };
  }

  const counts = {};
  for (const v of claimVerdicts) {
    const verdict = v.verdict || "存疑";
    counts[verdict] = (counts[verdict] || 0) + 1;
  }
  const total = claimVerdicts.length;

  const parts = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([verdict, count]) => `${verdict} ${count} 条`)
    .join("、");

  const honestCount = (counts["诚实"] || 0) + (counts["保守低估"] || 0);
  const exaggeratedCount = (counts["夸大"] || 0) + (counts["严重夸大"] || 0);
  const falseCount = counts["证伪"] || 0;
  const dishonestCount = exaggeratedCount + falseCount + (counts["信息不对称"] || 0);

  const finding = `共核查 ${total} 条声明：${parts}。`;
  const honestPct = Math.round((honestCount / total) * 100);
  const dishonestPct = Math.round((dishonestCount / total) * 100);

  const riskFactors = [];
  const positiveSignals = [];
  if (exaggeratedCount > 0) riskFactors.push(`${exaggeratedCount} 条声明存在夸大`);
  if (falseCount > 0) riskFactors.push(`${falseCount} 条声明被证伪`);
  if (counts["信息不对称"] > 0) riskFactors.push(`${counts["信息不对称"]} 条声明涉嫌信息不对称`);
  const veto = assessIntegrityVeto(claimVerdicts);
  if (veto.triggered) {
    riskFactors.unshift(`触发诚信一票否决（重大类别声明被证伪/严重夸大）：${veto.reasons[0]}`);
  }
  if (honestCount > 0) positiveSignals.push(`${honestCount} 条声明（${honestPct}%）经核查属实或保守`);
  if (dishonestPct === 0) positiveSignals.push("未发现明显夸大或造假迹象");

  return {
    finding,
    comprehensive_analysis: `${finding} 诚实/保守声明占比 ${honestPct}%，存在问题声明占比 ${dishonestPct}%。存疑声明为 LLM 知识库覆盖不足所致，不代表项目问题。${veto.triggered ? " ⚠ 重大类别（财务/估值/合规）声明被证伪或严重夸大，已触发诚信一票否决，评级被强制限制。" : ""}`,
    score_rationale: `verdict 映射（诚实/保守=10，存疑=6，夸大=3，信息不对称=2，严重夸大=1，证伪=0）后分组加权：财务/估值/合规等重大声明占 70%，其余声明占 30%；重大声明被证伪或严重夸大时 S5 封顶 25 分且评级封顶 C（不可被其他声明稀释）`,
    risk_factors: riskFactors,
    positive_signals: positiveSignals,
  };
}

/** 构建单个维度结果 */
function buildDimension(key, scoringResult, dimensionAnalysis) {
  const dimResult = scoringResult.dimensions[key];
  const expertDim = dimensionAnalysis[key] || {};
  const base = {
    score: dimResult.score,
    label: dimResult.label,
    subtitle: dimResult.subtitle,
    weight: dimResult.weight,
    finding: expertDim.finding || dimResult.label + " 评估完成",
    bp_claim: expertDim.bp_claim || "",
    ai_finding: expertDim.ai_finding || "",
    inputs: dimResult.inputs,
    // Enriched dimension data (ensureStringArray guards against LLM returning objects)
    bp_key_points: ensureStringArray(expertDim.bp_key_points),
    ai_research_findings: ensureStringArray(expertDim.ai_research_findings),
    comprehensive_analysis: expertDim.comprehensive_analysis || "",
    score_rationale: expertDim.score_rationale || "",
    risk_factors: ensureStringArray(expertDim.risk_factors),
    positive_signals: ensureStringArray(expertDim.positive_signals),
  };
  return base;
}

/** 构建完整的 verdict 响应对象 */
function buildVerdictResponse(scoringResult, structuralResult, validatedData, dimensionAnalysis, valuationComparison) {
  const dimensionKeys = ["timing_ceiling", "product_moat", "business_validation", "team", "external_risk"];

  // 第五维度（BP诚信度）由 JS 生成分析摘要，不依赖 LLM 的 dimension_analysis
  const enrichedDimAnalysis = {
    ...dimensionAnalysis,
    external_risk: buildIntegrityDimAnalysis(validatedData.claim_verdicts || []),
  };

  const dimensions = {};
  for (const key of dimensionKeys) {
    dimensions[key] = buildDimension(key, scoringResult, enrichedDimAnalysis);
  }

  return {
    total_score: scoringResult.total_score,
    grade: scoringResult.grade,
    grade_label: scoringResult.grade_label,
    grade_action: scoringResult.grade_action,
    grade_color: scoringResult.grade_color,
    // 诚信一票否决：触发时前端必须醒目展示（grade 已被 scoring 层封顶 C）
    integrity_veto: scoringResult.integrity_veto || null,
    grade_overridden_from: scoringResult.grade_overridden_from || null,
    verdict_summary: structuralResult?.one_line_summary || scoringResult.grade_label,
    dimensions,
    risk_flags: ensureStringArray(validatedData.risk_flags),
    strengths: ensureStringArray(validatedData.strengths),
    conflicts: validatedData.conflicts || [],
    claim_verdicts: validatedData.claim_verdicts || [],
    valuation_comparison: valuationComparison,
  };
}

/**
 * Step 1: 提取 BP 关键数据
 */
async function extractBPData(bpText, onProgress) {
  const maxChars = 30000;
  const truncatedText = bpText.length > maxChars
    ? bpText.slice(0, maxChars) + "\n...(文本已截断，共" + bpText.length + "字符)"
    : bpText;

  onProgress({ type: "progress", stage: "data_extract", percentage: 12, message: "正在提取BP关键声明（step 1/2）..." });

  let extractionRaw = await callLLM(
    AGENT_A_PROMPT,
    `以下是商业计划书全文（共 ${truncatedText.length} 字符）：\n\n${wrapBpDocument(truncatedText)}`,
    8192
  );
  let extractedData = extractJson(extractionRaw);

  // 重试机制
  if (!extractedData || !extractedData.key_claims) {
    onProgress({ type: "progress", stage: "data_extract_retry", percentage: 18, message: "数据提取重试中..." });
    const retryPrompt = AGENT_A_PROMPT + "\n\n【紧急提醒】只输出 JSON 对象。";
    extractionRaw = await callLLM(retryPrompt, `以下是商业计划书全文：\n\n${wrapBpDocument(truncatedText)}`, 8192);
    extractedData = extractJson(extractionRaw);
  }

  if (!extractedData) throw new Error("AI 数据提取失败，请重新分析");

  // 兼容旧格式
  if (!extractedData.key_claims && extractedData.search_queries) {
    extractedData.key_claims = extractedData.search_queries.map((q) => ({
      category: q.dimension || "other", claim: q.query || "", source_in_bp: "BP中",
    }));
  }
  normalizeKeyClaimsForResearch(extractedData);

  const claimCount = (extractedData.key_claims || []).length;
  onProgress({ type: "progress", stage: "data_done", percentage: 28, message: `数据提取完成，共 ${claimCount} 条声明，启动AI研究...` });

  return { extractedData, truncatedText };
}

/**
 * Step 2: 计算评分
 * @param {object} validatedData - LLM 结构化输出（含 validated_data）
 * @param {Array}  claimVerdicts - Agent B 声明核查结果数组（用于 S5 诚信度计算）
 */
// 把 validated_data 映射成 scoreProject 入参（原始与合并共用）
function _toScoringInput(d, claimVerdicts) {
  return {
    TAM_Million_RMB: d.TAM_Million_RMB ?? d.TAM ?? 0,
    CAGR: d.CAGR ?? 0,
    TRL: d.TRL ?? 5,
    Competitor_Rank_Score: d.Competitor_Rank_Score ?? 5,
    TRL_Evidence: d.TRL_Evidence,
    Moat_Rubric: d.Moat_Rubric,
    Chokepoint_Score: d.Chokepoint_Score,
    Industry_Capital_Score: d.Industry_Capital_Score ?? 5,
    Industry_Scale_Score: d.Industry_Scale_Score ?? 5,
    Founder_Exp_Years: d.Founder_Exp_Years ?? 3,
    Team_Experience_Score: d.Team_Experience_Score,
    Team_Domain_Match_Score: d.Team_Domain_Match_Score,
    Team_Completeness_Score: d.Team_Completeness_Score,
    Team_Track_Record_Score: d.Team_Track_Record_Score,
    Team_Education_Score: d.Team_Education_Score,
    claim_verdicts: d.claim_verdicts || claimVerdicts || [],
  };
}

function calculateScoring(validatedData, claimVerdicts, onProgress, multiagent = null) {
  onProgress({ type: "progress", stage: "ai_done", percentage: 82, message: "AI研究完成，计算五维评分..." });

  const rawScoringData = validatedData.validated_data || {};
  const mode = scoringHarnessMode(); // off | shadow | on

  // F-10: 财务/估值专家的确定性结论并入 live 声明集。
  // 这些 verdict 是纯 JS 查表推导（数学矛盾→证伪、估值远高于→夸大等），
  // 已在 scoringEvidence 里封顶防淹没——专家查到"财务自相矛盾"必须能拖分、
  // 能触发诚信一票否决，而不是只躺在 multiagent 标签页的文字里。
  // 注意：仅用于 live/legacy 路径；harness 合并路径(mergeSpecialistEvidence)
  // 自带同样的注入逻辑，传原始 claimVerdicts 避免重复计入。
  let liveVerdicts = claimVerdicts || [];
  if (multiagent && !multiagent.error) {
    try {
      const extra = [
        ...financialToVerdicts(multiagent.financial_analysis),
        ...valuationToVerdicts(multiagent.valuation_analysis),
      ].map((v) => ({ ...v, original_claim: v.original_claim || v.claim }));
      if (extra.length > 0) liveVerdicts = [...liveVerdicts, ...extra];
    } catch (err) {
      logger.warn("[Pipeline] 专家 verdict 注入 live 评分失败（忽略）:", err.message);
    }
  }

  // Plan A：把 orchestrator 5 专家已产的事实，用 JS 推导并双路合并进评分输入。
  // 任一专家缺失/{} → 合并器逐字段 no-op 回退 Agent B，绝不 fail。
  let enrichedData = null;
  let specialistAudit = null;
  if (mode !== "off" && multiagent && !multiagent.error) {
    try {
      const merged = mergeSpecialistEvidence({
        agentBData: rawScoringData,
        claimVerdicts: claimVerdicts || [],
        specialists: {
          founder_profile: multiagent.founder_profile,
          competitor_analysis: multiagent.competitor_analysis,
          financial_analysis: multiagent.financial_analysis,
          valuation_analysis: multiagent.valuation_analysis,
        },
        // 主管线默认无 skill 咽喉分；workspace 路径运行 chokepoint_analysis 后才注入
      });
      enrichedData = merged.enrichedInput;
      specialistAudit = merged.specialist_audit;
    } catch (err) {
      logger.warn("[Pipeline] 专家证据合并异常，回退 Agent B 原始评分:", err.message);
    }
  }

  let scoringInput;
  let scoringResult;
  if (mode === "on" && enrichedData) {
    // on：全量新分生效（harness S2 + 专家合并五维；专家 verdict 已由合并器注入）
    scoringInput = _toScoringInput(enrichedData, claimVerdicts);
    scoringResult = scoreProject(scoringInput, { modeOverride: "on" });
  } else {
    // off / shadow / 无专家：live 走纯 legacy（force off 避免嵌套 shadow），
    // 但专家确定性 verdict 计入 live S5（liveVerdicts）
    scoringInput = _toScoringInput(rawScoringData, liveVerdicts);
    scoringResult = scoreProject(scoringInput, { modeOverride: "off" });
    // shadow：把"全量新分"作为对照块附上，不影响 live
    if (mode === "shadow" && enrichedData) {
      const full = scoreProject(_toScoringInput(enrichedData, claimVerdicts), { modeOverride: "on" });
      scoringResult.scoring_shadow = {
        total_score: full.total_score,
        grade: full.grade,
        dimensions: {
          timing_ceiling: full.dimensions.timing_ceiling.score,
          product_moat: full.dimensions.product_moat.score,
          business_validation: full.dimensions.business_validation.score,
          team: full.dimensions.team.score,
          external_risk: full.dimensions.external_risk.score,
        },
        delta_total: full.total_score - scoringResult.total_score,
        specialist_audit: specialistAudit,
      };
    }
  }
  if (specialistAudit && !scoringResult.scoring_shadow) scoringResult.specialist_audit = specialistAudit;

  onProgress({ type: "progress", stage: "scoring", percentage: 86, message: `评分完成（${scoringResult.total_score}分 / ${scoringResult.grade}），生成报告...` });

  return { scoringInput, scoringResult };
}


/**
 * Step 3: 构建估值对比数据
 */
function buildValuationComparison(validatedData, extractedData, scoringInput, scoringResult, multiagent = null) {
  let valuationComparison = validatedData.valuation_comparison;
  const valuationAgent = multiagent?.valuation_analysis || null;
  const valuationTemp = valuationAgent?.valuation_temperature || null;
  const peerCompanies = Array.isArray(valuationAgent?.peer_public_companies)
    ? valuationAgent.peer_public_companies
    : [];
  const finiteNumber = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  if (valuationTemp || peerCompanies.length > 0) {
    const subjectPs = finiteNumber(valuationTemp?.subject_ps_multiple);
    const medianPs = finiteNumber(valuationTemp?.industry_median_ps);
    const overvaluedPct = subjectPs != null && medianPs != null && medianPs > 0
      ? Math.round(((subjectPs - medianPs) / medianPs) * 100)
      : 0;
    return {
      ...(valuationComparison || {}),
      bp_multiple: subjectPs != null ? subjectPs : (valuationComparison?.bp_multiple || 0),
      industry_avg_multiple: medianPs != null ? medianPs : (valuationComparison?.industry_avg_multiple || 0),
      overvalued_pct: overvaluedPct,
      industry_name: extractedData.industry || valuationComparison?.industry_name || "",
      comparable_companies: peerCompanies,
      temperature: valuationTemp?.temperature || null,
      temperature_reason: valuationTemp?.temperature_reason || null,
      data_source: valuationTemp?.source_boundary || "ValuationAgent Kimi 估值温度计",
      analysis: valuationAgent?.verdict?.summary || valuationComparison?.analysis || scoringResult.grade_action,
    };
  }

  if (!valuationComparison || !valuationComparison.bp_multiple) {
    const bpValuation = extractedData.BP_Valuation || 0;
    const bpRevenue = extractedData.BP_Revenue || 0;
    const bpMultiple = (bpValuation && bpRevenue) ? Math.round(bpValuation / bpRevenue) : 0;
    // 兜底路径没有行业对标数据，溢价无法计算——如实标注数据不足，
    // 不再伪装成"AI 知识库分析"输出恒为 0 的溢价百分比。
    valuationComparison = {
      bp_multiple: bpMultiple,
      industry_avg_multiple: 0,
      overvalued_pct: 0,
      industry_name: extractedData.industry || "",
      data_source: bpMultiple
        ? "按 BP 自述估值/收入推算倍数；行业对标数据不足，溢价未计算"
        : "估值/收入数据不足，无法计算",
      analysis: scoringResult.grade_action,
    };
  }

  return valuationComparison;
}

/**
 * 完整分析流水线（后台执行）
 * 优化：声明核查3批并发 + 深度研究与结构化评分并行
 */
async function runPipeline(bpText, onProgress, taskId = null, userId = null) {
  const startTime = Date.now();

  onProgress({ type: "progress", stage: "pdf_done", percentage: 8, message: "文档解析完成，准备分析..." });

  // Step 1: 数据提取
  const { extractedData, truncatedText } = await extractBPData(bpText, onProgress);

  // Step 2: Agent B（声明核查+评分）与 6 个 Multiagent 并行启动，互不等待
  onProgress({ type: "progress", stage: "agent_b_start", percentage: 32, message: "Agent B 启动（3批并发核查）+ 6个AI Agent 并行分析..." });

  const [agentBResult, multiagent] = await Promise.all([
    // 主流水线：声明核查 + 评分数据 + 五维深度分析 + 深度研究
    runAgentBWithBatchingAndResearch(extractedData, truncatedText, onProgress),

    // multiagent：本地 orchestrator 并行执行
    (async () => {
      try {
        onProgress({ type: "progress", stage: "multiagent_start", percentage: 33, message: "深度投研分析启动中..." });
        const { runId, multiagent: ma } = await agentRuntime.runBpPipeline({
          bpText, extractedData, taskId, userId,
        });
        const runtime = ma?.runtime || "legacy";
        onProgress({ type: "progress", stage: "multiagent_done", percentage: 85, message: `投研分析完成 (${runtime})` });
        return { runId, ...ma };
      } catch (err) {
        logger.warn("[Pipeline] multiagent 全局异常，不影响主报告:", err.message);
        return {};
      }
    })(),
  ]);

  const { claimVerdicts, structuralResult, thinking, dimensionAnalysisResult, deepResearch, scoringEvidenceUsed } = agentBResult;

  // ── 报告质量标记：降级不再静默，最终结果携带 quality.flags ──
  const qualityFlags = [];
  // Prompt Injection 预扫：BP 文本含操纵 AI 的指令特征 → 整份报告打可疑标记
  const injectionHits = detectInjectionHints(bpText);
  if (injectionHits.length > 0) {
    qualityFlags.push("prompt_injection_suspected");
    logger.warn("[Pipeline] BP 文本疑似包含 Prompt 注入指令", { hits: injectionHits });
  }
  if (!deepResearch) qualityFlags.push("deep_research_unavailable");
  if (!scoringEvidenceUsed) qualityFlags.push("scoring_search_unavailable");
  if (!multiagent || multiagent.error || Object.keys(multiagent).length === 0) {
    qualityFlags.push("multiagent_unavailable");
  }
  const failedVerifyCount = (claimVerdicts || []).filter(
    (v) => v && v.ai_research === "核查失败，无法验证"
  ).length;
  if (failedVerifyCount > 0) qualityFlags.push(`claim_verify_partial:${failedVerifyCount}`);

  // Agent A 数据兜底：如果结构化评分 3 层 + 抢救全部失败，用 Agent A 提取的数据直接评分
  let validatedData;
  if (!structuralResult || !structuralResult.validated_data) {
    qualityFlags.push("scoring_fallback_agent_a");
    logger.warn("[Pipeline] 结构化评分全部失败，启用 Agent A 数据兜底");
    onProgress({ type: "progress", stage: "scoring_fallback", percentage: 86, message: "正在整合分析数据..." });
    validatedData = {
      validated_data: {
        // F-06: Agent A 标注 estimated 的推断值按缺失处理（S1 走中性 30），
        // 不得让模型"行业常识猜的 TAM"冒充已验证市场规模进入评分
        TAM_Million_RMB: extractedData.TAM_estimated === true ? 0 : (extractedData.TAM_Million_RMB ?? 0),
        CAGR: extractedData.CAGR_estimated === true ? 0 : (extractedData.CAGR ?? 0),
        TRL: extractedData.TRL ?? 5,
        Competitor_Rank_Score: 5,
        Industry_Capital_Score: 5,
        Industry_Scale_Score: 5,
        Founder_Exp_Years: extractedData.Founder_Exp_Years ?? 3,
      },
      dimension_analysis: {},
      one_line_summary: `${extractedData.company_name || "未知公司"} — ${extractedData.industry || "未知赛道"}`,
      claim_verdicts: claimVerdicts,
    };
  } else {
    validatedData = { ...structuralResult, claim_verdicts: claimVerdicts };
    // F-06: Agent B 如果只是原样照抄 Agent A 的推断值（既没给独立 TAM_Source
    // 依据、数值也没变），该值仍是模型猜测——按缺失打折，并打质量旗
    const vd = validatedData.validated_data || {};
    if (
      extractedData.TAM_estimated === true &&
      Number(vd.TAM_Million_RMB) === Number(extractedData.TAM_Million_RMB)
    ) {
      const src = vd.TAM_Source;
      const hasIndependentBasis =
        src && typeof src === "object" && ["研报", "自下而上"].includes(String(src.type));
      if (!hasIndependentBasis) {
        vd.TAM_Million_RMB = 0; // isTamMissing → 中性 30 + inputs.TAM_missing 标记
        qualityFlags.push("tam_estimated_discounted");
      }
    }
    if (
      extractedData.CAGR_estimated === true &&
      Number(vd.CAGR) === Number(extractedData.CAGR)
    ) {
      vd.CAGR = 0; // CAGR 是加分项，推断增速不给分
      qualityFlags.push("cagr_estimated_discounted");
    }
  }

  // Step 3: 评分计算（CPU，瞬间完成）
  const { scoringInput, scoringResult } = calculateScoring(validatedData, claimVerdicts, onProgress, multiagent);

  // 所见即所评：报告展示的声明核查列表与实际计入 S5 的声明集保持一致
  // （含专家注入的"财务数学矛盾→证伪"等确定性结论，投资人必须看得到）
  if (Array.isArray(scoringInput.claim_verdicts) && scoringInput.claim_verdicts.length > 0) {
    validatedData.claim_verdicts = scoringInput.claim_verdicts;
  }

  // Step 4: 整合维度分析数据
  // 优先使用并行获取的专用维度分析结果，其次使用结构化评分中附带的，最后才用兜底
  const dimKeys = ["timing_ceiling", "product_moat", "business_validation", "team"];
  const hasDimContent = (dimObj) => dimObj && dimKeys.some(k => dimObj[k] && (dimObj[k].finding || dimObj[k].comprehensive_analysis));

  let dimensionAnalysis = {};
  if (hasDimContent(dimensionAnalysisResult)) {
    // 首选：并行专用调用结果
    dimensionAnalysis = dimensionAnalysisResult;
    logger.info("[Pipeline] 使用并行维度分析结果");
  } else if (hasDimContent(validatedData.dimension_analysis)) {
    // 次选：评分调用中附带的
    dimensionAnalysis = validatedData.dimension_analysis;
    logger.info("[Pipeline] 使用评分调用中的 dimension_analysis");
  } else {
    qualityFlags.push("dimension_analysis_supplemented");
    // 兜底：补充调用（仅在两路都失败时触发）
    logger.warn("[Pipeline] dimension_analysis 两路均未获取，执行补充分析...");
    onProgress({ type: "progress", stage: "dim_analysis", percentage: 88, message: "正在生成维度详细分析..." });
    try {
      const dimInput = [
        `【项目信息】${extractedData.company_name || "未知公司"} — ${extractedData.industry || "未知赛道"}`,
        `\n\n【评分数据】\n${JSON.stringify(validatedData.validated_data, null, 2)}`,
        `\n\n【声明核查报告（top-15）】\n${JSON.stringify((claimVerdicts || []).slice(0, 15).map(v => ({ claim: v.original_claim || v.bp_claim, verdict: v.verdict, diff: v.diff })), null, 2)}`,
      ].join("");
      const dimRaw = await callLLM(DIMENSION_ANALYSIS_PROMPT, dimInput, 8000);
      const dimResult = extractJson(dimRaw);
      if (dimResult) {
        for (const key of dimKeys) {
          if (dimResult[key] && (dimResult[key].finding || dimResult[key].comprehensive_analysis)) {
            dimensionAnalysis[key] = dimResult[key];
          }
        }
        logger.info("[Pipeline] dimension_analysis 补充成功");
      }
    } catch (err) {
      logger.warn("[Pipeline] dimension_analysis 补充调用失败:", err.message);
    }
    if (Object.keys(dimensionAnalysis).length === 0) {
      qualityFlags.push("dimension_analysis_missing");
    }
  }

  const valuationComparison = buildValuationComparison(validatedData, extractedData, scoringInput, scoringResult, multiagent);
  const verdict = buildVerdictResponse(scoringResult, structuralResult, validatedData, dimensionAnalysis, valuationComparison);

  // 注入嫌疑 → 风险旗置顶，投资人必须看到"这份 BP 试图操纵 AI 分析"
  if (injectionHits.length > 0) {
    verdict.risk_flags = [
      `BP 文本疑似包含操纵 AI 分析的指令（prompt injection），本报告所有结论请人工复核：${injectionHits[0]}`,
      ...(verdict.risk_flags || []),
    ];
  }

  // 评分全降级 → "行动建议"必须收回，绝不能拿默认兜底分指导投资动作
  if (qualityFlags.includes("scoring_fallback_agent_a")) {
    verdict.grade_label = `${verdict.grade_label}（兜底估算，不可作为决策依据）`;
    verdict.grade_action =
      "本次评分模型多次调用失败，当前分数基于系统默认中性值估算，不具备投资参考价值。" +
      "请重新发起分析；若多次失败请联系管理员排查 LLM 服务。原行动建议已撤回。";
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  onProgress({ type: "progress", stage: "finalizing", percentage: 98, message: "报告生成完成，整理结果..." });

  // 生成报告标题（公司名 - 产品/行业）
  const companyName = extractedData.company_name || "";
  const productName = extractedData.product_name || "";
  const industry = extractedData.industry || "";
  const title = companyName
    ? (productName ? `${companyName} - ${productName}` : `${companyName} - ${industry}`)
    : null;

  // 行业分类（多标签）
  const industryCategories = classifyIndustryMulti(industry);
  const industryCategory = industryCategories[0]; // 主分类（兼容旧字段）

  // 项目所在地推断（从 BP 提取数据中获取）
  const projectLocation = extractedData.project_location || null;

  // ── 训练数据采集（后台静默执行，不影响主流程）──
  // 仅在拥有有效 taskId 时记录 bp_company_links（task_id 为 NOT NULL）
  try {
    const trackCompanyName = extractedData.company_name;
    if (trackCompanyName && trackCompanyName.trim()) {
      // 异步执行，不 await，不阻塞返回
      const trackingTask = (async () => {
        try {
          const entity = await trackingService.findOrCreateCompanyEntity(extractedData, taskId);
          if (taskId) {
            const totalScore = verdict?.total_score ?? scoringResult?.total_score ?? null;
            const dims = scoringResult?.dimensions || {};
            const dimScores = {
              s1: dims.timing_ceiling?.score ?? null,
              s2: dims.product_moat?.score ?? null,
              s3: dims.business_validation?.score ?? null,
              s4: dims.team?.score ?? null,
              s5: dims.external_risk?.score ?? null,
            };
            trackingService.linkBPToCompany(taskId, entity.id, totalScore, dimScores, null, null);
          }
          logger.info("训练数据采集完成", { companyId: entity.id, companyName: trackCompanyName });
        } catch (innerErr) {
          logger.warn("训练数据采集失败（不影响主流程）", { error: innerErr.message });
        }
      })();
      trackingTask.catch((err) => logger.warn("训练数据采集异步异常", { error: err.message }));
    }
  } catch (outerErr) {
    logger.warn("训练数据采集初始化异常", { error: outerErr.message });
  }

  // 数据飞轮：异步写入数据沉淀表（不阻塞报告返回）
  // isAnonymized 默认 1，未来可通过用户设置控制
  (async () => {
    try {
      dataLakeService.sinkAllAgentData({
        taskId,
        userId,
        multiagent,
        score: verdict?.total_score ?? null,
        isAnonymized: 1,
      });
      const crossMatchInsights = crossMatchService.runCrossMatch({
        taskId,
        multiagent,
        score: verdict?.total_score ?? null,
      });
      if (crossMatchInsights) {
        logger.info("[Pipeline] 交叉识别完成", { taskId, insights: crossMatchInsights });
      }
    } catch (err) {
      logger.warn("[Pipeline] 数据飞轮写入异常（不影响报告）:", err.message);
    }
  })();

  return {
    success: true,
    pipeline_version: PIPELINE_VERSION,
    // 评分审计三件套：本次实际使用的模型、live 分数依据、shadow 对照块。
    // scoring_shadow 落库是 harness 灰度校准的前提——没有新旧分对照数据，
    // SCORING_HARNESS 永远无法安全切到 on。
    model_id: getModelName(),
    scoring_basis: scoringResult.scoring_basis || "legacy",
    scoring_shadow: scoringResult.scoring_shadow || null,
    specialist_audit:
      scoringResult.specialist_audit || scoringResult.scoring_shadow?.specialist_audit || null,
    // 降级显式化：degraded=true 表示报告部分内容由兜底路径生成，
    // flags 枚举具体降级点（前端/管理端可据此提示用户或排查）
    quality: { degraded: qualityFlags.length > 0, flags: qualityFlags },
    elapsed_seconds: parseFloat(elapsed),
    extracted_data: extractedData,
    validated_data: scoringInput,
    industry: extractedData.industry,
    thinking,
    deep_research: deepResearch,
    verdict,
    multiagent,
    title,
    industry_category: industryCategory,
    industry_categories: industryCategories,
    project_location: projectLocation,
    search_summary: {
      enabled: true, mock: false, total_results: 0,
      queries_count: (extractedData.key_claims || []).length, provider: "kimi_web_search",
    },
  };
}

module.exports = {
  runPipeline,
  classifyIndustry,
  classifyIndustryMulti,
  // 导出供测试与复用（注入防线/降级文案/评分接地的回归测试依赖这些函数）
  wrapBpDocument,
  detectInjectionHints,
  buildIntegrityDimAnalysis,
  buildScoringSearchQueries,
  calculateScoring,
};
