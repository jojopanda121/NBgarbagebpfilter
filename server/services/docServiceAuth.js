// ============================================================
// server/services/docServiceAuth.js — doc-service 调用认证头
//
// DOC_SERVICE_TOKEN 在 Node 与 doc-service 两端配置同一值后，
// 所有 doc-service HTTP 调用自动携带 Bearer 头。未配置时不加头（向后兼容）。
// ============================================================

const config = require("../config");

/**
 * 合并 doc-service 认证头。
 * @param {object} extra - 其他 headers（如 Content-Type）
 */
function docServiceHeaders(extra = {}) {
  if (config.docServiceToken) {
    return { ...extra, Authorization: `Bearer ${config.docServiceToken}` };
  }
  return { ...extra };
}

module.exports = { docServiceHeaders };
