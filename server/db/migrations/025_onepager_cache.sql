-- 025_onepager_cache.sql
-- 一页投资亮点 PPT 的缓存（JSON 字符串：含 headline / overview / market / highlights / risks / footer）
ALTER TABLE tasks ADD COLUMN onepager_cache TEXT;
