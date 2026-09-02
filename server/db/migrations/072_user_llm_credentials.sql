-- 072_user_llm_credentials.sql
-- BYOK:用户自带模型 API Key。
--
-- 每个用户最多一套凭证(user_id UNIQUE)。api_key_cipher 是 AES-256-GCM 密文,
-- 明文永不落库、永不进日志;读取只发生在分析任务的内存里(runtime/llmContext)。
-- 加密依赖 ENCRYPTION_KEY(64 位 hex);未配置该密钥时 BYOK 直接不可用 —— 宁可
-- 功能关掉,也不能明文存用户的 key。
--
-- last_validation_* 记录最近一次连通性校验结果:保存前会真的打一次模型,
-- 确认它既能应答、又能按 JSON Schema 输出结构化结果。过不了这关的模型
-- 不允许进流水线 —— 否则用户拿到的是一份跑到一半失败的分析。

CREATE TABLE IF NOT EXISTS user_llm_credentials (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                 INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  provider                TEXT NOT NULL,          -- deepseek | anthropic | openai | gemini | minimax | moonshot | qwen | zhipu
  api_key_cipher          TEXT NOT NULL,          -- iv:ciphertext:authTag(hex),AES-256-GCM
  base_url                TEXT,                   -- 可空;为空用厂商默认端点
  model_default           TEXT,                   -- 三档模型名;只填 default 时三档同模型
  model_heavy             TEXT,
  model_light             TEXT,
  max_output_tokens       INTEGER,                -- 用户显式覆盖能力矩阵(可空)
  context_window          INTEGER,
  last_validated_at       TEXT,
  last_validation_status  TEXT,                   -- ok | failed
  last_validation_message TEXT,
  created_at              TEXT DEFAULT (datetime('now')),
  updated_at              TEXT DEFAULT (datetime('now'))
);

-- 分析任务落库时记录这份报告是谁家模型出的:
-- 换模型重跑同一份 BP 不能复用旧结果(见 analyzeController.findExistingResult)。
ALTER TABLE tasks ADD COLUMN llm_provider TEXT;
ALTER TABLE tasks ADD COLUMN llm_model TEXT;
ALTER TABLE tasks ADD COLUMN llm_source TEXT;   -- platform | byok
