-- 017: tasks 表增加 total_score 字段（从 result JSON 提取，便于排行榜查询）
ALTER TABLE tasks ADD COLUMN total_score REAL;

-- 回填已有数据的 total_score（从 result JSON 中提取）
-- SQLite 支持 json_extract
UPDATE tasks
SET total_score = json_extract(result, '$.verdict.total_score')
WHERE status = 'complete' AND result IS NOT NULL AND total_score IS NULL;
