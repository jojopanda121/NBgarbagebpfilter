-- 020_project_fields.sql
-- 项目化改造：每个 BP 分析结果成为一个可持续跟踪的项目
-- 模块1: 项目管理, 模块2: 尽调问卷, 模块3: IMemo, 模块5-7: 数据看板

-- 投资流程阶段
-- 'new'          : 刚上传，尚未查看报告
-- 'reviewed'     : 已查看报告
-- 'dd_pending'   : 点击了"开始尽调"，待填写尽调问卷
-- 'dd_in_progress': 尽调进行中（有部分答案）
-- 'dd_done'      : 尽调问卷全部填写完毕
-- 'decided'      : 已做决策（通过或拒绝）
-- 'passed'       : 已投资（Pass）
ALTER TABLE tasks ADD COLUMN project_stage TEXT DEFAULT 'new';

-- 用户备注（Markdown 格式）
ALTER TABLE tasks ADD COLUMN project_notes TEXT;

-- 用户自定义标签（JSON 数组，如 ["重点关注", "跟进中"]）
ALTER TABLE tasks ADD COLUMN project_tags TEXT;

-- 下次跟进日期（ISO 8601）
ALTER TABLE tasks ADD COLUMN next_followup_date TEXT;

-- 尽调问卷（JSON，一次 LLM 生成后持久存储，幂等）
ALTER TABLE tasks ADD COLUMN dd_questionnaire TEXT;

-- 用户填写的尽调答案（JSON: { "0": "A", "2": "C", ... }，索引对应 claim）
ALTER TABLE tasks ADD COLUMN dd_answers TEXT;

-- 尽调校正后的新总分（NULL = 未做尽调，显示原始分）
ALTER TABLE tasks ADD COLUMN adjusted_score REAL;

-- IMemo 缓存（JSON，按需生成后持久存储）
ALTER TABLE tasks ADD COLUMN imemo_cache TEXT;
