-- 018: tasks 表增加 project_location 字段（省份，用于地图展示）
ALTER TABLE tasks ADD COLUMN project_location TEXT;
