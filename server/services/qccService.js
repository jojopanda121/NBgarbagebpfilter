// ============================================================
// server/services/qccService.js — 企查查 (QCC) Agent CLI 服务
// 封装 QCC CLI 工具调用，支持企业数据查询
// 使用 child_process.execFile 执行 qcc 命令
// ============================================================

const { execFile } = require("child_process");
const config = require("../config");
const logger = require("../utils/logger");

const QCC_TIMEOUT_MS = 30 * 1000; // 30 秒超时

/**
 * 检查 QCC 是否已启用
 * @returns {boolean} - QCC 是否可用
 */
function isEnabled() {
  return config.qccEnabled && config.qccApiKey;
}

/**
 * 执行 QCC CLI 命令
 * @param {string} server - 服务器类型 (e.g. 'company', 'risk', 'operation', 'ipr')
 * @param {string} tool - 工具名称 (e.g. 'get_company_registration_info')
 * @param {string} args - 命令参数，通常是公司名称
 * @returns {Promise<Object>} - 解析后的 JSON 结果
 */
async function execQCC(server, tool, args) {
  return new Promise((resolve, reject) => {
    // 构建命令：qcc <server> <tool> "<args>"
    const cmdArgs = [server, tool, args];

    const timeout = setTimeout(() => {
      childProcess.kill();
      reject(new Error(`QCC 命令超时 (${QCC_TIMEOUT_MS}ms): qcc ${server} ${tool} "${args}"`));
    }, QCC_TIMEOUT_MS);

    let stdout = "";

    const childProcess = execFile("qcc", cmdArgs, { encoding: "utf-8" }, (error, out, err) => {
      clearTimeout(timeout);

      if (error) {
        logger.warn("QCC 命令执行失败", {
          server,
          tool,
          error: error.message,
          stderr: err,
        });
        return reject(new Error(`QCC 执行失败: ${error.message}`));
      }

      stdout = out;
      stderr = err;

      try {
        // 尝试解析 JSON 输出
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (parseErr) {
        logger.warn("QCC 输出解析失败", {
          server,
          tool,
          stdout: stdout.substring(0, 500),
          parseError: parseErr.message,
        });
        reject(new Error(`QCC JSON 解析失败: ${parseErr.message}`));
      }
    });
  });
}

/**
 * 获取企业注册信息
 * @param {string} companyName - 公司名称
 * @returns {Promise<Object|null>} - 包含 credit_code, status, founded_date 等字段的对象，或 null
 */
async function getCompanyRegistration(companyName) {
  if (!isEnabled()) {
    logger.warn("QCC 未配置，跳过企业注册查询", { companyName });
    return null;
  }

  try {
    logger.debug("查询企业注册信息", { companyName });
    const result = await execQCC("company", "get_company_registration_info", companyName);
    return result;
  } catch (err) {
    logger.error("企业注册信息查询失败", {
      companyName,
      error: err.message,
    });
    return null;
  }
}

/**
 * 获取企业风险信息
 * 并行调用多个风险检查工具
 * @param {string} companyName - 公司名称
 * @returns {Promise<Object|null>} - 包含不诚实信息、严重违规、案件信息的对象，或 null
 */
async function getRiskScan(companyName) {
  if (!isEnabled()) {
    logger.warn("QCC 未配置，跳过风险扫描", { companyName });
    return null;
  }

  try {
    logger.debug("执行企业风险扫描", { companyName });

    const [dishonestInfo, seriousViolation, caseInfo] = await Promise.allSettled([
      execQCC("risk", "get_dishonest_info", companyName),
      execQCC("risk", "get_serious_violation", companyName),
      execQCC("risk", "get_case_filing_info", companyName),
    ]);

    const result = {
      dishonest: dishonestInfo.status === "fulfilled" ? dishonestInfo.value : null,
      serious_violation: seriousViolation.status === "fulfilled" ? seriousViolation.value : null,
      case_filing: caseInfo.status === "fulfilled" ? caseInfo.value : null,
    };

    return result;
  } catch (err) {
    logger.error("风险扫描失败", {
      companyName,
      error: err.message,
    });
    return null;
  }
}

/**
 * 获取企业运营动态
 * @param {string} companyName - 公司名称
 * @returns {Promise<Object|null>} - 包含新闻和运营信息的对象，或 null
 */
async function getOperationDynamics(companyName) {
  if (!isEnabled()) {
    logger.warn("QCC 未配置，跳过运营动态查询", { companyName });
    return null;
  }

  try {
    logger.debug("查询企业运营动态", { companyName });
    const result = await execQCC("operation", "get_news", companyName);
    return result;
  } catch (err) {
    logger.error("运营动态查询失败", {
      companyName,
      error: err.message,
    });
    return null;
  }
}

/**
 * 获取企业 IPR（知识产权）信息
 * @param {string} companyName - 公司名称
 * @returns {Promise<Object|null>} - 包含专利信息的对象，或 null
 */
async function getIPRInfo(companyName) {
  if (!isEnabled()) {
    logger.warn("QCC 未配置，跳过 IPR 查询", { companyName });
    return null;
  }

  try {
    logger.debug("查询企业 IPR 信息", { companyName });
    const result = await execQCC("ipr", "get_patent_info", companyName);
    return result;
  } catch (err) {
    logger.error("IPR 查询失败", {
      companyName,
      error: err.message,
    });
    return null;
  }
}

/**
 * 获取企业完整快照
 * 并行调用所有查询函数
 * @param {string} companyName - 公司名称
 * @returns {Promise<Object>} - 包含所有信息的综合对象
 */
async function getFullSnapshot(companyName) {
  if (!isEnabled()) {
    logger.warn("QCC 未配置，无法生成完整快照", { companyName });
    return {
      company_name: companyName,
      registration: null,
      risk_scan: null,
      operation_dynamics: null,
      ipr_info: null,
      snapshot_time: new Date().toISOString(),
    };
  }

  try {
    logger.info("生成企业完整快照", { companyName });

    const [registration, riskScan, operationDynamics, iprInfo] = await Promise.allSettled([
      getCompanyRegistration(companyName),
      getRiskScan(companyName),
      getOperationDynamics(companyName),
      getIPRInfo(companyName),
    ]);

    const snapshot = {
      company_name: companyName,
      registration: registration.status === "fulfilled" ? registration.value : null,
      risk_scan: riskScan.status === "fulfilled" ? riskScan.value : null,
      operation_dynamics: operationDynamics.status === "fulfilled" ? operationDynamics.value : null,
      ipr_info: iprInfo.status === "fulfilled" ? iprInfo.value : null,
      snapshot_time: new Date().toISOString(),
    };

    logger.debug("企业快照生成完成", { companyName });
    return snapshot;
  } catch (err) {
    logger.error("企业快照生成失败", {
      companyName,
      error: err.message,
    });
    return {
      company_name: companyName,
      registration: null,
      risk_scan: null,
      operation_dynamics: null,
      ipr_info: null,
      snapshot_time: new Date().toISOString(),
      error: err.message,
    };
  }
}

module.exports = {
  isEnabled,
  getCompanyRegistration,
  getRiskScan,
  getOperationDynamics,
  getIPRInfo,
  getFullSnapshot,
};
