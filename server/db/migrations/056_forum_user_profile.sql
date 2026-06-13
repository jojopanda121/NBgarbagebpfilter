-- 056_forum_user_profile.sql
-- 论坛身份资料：投资人 / 项目方 / FA 标签 + 论坛展示资料
--
-- 设计：user_type 是"社区身份"，与权限字段 role(user/admin) 严格分离。
--   role  = 鉴权/权限，不可被用户自改
--   user_type = 社区身份标签，用户可在资料页自选
--
-- contact_card 存"建立联系后才解锁"的名片（微信/邮箱/电话等），平时不公开；
-- 帖子里是否直接挂联系方式由发帖人单独决定，与此无关。

ALTER TABLE users ADD COLUMN user_type TEXT DEFAULT 'unset';   -- 'investor' | 'founder' | 'fa' | 'unset'
ALTER TABLE users ADD COLUMN type_verified INTEGER DEFAULT 0;  -- 身份是否经过认证（初期恒 0，后期加机构邮箱/名片认证）
ALTER TABLE users ADD COLUMN display_name TEXT;                -- 论坛展示名（空则回退 username）
ALTER TABLE users ADD COLUMN org_name TEXT;                    -- 机构/公司名（可空）
ALTER TABLE users ADD COLUMN bio TEXT;                         -- 一句话简介
ALTER TABLE users ADD COLUMN contact_card TEXT;                -- 名片（微信/邮箱/电话），仅撮合授权后互相可见

CREATE INDEX IF NOT EXISTS idx_users_user_type ON users(user_type);
