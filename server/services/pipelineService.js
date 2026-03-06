// ============================================================
// server/services/pipelineService.js — 分析流水线服务
// 从 index.js 提取的核心 AI 分析逻辑
// ============================================================

const { callLLM, callLLMWithThinking } = require("./llmService");
const { extractJson, extractJsonArray } = require("../utils/jsonParser");
const { scoreProject } = require("../scoring");
const logger = require("../utils/logger");
const {
  AGENT_A_PROMPT,
  CLAIM_VERDICT_BATCH_PROMPT,
  buildStructuralPrompt,
  EXPERT_JUDGE_MINIMAL_PROMPT,
  DEEP_RESEARCH_PROMPT,
} = require("../utils/prompts");

const MAX_CONCURRENT_BATCHES = 3; // 将声明分为最多3个并发批次

/** 行业大类映射 — 通过关键词匹配将细分行业归类到统计大类 */
const INDUSTRY_CATEGORIES = [
  { category: "人工智能", keywords: ["AI", "人工智能", "机器学习", "深度学习", "NLP", "自然语言", "计算机视觉", "大模型", "LLM", "GPT", "智能"] },
  { category: "新能源", keywords: ["新能源", "光伏", "储能", "锂电", "氢能", "风电", "电池", "充电", "碳中和", "清洁能源", "eVTOL", "电动"] },
  { category: "生物医药", keywords: ["生物", "医药", "医疗", "基因", "制药", "临床", "诊断", "创新药", "医疗器械", "健康"] },
  { category: "先进制造", keywords: ["制造", "半导体", "芯片", "机器人", "自动化", "工业", "材料", "3D打印", "精密", "航空航天"] },
  { category: "企业服务/SaaS", keywords: ["SaaS", "企业服务", "B2B", "云计算", "ERP", "CRM", "协同", "办公", "数据服务", "PaaS"] },
  { category: "消费/零售", keywords: ["消费", "零售", "电商", "品牌", "餐饮", "食品", "快消", "DTC", "新零售"] },
  { category: "金融科技", keywords: ["金融", "支付", "保险", "银行", "区块链", "数字货币", "信贷", "风控", "FinTech"] },
];

function classifyIndustry(industryStr) {
  if (!industryStr) return "其他";
  const upper = industryStr.toUpperCase();
  for (const { category, keywords } of INDUSTRY_CATEGORIES) {
    for (const kw of keywords) {
      if (upper.includes(kw.toUpperCase())) return category;
    }
  }
  return "其他";
}

