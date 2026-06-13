-- 060_deal_connections.sql
-- 撮合：投资人/FA 对某帖表达兴趣 → 发帖人同意 → 双方名片互相解锁。
--
-- 三种沟通渠道并存（产品决策）：
--   1) 本表的"意向 → 授权 → 换名片"闭环
--   2) 站内信（可后续基于本表/通知扩展）
--   3) 发帖人自愿在帖内 public_contact 直接留联系方式
-- 平台只做信息撮合，不背书项目真实性（免责声明见 site_content: forum_disclaimer）。

CREATE TABLE IF NOT EXISTS deal_connections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id       INTEGER NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  initiator_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 表达兴趣的一方（通常投资人/FA）
  owner_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 发帖人（项目方）
  message       TEXT,                                -- 意向附言
  status        TEXT NOT NULL DEFAULT 'pending',     -- 'pending' | 'accepted' | 'declined'
  created_at    TEXT DEFAULT (datetime('now')),
  responded_at  TEXT,
  UNIQUE (post_id, initiator_id)                     -- 同一人对同一帖只能发起一次
);

CREATE INDEX IF NOT EXISTS idx_deal_conn_owner ON deal_connections(owner_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_conn_initiator ON deal_connections(initiator_id, created_at DESC);

-- 论坛免责声明文案（管理员可在站点内容里改）
INSERT OR IGNORE INTO site_content (slug, title, body, images) VALUES
  ('forum_disclaimer', '论坛免责声明',
   '本论坛仅为用户之间的信息交流与撮合提供平台。平台不对任何项目信息的真实性、完整性、准确性作出保证，亦不对基于论坛信息所作出的任何投资决策或由此产生的结果承担责任。\n\n论坛展示的评分为系统基于上传材料自动生成的参考意见，不构成任何投资建议。项目方自愿披露的项目信息及联系方式风险自担；投资人/FA 应自行独立尽职调查并核实信息。\n\n请勿在论坛发布虚假、误导、侵权或违法信息。平台有权对违规内容予以下架处理。',
   '[]');
