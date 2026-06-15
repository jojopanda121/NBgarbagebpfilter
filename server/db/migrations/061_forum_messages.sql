-- 061_forum_messages.sql
-- 轻量站内信：任意两名登录用户之间的一对一私信。
--
-- 这是独立于 deal_connections(撮合) 的并行沟通渠道（产品决策：微博模型）。
-- 会话用规范化配对 (user_lo, user_hi) = (min(a,b), max(a,b)) 保证同一对用户只有一个会话。
-- 仅会话的两名参与者可读写（服务端 forumMessageService 强制，非纯前端）。

CREATE TABLE IF NOT EXISTS forum_conversations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_lo         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- min(a,b)
  user_hi         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- max(a,b)
  last_message_at TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  UNIQUE (user_lo, user_hi)
);

CREATE TABLE IF NOT EXISTS forum_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES forum_conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  created_at      TEXT DEFAULT (datetime('now')),
  read_at         TEXT                                  -- 对方读取时间，NULL = 未读
);

CREATE INDEX IF NOT EXISTS idx_forum_messages_conv ON forum_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_forum_conv_lo ON forum_conversations(user_lo, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_conv_hi ON forum_conversations(user_hi, last_message_at DESC);
