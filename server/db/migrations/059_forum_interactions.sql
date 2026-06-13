-- 059_forum_interactions.sql
-- 点赞 / 收藏 / 举报。点赞与收藏用唯一约束做幂等。

CREATE TABLE IF NOT EXISTS forum_likes (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,                        -- 'post' | 'comment'
  target_id   INTEGER NOT NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS forum_bookmarks (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     INTEGER NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  created_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS forum_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,                        -- 'post' | 'comment'
  target_id   INTEGER NOT NULL,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',      -- 'pending' | 'reviewed' | 'dismissed'
  created_at  TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT,
  reviewed_by INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_forum_bookmarks_user ON forum_bookmarks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_reports_status ON forum_reports(status, created_at DESC);
