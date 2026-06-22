-- 067: BP 深度尽调（multiagent 6 Agent）改为按需生成
--
-- 背景：原先 6 个 Agent 在 BP 分析流水线里强制并发执行并自动展示。
-- 改版后分析阶段不再自动跑（省算力 + 投研结论不再喂评分），改为用户
-- 在工作区点按钮按需生成。
--
-- bp_text:          持久化 BP 原文。6 个 Agent 依赖 bpFullText，而原文此前
--                   只在内存中（tasks 表不存），按需重跑必须能取回原文。
-- multiagent_cache: 缓存按需生成的 6 段尽调报告 JSON，二次打开直接返回。
ALTER TABLE tasks ADD COLUMN bp_text TEXT DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN multiagent_cache TEXT DEFAULT NULL;
