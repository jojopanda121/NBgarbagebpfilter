-- 062_user_badges.sql
-- BP 自动徽章：按用户分析出的 BP 的高分 / 总量 / 活跃频率 / 所在地，自动授予徽章。
--
-- 可信锚点（产品红线，呼应「快照只用平台实测」）：徽章由平台数据(tasks)自动算出，
--   用户只能选择是否「挂出」展示(displayed)，不能伪造 tier。
-- 徽章「定义」(名称/图标/各 tier 阈值) 写死在 services/badgeService.js，本表只存
--   已授予徽章 + 展示偏好。

CREATE TABLE IF NOT EXISTS user_badges (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_code TEXT NOT NULL,                  -- 'high_score' | 'volume' | 'active' | 'region'
  tier       INTEGER NOT NULL DEFAULT 1,     -- 等级（1 起）
  meta       TEXT,                           -- JSON: { best_score / count / recent_count / region }
  displayed  INTEGER NOT NULL DEFAULT 0,     -- 用户是否「挂出」对外展示
  awarded_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, badge_code)
);

CREATE INDEX IF NOT EXISTS idx_user_badges_displayed ON user_badges(user_id, displayed);
