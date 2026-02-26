-- 009_task_enhancements.sql
-- Add title, client_ip, ip_region, industry_category fields to tasks table

ALTER TABLE tasks ADD COLUMN title TEXT DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN client_ip TEXT DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN ip_region TEXT DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN industry_category TEXT DEFAULT NULL;

-- Create index for industry_category statistics
CREATE INDEX IF NOT EXISTS idx_tasks_industry_category ON tasks(industry_category);
