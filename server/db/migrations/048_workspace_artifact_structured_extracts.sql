-- ============================================================
-- 048_workspace_artifact_structured_extracts.sql
--
-- 用户上传资料结构化抽取结果。每个 workspace_artifacts (kind='upload')
-- 在落盘后异步/同步触发一次 LLM 结构化抽取，结果存这张表，下游 Evidence
-- Pack 以最高优先级注入（替换原先从 BP 原文跑的 "bp_deep_parsing"）。
--
-- structured_json 是一个 LLM 强 schema 输出：
--   {
--     financials, unit_economics, customers,
--     cap_table, legal_compliance_signals,
--     contracts_and_evidence, claims_to_verify, red_flags
--   }
-- 找不到的字段统一 null / [], 不允许自然语言占位。
--
-- 抽取失败 (LLM 报错 / 文件无法解析) 不影响上传成功，但要记录 status/error。
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_artifact_structured_extracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  filename TEXT,
  doc_type TEXT,                 -- 'financials' / 'customers' / 'cap_table' / 'contract' / 'mixed' / 'unknown'
  structured_json TEXT,          -- 完整 JSON payload
  extraction_status TEXT NOT NULL CHECK (extraction_status IN ('pending', 'running', 'success', 'error', 'skipped')),
  error TEXT,
  fact_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wase_artifact_id    ON workspace_artifact_structured_extracts(artifact_id);
CREATE INDEX        IF NOT EXISTS idx_wase_conv           ON workspace_artifact_structured_extracts(conversation_id);
CREATE INDEX        IF NOT EXISTS idx_wase_status         ON workspace_artifact_structured_extracts(extraction_status);
