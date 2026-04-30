// ============================================================
// server/services/workspaceService.js — 多 Agent 工作区服务
//
// 负责：会话/消息/附件的存取，项目上下文构建，主持人 routing，
// 专家并行调用，host 流式汇总，工具调用解析（generate_pptx）。
// ============================================================

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { getDb } = require("../db");
const { getTask } = require("./taskService");
const { callLLM, callLLMChat, callLLMWithSearch } = require("./llmService");
const config = require("../config");
const {
  WORKSPACE_HOST_ROUTING_PROMPT,
  WORKSPACE_HOST_SYSTEM_PROMPT,
  buildWorkspaceExpertPrompt,
} = require("../utils/prompts");

const ARTIFACTS_ROOT = path.join(__dirname, "..", "..", "data", "workspace_artifacts");
if (!fs.existsSync(ARTIFACTS_ROOT)) fs.mkdirSync(ARTIFACTS_ROOT, { recursive: true });

const VALID_AGENTS = ["market", "finance", "tech", "risk"];

function uuid() { return crypto.randomBytes(16).toString("hex"); }

// ── 会话 / 消息 ─────────────────────────────────────────────

function createOrGetConversation(taskId, userId) {
  const db = getDb();
  const existing = db.prepare(
    "SELECT * FROM workspace_conversations WHERE task_id = ? AND user_id = ? ORDER BY created_at ASC LIMIT 1"
  ).get(taskId, userId);
  if (existing) return existing;

  const id = uuid();
  db.prepare(
    `INSERT INTO workspace_conversations (id, task_id, user_id, title)
     VALUES (?, ?, ?, '默认会话')`
  ).run(id, taskId, userId);
  return db.prepare("SELECT * FROM workspace_conversations WHERE id = ?").get(id);
}

