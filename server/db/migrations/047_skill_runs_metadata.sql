-- 047_skill_runs_metadata.sql
-- P3-4: 把 skill 运行时 metadata（fallback / semantic_audit / upload_structured /
-- institutional_memory / sector_compliance 等）独立成列，方便 metricsAggregator
-- 跑 SQL 聚合，而不是逐行解析 artifact_json。
--
-- 旧行 metadata_json 默认 NULL，aggregator 会跳过它们。

ALTER TABLE skill_runs ADD COLUMN metadata_json TEXT;
