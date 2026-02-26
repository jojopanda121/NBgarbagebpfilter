-- 010_user_enhancements.sql
-- 添加 has_redeemed 字段：用户是否兑换过 Token
-- 兑换过 Token 的用户无需绑定手机/邮箱即可继续使用
ALTER TABLE users ADD COLUMN has_redeemed INTEGER DEFAULT 0;
