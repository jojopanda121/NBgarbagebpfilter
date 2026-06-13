-- 058_forum_comments.sql
-- 评论 / 盖楼。parent_id 支持一级回复（回复某条评论）。

CREATE TABLE IF NOT EXISTS forum_comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id   INTEGER REFERENCES forum_comments(id) ON DELETE CASCADE,  -- 空 = 顶层评论
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'published',   -- 'published' | 'removed'
  like_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_forum_comments_post ON forum_comments(post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_forum_comments_author ON forum_comments(author_id);
