// ============================================================
// server/services/extraction/index.js
//
// Upload-structured extraction 编排（旧版"BP 深度解析"已废弃）。
//
// 现在的语义是：
//   - 输入是**用户上传材料**（data room / 财务表 / 合同 / 客户清单 /
//     访谈纪要 / 合规证书 / Cap Table 等），不是 BP 原文。
//   - 三个 agent (financialStatementsAgent / unitEconomicsAgent /
//     customerListAgent) 被复用，但他们消费的是上传文本。
//   - 增加 extrasAgent 抽取 cap_table / legal / contracts / claims / red_flags。
//   - 编排器 + 持久化逻辑在 uploadStructuredExtraction.js。
//
// 下游消费方式：
//   const upload = require("./uploadStructuredExtraction");
//   await upload.runAndPersist({ db, artifactId, conversationId, ... });
//   const rows = upload.listStructuredExtractsForConversation(db, convId);
//
// 保留 flattenToFacts 的旧签名以兼容仍在演进的测试，但 source_type 已迁移到
// "upload_structured"，**禁止**再产 "bp_deep_parsing" 类型的 fact。
// ============================================================

const financialStatementsAgent = require("./financialStatementsAgent");
const unitEconomicsAgent = require("./unitEconomicsAgent");
const customerListAgent = require("./customerListAgent");
const extrasAgent = require("./extrasAgent");
const uploadStructured = require("./uploadStructuredExtraction");

module.exports = {
  // 新接口（推荐）
  extractUploadStructured: uploadStructured.extractUploadStructured,
  runAndPersistUploadStructured: uploadStructured.runAndPersist,
  flattenStructuredToFacts: uploadStructured.flattenStructuredToFacts,
  listStructuredExtractsForConversation: uploadStructured.listStructuredExtractsForConversation,
  upsertStructuredExtractionRow: uploadStructured.upsertExtractionRow,

  // 底层 agent（供单元测试 / 调试直接调用）
  financialStatementsAgent,
  unitEconomicsAgent,
  customerListAgent,
  extrasAgent,
};