function appendMessage(conversationId, role, agentName, content, metadata) {
  const db = getDb();
  const id = uuid();
  db.prepare(
    `INSERT INTO workspace_messages (id, conversation_id, role, agent_name, content, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    conversationId,
    role,
    agentName || null,
    content,
    metadata ? JSON.stringify(metadata) : null
  );
  db.prepare("UPDATE workspace_conversations SET updated_at = datetime('now') WHERE id = ?")
    .run(conversationId);
  return id;
}

function listMessages(conversationId, limit = 200) {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, role, agent_name, content, metadata, created_at
     FROM workspace_messages
     WHERE conversation_id = ?
     ORDER BY created_at ASC LIMIT ?`
  ).all(conversationId, limit);
  return rows.map(r => ({
    ...r,
    metadata: r.metadata ? safeParse(r.metadata) : null,
  }));
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// ── Artifacts ──────────────────────────────────────────────

function listArtifacts(conversationId) {
  const db = getDb();
  return db.prepare(
    `SELECT id, kind, filename, mime_type, size_bytes, summary, created_at, message_id
     FROM workspace_artifacts WHERE conversation_id = ? ORDER BY created_at DESC`
  ).all(conversationId);
}

function getArtifact(artifactId) {
  const db = getDb();
  return db.prepare("SELECT * FROM workspace_artifacts WHERE id = ?").get(artifactId);
}

function insertArtifact({ conversationId, messageId, kind, filename, storagePath, mimeType, sizeBytes, summary }) {
  const db = getDb();
  const id = uuid();
  db.prepare(
    `INSERT INTO workspace_artifacts
       (id, conversation_id, message_id, kind, filename, storage_path, mime_type, size_bytes, summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, conversationId, messageId || null, kind, filename, storagePath, mimeType || null, sizeBytes || null, summary || null);
  return db.prepare("SELECT * FROM workspace_artifacts WHERE id = ?").get(id);
}

// ── 上下文构建 ─────────────────────────────────────────────

/**
 * 抽取项目核心上下文（紧凑版，~2-3k tokens）
 * 来源：tasks.result.extracted_data / verdict / claim_verdicts + 最近 artifact summaries
 */
function buildProjectContext(taskId, conversationId) {
  const task = getTask(taskId);
  if (!task) return "（项目数据不存在）";

  let result = task.result;
  if (typeof result === "string") {
    try { result = JSON.parse(result); } catch { result = null; }
  }
  result = result || {};

  const ed = result.extracted_data || {};
  const v = result.verdict || {};
  const dims = v.dimensions || {};
  const claims = result.claim_verdicts || [];

  const riskyClaims = claims
    .filter(c => ["夸大", "严重夸大", "信息不对称", "证伪"].includes(c.verdict))
    .slice(0, 8)
    .map(c => `- [${c.verdict}] ${c.original_claim}${c.diff ? `（${c.diff}）` : ""}`)
    .join("\n");

  const dimSummary = Object.entries(dims)
    .map(([k, val]) => {
      const score = val?.score ?? val?.total_score;
      return `  - ${k}: ${score != null ? `${score}分` : "—"}`;
    })
    .join("\n");

  const lines = [
    `# 项目快照`,
    `公司: ${ed.company_name || task.title || "（未知）"}`,
    `行业: ${ed.industry || "（未知）"}`,
    `所在地: ${task.project_location || ed.project_location || "（未知）"}`,
    `BP声称估值: ${ed.BP_Valuation || "—"}；声称收入/ARR: ${ed.BP_Revenue || "—"}`,
    `TAM(百万RMB): ${ed.TAM_Million_RMB || "—"}；CAGR(%): ${ed.CAGR || "—"}；TRL: ${ed.TRL || "—"}`,
    `商业模式: ${ed.Business_Model || "—"}；增长引擎: ${ed.Growth_Engine || "—"}`,
    `创始人相关从业年: ${ed.Founder_Exp_Years || "—"}`,
    "",
    `# 综合评分`,
    `总分: ${task.adjusted_score ?? v.total_score ?? "—"}（${v.grade_label || "—"}）`,
    `各维度:`,
    dimSummary || "  （无）",
    "",
    `# 主要风险/信息不对称`,
    riskyClaims || "（暂未发现明显风险声明）",
  ];

  // 附加最近 artifact summaries
  if (conversationId) {
    const arts = listArtifacts(conversationId).filter(a => a.summary).slice(0, 5);
    if (arts.length > 0) {
      lines.push("", "# 用户已补充材料摘要");
      for (const a of arts) lines.push(`- ${a.filename}: ${a.summary}`);
    }
  }
  return lines.join("\n");
}

// ── Routing：决定调度哪些专家 ───────────────────────────────

async function runHostRouting(projectCtx, history, userMsg) {
  const userPrompt = `# 项目上下文\n${projectCtx}\n\n# 最近对话\n${formatHistory(history, 8)}\n\n# 当前用户消息\n${userMsg}`;
  let raw;
  try {
    raw = await callLLM(WORKSPACE_HOST_ROUTING_PROMPT, userPrompt, 512);
  } catch (err) {
    console.warn("[Workspace] routing LLM 失败，回退为空:", err.message);
    return { agents: [], reason: "routing_failed" };
  }
  const obj = parseRoutingJson(raw);
  if (!obj || !Array.isArray(obj.agents)) return { agents: [], reason: "parse_failed" };
  obj.agents = obj.agents.filter(a => VALID_AGENTS.includes(a)).slice(0, 4);
  return obj;
}

function parseRoutingJson(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/```json\s*|```/g, "").trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function formatHistory(history, max) {
  return history.slice(-max).map(m => {
    const tag = m.role === "user" ? "用户" : (m.agent_name || "AI");
    return `【${tag}】${m.content}`;
  }).join("\n");
}

// ── 专家并行调用 ───────────────────────────────────────────

// 市场/风险专家对宏观新数据敏感，启用 web_search；财务/技术走普通模式
const SEARCH_ENABLED_AGENTS = new Set(["market", "risk"]);

async function runExpert(agentName, projectCtx, history, userMsg) {
  const sys = buildWorkspaceExpertPrompt(agentName);
  const userPrompt = `# 项目上下文\n${projectCtx}\n\n# 最近对话\n${formatHistory(history, 6)}\n\n# 用户当前问题\n${userMsg}`;
  if (SEARCH_ENABLED_AGENTS.has(agentName)) {
    try {
      const { text } = await callLLMWithSearch(sys, userPrompt, { maxTokens: 1500 });
      return { agent: agentName, content: text.trim() };
    } catch (err) {
      console.warn(`[Workspace] ${agentName} web_search 失败，降级:`, err.message);
    }
  }
  const text = await callLLM(sys, userPrompt, 1500);
  return { agent: agentName, content: text.trim() };
}

async function runExpertsParallel(agents, projectCtx, history, userMsg, onExpertDone) {
  const tasks = agents.map(async (a) => {
    try {
      const out = await runExpert(a, projectCtx, history, userMsg);
      onExpertDone?.(out);
      return out;
    } catch (err) {
      const out = { agent: a, content: `（${a} 专家暂时不可用：${err.message}）`, error: true };
      onExpertDone?.(out);
      return out;
    }
  });
  return Promise.all(tasks);
}

// ── Host 流式汇总 ──────────────────────────────────────────

async function streamHostSummary({ projectCtx, history, userMsg, expertOutputs, onDelta, signal }) {
  const expertBlock = expertOutputs.length > 0
    ? expertOutputs.map(e => `## ${e.agent} 专家意见\n${e.content}`).join("\n\n")
    : "（无专家协助，直接回答）";

  const userPrompt = [
    `# 项目上下文`,
    projectCtx,
    "",
    `# 最近对话`,
    formatHistory(history, 8),
    "",
    `# 用户当前消息`,
    userMsg,
    "",
    `# 专家意见汇总`,
    expertBlock,
    "",
    "请融会贯通后给用户回答。"
  ].join("\n");

  return callLLMChat(
    WORKSPACE_HOST_SYSTEM_PROMPT,
    [{ role: "user", content: userPrompt }],
    { maxTokens: 3000, onDelta, signal }
  );
}

// ── 工具调用解析 ───────────────────────────────────────────

function parseToolCalls(content) {
  const re = /<TOOL_CALL>([\s\S]*?)<\/TOOL_CALL>/g;
  const calls = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (parsed && parsed.tool) calls.push(parsed);
    } catch (err) {
      console.warn("[Workspace] tool_call JSON 解析失败:", err.message);
    }
  }
  return calls;
}

