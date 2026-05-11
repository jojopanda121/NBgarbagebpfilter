const { querySharedMemory, recordSharedUse } = require("./sharedContextMemoryStore");
const { queryLongTermMemory, recordLongTermUse } = require("./longTermMemoryStore");
const { matchSkills, recordSkillUse } = require("./skillRegistry");

function categoriesForAgent(agentName, taskType) {
  const base = {
    market: ["market", "company_fact", "open_question"],
    finance: ["finance", "deal_terms", "company_fact"],
    tech: ["tech", "company_fact", "open_question"],
    risk: ["risk", "company_fact", "open_question"],
    host: ["market", "finance", "tech", "risk", "deal_terms", "company_fact", "user_requirement"],
  }[agentName] || ["company_fact"];
  if (taskType === "generate_xlsx") return [...new Set([...base, "finance", "risk"])];
  if (taskType?.startsWith("generate_")) return [...new Set([...base, "user_requirement"])];
  return base;
}

async function queryMemory({ userId, taskId, agentName, taskType, userMessage, intent }) {
  const categories = categoriesForAgent(agentName, taskType);
  const shared = taskId ? querySharedMemory(taskId, {
    category: categories,
    intent: intent || taskType,
    agentName,
    limit: agentName === "host" ? 12 : 8,
  }) : [];
  const longTerm = userId ? queryLongTermMemory(userId, {
    trigger: intent || taskType || userMessage,
    taskType,
    agentName,
    limit: agentName === "host" ? 5 : 3,
  }) : [];
  const skills = userId ? matchSkills({ userId, taskType, userMessage, limit: 3 }) : [];

  recordSharedUse(shared.map((m) => m.id), { taskId, userId, agentName, outcome: "used" });
  recordLongTermUse(longTerm.map((m) => m.id), { taskId, userId, agentName, outcome: "used" });
  for (const skill of skills) recordSkillUse(skill.id, "used");

  return { shared, longTerm, skills };
}

function formatMemoryPack(memoryPack) {
  const lines = ["# 显式 Memory 查询结果", "这些是结构化记忆，不是原文片段。请只使用相关证据，不要声称你在自动读取全部历史。"];
  if (memoryPack?.shared?.length) {
    lines.push("", "## Layer 2 Shared Context Memory");
    for (const m of memoryPack.shared) {
      const evidence = (m.evidence || []).map((e) => e.quote_or_fact || e.snippet || e.title || "").filter(Boolean).slice(0, 3).join("；");
      lines.push(`- [${m.category}] ${m.claim}${m.implication ? ` => ${m.implication}` : ""}${evidence ? `（证据：${evidence}）` : ""}`);
    }
  }
  if (memoryPack?.longTerm?.length) {
    lines.push("", "## Layer 3 Long-term Memory");
    for (const m of memoryPack.longTerm) {
      lines.push(`- [${m.type}] 触发：${m.trigger}；规则：${m.rule}；动作：${m.action}`);
    }
  }
  if (memoryPack?.skills?.length) {
    lines.push("", "## 可复用 Skills");
    for (const s of memoryPack.skills) {
      const steps = (s.steps || []).map((step) => step.action).filter(Boolean).slice(0, 4).join(" -> ");
      lines.push(`- ${s.name}: ${s.description}${steps ? `；步骤：${steps}` : ""}`);
    }
  }
  return lines.join("\n");
}

module.exports = {
  queryMemory,
  formatMemoryPack,
  categoriesForAgent,
};
