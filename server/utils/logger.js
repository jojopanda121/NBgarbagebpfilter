// ============================================================
// server/utils/logger.js — 轻量级结构化日志
// 零外部依赖，输出 JSON 格式日志，可无缝升级至 pino/winston
// ============================================================

const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || "info"] || LOG_LEVELS.info;

function formatLog(level, message, data) {
  const entry = {
    level,
    timestamp: new Date().toISOString(),
    message,
  };

  if (data) {
    // 展开常用上下文字段到顶层
    if (data.requestId) entry.requestId = data.requestId;
    if (data.userId) entry.userId = data.userId;
    // 其余字段放 data
    const { requestId, userId, ...rest } = data;
    if (Object.keys(rest).length > 0) entry.data = rest;
  }

  return JSON.stringify(entry);
}

const logger = {
  debug(message, data) {
    if (LEVEL <= LOG_LEVELS.debug) {
      process.stdout.write(formatLog("debug", message, data) + "\n");
    }
  },

  info(message, data) {
    if (LEVEL <= LOG_LEVELS.info) {
      process.stdout.write(formatLog("info", message, data) + "\n");
    }
  },

  warn(message, data) {
    if (LEVEL <= LOG_LEVELS.warn) {
      process.stderr.write(formatLog("warn", message, data) + "\n");
    }
  },

  error(message, data) {
    if (LEVEL <= LOG_LEVELS.error) {
      process.stderr.write(formatLog("error", message, data) + "\n");
    }
  },

  /**
   * 创建带上下文的子 logger（绑定 requestId / userId）
   * @param {Object} context - { requestId, userId, ... }
   * @returns {Object} 带上下文的 logger
   */
  child(context) {
    return {
      debug: (msg, data) => logger.debug(msg, { ...context, ...data }),
      info: (msg, data) => logger.info(msg, { ...context, ...data }),
      warn: (msg, data) => logger.warn(msg, { ...context, ...data }),
      error: (msg, data) => logger.error(msg, { ...context, ...data }),
    };
  },
};

/**
 * P2-3: console 桥接 — 把全代码库存量的 console.log/info/warn/error
 * 统一导入结构化 JSON 日志管道（util.format 保持任意参数形状，含 %s/%d 占位符）。
 * 仅在真实运行时（server/index.js）安装；测试环境不安装，保持 jest 输出可读。
 * 新代码请直接使用本 logger，console.* 仅作为历史存量兼容。
 */
function installConsoleBridge() {
  const util = require("util");
  const bridge = (level) => (...args) => logger[level](util.format(...args));
  console.log = bridge("info");
  console.info = bridge("info");
  console.warn = bridge("warn");
  console.error = bridge("error");
  console.debug = bridge("debug");
}

module.exports = logger;
module.exports.installConsoleBridge = installConsoleBridge;