function stripToolCalls(content) {
  return content.replace(/<TOOL_CALL>[\s\S]*?<\/TOOL_CALL>/g, "").trim();
}

/**
 * 执行 generate_pptx 工具：调用 doc-service /generate/pptx，
 * 把返回的二进制保存到本地 artifacts 目录，并写入 workspace_artifacts。
 */
async function executeGeneratePptx({ args, conversationId, messageId }) {
  if (!config.docServiceUrl) throw new Error("doc-service 未配置");
  const slides = Array.isArray(args?.slides) ? args.slides : [];
  const title = args?.title || "投委会简报";
  if (slides.length === 0) throw new Error("slides 为空");

  const resp = await fetch(`${config.docServiceUrl}/generate/pptx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, slides }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`doc-service 错误: ${t}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());

  const convDir = path.join(ARTIFACTS_ROOT, conversationId);
  if (!fs.existsSync(convDir)) fs.mkdirSync(convDir, { recursive: true });
  const safeTitle = title.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 40);
  const filename = `${safeTitle}-${Date.now()}.pptx`;
  const fullPath = path.join(convDir, filename);
  fs.writeFileSync(fullPath, buf);

  return insertArtifact({
    conversationId,
    messageId,
    kind: "generated_pptx",
    filename,
    storagePath: fullPath,
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    sizeBytes: buf.length,
    summary: `${slides.length} 页 PPT：${title}`,
  });
}

async function executeToolCalls(calls, { conversationId, messageId }) {
  const results = [];
  for (const c of calls) {
    try {
      if (c.tool === "generate_pptx") {
        const art = await executeGeneratePptx({ args: c.args || {}, conversationId, messageId });
        results.push({ tool: c.tool, artifact: art });
      } else {
        results.push({ tool: c.tool, error: "未知工具" });
      }
    } catch (err) {
      results.push({ tool: c.tool, error: err.message });
    }
  }
  return results;
}

// ── 上传材料处理 ───────────────────────────────────────────

/**
 * 用 LLM 给上传文档生成一段简短摘要（注入后续 prompt 用）
 */
async function summarizeUploadedText(text, filename) {
  const trimmed = text.length > 8000 ? text.slice(0, 8000) + "\n...（已截断）" : text;
  const sys = `你是项目助理。请给以下补充材料生成 100-200 字的中文摘要，突出与投资判断相关的事实/数据/关键论点。只输出摘要正文。`;
  const user = `文件名: ${filename}\n\n内容:\n${trimmed}`;
  try {
    const out = await callLLM(sys, user, 400);
    return out.trim();
  } catch (err) {
    return `（摘要失败：${err.message}）`;
  }
}

module.exports = {
  VALID_AGENTS,
  createOrGetConversation,
  appendMessage,
  listMessages,
  listArtifacts,
  getArtifact,
  insertArtifact,
  buildProjectContext,
  runHostRouting,
  runExpertsParallel,
  streamHostSummary,
  parseToolCalls,
  stripToolCalls,
  executeToolCalls,
  summarizeUploadedText,
  ARTIFACTS_ROOT,
};
