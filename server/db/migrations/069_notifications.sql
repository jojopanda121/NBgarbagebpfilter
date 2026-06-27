-- 069_notifications.sql
-- 通用站内通知 + 邮件开关。论坛留存的发动机:
--   "发生了某事 → 通知对的人 → 他回来"。撮合每一步都接通知,让站内活动可被召回。
--
-- 渠道:站内(本表) + 邮件(best-effort,复用 emailService;收件人有 email 且 notify_email=1 才发)。
-- payload 只存小上下文(帖标题/codename、附言摘要),不存敏感全文。

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 收件人
  type       TEXT NOT NULL,        -- 'interest_received' | 'report_requested' | 'report_unlocked' | 'interest_accepted'
  actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,          -- 触发者(可空)
  post_id    INTEGER REFERENCES forum_posts(id) ON DELETE CASCADE,     -- 关联帖(可空)
  payload    TEXT,                 -- JSON: { post_title, codename, message, ... } 小上下文
  read_at    TEXT,                 -- NULL = 未读
  created_at TEXT DEFAULT (datetime('now'))
);

-- 收件箱:按用户拉未读/全部,按时间倒序
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at, created_at DESC);

-- 邮件通知开关(可退订);默认开
ALTER TABLE users ADD COLUMN notify_email INTEGER DEFAULT 1;
