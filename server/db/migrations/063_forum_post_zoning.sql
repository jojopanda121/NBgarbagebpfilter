-- 063_forum_post_zoning.sql
-- 论坛排序与「未来分区」数据基建（产品决策：现在不分区，但表结构先备好）。
--
-- 目的：
--   1) 排序可走索引：把评分从 score_snapshot JSON 里抽出来，落成一等列 score_total，
--      连同已有的 interest_count / created_at，三种排序（最新 / 评分 / 最多人感兴趣）
--      都能命中索引，帖子量大了也不退化。
--   2) 预留分区维度：region(大区) / industry(行业) 两个可空列 + 索引。
--      现在不按地域/行业分区，但以后要分时，查询「某大区/某行业的帖子再排序」
--      可直接命中 (region|industry, status, ...) 复合索引，无需再改表回填。
--
-- 约束：这两列纯属「冗余/派生」数据，不破坏既有红线 —— 分数仍只来自平台快照
--   (score_snapshot 不可变)，这里只是把 total_score 复制一份出来方便排序。

-- ── 派生列 ──
ALTER TABLE forum_posts ADD COLUMN score_total INTEGER;   -- 评分帖总分（从 score_snapshot 抽出，便于索引排序；非评分帖为 NULL）
ALTER TABLE forum_posts ADD COLUMN industry TEXT;         -- 行业（未来分区维度，可空；评分帖从任务行业派生）
ALTER TABLE forum_posts ADD COLUMN region   TEXT;         -- 大区（未来分区维度，可空；评分帖从任务地域派生）

-- ── 回填历史数据 ──
-- 分数：从不可变快照里抽 total_score。
UPDATE forum_posts
   SET score_total = CAST(json_extract(score_snapshot, '$.total_score') AS INTEGER)
 WHERE score_snapshot IS NOT NULL
   AND json_valid(score_snapshot)
   AND json_extract(score_snapshot, '$.total_score') IS NOT NULL;

-- 行业：历史帖在发帖时把行业写进了 teaser_payload.sector，能回填的回填。
UPDATE forum_posts
   SET industry = json_extract(teaser_payload, '$.sector')
 WHERE industry IS NULL
   AND teaser_payload IS NOT NULL
   AND json_valid(teaser_payload)
   AND json_extract(teaser_payload, '$.sector') IS NOT NULL;
-- region 历史无可靠来源（帖子未存地域），留空，发帖时向后填充。

-- ── 排序索引（板块内）──
CREATE INDEX IF NOT EXISTS idx_forum_posts_score
  ON forum_posts(category, status, score_total DESC);
CREATE INDEX IF NOT EXISTS idx_forum_posts_interest
  ON forum_posts(category, status, interest_count DESC);
-- 「最新」已有 idx_forum_posts_category (category, status, created_at DESC) 覆盖。

-- ── 未来分区维度索引（现在不查，先备好）──
CREATE INDEX IF NOT EXISTS idx_forum_posts_industry
  ON forum_posts(industry, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_posts_region
  ON forum_posts(region, status, created_at DESC);