/** 压缩声明核查结果 */
function compressVerdicts(verdicts) {
  if (!Array.isArray(verdicts)) return [];
  const severityOrder = { "严重": 0, "高": 0, "中": 1, "低": 2 };
  const sorted = [...verdicts].sort(
    (a, b) => (severityOrder[a.severity] ?? 1) - (severityOrder[b.severity] ?? 1)
  );
  return sorted.slice(0, 15).map(
    ({ category, original_claim, verdict, diff, severity, score_impact }) => ({
      category, original_claim, verdict, diff, severity, score_impact,
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

  // Phase 1: 微观声明核查 — 平均分成最多 3 个并发批次
  const batches = [];
  const batchSize = Math.ceil(claims.length / MAX_CONCURRENT_BATCHES);
  for (let i = 0; i < claims.length; i += batchSize) {
    batches.push(claims.slice(i, i + batchSize));
  }

  const batchCount = batches.length;
  logger.info("[B.1] 声明核查启动", { claimCount: claims.length, batchCount });
  onProgress({ type: "progress", stage: "claim_verify", percentage: 35, message: `核查 ${claims.length} 条关键声明（${batchCount} 批并发）...` });

  const bpContext = `请对处于 ${extractedData.industry || "未知"} 赛道的 ${extractedData.company_name || "未知公司"} 进行核查。产品：${extractedData.product_name || "未知"}。`;

  const batchResults = await Promise.all(
    batches.map((batch, batchIdx) =>
      callLLM(
        CLAIM_VERDICT_BATCH_PROMPT + "\n\n【重要】请严格只输出 JSON 数组。",
        `${bpContext}\n\n待核查声明批次 ${batchIdx + 1}/${batchCount}：\n${JSON.stringify(batch, null, 2)}`,
        8192
      ).then((raw) => {
        const parsed = extractJsonArray(raw);
        if (!parsed) {
          return { failed: true, batch, batchIdx };
        }
        return { failed: false, results: parsed };
      }).catch(() => {
        return { failed: true, batch, batchIdx };
      })
    )
  );

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

  // Phase 2: 并行执行 结构化打分 + 深度研究报告
  const compressedVerdicts = compressVerdicts(allClaimVerdicts);
  const dynamicPrompt = buildStructuralPrompt(extractedData);

  const structuralInput = [
    `【BP提取数据（原始）】\n${JSON.stringify(extractedData, null, 2)}`,
    `\n\n【微观声明核查报告】\n${JSON.stringify(compressedVerdicts, null, 2)}`,
    `\n\n【BP原文节选（前3000字）】\n${bpText.slice(0, 3000)}`,
  ].join("");

  // 深度研究所需输入（基于已有数据，不依赖结构化评分结果）
  const earlyDeepResearchInput = [
    `【商业计划书原文节选（前12000字）】\n${bpText.slice(0, 12000)}`,
    `\n\n【项目基本信息】\n公司：${extractedData.company_name || "未知"}，赛道：${extractedData.industry || "未知"}`,
    `\n\n【声明核查结果】\n${JSON.stringify(compressedVerdicts, null, 2)}`,
    `\n\n【BP提取数据】\n${JSON.stringify(extractedData, null, 2)}`,
  ].join("");

  // 并行执行：结构化评分（DeepThink）+ 深度研究
  const [structuralOutcome, deepResearch] = await Promise.all([
    // Task A: 结构化评分
    (async () => {
      // 层1: DeepThink
      const judgeResult = await callLLMWithThinking(dynamicPrompt, structuralInput, 20000, 3000);
      let result = extractJson(judgeResult.text);

      // 层2: 普通模式
      if (!result || !result.validated_data) {
        logger.warn("[B.2] 首次解析失败，重试层2...");
        onProgress({ type: "progress", stage: "scoring_retry", percentage: 74, message: "评分结果解析失败，重试中..." });
        const retry1Raw = await callLLM(dynamicPrompt + "\n\n【紧急提醒】只输出 JSON 对象。", structuralInput, 20000);
        result = extractJson(retry1Raw);
      }

      // 层3: 精简模式
      if (!result || !result.validated_data) {
        logger.warn("[B.2] 重试层2仍失败，启用兜底层3...");
        onProgress({ type: "progress", stage: "scoring_retry2", percentage: 78, message: "启用精简模式重试..." });
        const minimalInput = [
          `【BP提取数据】\n${JSON.stringify(extractedData, null, 2)}`,
          `\n\n【声明核查报告（top-10）】\n${JSON.stringify(compressedVerdicts.slice(0, 10), null, 2)}`,
        ].join("");
        const retry2Raw = await callLLM(EXPERT_JUDGE_MINIMAL_PROMPT, minimalInput, 8192);
        result = extractJson(retry2Raw);
      }

      return { structuralResult: result, thinking: judgeResult.thinking || "" };
    })(),
    // Task B: 深度研究（与评分并行）
    (async () => {
      onProgress({ type: "progress", stage: "report_parallel", percentage: 60, message: "深度研究报告生成中（与评分并行）..." });
      return await callLLM(DEEP_RESEARCH_PROMPT, earlyDeepResearchInput, 8192);
    })(),
  ]);

  onProgress({ type: "progress", stage: "parallel_done", percentage: 82, message: "评分与深度研究均已完成..." });

  return {
    claimVerdicts: allClaimVerdicts,
    structuralResult: structuralOutcome.structuralResult,
    thinking: structuralOutcome.thinking,
    deepResearch,
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
    // Enriched dimension data
    bp_key_points: expertDim.bp_key_points || [],
    ai_research_findings: expertDim.ai_research_findings || [],
    comprehensive_analysis: expertDim.comprehensive_analysis || "",
    score_rationale: expertDim.score_rationale || "",
    risk_factors: expertDim.risk_factors || [],
    positive_signals: expertDim.positive_signals || [],
  };
  if (key === "external_risk") {
    base.multiplier = dimResult.multiplier;
  }
  return base;
}

/** 构建完整的 verdict 响应对象 */
function buildVerdictResponse(scoringResult, structuralResult, validatedData, dimensionAnalysis, valuationComparison) {
  const dimensionKeys = ["timing_ceiling", "product_moat", "business_validation", "team", "external_risk"];
  const dimensions = {};
  for (const key of dimensionKeys) {
    dimensions[key] = buildDimension(key, scoringResult, dimensionAnalysis);
  }

  return {
    total_score: scoringResult.total_score,
    grade: scoringResult.grade,
    grade_label: scoringResult.grade_label,
    grade_action: scoringResult.grade_action,
    grade_color: scoringResult.grade_color,
    verdict_summary: structuralResult?.one_line_summary || scoringResult.grade_label,
    dimensions,
    risk_flags: validatedData.risk_flags || [],
    strengths: validatedData.strengths || [],
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
    `以下是商业计划书全文（共 ${truncatedText.length} 字符）：\n\n${truncatedText}`,
    8192
  );
  let extractedData = extractJson(extractionRaw);

  // 重试机制
  if (!extractedData || !extractedData.key_claims) {
    onProgress({ type: "progress", stage: "data_extract_retry", percentage: 18, message: "数据提取重试中..." });
    const retryPrompt = AGENT_A_PROMPT + "\n\n【紧急提醒】只输出 JSON 对象。";
    extractionRaw = await callLLM(retryPrompt, `以下是商业计划书全文：\n\n${truncatedText}`, 8192);
    extractedData = extractJson(extractionRaw);
  }

  if (!extractedData) throw new Error("AI 数据提取失败，请重新分析");

  // 兼容旧格式
  if (!extractedData.key_claims && extractedData.search_queries) {
    extractedData.key_claims = extractedData.search_queries.map((q) => ({
      category: q.dimension || "other", claim: q.query || "", source_in_bp: "BP中",
    }));
  }

  const claimCount = (extractedData.key_claims || []).length;
  onProgress({ type: "progress", stage: "data_done", percentage: 28, message: `数据提取完成，共 ${claimCount} 条声明，启动AI研究...` });

  return { extractedData, truncatedText };
}

/**
 * Step 2: 计算评分
 */
function calculateScoring(validatedData, onProgress) {
  onProgress({ type: "progress", stage: "ai_done", percentage: 82, message: "AI研究完成，计算五维评分..." });

  const rawScoringData = validatedData.validated_data || {};
  const scoringInput = {
    TAM_Million_RMB: rawScoringData.TAM_Million_RMB ?? rawScoringData.TAM ?? 0,
    CAGR: rawScoringData.CAGR ?? 0,
    TRL: rawScoringData.TRL ?? 5,
    Competitor_Rank_Score: rawScoringData.Competitor_Rank_Score ?? 5,
    Industry_Capital_Score: rawScoringData.Industry_Capital_Score ?? 5,
    Industry_Scale_Score: rawScoringData.Industry_Scale_Score ?? 5,
    Founder_Exp_Years: rawScoringData.Founder_Exp_Years ?? 3,
    Team_Experience_Score: rawScoringData.Team_Experience_Score,
    Team_Domain_Match_Score: rawScoringData.Team_Domain_Match_Score,
    Team_Completeness_Score: rawScoringData.Team_Completeness_Score,
    Team_Track_Record_Score: rawScoringData.Team_Track_Record_Score,
    Team_Education_Score: rawScoringData.Team_Education_Score,
    Policy_Risk: rawScoringData.Policy_Risk ?? 1,
    Valuation_Gap: rawScoringData.Valuation_Gap ?? 1.0,
  };
  const scoringResult = scoreProject(scoringInput);

  onProgress({ type: "progress", stage: "scoring", percentage: 86, message: `评分完成（${scoringResult.total_score}分 / ${scoringResult.grade}），生成报告...` });

  return { scoringInput, scoringResult };
}

/**
 * Step 3: 构建估值对比数据
 */
function buildValuationComparison(validatedData, extractedData, scoringInput, scoringResult) {
  let valuationComparison = validatedData.valuation_comparison;

  if (!valuationComparison || !valuationComparison.bp_multiple) {
    const bpValuation = extractedData.BP_Valuation || 0;
    const bpRevenue = extractedData.BP_Revenue || 0;
    const bpMultiple = (bpValuation && bpRevenue) ? Math.round(bpValuation / bpRevenue) : 0;
    valuationComparison = {
      bp_multiple: bpMultiple,
      industry_avg_multiple: 0,
      overvalued_pct: scoringInput.Valuation_Gap ? Math.round((scoringInput.Valuation_Gap - 1) * 100) : 0,
      industry_name: extractedData.industry || "",
      data_source: "MiniMax AI 知识库分析",
      analysis: scoringResult.grade_action,
    };
  }

  return valuationComparison;
}

/**
 * 完整分析流水线（后台执行）
 * 优化：声明核查3批并发 + 深度研究与结构化评分并行
 */
async function runPipeline(bpText, onProgress) {
  const startTime = Date.now();

  onProgress({ type: "progress", stage: "pdf_done", percentage: 8, message: "文档解析完成，准备分析..." });

  // Step 1: 数据提取
  const { extractedData, truncatedText } = await extractBPData(bpText, onProgress);

  // Step 2: 声明核查（3批并发）
  onProgress({ type: "progress", stage: "agent_b_start", percentage: 32, message: "Agent B 启动（3批并发核查）..." });
  const { claimVerdicts, structuralResult, thinking, deepResearch } =
    await runAgentBWithBatchingAndResearch(extractedData, truncatedText, onProgress);

  if (!structuralResult || !structuralResult.validated_data) {
    throw new Error("AI 专家评分失败，请重试");
  }

  const validatedData = { ...structuralResult, claim_verdicts: claimVerdicts };

  // Step 3: 评分计算（CPU，瞬间完成）
  const { scoringInput, scoringResult } = calculateScoring(validatedData, onProgress);

  // Step 4: 构建维度数据和估值对比
  const dimensionAnalysis = validatedData.dimension_analysis || {};
  const valuationComparison = buildValuationComparison(validatedData, extractedData, scoringInput, scoringResult);
  const verdict = buildVerdictResponse(scoringResult, structuralResult, validatedData, dimensionAnalysis, valuationComparison);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  onProgress({ type: "progress", stage: "finalizing", percentage: 98, message: "报告生成完成，整理结果..." });

  // 生成报告标题（公司名 - 产品/行业）
  const companyName = extractedData.company_name || "";
  const productName = extractedData.product_name || "";
  const industry = extractedData.industry || "";
  const title = companyName
    ? (productName ? `${companyName} - ${productName}` : `${companyName} - ${industry}`)
    : null;

  // 行业分类
  const industryCategory = classifyIndustry(industry);

  return {
    success: true,
    elapsed_seconds: parseFloat(elapsed),
    extracted_data: extractedData,
    validated_data: scoringInput,
    industry: extractedData.industry,
    thinking,
    deep_research: deepResearch,
    verdict,
    title,
    industry_category: industryCategory,
    search_summary: {
      enabled: true, mock: false, total_results: 0,
      queries_count: (extractedData.key_claims || []).length, provider: "minimax_builtin_knowledge",
    },
  };
}

module.exports = { runPipeline, classifyIndustry };
