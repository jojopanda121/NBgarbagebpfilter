# Skill: Memory Curator

## 触发场景
**定时任务**：每天北京时间 03:00 由 Hermes job 调度触发。
**默认 OFF**：北京环境变量 `HERMES_SHARED_LEARNING=off` 时，curator job 不执行。

## 目标
扫描过去 24 小时内的会话和工具调用，**提炼可跨用户共享的"程序性知识"**——例如：

- 80% 用户在"消费医疗 BP"场景下都会追问"收入确认是否合规"
- "硬科技 A 轮 TAM 夸大"的常见识别模式
- "财务模型缺 LTV/CAC 时"的标准判断流程

## 严格 do-not
- **不**提取具体公司名、人名、手机号、身份证（这些在脱敏映射表里）
- **不**复述具体 BP 原文片段
- **不**复制单个会话——必须从 ≥ 5 个独立会话归纳出共性
- **不**提取与单个用户偏好绑定的内容（那是 user memory 私有层）

## 工作流

1. 拉取 24h 内的 sessions（按 `bp_pipeline_playbook` 或 `host` 触发的）
2. 按 (industry, stage, business_model) 聚类
3. 对每个聚类，提取频繁出现的：
   - **问题模式**（用户反复追问的同类问题）
   - **流程模式**（host 反复执行的同类拆解）
   - **红旗模式**（reviewer 反复标的同类风险）
4. 每个候选模式必须满足：
   - 来自 ≥ 5 个独立 session
   - 不包含个体 PII / 公司名
   - 可表达为 `name + description + trigger + steps` 的程序性技能
5. 通过 callback API 提交到北京 `shared_skill_approvals`

## Callback 协议

POST 北京 `POST /api/hermes/curator/submit`，Bearer 用 HERMES_API_KEY：

```json
{
  "target_table": "workspace_skills",      // 或 "institutional_memory"
  "candidate_payload": {
    "name": "消费医疗收入确认核验流程",
    "description": "...",
    "trigger": { "task_type": ["bp_analysis"], "keywords": ["消费医疗", "医美"] },
    "required_inputs": ["...","..."],
    "steps": [{ "step": 1, "action": "...", "rationale": "..." }],
    "success_criteria": ["..."],
    "failure_modes": ["..."]
  },
  "source_run_ids": ["run_abc", "run_def", "..."],
  "rationale": "本候选基于 N 个 session 的共性归纳，无 PII"
}
```

提交后：
- 北京端写 `shared_skill_approvals (status=pending)`
- 由 `skill_reviewer` 异步审
- admin 抽样人工复核

## 频率上限

- 单次任务提交候选 ≤ 20 条
- 重复模式 dedup：candidate_payload.name 在过去 30 天内重复出现的不提交
