-- ============================================================
-- 046_institutional_memory.sql
--
-- P3-3 机构记忆（categorical RAG）：沉淀过去看过的项目决策结果，
-- 给新项目的 skill 流程提供"我们过去为什么投/没投类似项目"的上下文。
--
-- 非向量库版：纯标签匹配 (industry / sub_industry / business_model / stage)，
-- 通过 SQL 索引快速过滤；ranking 由 services/institutionalMemory.js 完成。
-- ============================================================

CREATE TABLE IF NOT EXISTS institutional_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT NOT NULL,
  industry TEXT NOT NULL,
  sub_industry TEXT,
  business_model TEXT,
  stage TEXT,
  region TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('invested', 'passed', 'observed', 'watchlist')),
  thesis TEXT,
  kill_factors TEXT,                 -- 多条用 \n 分隔; 决策时点的致命伤陈述
  precedent_outcome TEXT,            -- 决策后续观察到的结果（'IPO 2024' / '关门 2025 Q2' / '仍在 watch'）
  decision_date TEXT NOT NULL,       -- ISO YYYY-MM-DD
  lead_partner TEXT,
  source_project_id INTEGER,         -- 关联到 projects 表（若该决策源自系统内项目）
  meta_json TEXT,                    -- 任意元数据 JSON: 估值、轮次细节、tags 等
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 检索用复合索引：先按 industry 过滤，再按 business_model / stage 排序
CREATE INDEX IF NOT EXISTS idx_im_industry          ON institutional_memory(industry);
CREATE INDEX IF NOT EXISTS idx_im_business_model    ON institutional_memory(business_model);
CREATE INDEX IF NOT EXISTS idx_im_stage             ON institutional_memory(stage);
CREATE INDEX IF NOT EXISTS idx_im_decision_date     ON institutional_memory(decision_date);
CREATE INDEX IF NOT EXISTS idx_im_source_project_id ON institutional_memory(source_project_id);
