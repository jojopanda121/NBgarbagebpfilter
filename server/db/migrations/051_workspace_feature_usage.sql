-- 051_workspace_feature_usage.sql
-- Workspace 功能使用统计：记录用户每次调用 AI 工具/技能的轻量事件，
-- 用于后台"功能热度排行 + 按用户下钻"。
--
-- 与 skill_runs 的区别：skill_runs 偏健康度监控且只覆盖走 skill registry 的工具；
-- 本表统一覆盖全部 host 工具（含 web_search / generate_docx / generate_xlsx）与技能按钮调用，
-- 仅保留聚合所需的最小字段，写入为 fire-and-forget，不影响主流程。

CREATE TABLE IF NOT EXISTS workspace_feature_usage (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  feature     TEXT NOT NULL,                       -- 工具/技能标识, 如 onepager_pptx / web_search / generate_docx
  source      TEXT NOT NULL DEFAULT 'host_tool',   -- 'host_tool' | 'skill_button'
  status      TEXT NOT NULL DEFAULT 'success',     -- 'success' | 'failed'
  duration_ms INTEGER,
  project_id  INTEGER,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wfu_feature ON workspace_feature_usage(feature, created_at);
CREATE INDEX IF NOT EXISTS idx_wfu_user    ON workspace_feature_usage(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wfu_created ON workspace_feature_usage(created_at);
