-- 057_forum_posts.sql
-- 论坛帖子。
--
-- 可信锚点（产品红线）：
--   评分帖必须关联真实分析任务 task_id；分数快照由服务端发帖瞬间从
--   tasks.result.$.verdict 现取，落库到 score_snapshot（不可变 JSON），
--   用户无法手填分数。所以论坛上的分数天然都是"平台实测"。
--
-- 脱敏：disclosure_level + show_project_name / show_company_name 控制可识别信息，
--   但风险结论(risk_flags)强制全带、发帖人不可删。
--
-- 软墙：游客可见列表的精简字段；正文/详情对游客截断（路由层处理，非本表）。

CREATE TABLE IF NOT EXISTS forum_posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  category      TEXT NOT NULL DEFAULT 'project',   -- 'project'(优质项目) | 'discussion'(行业讨论) | 'market'(找钱/找项目)
  title         TEXT NOT NULL,
  body          TEXT DEFAULT '',                   -- 发帖人正文（脱敏由发帖人把关 + 服务端兜底）

  -- 评分快照（评分帖才有）
  task_id       TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  score_snapshot TEXT,                             -- JSON: { total_score, grade, grade_label, grade_action, grade_color, verdict_summary, strengths[], risk_flags[] }
  score_source  TEXT DEFAULT 'platform',           -- 恒 'platform'（只允许平台实测快照）

  -- 脱敏配置
  disclosure_level   TEXT DEFAULT 'anonymous',     -- 'anonymous' | 'semi' | 'public'
  show_project_name  INTEGER DEFAULT 0,
  show_company_name  INTEGER DEFAULT 0,
  codename           TEXT,                          -- 匿名时展示的项目代号
  teaser_payload     TEXT,                          -- JSON: 脱敏后的项目要点（复用 teaser_generate 产物，可空）

  -- 撮合：发帖人是否开放被联系 + 帖内明示联系方式（自愿）
  allow_contact      INTEGER DEFAULT 1,             -- 是否接受"我有兴趣"撮合意向
  public_contact     TEXT,                          -- 发帖人自愿在帖内直接公开的联系方式（可空）

  status        TEXT NOT NULL DEFAULT 'published', -- 'published' | 'removed'（被作者删或被管理员下架）
  removed_reason TEXT,

  like_count    INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  view_count    INTEGER NOT NULL DEFAULT 0,
  interest_count INTEGER NOT NULL DEFAULT 0,        -- 收到的撮合意向数

  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_forum_posts_category ON forum_posts(category, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_posts_author ON forum_posts(author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_posts_task ON forum_posts(task_id);
