-- 软删除：用户可以隐藏报告，但数据库保留数据
ALTER TABLE tasks ADD COLUMN deleted_at TEXT DEFAULT NULL;
