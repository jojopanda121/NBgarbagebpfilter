-- ============================================================
-- 004_feedback.sql — 用户反馈表
-- ============================================================

CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id),
  type        TEXT NOT NULL DEFAULT 'suggestion',  -- suggestion/bug/complaint
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending/processed/resolved
  admin_reply TEXT DEFAULT NULL,
  replied_at  TEXT DEFAULT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
