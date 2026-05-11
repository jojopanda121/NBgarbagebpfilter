const { callLLM } = require("../llmService");
const { upsertSharedMemory } = require("./sharedContextMemoryStore");
const { upsertLongTermMemory } = require("./longTermMemoryStore");
const { maybeCreateSkillFromRun } = require("./skillRegistry");
const { clampText, normalizeKey } = require("./utils");

function categoryForAgent(agentName) {
  if (["market", "finance", "tech", "risk"].includes(agentName)) return agentName;
  return "company_fact";
}

function parseJsonArray(text) {
  if (!text) return [];
  const cleaned = text.replace(/```json\s*|```/g, "").trim();
  const m = cleaned.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function heuristicDistill({ agentName, content, sourceType = "agent" }) {
  const category = categoryForAgent(agentName);
  return String(content || "")
    .split(/\n+/)
    .map((line) => line.replace(/^[-*#\d.\s]+/, "").trim())
    .filter((line) => line.length >= 18 && line.length <= 220)
    .slice(0, 4)
    .map((line) => ({
      scope: "project",
      category,
      claim: line,
      evidence: [{ source_type: sourceType, quote_or_fact: line.slice(0, 160) }],
      implication: "",
      confidence: 0.55,
      tags: [agentName].filter(Boolean),
      owner_agent: agentName,
    }));
}

function qualityAccept(item) {
  if (!item?.claim || item.claim.length < 12) return false;
  if (item.claim.length > 2000) return false;
  if (!Array.isArray(item.evidence) || item.evidence.length === 0) return false;
  if (/我来|实时搜索工具|tool_call|web_search/i.test(item.claim)) return false;
  return true;
}

async function distillToEvidence({ agentName, content, taskType, sourceType = "agent" }) {
  const text = clampText(content, 4000);
  if (!text) return [];
  const sys = `你是 Workspace Keeper，职责是把 Agent 输出炼成结构化记忆证据。
只输出 JSON 数组，不要 markdown。每项必须是可直接注入投资判断的结论，不要保存原文碎片。
字段：scope("project"或"long_term")、category、claim、evidence[{source_type,quote_or_fact,url,date}]、implication、confidence、tags。
long_term 只允许保存用户偏好、判断框架、常见风险模式，不允许保存具体项目数据。最多输出 4 项。`;
  const user = `agent=${agentName || "host"}\ntask_type=${taskType || "answer"}\nsource_type=${sourceType}\n\n内容：\n${text}`;
  try {
    const raw = await callLLM(sys, user, 900);
    const parsed = parseJsonArray(raw);
    const normalized = parsed.map((item) => ({
      scope: item.scope === "long_term" ? "long_term" : "project",
      category: item.category || categoryForAgent(agentName),
      claim: clampText(item.claim, 2000),
      evidence: Array.isArray(item.evidence) ? item.evidence.slice(0, 4) : [{ source_type: sourceType, quote_or_fact: clampText(item.claim || text, 180) }],
      implication: clampText(item.implication || "", 800),
      confidence: Math.max(0.1, Math.min(0.95, Number(item.confidence || 0.6))),
      tags: Array.isArray(item.tags) ? item.tags.slice(0, 8) : [agentName].filter(Boolean),
      owner_agent: agentName,
      claim_key: normalizeKey(item.claim || ""),
    }));
    return normalized.filter(qualityAccept);
  } catch (err) {
    console.warn("[Keeper] LLM 提炼失败，使用启发式提炼:", err.message);
    return heuristicDistill({ agentName, content, sourceType }).filter(qualityAccept);
  }
}

async function processAgentOutput({ taskId, userId, agentName, content, taskType, sourceType = "agent" }) {
  if (!taskId || !content) return { shared: 0, longTerm: 0, discarded: 0 };
  const items = await distillToEvidence({ agentName, content, taskType, sourceType });
  let shared = 0;
  let longTerm = 0;
  let discarded = 0;
  for (const item of items) {
    if (item.scope === "long_term") {
      if (!userId) { discarded++; continue; }
      const saved = upsertLongTermMemory(userId, {
        type: item.category === "risk" ? "risk_pattern" : "decision_preference",
        trigger: taskType || "general",
        rule: item.claim,
        action: item.implication || "在同类任务中优先检查该规则。",
        examples: item.evidence?.map((e) => e.quote_or_fact).filter(Boolean).slice(0, 3),
        confidence: item.confidence,
      });
      if (saved) longTerm++; else discarded++;
    } else {
      const saved = upsertSharedMemory(taskId, item);
      if (saved) shared++; else discarded++;
    }
  }
  return { shared, longTerm, discarded };
}

async function processUploadSummary({ taskId, userId, filename, summary }) {
  return processAgentOutput({
    taskId,
    userId,
    agentName: "host",
    taskType: "analyze_file",
    sourceType: "upload",
    content: `文件：${filename}\n摘要：${summary}`,
  });
}

function processSkillCandidate(args) {
  return maybeCreateSkillFromRun(args);
}

module.exports = {
  distillToEvidence,
  processAgentOutput,
  processUploadSummary,
  processSkillCandidate,
  qualityAccept,
};
