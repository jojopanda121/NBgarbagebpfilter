-- ============================================================
-- 054_shared_skill_approvals.sql
--
-- 跨用户共享学习审核队列。Hermes-first plan §8。
--
-- 流程：
--   1. Hermes memory_curator skill 日扫提炼候选 → callback POST 写入此表 (status=pending)
--   2. Hermes skill_reviewer skill 异步审 → 更新 status=auto_approved | needs_human | rejected
--   3. Admin 在后台抽样人工复核（≥10% 抽样率）
--   4. 通过的条目写入 workspace_skills (user_id IS NULL) 或 institutional_memory
--
-- 字段说明：
--   target_table         —— 'workspace_skills' | 'institutional_memory'
--                          决定最终写入哪张表
--   candidate_payload    —— Hermes 提交的候选内容 JSON（包含 name/description/trigger/steps 等）
--   source_run_ids       —— JSON array，记录这个候选是从哪些 run/conversation 提炼出的
--   status               —— 'pending' (curator 刚写入)
--                         | 'auto_approved' (reviewer skill 自动放行)
--                         | 'needs_human' (reviewer 要求人工)
--                         | 'admin_approved' (admin 复核通过)
--                         | 'rejected' (reviewer 或 admin 拒绝)
--                         | 'published' (已写入目标表，归档)
--   reviewer_verdict     —— LLM reviewer 判定理由（短文）
--   reviewer_risk_tags   —— JSON array：['contains_pii','sample_too_small','vague',...]
--   admin_user_id        —— 复核 admin 的 user_id
--   admin_decision_at    —— admin 决定时间
--   published_target_id  —— 写入目标表后的主键（便于追溯）
-- ============================================================

CREATE TABLE IF NOT EXISTS shared_skill_approvals (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  target_table        TEXT    NOT NULL CHECK (target_table IN ('workspace_skills', 'institutional_memory')),
  candidate_payload   TEXT    NOT NULL,         -- JSON
  source_run_ids      TEXT,                     -- JSON array
  status              TEXT    NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'auto_approved', 'needs_human', 'admin_approved', 'rejected', 'published')),
  reviewer_verdict    TEXT,
  reviewer_risk_tags  TEXT,                     -- JSON array
  admin_user_id       INTEGER,
  admin_decision_at   TEXT,
  admin_notes         TEXT,
  published_target_id INTEGER,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_shared_skill_approvals_status
  ON shared_skill_approvals(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shared_skill_approvals_target
  ON shared_skill_approvals(target_table, status);
