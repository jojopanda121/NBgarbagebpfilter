-- 068_forum_report_grants.sql
-- 报告授权解锁:发帖人把「完整评分报告」按人授权给感兴趣的一方查看。
--
-- 产品红线(对应 forumService/forumReportService 的纪律):
--   发帖人只控制「给谁看」(access),不控制「看什么」(content)。
--   报告永远是平台从 tasks.result.$.verdict 现取、自动脱敏、风险旗标强制全带的
--   那一份;本表只记录授权关系,不存任何报告内容。
--
-- 解锁是渐进披露阶梯的第 3 档:
--   游客(总分/评级) → 登录(脱敏快照) → 【授权解锁:完整脱敏报告】 → 撮合 accepted(名片/私信)
--
-- 前置条件:被授权方(grantee)必须先在该帖表达过 interest(deal_connections 存在),
--   发帖人才能授权 —— 防止把报告推给随机人。

CREATE TABLE IF NOT EXISTS forum_report_grants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  grantee_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 被授权看完整报告的人(感兴趣方)
  granter_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 发帖人(授权人)
  status      TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'revoked'
  created_at  TEXT DEFAULT (datetime('now')),
  revoked_at  TEXT,
  UNIQUE (post_id, grantee_id)                  -- 同一帖对同一人只有一条授权(可在 active/revoked 间切换)
);

-- 「我的报告库」:某人被解锁了哪些报告
CREATE INDEX IF NOT EXISTS idx_report_grants_grantee ON forum_report_grants(grantee_id, status);
-- 发帖人管理某帖的授权
CREATE INDEX IF NOT EXISTS idx_report_grants_post ON forum_report_grants(post_id);
