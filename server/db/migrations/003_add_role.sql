-- ============================================================
-- Migration 003: 添加用户角色字段
-- ============================================================

-- 为 users 表添加 role 列（默认为 'user'）
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';

-- 为现有管理员设置角色（如果需要）
-- UPDATE users SET role = 'admin' WHERE username = 'admin';
