-- 015: 为任务添加档案号（archive_number）
-- 格式: DA-YYYYMMDD-XXXX (如 DA-20260309-0001)
ALTER TABLE tasks ADD COLUMN archive_number TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_archive_number ON tasks(archive_number);
