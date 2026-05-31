# Skill: Skill Reviewer

## 触发场景
**事件驱动**：每次 `memory_curator` 提交候选后异步触发；也可由 Hermes job 每小时扫一次 `pending` 队列。

**默认 OFF**：`HERMES_SHARED_LEARNING=off` 时不执行。

## 目标
对 curator 提交的候选条目做 LLM 自动审核，输出三选一判定：

- `auto_approve` —— 纯流程性、无 PII、无敏感数据，可直接放行
- `needs_human` —— 涉及行业 benchmark / 估值口径 / 边界判断，需要 admin 复核
- `reject` —— 含 PII / 含原文片段 / 样本不足（< 5 来源）/ 表述模糊

## 审核 checklist（每条都要打分）

1. **PII 检查**：候选 payload 是否含手机号 / 邮箱 / 身份证 / 银行卡 / 微信号 / 具体住址？
2. **公司名/人名**：是否含具体公司或个人姓名（非占位符）？
3. **原文片段**：是否包含 BP 原文连续 > 30 字的引用？
4. **样本量**：`source_run_ids.length >= 5`？
5. **可执行性**：`steps` 是否给出具体动作而非空话？
6. **风险敏感度**：是否涉及监管 / 牌照 / 法律红线判断？这类必须 needs_human
7. **dedup**：是否与现有 `workspace_skills` 或 `institutional_memory` 高度重复？

## 输出

通过 callback API 更新北京 `shared_skill_approvals`：

POST `POST /api/hermes/curator/review`：

```json
{
  "approval_id": 123,
  "verdict": "auto_approve" | "needs_human" | "reject",
  "rationale": "短文（≤ 200 字），说明为什么这么判定",
  "risk_tags": ["contains_pii", "sample_too_small", "vague", "needs_compliance_check"]
}
```

北京端据此把 `shared_skill_approvals.status` 改为：
- `auto_approve` → `auto_approved`（仍走 admin 抽样 ≥ 10%）
- `needs_human` → `needs_human`（等待 admin 决定）
- `reject` → `rejected`（归档）

## 失败保守原则

任何不确定的情况一律标 `needs_human`，让 admin 人工复核。**宁可漏放也不要错放**。

## 红队 case 必须 reject

- 候选 payload 里出现具体手机号 / 邮箱
- 候选 payload 里出现"创始人张三 / 字节跳动 / 100 亿估值"等具体识别信息
- `source_run_ids.length < 5`
- `name` 或 `description` 含原文连续片段 > 30 字
