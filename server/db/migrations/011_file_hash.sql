-- 011: 添加文件哈希字段，用于 BP 文件去重
ALTER TABLE tasks ADD COLUMN file_hash TEXT DEFAULT NULL;

-- 索引：按 file_hash + status 快速查找已完成的相同文件
CREATE INDEX IF NOT EXISTS idx_tasks_file_hash ON tasks(file_hash, status);
