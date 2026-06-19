-- 061_forum_moderation.sql
-- 论坛管理：置顶 / 精华。
-- 仅影响展示排序与标记，不触碰 score_snapshot / risk_flags（评分快照与风险旗标不可篡改）。
-- 下架/恢复沿用既有 forum_posts.status('published'|'removed') + removed_reason，无需新列。

ALTER TABLE forum_posts ADD COLUMN pinned   INTEGER DEFAULT 0;  -- 置顶（列表内优先排序）
ALTER TABLE forum_posts ADD COLUMN featured INTEGER DEFAULT 0;  -- 精华（标记，前台可展示徽章）

-- 置顶帖优先排序：列表查询用 ORDER BY pinned DESC, created_at DESC
CREATE INDEX IF NOT EXISTS idx_forum_posts_pinned ON forum_posts(pinned DESC, created_at DESC);
