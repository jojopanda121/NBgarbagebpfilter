// ============================================================
// server/services/trackingService.js — 企业追踪与预测验证服务
// 管理企业实体、BP 语料库、快照数据和预测验证
// 支持模型微调和定期跟踪
// ============================================================

const { getDb } = require("../db");
const logger = require("../utils/logger");
const qccService = require("./qccService");

/**
 * 查找或创建企业实体
 * @param {Object} extractedData - 提取的 BP 数据，包含 company_name, industry, product_name, founder info 等
 * @param {string} taskId - 当前任务 ID
 * @returns {Promise<Object>} - 企业实体对象，包含 id, company_name, credit_code 等字段
 */
async function findOrCreateCompanyEntity(extractedData, taskId) {
  const db = getDb();
  const companyName = extractedData.company_name;

  try {
    // 1. 按公司名称查找现有实体
    let company = db.prepare(
      "SELECT * FROM company_entities WHERE company_name = ?"
    ).get(companyName);

    if (company) {
      logger.debug("找到现有企业实体", {
        taskId,
        companyId: company.id,
        companyName,
      });

      // 更新关联的任务
      if (taskId && !company.first_task_id) {
        db.prepare(
          "UPDATE company_entities SET first_task_id = ? WHERE id = ?"
        ).run(taskId, company.id);
      }

      return company;
    }

    // 2. 新建企业实体
    logger.info("创建新企业实体", { taskId, companyName });

    // 尝试从 QCC 获取企业注册信息（如果可用）
    let qccRegistration = null;
    let creditCode = null;

    if (qccService.isEnabled()) {
      try {
        qccRegistration = await qccService.getCompanyRegistration(companyName);
        if (qccRegistration && qccRegistration.credit_code) {
          creditCode = qccRegistration.credit_code;
        }
      } catch (err) {
        logger.warn("QCC 查询失败，继续使用提取数据", {
          taskId,
          companyName,
          error: err.message,
        });
      }
    }

    // 3. 提取相关数据
    const founderNames = extractedData.founder_info
      ? (Array.isArray(extractedData.founder_info)
          ? extractedData.founder_info.join(",")
          : extractedData.founder_info)
      : null;

    const industryTags = extractedData.industry
      ? (Array.isArray(extractedData.industry)
          ? extractedData.industry.join(",")
          : extractedData.industry)
      : null;

    // 4. 插入新实体
    const info = db.prepare(
      `INSERT INTO company_entities
       (company_name, credit_code, founder_names, city, founded_year,
        industry_tags, first_task_id, current_status, qcc_raw_registration)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      companyName,
      creditCode || null,
      founderNames,
      extractedData.city || null,
      extractedData.founded_year || null,
      industryTags,
      taskId,
      "unknown",
      qccRegistration ? JSON.stringify(qccRegistration) : null
    );

    const newCompany = db.prepare(
      "SELECT * FROM company_entities WHERE id = ?"
    ).get(info.lastInsertRowid);

    logger.info("企业实体创建成功", {
      taskId,
      companyId: newCompany.id,
      companyName,
      creditCode: newCompany.credit_code,
    });

    return newCompany;
  } catch (err) {
    logger.error("企业实体查询/创建失败", {
      taskId,
      companyName,
      error: err.message,
    });
    throw err;
  }
}

/**
 * 保存 BP 语料库
 * @param {string} fileHash - 文件哈希值
 * @param {string} rawText - BP 原始文本
 * @param {string|Array} industryTags - 行业标签
 * @param {number} companyId - 企业 ID
 * @returns {Object} - 语料库记录
 */
function saveBPCorpus(fileHash, rawText, industryTags, companyId) {
  const db = getDb();

  try {
    const tags = Array.isArray(industryTags)
      ? industryTags.join(",")
      : industryTags;

    // 检查是否已存在
    const existing = db.prepare(
      "SELECT * FROM training_bp_corpus WHERE file_hash = ?"
    ).get(fileHash);

    if (existing) {
      // 更新上传计数
      db.prepare(
        "UPDATE training_bp_corpus SET upload_count = upload_count + 1 WHERE file_hash = ?"
      ).run(fileHash);

      logger.debug("BP 语料库已存在，更新计数", { fileHash, companyId });
      return existing;
    }

    // 插入新记录
    const info = db.prepare(
      `INSERT INTO training_bp_corpus
       (file_hash, raw_text, char_count, language, industry_tags, company_id)
       VALUES (?, ?, ?, 'zh', ?, ?)`
    ).run(
      fileHash,
      rawText,
      rawText.length,
      tags,
      companyId || null
    );

    const corpus = db.prepare(
      "SELECT * FROM training_bp_corpus WHERE id = ?"
    ).get(info.lastInsertRowid);

    logger.info("BP 语料库保存成功", { fileHash, companyId, charCount: corpus.char_count });
    return corpus;
  } catch (err) {
    logger.error("BP 语料库保存失败", {
      fileHash,
      companyId,
      error: err.message,
    });
    throw err;
  }
}

/**
 * 链接 BP 到企业
 * @param {string} taskId - 任务 ID
 * @param {number} companyId - 企业 ID
 * @param {number} aiScore - AI 总分数
 * @param {Object} dimensionScores - 各维度评分
 * @param {number} adjustedScore - 人工调整后的评分
 * @param {string} bpTextHash - BP 文本哈希值
 * @returns {Object} - 链接记录
 */
function linkBPToCompany(taskId, companyId, aiScore, dimensionScores, adjustedScore, bpTextHash) {
  const db = getDb();

  try {
    const info = db.prepare(
      `INSERT INTO bp_company_links
       (task_id, company_id, ai_total_score, ai_dimension_scores,
        human_adjusted_score, raw_bp_text_hash, analysis_date)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(
      taskId,
      companyId,
      aiScore || null,
      JSON.stringify(dimensionScores || {}),
      adjustedScore || null,
      bpTextHash || null
    );

    const link = db.prepare(
      "SELECT * FROM bp_company_links WHERE id = ?"
    ).get(info.lastInsertRowid);

    logger.info("BP-企业链接创建成功", {
      taskId,
      companyId,
      aiScore,
      adjustedScore,
    });

    return link;
  } catch (err) {
    logger.error("BP-企业链接创建失败", {
      taskId,
      companyId,
      error: err.message,
    });
    throw err;
  }
}

/**
 * 获取可追踪的企业列表
 * @returns {Array<Object>} - 企业实体列表
 */
function getTrackableCompanies() {
  const db = getDb();

  try {
    const companies = db.prepare(
      `SELECT * FROM company_entities
       WHERE tracking_enabled = 1
       AND current_status NOT IN ('defunct', 'liquidated', 'dissolved')
       ORDER BY updated_at DESC`
    ).all();

    logger.debug("获取可追踪企业列表", { count: companies.length });
    return companies;
  } catch (err) {
    logger.error("获取可追踪企业列表失败", { error: err.message });
    throw err;
  }
}

/**
 * 创建企业快照
 * @param {number} companyId - 企业 ID
 * @param {Object} snapshotData - 快照数据
 * @returns {Object} - 快照记录
 */
function createSnapshot(companyId, snapshotData) {
  const db = getDb();

  try {
    const info = db.prepare(
      `INSERT INTO company_snapshots
       (company_id, snapshot_date, operating_status, latest_funding_round,
        latest_funding_amount, latest_valuation, news_sentiment, major_events,
        risk_flags, patent_count, lawsuit_summary, employee_trend, data_sources,
        qcc_raw_data, confidence, model_version)
       VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      companyId,
      snapshotData.operating_status || null,
      snapshotData.latest_funding_round || null,
      snapshotData.latest_funding_amount || null,
      snapshotData.latest_valuation || null,
      snapshotData.news_sentiment || null,
      snapshotData.major_events ? JSON.stringify(snapshotData.major_events) : null,
      snapshotData.risk_flags ? JSON.stringify(snapshotData.risk_flags) : null,
      snapshotData.patent_count || null,
      snapshotData.lawsuit_summary || null,
      snapshotData.employee_trend || null,
      snapshotData.data_sources || null,
      snapshotData.qcc_raw_data ? JSON.stringify(snapshotData.qcc_raw_data) : null,
      snapshotData.confidence || null,
      snapshotData.model_version || "v1"
    );

    const snapshot = db.prepare(
      "SELECT * FROM company_snapshots WHERE id = ?"
    ).get(info.lastInsertRowid);

    logger.info("企业快照创建成功", { companyId, snapshotId: snapshot.id });
    return snapshot;
  } catch (err) {
    logger.error("企业快照创建失败", {
      companyId,
      error: err.message,
    });
    throw err;
  }
}

/**
 * 生成预测验证记录
 * @param {string} taskId - 任务 ID
 * @param {number} companyId - 企业 ID
 * @param {number} monthsElapsed - 经过的月份数
 * @returns {Object|null} - 预测验证记录，或 null（如果无有效数据）
 */
function generatePredictionValidation(taskId, companyId, monthsElapsed) {
  const db = getDb();

  try {
    // 1. 查找原始 BP 链接和预测分数
    const bpLink = db.prepare(
      `SELECT ai_total_score, ai_dimension_scores
       FROM bp_company_links
       WHERE task_id = ? AND company_id = ?`
    ).get(taskId, companyId);

    if (!bpLink || !bpLink.ai_total_score) {
      logger.warn("未找到原始预测分数", { taskId, companyId });
      return null;
    }

    // 2. 查找最新快照
    const latestSnapshot = db.prepare(
      `SELECT * FROM company_snapshots
       WHERE company_id = ?
       ORDER BY snapshot_date DESC
       LIMIT 1`
    ).get(companyId);

    if (!latestSnapshot) {
      logger.warn("未找到企业快照", { taskId, companyId });
      return null;
    }

    // 3. 计算结果分数和误差
    // 简单逻辑：根据快照数据推断当前状态分数
    const outcomeStatus = latestSnapshot.operating_status || "unknown";
    let outcomeScore = 50; // 默认中位数

    if (outcomeStatus === "active" || outcomeStatus === "operating") {
      outcomeScore = 75; // 正常运营
    } else if (outcomeStatus === "suspended" || outcomeStatus === "abnormal") {
      outcomeScore = 25; // 异常
    } else if (outcomeStatus === "defunct" || outcomeStatus === "liquidated") {
      outcomeScore = 0; // 失败
    }

    const scoreError = Math.abs(bpLink.ai_total_score - outcomeScore);
    const predictionGrade = bpLink.ai_total_score > 70 ? "A" : (bpLink.ai_total_score > 50 ? "B" : "C");

    // 4. 插入预测验证记录
    const info = db.prepare(
      `INSERT INTO prediction_validations
       (task_id, company_id, prediction_score, prediction_grade,
        prediction_dimensions, months_elapsed, outcome_status, outcome_score,
        score_error, validation_date, snapshot_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`
    ).run(
      taskId,
      companyId,
      bpLink.ai_total_score,
      predictionGrade,
      bpLink.ai_dimension_scores,
      monthsElapsed,
      outcomeStatus,
      outcomeScore,
      scoreError,
      latestSnapshot.id
    );

    const validation = db.prepare(
      "SELECT * FROM prediction_validations WHERE id = ?"
    ).get(info.lastInsertRowid);

    logger.info("预测验证记录创建成功", {
      taskId,
      companyId,
      monthsElapsed,
      scoreError: scoreError.toFixed(2),
    });

    return validation;
  } catch (err) {
    logger.error("预测验证记录创建失败", {
      taskId,
      companyId,
      error: err.message,
    });
    return null;
  }
}

/**
 * 获取追踪仪表板数据
 * @returns {Object} - 包含统计信息、状态分布、预测准确度等数据
 */
function getTrackingDashboardData() {
  const db = getDb();

  try {
    // 1. 总企业数和状态分布
    const companies = db.prepare(
      "SELECT current_status, COUNT(*) as count FROM company_entities WHERE tracking_enabled = 1 GROUP BY current_status"
    ).all();

    const statusDistribution = {};
    let totalCompanies = 0;
    companies.forEach((row) => {
      statusDistribution[row.current_status] = row.count;
      totalCompanies += row.count;
    });

    // 2. 预测准确度指标
    const validations = db.prepare(
      "SELECT score_error, prediction_grade FROM prediction_validations WHERE score_error IS NOT NULL"
    ).all();

    const avgScoreError = validations.length > 0
      ? (validations.reduce((sum, v) => sum + v.score_error, 0) / validations.length).toFixed(2)
      : null;

    const gradeDistribution = {};
    validations.forEach((v) => {
      gradeDistribution[v.prediction_grade] = (gradeDistribution[v.prediction_grade] || 0) + 1;
    });

    // 3. 最近快照
    const recentSnapshots = db.prepare(
      `SELECT cs.id, ce.company_name, cs.snapshot_date, cs.operating_status, cs.confidence
       FROM company_snapshots cs
       JOIN company_entities ce ON cs.company_id = ce.id
       ORDER BY cs.created_at DESC
       LIMIT 10`
    ).all();

    // 4. BP 语料统计
    const corpusStats = db.prepare(
      `SELECT COUNT(*) as total_records,
              SUM(char_count) as total_chars,
              COUNT(DISTINCT company_id) as unique_companies
       FROM training_bp_corpus`
    ).get();

    const dashboardData = {
      total_companies: totalCompanies,
      status_distribution: statusDistribution,
      prediction_accuracy: {
        avg_score_error: avgScoreError,
        total_validations: validations.length,
        grade_distribution: gradeDistribution,
      },
      recent_snapshots: recentSnapshots,
      corpus_stats: {
        total_bp_records: corpusStats.total_records || 0,
        total_characters: corpusStats.total_chars || 0,
        unique_companies: corpusStats.unique_companies || 0,
      },
    };

    logger.debug("仪表板数据获取成功", {
      totalCompanies,
      validationCount: validations.length,
    });

    return dashboardData;
  } catch (err) {
    logger.error("仪表板数据获取失败", { error: err.message });
    throw err;
  }
}

/**
 * 导出训练数据
 * @param {number} monthsWindow - 时间窗口（月份）
 * @returns {Array<Object>} - 训练数据数组
 */
function exportTrainingData(monthsWindow = 12) {
  const db = getDb();

  try {
    const trainingData = db.prepare(
      `SELECT
         bcc.raw_text as bp_text,
         bpl.ai_total_score as ai_score,
         bpl.ai_dimension_scores as ai_dimensions,
         pv.outcome_score,
         pv.outcome_status,
         pv.months_elapsed
       FROM bp_company_links bpl
       JOIN training_bp_corpus bcc ON bpl.raw_bp_text_hash = bcc.file_hash
       LEFT JOIN prediction_validations pv ON bpl.task_id = pv.task_id AND bpl.company_id = pv.company_id
       WHERE bpl.created_at >= datetime('now', '-' || ? || ' months')
       ORDER BY bpl.created_at DESC`
    ).all(monthsWindow);

    logger.info("训练数据导出成功", {
      recordCount: trainingData.length,
      monthsWindow,
    });

    return trainingData;
  } catch (err) {
    logger.error("训练数据导出失败", {
      monthsWindow,
      error: err.message,
    });
    throw err;
  }
}

/**
 * 运行季度追踪批处理
 * 迭代所有可追踪企业，获取最新快照，生成预测验证
 * @returns {Promise<Object>} - 批处理统计信息
 */
async function runQuarterlyTracking() {
  const db = getDb();
  const stats = {
    total_companies: 0,
    snapshots_created: 0,
    validations_generated: 0,
    errors: 0,
    error_details: [],
  };

  try {
    logger.info("开始季度追踪批处理");

    const companies = getTrackableCompanies();
    stats.total_companies = companies.length;

    for (const company of companies) {
      try {
        logger.debug("处理企业", { companyId: company.id, companyName: company.company_name });

        // 1. 获取最新快照（从 QCC）
        const fullSnapshot = await qccService.getFullSnapshot(company.company_name);

        // 2. 提取快照数据
        const snapshotData = {
          operating_status: fullSnapshot.registration?.status || "unknown",
          patent_count: fullSnapshot.ipr_info?.patent_count || 0,
          qcc_raw_data: fullSnapshot,
          confidence: 0.8, // 来自 QCC 的数据默认置信度
          model_version: "v1",
        };

        // 如果有新闻数据，提取情感
        if (fullSnapshot.operation_dynamics && Array.isArray(fullSnapshot.operation_dynamics.news)) {
          snapshotData.news_sentiment = "neutral"; // 简化处理
          snapshotData.major_events = fullSnapshot.operation_dynamics.news.slice(0, 5);
        }

        // 如果有风险数据
        if (fullSnapshot.risk_scan) {
          const riskFlags = [];
          if (fullSnapshot.risk_scan.dishonest) riskFlags.push("dishonest");
          if (fullSnapshot.risk_scan.serious_violation) riskFlags.push("serious_violation");
          if (fullSnapshot.risk_scan.case_filing) riskFlags.push("case_filing");
          snapshotData.risk_flags = riskFlags;
        }

        // 3. 创建快照记录
        const snapshot = createSnapshot(company.id, snapshotData);
        stats.snapshots_created++;

        // 4. 生成预测验证（对于有原始 BP 链接的企业）
        const bpLinks = db.prepare(
          "SELECT task_id FROM bp_company_links WHERE company_id = ? ORDER BY created_at DESC LIMIT 1"
        ).all(company.id);

        for (const link of bpLinks) {
          // 计算经过的月份数
          const bpLinkRecord = db.prepare(
            "SELECT created_at FROM bp_company_links WHERE task_id = ?"
          ).get(link.task_id);

          if (bpLinkRecord) {
            const createdDate = new Date(bpLinkRecord.created_at);
            const now = new Date();
            const monthsElapsed = Math.floor(
              (now.getFullYear() - createdDate.getFullYear()) * 12 +
              (now.getMonth() - createdDate.getMonth())
            );

            if (monthsElapsed >= 3) { // 只生成超过 3 个月的验证
              const validation = generatePredictionValidation(
                link.task_id,
                company.id,
                monthsElapsed
              );

              if (validation) {
                stats.validations_generated++;
              }
            }
          }
        }

        // 5. 更新企业状态
        db.prepare(
          "UPDATE company_entities SET current_status = ?, status_updated_at = datetime('now') WHERE id = ?"
        ).run(snapshotData.operating_status, company.id);
      } catch (err) {
        stats.errors++;
        stats.error_details.push({
          company_id: company.id,
          company_name: company.company_name,
          error: err.message,
        });

        logger.error("企业处理失败，继续下一个", {
          companyId: company.id,
          companyName: company.company_name,
          error: err.message,
        });
      }
    }

    logger.info("季度追踪批处理完成", stats);
    return stats;
  } catch (err) {
    logger.error("季度追踪批处理失败", {
      error: err.message,
      stats,
    });
    throw err;
  }
}

module.exports = {
  findOrCreateCompanyEntity,
  saveBPCorpus,
  linkBPToCompany,
  getTrackableCompanies,
  createSnapshot,
  generatePredictionValidation,
  getTrackingDashboardData,
  exportTrainingData,
  runQuarterlyTracking,
};
