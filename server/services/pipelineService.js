// ============================================================
// server/services/pipelineService.js — 分析流水线服务
// 从 index.js 提取的核心 AI 分析逻辑
// ============================================================

const pLimit = require("p-limit");
const { callLLM, callLLMWithThinking } = require("./llmService");
const { extractJson, extractJsonArray, extractPartialResult, ensureStringArray } = require("../utils/jsonParser");
const { scoreProject } = require("../scoring");
const logger = require("../utils/logger");
const trackingService = require("./trackingService");
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
  const batchResults = await Promise.all(
    batches.map((batch, batchIdx) =>
      limit(() =>
        callLLM(
          CLAIM_VERDICT_BATCH_PROMPT + "\n\n【重要】请严格只输出 JSON 数组，不要使用 markdown 代码块。",
          `${bpContext}\n\n待核查声明批次 ${batchIdx + 1}/${batchCount}：\n${JSON.stringify(batch, null, 2)}`,
          6144
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

  // Phase 2: 三路并行：评分数据（小输出） + 五维深度分析（专注大输出） + 深度研究报告
  const compressedVerdicts = compressVerdicts(allClaimVerdicts);
  const scoringPrompt = buildStructuralPrompt(extractedData);
  const dimAnalysisPrompt = buildDimensionAnalysisPrompt(extractedData);

  // 评分和维度分析共用同一组输入
  const structuralInput = [
    `【BP提取数据（原始）】\n${JSON.stringify(extractedData, null, 2)}`,
    `\n\n【微观声明核查报告】\n${JSON.stringify(compressedVerdicts, null, 2)}`,
    `\n\n【BP原文节选（前3000字）】\n${bpText.slice(0, 3000)}`,
  ].join("");

  // 深度研究使用更多原文
  const earlyDeepResearchInput = [
    `【商业计划书原文节选（前12000字）】\n${bpText.slice(0, 12000)}`,
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

    // Task C: 深度研究报告（token 上限提升至 16000）
    withTaskTimeout((async () => {
      return await callLLM(DEEP_RESEARCH_PROMPT, earlyDeepResearchInput, 16000);
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
      comprehensive_analysis: "暂无声明核查数据，诚信度取默认及格分。",
      score_rationale: "无核查数据，取中性默认分 60",
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
  if (honestCount > 0) positiveSignals.push(`${honestCount} 条声明（${honestPct}%）经核查属实或保守`);
  if (dishonestPct === 0) positiveSignals.push("未发现明显夸大或造假迹象");

  return {
    finding,
    comprehensive_analysis: `${finding} 诚实/保守声明占比 ${honestPct}%，存在问题声明占比 ${dishonestPct}%。存疑声明为 LLM 知识库覆盖不足所致，不代表项目问题。`,
    score_rationale: `按 verdict 加权均值计算：诚实/保守=10分，存疑=6分，夸大=3分，信息不对称=2分，严重夸大=1分，证伪=0分`,
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
 * @param {object} validatedData - LLM 结构化输出（含 validated_data）
 * @param {Array}  claimVerdicts - Agent B 声明核查结果数组（用于 S5 诚信度计算）
 */
function calculateScoring(validatedData, claimVerdicts, onProgress) {
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
    // S5 诚信度：直接传入声明核查结果，JS 端纯计算，不依赖 LLM 输出 Policy_Risk / Valuation_Gap
    claim_verdicts: claimVerdicts || [],
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
async function runPipeline(bpText, onProgress, taskId = null) {
  const startTime = Date.now();

  onProgress({ type: "progress", stage: "pdf_done", percentage: 8, message: "文档解析完成，准备分析..." });

  // Step 1: 数据提取
  const { extractedData, truncatedText } = await extractBPData(bpText, onProgress);

  // Step 2: 声明核查（3批并发）+ 评分数据 + 五维深度分析 + 深度研究（三路并行）
  onProgress({ type: "progress", stage: "agent_b_start", percentage: 32, message: "Agent B 启动（3批并发核查）..." });
  const { claimVerdicts, structuralResult, thinking, dimensionAnalysisResult, deepResearch } =
    await runAgentBWithBatchingAndResearch(extractedData, truncatedText, onProgress);

  // Agent A 数据兜底：如果结构化评分 3 层 + 抢救全部失败，用 Agent A 提取的数据直接评分
  let validatedData;
  if (!structuralResult || !structuralResult.validated_data) {
    logger.warn("[Pipeline] 结构化评分全部失败，启用 Agent A 数据兜底");
    onProgress({ type: "progress", stage: "scoring_fallback", percentage: 86, message: "正在整合分析数据..." });
    validatedData = {
      validated_data: {
        TAM_Million_RMB: extractedData.TAM_Million_RMB ?? 0,
        CAGR: extractedData.CAGR ?? 0,
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
  }

  // Step 3: 评分计算（CPU，瞬间完成）
  const { scoringInput, scoringResult } = calculateScoring(validatedData, claimVerdicts, onProgress);

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
  }

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
    industry_categories: industryCategories,
    project_location: projectLocation,
    search_summary: {
      enabled: true, mock: false, total_results: 0,
      queries_count: (extractedData.key_claims || []).length, provider: "minimax_builtin_knowledge",
    },
  };
}

module.exports = { runPipeline, classifyIndustry, classifyIndustryMulti };
