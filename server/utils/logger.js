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

module.exports = logger;
