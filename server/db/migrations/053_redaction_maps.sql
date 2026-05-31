-- ============================================================
-- 053_redaction_maps.sql
--
-- 脱敏映射表 —— 反脱敏依赖。永不出境，仅存北京 SQLite。
--
-- 设计：
--   每次出境前 redactor 把 PII (手机/邮箱/身份证/银行卡/微信号/住址 等)
--   和"谨慎"字段(创始人完整姓名等)替换成占位符 (例如 [PHONE_3]、[FOUNDER_1])，
--   占位符 -> 原值映射写入本表。Hermes 返回的文本里若包含占位符，
--   unredactor 读本表还原。
--
--   公司名/收入/估值/ARR 等商业字段 *不在此处脱敏*，按 plan 直接保留出境。
--
-- 字段说明：
--   session_id    —— 北京端按 conversation_id 拼装的 redact session
--                   (BP pipeline 用 bp:${bp_id})
--   placeholder   —— 例如 [PHONE_3]
--   original      —— 原始值（密文还原后明文）
--   kind          —— 'phone' | 'email' | 'id_card' | 'bank_card' |
--                    'wechat' | 'address' | 'founder_name'
--   created_at    —— 创建时间，用于 TTL 24h GC
-- ============================================================

CREATE TABLE IF NOT EXISTS redaction_maps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL,
  placeholder TEXT    NOT NULL,
  original    TEXT    NOT NULL,
  kind        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, placeholder)
);

CREATE INDEX IF NOT EXISTS idx_redaction_maps_session
  ON redaction_maps(session_id);

CREATE INDEX IF NOT EXISTS idx_redaction_maps_created
  ON redaction_maps(created_at);
