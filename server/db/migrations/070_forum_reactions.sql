-- 070_forum_reactions.sql
-- 评论/帖子的表情回应(emoji + 定制卡通贴纸)。社区趣味层,只作用于社区区,
-- 不进评分报告/风险旗标/免责声明。
--
-- reaction 取值走服务端白名单(已知 emoji 集 + 已知 sticker id),防注入:
--   'emoji:👍' | 'sticker:bullish' ...
-- 切换语义:同一用户对同一目标再点同一 reaction 即取消(唯一约束兜底)。
-- 不动现有 forum_likes(点赞计数独立保留)。

CREATE TABLE IF NOT EXISTS forum_reactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,       -- 'post' | 'comment'
  target_id   INTEGER NOT NULL,
  reaction    TEXT NOT NULL,       -- 'emoji:<char>' | 'sticker:<id>'(白名单)
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, target_type, target_id, reaction)
);

-- 聚合某目标的全部表情(渲染 ReactionBar)
CREATE INDEX IF NOT EXISTS idx_forum_reactions_target ON forum_reactions(target_type, target_id);
