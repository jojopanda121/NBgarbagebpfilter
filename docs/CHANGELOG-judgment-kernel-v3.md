# 投资判断内核 v3 — CHANGELOG（PIPELINE_VERSION v4.7.0）

面向一级市场投资人的 BP 评分系统重构。逐条对应原系统五个根因，说明每个怎么修的。
全部新逻辑走灰度开关 `SCORING_AGG`（off/shadow/on，默认 shadow），不破坏既有 38 项算术平均测试与
`Integrity Veto` 不变量。架构铁律保持：确定性内核（`scoring*.js` + `config/scoringTables.js`）纯函数、
零 LLM、可单测；证据层（`pipelineService`/agents）只产带出处的结构化数据，两层物理隔离。

## 根因 → 修复

1. **算术平均压缩方差（分数挤在 70-78）**
   → 新增 `scoringAggregate.js`（方案乙）：赛道相关加权 + 卓越加成（每维≥90 给 α，封顶 6）+
   A 级共振 gate（A 要求 total≥80 且 ≥2 维≥80，堵单维独大）。容忍单点短板：2-3 维卓越时
   即便重资产 S3 偏低也能上 A。取代 `calculateTotalScore` 的等权平均（后者保留作 off/对照）。

2. **缺失信息默认中性分，把项目往中心拽**
   → 每维输出 `coverage`(0-1)，缺失维在聚合中按 coverage 让权重归一，不再用中性默认硬撑；
   总分附 `confidence`(高/中/低)与区间宽度（覆盖越低区间越宽）。低信息项目显示"X分/低置信"，
   而非被默认分拉到中心（`_deriveCoverages` + 判断卡 `dimensions.*.coverage`）。

3. **子量表满分够不到**
   → S4 经验曲线 `min(10, 2.5×ln(年+1))` → `min(10, 年数/2.5)`（25 年触顶）；
   `scoringTables` 教育/同赛道/退出子档上限 9 → 10（清北复交/同赛道/IPO退出=满分10）。
   经验完全缺失改中性 6（不再用假设 5 年算低分）。`scoring.js` 与 `scoringEvidence.js` 同步。

4. **S3 对深科技结构性偏低（重资产被压到 ~40）**
   → S3 资本壁垒 harness（`scoringS3Harness.js`，v4.6.0 已建）正式接入聚合；
   聚合在硬科技赛道下调 S3 权重(.20→.16)、上调 S2 咽喉壁垒权重(.20→.24)。
   附带修复：`_toScoringInput` 此前漏传 `S3_Rubric/Capital_Archetype/Scale_Mechanism`，
   导致 S3 harness 在生产中拿不到结构化输入 —— 已补传。

5. **完全没有政策契合度维度**
   → 政策**融入** S1（需求侧：政策保障的需求→抬天花板）与 S3（资本侧：廉价耐心资本+资本壁垒），
   不设独立被平均的维度（`scoringPolicy.js` + `config` 的 `POLICY_TIERS` 五档表，可年度更新）。
   两通道量不同机制、不重叠 → 无双计。政策契合度仍显式 `policy_fit` readout + triggered_rules，
   供判断卡展示与回测，但不进加权平均。防后门：A 级共振 gate 使政策无法单独把项目顶上 A。

## 附加交付

- **S1 二阶加速（基因⑤）**：新增 `Company_Revenue_Growth_YoY` 输入，奖励"小基数+高斜率"；
  市场 CAGR 退为天花板辅助（停滞赛道封顶可疑增速）。无公司增速时回退市场 CAGR（向后兼容）。
- **判断卡（阶段5）**：总分以分布（中位+区间+置信度）呈现 + 敏感性 top3 + 触发规则（每条带逻辑）
  + 政策 readout。后端 `buildVerdictResponse` 透传，前端 `VerdictCard.jsx` 的 `JudgmentCardV3`
  在 `SCORING_AGG=on` 时渲染（shadow/off 自动隐藏）。
- **诊断式校准/回测（第9部分）**：`calibrationService.js` + migration `064_scoring_calibration.sql`。
  归档每次 judgment 快照，GP 事后标注真实标签后算：排序吻合度(Kendall τ)/系统性偏差/规则命中×结果回测/
  分布漂移。**不做自动参数反解**（几十噪声样本反解 ~20 参数必过拟合且破坏可解释）—— 参数手设，
  标签只诊断不回写。
- **检索纪律（第7部分）**：`retrievalDiscipline.js` —— 来源可信度分层（官方/监管>财经媒体>行研>其他，
  丢弃命理/玄学/SEO 农场）、调用硬上限（每条声明≤2、单项目≤14）、冲突取保守值、search_log 结构。
  接入 `runWebSearch`（过滤+排序+去重）。

## 回归验收（`__tests__/scoringBenchmarks.test.js`，排序+档位+veto，不钉死点分）

| 标的 | 总分 | 评级 |
|---|---|---|
| 寒武纪 / 摩尔线程 / 长鑫 / 长江 / 宁德 | 91–98 | A |
| 反例B 平庸SaaS | ~73 | 非 A（轻资产≠自动高分） |
| 反例A 钢铁厂 | ~47 | D |
| 反例C 财务造假 | — | Integrity Veto → 封顶 C |

排序：五标杆 > 反例B > 反例A；间距显著（≥13）。全套 583 测试通过。

## 切 on 路线

shadow 落库 → `calibrationService.runDiagnostics()` 看排序吻合度/偏差 → 校准达标后
`SCORING_AGG=on`（连同 `SCORING_HARNESS`/`SCORING_S3_HARNESS`）。在此之前 live 仍是旧算术平均，
新分仅作 `scoring_agg_shadow` 对照块落库。
