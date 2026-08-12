// ============================================================
// server/services/pipelineService.js — 分析流水线服务
// 从 index.js 提取的核心 AI 分析逻辑
// ============================================================

const pLimit = require("p-limit");
const { callLLM, callLLMWithThinking, callLLMWithSearch, getModelName } = require("./llmService");
const { extractJson, extractJsonArray, extractPartialResult, ensureStringArray } = require("../utils/jsonParser");
const { scoreProject, analyzeIntegrity } = require("../scoring");
const { runWebSearch, formatSearchContext } = require("./webSearchService");
const logger = require("../utils/logger");
const trackingService = require("./trackingService");
const dataLakeService = require("./dataLakeService");
const crossMatchService = require("./crossMatchService");
const calibrationService = require("./calibrationService");
const { PIPELINE_VERSION } = require("../config/versions");
const config = require("../config");
const {
  AGENT_A_PROMPT,
  CLAIM_VERDICT_BATCH_PROMPT,
  buildStructuralPrompt,
  buildDimensionAnalysisPrompt,
  EXPERT_JUDGE_MINIMAL_PROMPT,
  DEEP_RESEARCH_PROMPT,
  DIMENSION_ANALYSIS_PROMPT,
} = require("../utils/prompts");

const MAX_CLAIMS_PER_BATCH = 6; // 每批最多6条声明，截断时按"已完成条数"做残片抢救+重试剩余
const MAX_CONCURRENT_BATCHES = 8; // 并发批次（M3 限流 RPM 200/TPM 10M，8 路仍有大量余量）
// 单路并行任务上限 11min：必须 > 单次 LLM 请求超时上限（calcTimeout 封顶 600s/10min），
// 否则放大 max_tokens 后的慢请求会被本壳子提前 kill，误判为失败。
const PARALLEL_TASK_TIMEOUT_MS = 11 * 60 * 1000;

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
    research_prompt:
      `请核验 ${company}（${industry}）BP 声明：“${claimText}”。` +
      "用公开网页检索可得的权威信源（官网/年报/交易所公告/监管与司法公开信息/权威行业报告/学术与专利公开库）；" +
      "本系统没有专业数据库直连，拿不到专业库口径时用用户材料/自身知识辅助，并明确标注缺口和置信度。",
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
        research_prompt: harness.research_prompt,
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
  return sorted.slice(0, 30).map(
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
      { maxTokens: 8000, taskHint: "claim_verdict" }
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

/**
 * 把一批核查的原始输出切成"已完成的 verdict"和"还没做完、需重试的 claim"。
 * M3 截断时 extractJsonArray 会修复并返回已完成的前 N 条 verdict（与输入
 * claim 顺序一致）；据此保留前 N 条、把剩余 (batch.length - N) 条留待重试，
 * 而不是整批丢弃——这是把核查失败率压到接近 0 的关键。
 * @returns {{ verdicts: object[], remaining: object[] }}
 */
function splitBatchVerdicts(raw, batch) {
  const parsed = extractJsonArray(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { verdicts: [], remaining: batch };
  }
  if (parsed.length >= batch.length) {
    return { verdicts: parsed.slice(0, batch.length), remaining: [] };
  }
  // 部分完成（截断）：保留已完成的，剩余 claim 留待重试
  return { verdicts: parsed, remaining: batch.slice(parsed.length) };
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
  // 外部证据，而不是纯模型记忆自我背书。优先服务端预检索注入，
  // 检索失败时 callLLMWithSearch 会降级为纯模型回答。
  const verifyBatch = async (batch, batchIdx) => {
    const sysPrompt = CLAIM_VERDICT_BATCH_PROMPT + "\n\n【重要】请严格只输出 JSON 数组，不要使用 markdown 代码块。";
    const userInput = `${bpContext}\n\n待核查声明批次 ${batchIdx + 1}/${batchCount}：\n${JSON.stringify(batch, null, 2)}`;
    const hasPriorityClaim = batch.some((c) =>
      ["critical", "high"].includes(String(c?.priority || "").toLowerCase())
    );
    if (!hasPriorityClaim) {
      return callLLM(sysPrompt, userInput, { maxTokens: 16000, taskHint: "claim_verdict" });
    }

    const preSearchQueries = batch
      .filter((c) => ["critical", "high"].includes(String(c?.priority || "").toLowerCase()))
      // 历史任务落库的字段名是 minimax_/kimi_research_prompt，回放老数据时要兼容
      .map((c) => c?.verification_harness?.research_prompt
        || c?.verification_harness?.minimax_research_prompt
        || c?.verification_harness?.kimi_research_prompt)
      .filter(Boolean)
      .slice(0, 3);
    return callLLMWithSearch(sysPrompt, userInput, {
      maxTokens: 16000, preSearchQueries, taskHint: "claim_verdict",
    }).then((r) => r.text);
  };

  // M8: 外层 try/catch 兜底 Promise.all 内部不可达异常（如 p-limit 自身错误）
  let batchOutcomes;
  try {
    batchOutcomes = await Promise.all(
      batches.map((batch, batchIdx) =>
        limit(() =>
          verifyBatch(batch, batchIdx)
            // 残片抢救：截断时保留已完成的前 N 条 verdict，剩余 claim 留待重试
            .then((raw) => ({ batchIdx, ...splitBatchVerdicts(raw, batch) }))
            .catch(() => ({ batchIdx, verdicts: [], remaining: batch }))
        )
      )
    );
  } catch (err) {
    logger.error("[B.1] 批量并发调度本身异常，全部降级为重试:", err.message);
    batchOutcomes = batches.map((batch, batchIdx) => ({ batchIdx, verdicts: [], remaining: batch }));
  }

  // 收集首轮已完成的 verdict，以及需要重试的剩余 claim（失败批次 + 截断残片）
  const allClaimVerdicts = [];
  const remainingClaims = [];
  for (const bo of batchOutcomes) {
    allClaimVerdicts.push(...bo.verdicts);
    for (const claim of bo.remaining) remainingClaims.push(claim);
  }

  // Phase 1.5: 重试剩余 claim — 重新分批整体重试（大预算）→ 残片抢救 → 逐条降级
  if (remainingClaims.length > 0) {
    logger.warn(`[B.1] ${remainingClaims.length} 条声明首轮未完成（失败/截断），启动重试...`);
    onProgress({ type: "progress", stage: "claim_verify", percentage: 50, message: `${remainingClaims.length} 条声明核查未完成，重试中...` });

    const retryBatches = [];
    for (let i = 0; i < remainingClaims.length; i += MAX_CLAIMS_PER_BATCH) {
      retryBatches.push(remainingClaims.slice(i, i + MAX_CLAIMS_PER_BATCH));
    }

    for (const rb of retryBatches) {
      let got = [];
      try {
        const retryRaw = await callLLM(
          CLAIM_VERDICT_BATCH_PROMPT + "\n\n【紧急提醒】请严格只输出 JSON 数组，不要输出任何其他内容。",
          `${bpContext}\n\n待核查声明（重试）：\n${JSON.stringify(rb, null, 2)}`,
          { maxTokens: 16000, taskHint: "claim_verdict" }
        );
        got = splitBatchVerdicts(retryRaw, rb).verdicts;
      } catch (err) {
        logger.warn(`[B.1] 剩余声明整体重试失败: ${err.message}`);
      }
      allClaimVerdicts.push(...got);
      // 重试后仍缺的，逐条降级核查（保证每条 claim 都有结论）
      for (const claim of rb.slice(got.length)) {
        allClaimVerdicts.push(await verifySingleClaim(claim, bpContext, "重试剩余"));
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
    `\n\n【BP原文${bpText.length > config.bpScoringContextMaxChars ? `节选（前${config.bpScoringContextMaxChars}字）` : "全文"}】\n${wrapBpDocument(bpText.slice(0, config.bpScoringContextMaxChars))}`,
    scoringEvidence,
  ].join("");

  // 深度研究使用更多原文
  const earlyDeepResearchInput = [
    `【商业计划书原文${bpText.length > config.bpDeepResearchMaxChars ? `节选（前${config.bpDeepResearchMaxChars}字）` : "全文"}】\n${wrapBpDocument(bpText.slice(0, config.bpDeepResearchMaxChars))}`,
    `\n\n【项目基本信息】\n公司：${extractedData.company_name || "未知"}，赛道：${extractedData.industry || "未知"}`,
    `\n\n【声明核查结果】\n${JSON.stringify(compressedVerdicts, null, 2)}`,
    `\n\n【BP提取数据】\n${JSON.stringify(extractedData, null, 2)}`,
  ].join("");

  onProgress({ type: "progress", stage: "report_parallel", percentage: 58, message: "三路并行：评分数据 + 五维深度分析 + 深度研究报告..." });

  const settled = await Promise.allSettled([
    withTaskTimeout((async () => {
      // 层1: DeepThink（评分数据输出小，12000 足够）
      const judgeResult = await callLLMWithThinking(
        scoringPrompt, structuralInput, 12000, 5000, { taskHint: "scoring_judge" }
      );
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
        const retry1Raw = await callLLM(
          scoringPrompt + "\n\n【紧急提醒】只输出 JSON 对象，不要 markdown 代码块。",
          structuralInput,
          { maxTokens: 8192, taskHint: "scoring_judge" }
        );
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
          `\n\n【声明核查报告（top-25）】\n${JSON.stringify(compressedVerdicts.slice(0, 25), null, 2)}`,
        ].join("");
        const retry2Raw = await callLLM(
          EXPERT_JUDGE_MINIMAL_PROMPT, minimalInput,
          { maxTokens: 4096, taskHint: "scoring_judge" }
        );
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
        const dimRaw = await callLLM(
          dimAnalysisPrompt, structuralInput,
          { maxTokens: 16000, taskHint: "dimension_analysis" }
        );
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
        const dimRaw2 = await callLLM(
          dimAnalysisPrompt + "\n\n【紧急提醒】只输出 JSON 对象，不要 markdown 代码块，只要 dimension_analysis 字段。",
          structuralInput,
          { maxTokens: 16000, taskHint: "dimension_analysis" }
        );
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

    // Task C: 深度研究报告（启用 web_search 工具走博查检索，失败自动降级；并加 8min 任务级超时）
    withTaskTimeout((async () => {
      try {
        const { text, searchUsed } = await callLLMWithSearch(
          DEEP_RESEARCH_PROMPT,
          earlyDeepResearchInput,
          { maxTokens: 16000, taskHint: "deep_research" }
        );
        if (searchUsed) logger.info("[B.deep] 深度研究已使用 web_search 增强");
        return text;
      } catch (e) {
        logger.warn("[B.deep] web_search 调用失败，降级普通模式:", e.message);
        return await callLLM(
          DEEP_RESEARCH_PROMPT, earlyDeepResearchInput,
          { maxTokens: 16000, taskHint: "deep_research" }
        );
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

const _STAGE_LABEL = { early: "早期", growth: "成长期", mature: "成熟期" };

/**
 * 基于声明核查结果生成诚信度维度的分析摘要（纯 JS，不依赖 LLM）
 * v5：呈现核查覆盖率 + 项目阶段 + 分层否决，并把"存疑系知识盲区不扣分"说清楚。
 * @param {Array} claimVerdicts
 * @param {object} [data] 评分输入（validated_data），用于派生项目阶段
 * @returns {{ finding, comprehensive_analysis, score_rationale, risk_factors, positive_signals }}
 */
function buildIntegrityDimAnalysis(claimVerdicts, data = {}) {
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

  const ana = analyzeIntegrity(claimVerdicts, { data });
  const stageLabel = _STAGE_LABEL[ana.stage] || "早期";
  const coveragePct = Math.round(ana.coverage * 100);
  const unverifiable = total - ana.verifiable;

  const honestCount = (counts["诚实"] || 0) + (counts["保守低估"] || 0);
  const exaggeratedCount = (counts["夸大"] || 0) + (counts["严重夸大"] || 0);
  const falseCount = counts["证伪"] || 0;

  const finding = `共核查 ${total} 条声明：${parts}。`;
  const honestPct = ana.verifiable > 0 ? Math.round((honestCount / ana.verifiable) * 100) : 0;

  const riskFactors = [];
  const positiveSignals = [];

  if (exaggeratedCount > 0) riskFactors.push(`${exaggeratedCount} 条声明存在夸大（已按项目阶段【${stageLabel}】计权）`);
  if (falseCount > 0) riskFactors.push(`${falseCount} 条声明被证伪`);
  if (counts["信息不对称"] > 0) riskFactors.push(`${counts["信息不对称"]} 条声明涉嫌信息不对称`);
  // 尽调红旗：前瞻预测/无独立证据的重大夸大（需追问验证，不扣分）
  for (const f of ana.dd_flags) riskFactors.push(f);

  if (honestCount > 0) positiveSignals.push(`可核实声明中 ${honestCount} 条（${honestPct}%）经核查属实或保守`);
  positiveSignals.push(`核查覆盖率 ${ana.verifiable}/${total}（${coveragePct}%）；其余 ${unverifiable} 条为存疑/无法核实，系知识盲区，不计入诚信扣分`);
  if (exaggeratedCount === 0 && falseCount === 0) {
    positiveSignals.push("可核实声明中未发现夸大或造假迹象");
  }

  return {
    finding,
    comprehensive_analysis: `${finding} 项目阶段判定为【${stageLabel}】，夸大类按该阶段计权。诚信仅就可核实声明评判：可核实 ${ana.verifiable} 条（覆盖率 ${coveragePct}%），其中诚实/保守 ${honestCount} 条。其余 ${unverifiable} 条为存疑/无法核实，系 LLM 知识库覆盖不足，已不计入诚信扣分、仅降低核查覆盖率与置信度。`,
    score_rationale: `诚信仅在可核实声明上计分（存疑/无独立证据剔除，只降覆盖率）：诚实/保守=10、信息不对称=2、证伪=0；夸大/严重夸大按项目阶段计权（成熟 8/5、成长 6/3、早期 4/2）。先按重大（财务/估值/合规）70% + 一般 30% 分组加权，再按核查覆盖率向中性 60 折让（覆盖率≥60% 给满置信）。证伪/严重夸大只按计分表拉低 S5，不再触发一票否决或强制改评级；前瞻预测与无独立证据的判断仅列尽调红旗。`,
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
    external_risk: buildIntegrityDimAnalysis(
      validatedData.claim_verdicts || [],
      { ...(validatedData.validated_data || {}), claim_verdicts: validatedData.claim_verdicts || [] }
    ),
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
    // Integrity Veto 已于 v4.8.0 移除；以下两字段恒为 null，保留供 DB 列/
    // 校准表（migration 064）向后兼容，不再有任何触发路径。
    integrity_veto: scoringResult.integrity_veto || null,
    grade_overridden_from: scoringResult.grade_overridden_from || null,
    verdict_summary: structuralResult?.one_line_summary || scoringResult.grade_label,
    dimensions,
    risk_flags: ensureStringArray(validatedData.risk_flags),
    strengths: ensureStringArray(validatedData.strengths),
    conflicts: validatedData.conflicts || [],
    claim_verdicts: validatedData.claim_verdicts || [],
    valuation_comparison: valuationComparison,
    // 判断卡 v3（SCORING_AGG=on 时生效；shadow/off 时为 null，UI 自动隐藏）：
    // 总分分布、政策契合度 readout、敏感性、触发规则、聚合元信息
    total_distribution: scoringResult.total_distribution || null,
    policy_fit: scoringResult.policy_fit || null,
    sensitivity: scoringResult.sensitivity || null,
    triggered_rules: scoringResult.triggered_rules || null,
    aggregation: scoringResult.aggregation || null,
  };
}

/**
 * Step 1: 提取 BP 关键数据
 */
async function extractBPData(bpText, onProgress) {
  // DeepSeek V4 是 1M token 上下文，30000 字是 MiniMax 时代的历史包袱。
  // 这是全局天花板：超出部分对整条流水线永久不可见。
  const maxChars = config.bpExtractionMaxChars;
  const truncatedText = bpText.length > maxChars
    ? bpText.slice(0, maxChars) + "\n...(文本已截断，共" + bpText.length + "字符)"
    : bpText;

  onProgress({ type: "progress", stage: "data_extract", percentage: 12, message: "正在提取BP关键声明（step 1/2）..." });

  let extractionRaw = await callLLM(
    AGENT_A_PROMPT,
    `以下是商业计划书全文（共 ${truncatedText.length} 字符）：\n\n${wrapBpDocument(truncatedText)}`,
    { maxTokens: 8192, taskHint: "bp_extraction" }
  );
  let extractedData = extractJson(extractionRaw);

  // 重试机制
  if (!extractedData || !extractedData.key_claims) {
    onProgress({ type: "progress", stage: "data_extract_retry", percentage: 18, message: "数据提取重试中..." });
    const retryPrompt = AGENT_A_PROMPT + "\n\n【紧急提醒】只输出 JSON 对象。";
    extractionRaw = await callLLM(
      retryPrompt,
      `以下是商业计划书全文：\n\n${wrapBpDocument(truncatedText)}`,
      { maxTokens: 8192, taskHint: "bp_extraction" }
    );
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
// industryCategory：用于聚合层的政策融入（无显式 Policy_Rubric.tier 时据赛道大类派生）
function _toScoringInput(d, claimVerdicts, industryCategory = null) {
  return {
    TAM_Million_RMB: d.TAM_Million_RMB ?? d.TAM ?? 0,
    CAGR: d.CAGR ?? 0,
    Company_Revenue_Growth_YoY: d.Company_Revenue_Growth_YoY,
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
    // S3 harness 输入（此前被本映射函数漏传 → harness 在生产中拿不到结构化输入）
    S3_Rubric: d.S3_Rubric,
    Capital_Archetype: d.Capital_Archetype,
    Scale_Mechanism: d.Scale_Mechanism,
    // 政策融入 S1/S3 的输入（聚合层用）；Policy_Rubric 由证据层产出（可缺）
    Policy_Rubric: d.Policy_Rubric,
    industry_category: industryCategory,
  };
}

function calculateScoring(validatedData, claimVerdicts, onProgress, industryCategory = null) {
  onProgress({ type: "progress", stage: "ai_done", percentage: 82, message: "AI研究完成，计算五维评分..." });

  const rawScoringData = validatedData.validated_data || {};

  // v4.8.0 起 multiagent 专家证据不再喂评分（深度尽调改为按需生成，见 multiagentService）。
  // live 走纯 legacy（S2 harness force off 避免嵌套 shadow）；S3/聚合 shadow 由
  // scoreProject 内部按全局开关自行附挂，与此处无关。
  const scoringInput = _toScoringInput(rawScoringData, claimVerdicts || [], industryCategory);
  const scoringResult = scoreProject(scoringInput, { modeOverride: "off" });

  onProgress({ type: "progress", stage: "scoring", percentage: 86, message: `评分完成（${scoringResult.total_score}分 / ${scoringResult.grade}），生成报告...` });

  return { scoringInput, scoringResult };
}


/**
 * Step 3: 构建估值对比数据
 */
function buildValuationComparison(validatedData, extractedData, scoringResult) {
  let valuationComparison = validatedData.valuation_comparison;

  // v4.8.0 起 ValuationAgent（估值温度计/可比公司）不再随主流水线生成，
  // 估值对比退回 BP 自述倍数兜底；专家估值改由按需深度尽调单独呈现。
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

  // Step 2: Agent B（声明核查 + 评分 + 五维深度分析 + 深度研究）
  // 注：6 个 Multiagent 深度尽调 Agent 已从分析流水线中摘出，改为用户在工作区
  // 按需触发（见 multiagentService）。分析阶段不再自动跑，投研结论也不再喂评分。
  onProgress({ type: "progress", stage: "agent_b_start", percentage: 32, message: "Agent B 启动（3批并发核查）..." });

  const agentBResult = await runAgentBWithBatchingAndResearch(extractedData, truncatedText, onProgress);

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
  // multiagent 已改为按需生成，分析阶段不参与，不再因其缺席标记降级
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
  // 赛道大类（聚合层政策融入按此派生政策档位；显式 Policy_Rubric.tier 优先）
  const primaryIndustryCategory = classifyIndustryMulti(extractedData.industry)[0];
  const { scoringInput, scoringResult } = calculateScoring(
    validatedData, claimVerdicts, onProgress, primaryIndustryCategory
  );

  // 所见即所评：报告展示的声明核查列表与实际计入 S5 的声明集保持一致。
  // multiagent 专家证据已解耦，不再注入 live 评分。
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
        `\n\n【声明核查报告（top-30）】\n${JSON.stringify((claimVerdicts || []).slice(0, 30).map(v => ({ claim: v.original_claim || v.bp_claim, verdict: v.verdict, diff: v.diff })), null, 2)}`,
      ].join("");
      const dimRaw = await callLLM(
        DIMENSION_ANALYSIS_PROMPT, dimInput,
        { maxTokens: 12000, taskHint: "dimension_analysis" }
      );
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

  const valuationComparison = buildValuationComparison(validatedData, extractedData, scoringResult);
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
        multiagent: null,
        score: verdict?.total_score ?? null,
        isAnonymized: 1,
      });
      const crossMatchInsights = crossMatchService.runCrossMatch({
        taskId,
        multiagent: null,
        score: verdict?.total_score ?? null,
      });
      if (crossMatchInsights) {
        logger.info("[Pipeline] 交叉识别完成", { taskId, insights: crossMatchInsights });
      }
      // 诊断式校准：归档 judgment 快照（供 GP 事后标注 + 回测；不阻塞、不回写内核）
      calibrationService.recordJudgment({
        taskId,
        projectName: title,
        industryCategory: primaryIndustryCategory,
        pipelineVersion: PIPELINE_VERSION,
        verdict,
        scoringResult,
      });
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
    // multiagent 深度尽调改为按需生成，不再随分析结果一起返回（见 multiagentService）
    title,
    industry_category: industryCategory,
    industry_categories: industryCategories,
    project_location: projectLocation,
    search_summary: {
      enabled: true, mock: false, total_results: 0,
      queries_count: (extractedData.key_claims || []).length, provider: "bocha_web_search",
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
