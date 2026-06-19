-- ============================================================
-- 064_scoring_calibration.sql
--
-- 诊断式校准/回测层（投资判断内核 v3，第9部分）。
-- 设计决策（与用户确认）：**不做自动参数反解**（几十个噪声样本上反解 ~20 个权重
-- /阈值/聚合系数必然过拟合，且破坏可解释铁律）。本表只做"留痕 + 诊断"：
--   • 每次打分归档一份 judgment 快照（总分/评级/六维/政策 readout/触发规则）。
--   • GP 事后给"真实标签"（投/观望/放弃 或事后实际表现）。
--   • 诊断脚本据此算：排序吻合度、系统性偏差、规则命中×结果回测、分布漂移。
-- 参数仍手设可解释；标签只用来诊断，不回写改内核。
-- ============================================================

CREATE TABLE IF NOT EXISTS scoring_calibration (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  project_name TEXT,
  industry_category TEXT,
  pipeline_version TEXT,
  scoring_agg_basis TEXT,          -- legacy | aggregate_v3（live 实际用的聚合）
  total_score INTEGER,             -- 归档时的 live 总分
  grade TEXT,
  confidence TEXT,                 -- 高/中/低（来自分布）
  dims_json TEXT,                  -- {s1..s5}
  coverages_json TEXT,             -- {S1..S5} 覆盖度
  policy_tier TEXT,
  policy_readout INTEGER,          -- 政策契合度 readout（不进平均，可回测）
  triggered_tags_json TEXT,        -- 触发的规则 tag 数组（规则回测用）
  integrity_veto INTEGER DEFAULT 0,
  agg_shadow_json TEXT,            -- shadow 对照块（新旧分对照，校准用）
  -- GP 标注（事后填）
  gp_label TEXT,                   -- 投 | 观望 | 放弃（或 fast_track/dd/watch/pass）
  gp_label_at TEXT,
  outcome_json TEXT,               -- 事后实际表现（自由结构，可选）
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scoring_calibration_label
  ON scoring_calibration(gp_label, created_at);
CREATE INDEX IF NOT EXISTS idx_scoring_calibration_task
  ON scoring_calibration(task_id);
CREATE INDEX IF NOT EXISTS idx_scoring_calibration_version
  ON scoring_calibration(pipeline_version, created_at);
