// ============================================================
// server/services/workspaceService.js — 多 Agent 工作区服务
//
// 负责：会话/消息/附件的存取，项目上下文构建，主持人 routing，
// 专家并行调用，host 流式汇总，工具调用解析（registry allowlist）。
// ============================================================

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { getDb } = require("../db");
const { getTask } = require("./taskService");
const { callLLM, callLLMAgentic } = require("./llmService");
const { buildSearchQueries, runWebSearch, formatSearchContext } = require("./webSearchService");
const { queryMemory, formatMemoryPack } = require("./memory/memoryRouter");
const { createWorkingMemory, appendWorkingFinding } = require("./memory/workingMemoryStore");
const keeper = require("./memory/keeperService");
const { runMemoryGc } = require("./memory/gcService");
const config = require("../config");
const {
  WORKSPACE_HOST_ROUTING_PROMPT,
  WORKSPACE_HOST_SYSTEM_PROMPT,
  buildWorkspaceExpertPrompt,
} = require("../utils/prompts");
const {
  getAgentNames,
  getSearchEnabledAgents,
  assertToolAllowed,
  listWorkspaceCapabilities,
} = require("../utils/workspaceRegistry");
const { normalizeOnePager } = require("./pptService");
const { extractJson } = require("../utils/jsonParser");

const ARTIFACTS_ROOT = path.join(__dirname, "..", "..", "data", "workspace_artifacts");
if (!fs.existsSync(ARTIFACTS_ROOT)) fs.mkdirSync(ARTIFACTS_ROOT, { recursive: true });

const VALID_AGENTS = getAgentNames();

function uuid() { return crypto.randomBytes(16).toString("hex"); }

// ── 会话 / 消息 ─────────────────────────────────────────────

function createOrGetConversation(taskId, userId) {
  const db = getDb();

  const taskRow = db.prepare(
    "SELECT id, workspace_project_id, workspace_version_number FROM tasks WHERE id = ?"
  ).get(taskId);
  const projectId = taskRow?.workspace_project_id || null;

  if (projectId) {
    const existing = db.prepare(
      `SELECT * FROM workspace_conversations
       WHERE project_id = ? AND user_id = ?
       ORDER BY created_at ASC LIMIT 1`
    ).get(projectId, userId);
    if (existing) return existing;

    const id = uuid();
    db.prepare(
      `INSERT INTO workspace_conversations (id, task_id, user_id, project_id, title)
       VALUES (?, ?, ?, ?, '默认会话')`
    ).run(id, taskId, userId, projectId);
    return db.prepare("SELECT * FROM workspace_conversations WHERE id = ?").get(id);
  }

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

function createOrGetConversationByProject(projectId, userId) {
  const db = getDb();
  const existing = db.prepare(
    `SELECT * FROM workspace_conversations
     WHERE project_id = ? AND user_id = ?
     ORDER BY created_at ASC LIMIT 1`
  ).get(projectId, userId);
  if (existing) return existing;

  const proj = db.prepare(
    "SELECT id, user_id, latest_task_id FROM projects WHERE id = ? AND user_id = ?"
  ).get(projectId, userId);
  if (!proj) throw new Error("项目不存在或无权访问");

  const id = uuid();
  db.prepare(
    `INSERT INTO workspace_conversations (id, task_id, user_id, project_id, title)
     VALUES (?, ?, ?, ?, '默认会话')`
  ).run(id, proj.latest_task_id || null, userId, projectId);
  return db.prepare("SELECT * FROM workspace_conversations WHERE id = ?").get(id);
}

function appendMessage(conversationId, role, agentName, content, metadata) {
  const db = getDb();
  const id = uuid();
  const enrichedMeta = { ...(metadata || {}) };

  if (enrichedMeta.version_number == null) {
    try {
      const conv = db.prepare(
        "SELECT project_id FROM workspace_conversations WHERE id = ?"
      ).get(conversationId);
      if (conv?.project_id) {
        const v = db.prepare(
          "SELECT MAX(version_number) AS v FROM project_versions WHERE project_id = ?"
        ).get(conv.project_id);
        if (v?.v != null) enrichedMeta.version_number = v.v;
      }
    } catch (_) { /* old databases may not have project version tables */ }
  }

  db.prepare(
    `INSERT INTO workspace_messages (id, conversation_id, role, agent_name, content, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    conversationId,
    role,
    agentName || null,
    content,
    Object.keys(enrichedMeta).length ? JSON.stringify(enrichedMeta) : null
  );
  db.prepare("UPDATE workspace_conversations SET updated_at = datetime('now') WHERE id = ?")
    .run(conversationId);
  compactSlidingWindow(conversationId);
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

function compactSlidingWindow(conversationId) {
  const db = getDb();
  const maxMessages = 120;
  const maxChars = 300000;
  const rows = db.prepare(
    `SELECT id, content FROM workspace_messages
     WHERE conversation_id = ?
     ORDER BY created_at DESC`
  ).all(conversationId);
  let chars = 0;
  const deleteIds = [];
  rows.forEach((row, idx) => {
    chars += String(row.content || "").length;
    if (idx >= maxMessages || chars > maxChars) deleteIds.push(row.id);
  });
  if (deleteIds.length) {
    const stmt = db.prepare("DELETE FROM workspace_messages WHERE id = ?");
    for (const id of deleteIds) stmt.run(id);
  }
}

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

function getArtifactForUser(artifactId, userId) {
  const db = getDb();
  return db.prepare(
    `SELECT a.*
     FROM workspace_artifacts a
     JOIN workspace_conversations c ON c.id = a.conversation_id
     WHERE a.id = ? AND c.user_id = ?`
  ).get(artifactId, userId);
}

function removeArtifactFiles(artifact) {
  if (!artifact?.storage_path) return;
  for (const p of [artifact.storage_path, extractedTextPath(artifact.storage_path)]) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (err) {
      console.warn("[Workspace] 删除 artifact 文件失败:", err.message);
    }
  }
}

function deleteArtifact(artifactId, conversationId) {
  const db = getDb();
  const artifact = getArtifact(artifactId);
  if (!artifact || artifact.conversation_id !== conversationId) return false;
  removeArtifactFiles(artifact);
  db.prepare("DELETE FROM workspace_artifacts WHERE id = ?").run(artifactId);
  return true;
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

function extractedTextPath(storagePath) {
  return `${storagePath}.extracted.txt`;
}

function saveArtifactExtractedText(storagePath, text) {
  if (!text || !text.trim()) return null;
  const sidecar = extractedTextPath(storagePath);
  fs.writeFileSync(sidecar, text, "utf-8");
  return sidecar;
}

function readArtifactExtract(storagePath, maxChars = 5000) {
  const sidecar = extractedTextPath(storagePath);
  if (!fs.existsSync(sidecar)) return "";
  try {
    const text = fs.readFileSync(sidecar, "utf-8");
    return text.length > maxChars ? text.slice(0, maxChars) + "\n...（材料正文已截断）" : text;
  } catch {
    return "";
  }
}

/**
 * 按 scope 清空：
 *   - "chat":    只清聊天记录（含专家 internal 消息）
 *   - "uploads": 只清用户上传材料（kind = 'upload'）
 *   - "outputs": 只清 AI 生成产物（kind LIKE 'generated_%'）
 *   - "all":     全清（向后兼容旧客户端）
 */
function clearConversation(conversationId, scope = "all") {
  const db = getDb();
  const result = { scope, deleted_messages: 0, deleted_artifacts: 0 };

  if (scope === "chat" || scope === "all") {
    const info = db.prepare("DELETE FROM workspace_messages WHERE conversation_id = ?").run(conversationId);
    result.deleted_messages = info.changes;
  }

  if (scope === "uploads" || scope === "all") {
    const uploads = db.prepare(
      "SELECT * FROM workspace_artifacts WHERE conversation_id = ? AND kind = 'upload'"
    ).all(conversationId);
    for (const a of uploads) removeArtifactFiles(a);
    const info = db.prepare(
      "DELETE FROM workspace_artifacts WHERE conversation_id = ? AND kind = 'upload'"
    ).run(conversationId);
    result.deleted_artifacts += info.changes;
  }

  if (scope === "outputs" || scope === "all") {
    const outs = db.prepare(
      "SELECT * FROM workspace_artifacts WHERE conversation_id = ? AND kind LIKE 'generated_%'"
    ).all(conversationId);
    for (const a of outs) removeArtifactFiles(a);
    const info = db.prepare(
      "DELETE FROM workspace_artifacts WHERE conversation_id = ? AND kind LIKE 'generated_%'"
    ).run(conversationId);
    result.deleted_artifacts += info.changes;
  }

  db.prepare("UPDATE workspace_conversations SET updated_at = datetime('now') WHERE id = ?").run(conversationId);
  return result;
}

function runWorkspaceMemoryGc() {
  return runMemoryGc({ artifactRoot: ARTIFACTS_ROOT, artifactMaxAgeDays: 30 });
}

// ── 上下文构建 ─────────────────────────────────────────────

/**
 * 抽取项目核心上下文（~3-5k tokens）
 * 来源：tasks.result.extracted_data / verdict / dimension_analysis / deep_research / claim_verdicts
 *       + 最近 artifact summaries（用户上传材料）
 * 每次调用都现读 DB，不做进程缓存——保证用户每轮提问都拿到最新事实。
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
  const deepResearch = result.deep_research || {};
  const claims = result.claim_verdicts || result.validated_data?.claim_verdicts || [];

  const riskyClaims = claims
    .filter(c => ["夸大", "严重夸大", "信息不对称", "证伪"].includes(c.verdict))
    .slice(0, 10)
    .map(c => `- [${c.verdict}] ${c.original_claim}${c.diff ? `（${c.diff}）` : ""}`)
    .join("\n");

  const dimSummary = Object.entries(dims)
    .map(([k, val]) => {
      const score = val?.score ?? val?.total_score;
      const rationale = val?.finding || val?.score_rationale;
      const tail = rationale ? `：${String(rationale).slice(0, 160)}` : "";
      return `  - ${k}: ${score != null ? `${score}分` : "—"}${tail}`;
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
    `# BP 声明核查（夸大/证伪/信息不对称）`,
    riskyClaims || "（暂未发现明显风险声明）",
  ];

  // 深度研究核心段落（限长，避免 prompt 爆掉）
  const dr = collectDeepResearchExcerpts(deepResearch, 2400);
  if (dr) {
    lines.push("", `# AI 深度研究报告摘要`, dr);
  }

  // 五维详细分析摘要（每维 ~200 字以内）
  const dimDetail = collectDimensionAnalysis(dims, 1600);
  if (dimDetail) {
    lines.push("", `# 五维分析详情`, dimDetail);
  }

  // 附加最近 artifact summaries
  if (conversationId) {
    const arts = listArtifacts(conversationId).filter(a => a.summary).slice(0, 5);
    if (arts.length > 0) {
      lines.push("", "# 用户已补充材料摘要");
      for (const a of arts) lines.push(`- ${a.filename}: ${a.summary}`);

      const excerpts = arts
        .map((a) => ({ filename: a.filename, excerpt: readArtifactExtract(a.storage_path, 3500) }))
        .filter((a) => a.excerpt)
        .slice(0, 2);
      if (excerpts.length > 0) {
        lines.push("", "# 最近上传材料正文摘录（仅当用户要求分析材料时使用）");
        for (const a of excerpts) {
          lines.push(`## ${a.filename}`, a.excerpt);
        }
      }
    }
  }
  return lines.join("\n");
}

function collectDeepResearchExcerpts(deepResearch, maxChars) {
  if (!deepResearch) return "";
  // 深度研究有时是 LLM 直出的长文本（pipelineService 的 callLLM 走兜底分支），
  // 此时直接截断返回；只有结构化对象才走字段映射。
  if (typeof deepResearch === "string") {
    const trimmed = deepResearch.replace(/\s+/g, " ").trim();
    if (!trimmed) return "";
    return trimmed.length > maxChars ? trimmed.slice(0, maxChars) + "…（深度研究已截断）" : trimmed;
  }
  if (typeof deepResearch !== "object") return "";
  const order = [
    ["industry_overview", "行业概览"],
    ["market_landscape", "市场格局"],
    ["competitive_landscape", "竞争格局"],
    ["growth_drivers", "增长驱动"],
    ["policy_context", "政策背景"],
    ["technology_trends", "技术趋势"],
    ["risks", "外部风险"],
    ["conclusion", "研究结论"],
    ["summary", "研究摘要"],
  ];
  const parts = [];
  let total = 0;
  for (const [key, label] of order) {
    const raw = deepResearch[key];
    if (!raw) continue;
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (!trimmed) continue;
    const remaining = maxChars - total;
    if (remaining <= 80) break;
    const slice = trimmed.length > remaining ? trimmed.slice(0, remaining) + "…" : trimmed;
    parts.push(`## ${label}\n${slice}`);
    total += slice.length;
  }
  // 兜底：如果上面字段都为空但 deepResearch 本身有内容，直接 stringify 截一段
  if (parts.length === 0) {
    const fallback = JSON.stringify(deepResearch).slice(0, maxChars);
    if (fallback && fallback !== "{}") return fallback;
  }
  return parts.join("\n\n");
}

function collectDimensionAnalysis(dims, maxChars) {
  if (!dims || typeof dims !== "object") return "";
  const parts = [];
  let total = 0;
  for (const [dim, val] of Object.entries(dims)) {
    if (!val || typeof val !== "object") continue;
    const text =
      val.comprehensive_analysis ||
      val.score_rationale ||
      val.finding ||
      val.ai_finding ||
      "";
    const trimmed = String(text).replace(/\s+/g, " ").trim();
    if (!trimmed) continue;
    const remaining = maxChars - total;
    if (remaining <= 80) break;
    const slice = trimmed.length > remaining ? trimmed.slice(0, remaining) + "…" : trimmed;
    parts.push(`- ${dim}: ${slice}`);
    total += slice.length;
  }
  return parts.join("\n");
}

// ── Routing：决定调度哪些专家 ───────────────────────────────

async function runHostRouting(projectCtx, history, userMsg) {
  const userPrompt = `# 项目上下文\n${projectCtx}\n\n# 最近对话\n${formatHistory(history, 8)}\n\n# 当前用户消息\n${userMsg}`;
  let raw;
  try {
    raw = await callLLM(WORKSPACE_HOST_ROUTING_PROMPT, userPrompt, 512);
  } catch (err) {
    console.warn("[Workspace] routing LLM 失败，回退为空:", err.message);
    return inferRoutingFromText(userMsg, "routing_failed");
  }
  const obj = parseRoutingJson(raw);
  if (!obj || !Array.isArray(obj.agents)) return inferRoutingFromText(userMsg, "parse_failed");
  obj.agents = obj.agents.filter(a => VALID_AGENTS.includes(a)).slice(0, 4);
  if (!obj.task_type) obj.task_type = inferRoutingFromText(userMsg).task_type;
  return obj;
}

function inferRoutingFromText(userMsg = "", reason = "heuristic") {
  const text = userMsg.toLowerCase();
  // one-pager 必须先匹配，否则会被下面的通用 PPT 规则吃掉
  if (isOnePagerRequest(userMsg)) {
    return { task_type: "generate_onepager", agents: ["market", "finance", "tech", "risk"], tools: ["generate_onepager"], reason };
  }
  if (/ppt|pptx|演示|幻灯片|slide|一页纸/.test(text)) {
    return { task_type: "generate_pptx", agents: ["market", "finance", "tech", "risk"], tools: ["generate_pptx"], reason };
  }
  if (/word|docx|文档|报告|memo|备忘录/.test(text)) {
    return { task_type: "generate_docx", agents: ["market", "finance", "tech", "risk"], tools: ["generate_docx"], reason };
  }
  if (/excel|xlsx|表格|模型|清单/.test(text)) {
    return { task_type: "generate_xlsx", agents: ["finance", "risk"], tools: ["generate_xlsx"], reason };
  }
  if (/附件|材料|文件|分析.*(docx|xlsx|pdf|pptx|csv)/.test(text)) {
    return { task_type: "analyze_file", agents: ["market", "finance", "tech", "risk"], tools: [], reason };
  }
  return { task_type: "answer", agents: [], tools: [], reason };
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

// 由 registry 声明哪些专家可使用 MiniMax 内置 web_search。
const SEARCH_ENABLED_AGENTS = getSearchEnabledAgents();

function stripModelToolCalls(text = "") {
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/gi, "")
    .replace(/<TOOL_CALL>[\s\S]*?<\/TOOL_CALL>/g, "")
    .replace(/```(?:json)?\s*\[[\s\S]*?tool[\s\S]*?\]\s*```/gi, "")
    .trim();
}

function leakedToolCall(text = "") {
  return /<tool_call>|<\/tool_call>|<minimax:tool_call>|tool\s*=>|web_search|TOOL_CALL|实时搜索工具|检索最新|我来搜索|我将搜索|让我搜索/i.test(text);
}

async function runExpert(agentName, projectCtx, history, userMsg, opts = {}) {
  const sys = buildWorkspaceExpertPrompt(agentName);
  const runId = opts.runId || uuid();
  const onEvent = typeof opts.onEvent === "function" ? opts.onEvent : () => {};

  createWorkingMemory(runId, opts.taskId || "unknown", agentName, userMsg.slice(0, 600));
  const memoryPack = await queryMemory({
    userId: opts.userId,
    taskId: opts.taskId,
    agentName,
    taskType: opts.taskType,
    userMessage: userMsg,
    intent: opts.taskType,
  });
  const memoryContext = formatMemoryPack(memoryPack);
  let searchContext = "";
  if (SEARCH_ENABLED_AGENTS.has(agentName)) {
    try {
      const queries = buildSearchQueries(agentName, userMsg, projectCtx);
      const results = await runWebSearch(queries);
      searchContext = formatSearchContext(results);
    } catch (err) {
      console.warn(`[Workspace] ${agentName} server web_search 失败，降级:`, err.message);
    }
  }

  const userPrompt = [
    `# 项目上下文（事实清单，禁止整段复述）`,
    projectCtx,
    "",
    memoryContext,
    searchContext ? `\n${searchContext}` : "",
    "",
    `# 最近对话`,
    formatHistory(history, 6),
    "",
    `# 用户当前问题`,
    userMsg,
    "",
    `# 你的任务`,
    `先在 thinking 块里**真实地推理**：你最关注哪 2-3 个证据？产生了什么疑虑？最后怎么权衡得出结论？`,
    `再写最终回答 200-400 字，第一人称表达。不要复述项目上下文原文。`,
  ].join("\n");

  let thinkingBuf = "";
  let textBuf = "";

  try {
    await callLLMAgentic({
      system: sys,
      messages: [{ role: "user", content: userPrompt }],
      thinkingBudget: opts.thinkingBudget ?? 3000,
      maxTokens: 2000,
      maxToolRounds: 1, // 专家不调工具
      signal: opts.signal,
      onEvent: (ev) => {
        if (ev.type === "thinking_delta") {
          thinkingBuf += ev.text;
          onEvent({ agent: agentName, type: "thinking", text: ev.text });
        } else if (ev.type === "text_delta") {
          textBuf += ev.text;
          onEvent({ agent: agentName, type: "text", text: ev.text });
        }
      },
    });
  } catch (err) {
    throw err;
  }

  // 后兜底：若上游一句话都没吐（thinking 也没出），降级一次普通 callLLM
  if (!textBuf.trim()) {
    console.warn(`[Workspace] ${agentName} agentic 无输出，降级为 callLLM`);
    const fallback = await callLLM(sys, userPrompt, 1500);
    textBuf = stripModelToolCalls(fallback);
    if (textBuf) onEvent({ agent: agentName, type: "text", text: textBuf });
  } else if (leakedToolCall(textBuf)) {
    textBuf = stripModelToolCalls(textBuf);
  }

  const content = textBuf.trim();
  appendWorkingFinding(runId, agentName, content.slice(0, 300));
  keeper.processAgentOutput({
    taskId: opts.taskId,
    userId: opts.userId,
    agentName,
    content,
    taskType: opts.taskType,
  }).catch((err) => console.warn(`[Keeper] ${agentName} 记忆提炼失败:`, err.message));
  return { agent: agentName, content, thinking: thinkingBuf, memory_used: memoryPack };
}

async function runExpertsParallel(agents, projectCtx, history, userMsg, onExpertDone, opts = {}) {
  const tasks = agents.map(async (a) => {
    try {
      const out = await runExpert(a, projectCtx, history, userMsg, opts);
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

// ── Host：thinking + tools 真 agentic 调用 ─────────────────

const HOST_TOOL_SCHEMAS = [
  {
    name: "generate_onepager",
    description: "生成【单页】投资亮点速览 PPT（pitch 视角，恰好 1 页）。当用户提到\"投资亮点 / 一页纸 / 单页 / one-pager / 速览 / pitch\"时**必须**调用此工具，禁止用 generate_pptx 凑一个 slides 数组只有 1 项的伪一页 PPT。highlights 恰好 4 条、risks 恰好 2 条、KPI 恰好 4 条、drivers 恰好 3 条、products 恰好 3 条。叙事正面，禁止评级 / 不建议结论 / 红旗 / D级 / ★ 星标。",
    input_schema: {
      type: "object",
      properties: {
        company_name: { type: "string", description: "公司名" },
        headline: { type: "string", description: "一句话标语（红底标语，<= 30 字）" },
        company_overview: {
          type: "object",
          properties: {
            summary: { type: "string", description: "公司一句话描述（<= 120 字）" },
            products: {
              type: "array",
              description: "3 条核心产品",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  desc: { type: "string" },
                },
                required: ["name", "desc"],
              },
            },
          },
          required: ["summary", "products"],
        },
        market_opportunity: {
          type: "object",
          properties: {
            kpis: {
              type: "array",
              description: "恰好 4 条 KPI（TAM / CAGR / 渗透率 / 增量空间）",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  value: { type: "string" },
                },
                required: ["label", "value"],
              },
            },
            drivers: {
              type: "array",
              description: "恰好 3 条增长驱动（政策 / 技术 / 需求）",
              items: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  text: { type: "string" },
                },
                required: ["type", "text"],
              },
            },
            competition: { type: "string", description: "竞争格局一句话" },
          },
          required: ["kpis", "drivers", "competition"],
        },
        highlights: {
          type: "array",
          description: "恰好 4 条投资亮点（全部正面叙事）",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "亮点小标题，名词短语，禁带星标/打分修饰" },
              desc: { type: "string", description: "一两句话支撑，正面叙事" },
            },
            required: ["title", "desc"],
          },
        },
        risks: {
          type: "array",
          description: "恰好 2 条风险（简洁中立，不写'不建议投资'结论）",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              desc: { type: "string" },
            },
            required: ["title", "desc"],
          },
        },
        footer: {
          type: "object",
          properties: {
            founded: { type: "string", description: "成立年份" },
            team_size: { type: "string", description: "团队规模" },
            funding_total: { type: "string", description: "累计融资" },
            ai_grade: { type: "string", description: "AI 评级文字（可为空字符串）" },
          },
          required: ["founded", "team_size", "funding_total", "ai_grade"],
        },
      },
      required: [
        "company_name",
        "headline",
        "company_overview",
        "market_opportunity",
        "highlights",
        "risks",
        "footer",
      ],
    },
  },
  {
    name: "generate_pptx",
    description: "生成【多页】PPT 文件（投委会演示、路演材料、项目简报）。slides 数组每项是一页。如果用户要的是【单页投资亮点 / 一页纸 / one-pager / 速览】，请改用 generate_onepager，禁止用本工具凑一个只有 1 项的 slides 数组。",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "PPT 标题" },
        subtitle: { type: "string", description: "副标题（可选）" },
        slides: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "页标题" },
              bullets: { type: "array", items: { type: "string" }, description: "要点 3-6 条" },
              notes: { type: "string", description: "演讲备注（可选）" },
            },
            required: ["title", "bullets"],
          },
        },
      },
      required: ["title", "slides"],
    },
  },
  {
    name: "generate_docx",
    description: "生成 Word 文件（尽调备忘录、会议纪要、投资 memo、风险清单）。sections 数组每项是一节。",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        subtitle: { type: "string" },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              heading: { type: "string", description: "节标题" },
              paragraphs: { type: "array", items: { type: "string" } },
              bullets: { type: "array", items: { type: "string" } },
            },
            required: ["heading"],
          },
        },
      },
      required: ["title", "sections"],
    },
  },
  {
    name: "generate_xlsx",
    description: "生成 Excel 文件（财务模型、尽调清单、风险台账、竞品表）。sheets 数组每项是一个 sheet。",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        sheets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Sheet 名" },
              headers: { type: "array", items: { type: "string" } },
              rows: { type: "array", items: { type: "array", items: { type: "string" } } },
            },
            required: ["name", "headers", "rows"],
          },
        },
      },
      required: ["title", "sheets"],
    },
  },
];

/**
 * Host 主推理 —— thinking + tools + stream 一气呵成。
 * 调用方通过 onEvent 收所有事件：thinking_delta / text_delta / tool_use / tool_result。
 * 工具真执行：toolRunner 由外部传入（route 层接 doc-service），artifact 写库由 toolRunner 完成。
 *
 * @returns {Promise<{ text, thinking, artifacts: array, used_tools, used_thinking, used_stream }>}
 */
async function runHostAgentic({
  projectCtx,
  history,
  userMsg,
  expertOutputs,
  memoryPack,
  signal,
  onEvent = () => {},
  hostToolRunner, // (toolName, input) => Promise<{ artifact, summary }>
}) {
  const expertBlock = expertOutputs.length > 0
    ? expertOutputs.map(e => `## ${e.agent} 专家意见\n${e.content}`).join("\n\n")
    : "（这一轮没有调用专家）";

  const userPrompt = [
    `# 项目上下文（事实清单，禁止整段复述）`,
    projectCtx,
    "",
    memoryPack ? formatMemoryPack(memoryPack) : "",
    "",
    `# 最近对话`,
    formatHistory(history, 8),
    "",
    `# 用户当前消息`,
    userMsg,
    "",
    `# 各专家本轮意见（你的素材，不要逐条复读）`,
    expertBlock,
    "",
    `# 你的任务`,
    `1. 先在 thinking 块里**真实地推理**：你最被什么打动 / 被什么动摇？专家意见之间有没有矛盾？最后凝结成什么 thesis？`,
    `2. 如果用户要生成文件，先在 thinking 里规划好结构，再调用对应工具（generate_onepager / generate_pptx / generate_docx / generate_xlsx），args 必须是合法 JSON。`,
    `2a. 关键规则：用户说"投资亮点 / 一页纸 / 单页 PPT / one-pager / 速览"时，**必须**用 generate_onepager（恰好 1 页 pitch 视角），禁止用 generate_pptx 凑 1 页伪 onepager。`,
    `2b. generate_onepager 强约束：highlights 恰 4 条全部正面叙事；risks 恰 2 条中立陈述（不写"不建议投资"结论）；KPI 恰 4 条；drivers 恰 3 条；products 恰 3 条。叙事禁出现：D级、不建议、风险红旗、★ 星标、可信度打分等审查口吻。`,
    `3. 工具返回 tool_result 后，写最终答复给用户：第一人称投资判断，不复述上下文，不复读专家原话。`,
    `4. 如果只是问答（不要生成文件），跳过工具，直接写答复。`,
  ].join("\n");

  const artifacts = [];
  let thinking = "";
  let text = "";

  const toolRunner = async (name, input) => {
    if (typeof hostToolRunner !== "function") {
      return `工具暂不可用：缺少 hostToolRunner`;
    }
    try {
      const r = await hostToolRunner(name, input);
      if (r?.artifact) {
        artifacts.push(r.artifact);
        return r.summary || `已生成 ${r.artifact.filename}`;
      }
      return r?.summary || "工具执行完成";
    } catch (e) {
      throw e;
    }
  };

  let result;
  try {
    result = await callLLMAgentic({
      system: WORKSPACE_HOST_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      tools: HOST_TOOL_SCHEMAS,
      toolRunner,
      thinkingBudget: 5000,
      maxTokens: 6000,
      maxToolRounds: 4,
      signal,
      onEvent: (ev) => {
        if (ev.type === "thinking_delta") thinking += ev.text;
        if (ev.type === "text_delta") text += ev.text;
        onEvent(ev);
      },
    });
  } catch (err) {
    const msg = err?.message || "";
    const jsonSyntax = /Expected ',' or '}' after property value|Unexpected token|JSON|position \d+/i.test(msg);
    const fallback = jsonSyntax
      ? buildFallbackToolCall({
        routing: inferRoutingFromText(userMsg),
        userMsg,
        cleanContent: text,
        expertOutputs,
      })
      : null;
    if (!fallback) throw err;

    const toolId = `fallback-${Date.now()}`;
    console.warn("[Workspace] host 工具 JSON 解析失败，已降级为 fallback 工具调用:", msg);
    if (typeof hostToolRunner !== "function") {
      result = {
        text: `<TOOL_CALL>${JSON.stringify(fallback)}</TOOL_CALL>`,
        used_thinking: false,
        used_tools: false,
        used_stream: false,
      };
    } else {
      onEvent({ type: "tool_use_start", id: toolId, name: fallback.tool });
      onEvent({ type: "tool_use", id: toolId, name: fallback.tool, input: fallback.args });
      try {
        const r = await hostToolRunner(fallback.tool, fallback.args || {});
        if (r?.artifact) artifacts.push(r.artifact);
        onEvent({
          type: "tool_result",
          id: toolId,
          name: fallback.tool,
          result: r?.summary || "已生成",
          error: false,
        });
        result = {
          text: text || "已按当前项目材料生成文件。",
          used_thinking: false,
          used_tools: false,
          used_stream: false,
        };
      } catch (toolErr) {
        onEvent({
          type: "tool_result",
          id: toolId,
          name: fallback.tool,
          result: toolErr.message,
          error: true,
        });
        throw toolErr;
      }
    }
  }

  // 没开 tools 的降级路径：从 text 里抓 <TOOL_CALL>
  if (!result.used_tools) {
    const parsed = parseToolCalls(text);
    if (parsed.length > 0 && hostToolRunner) {
      onEvent({ type: "fallback_text_tool_call", count: parsed.length });
      for (const p of parsed) {
        try {
          const r = await hostToolRunner(p.tool, p.args || {});
          if (r?.artifact) {
            artifacts.push(r.artifact);
            onEvent({ type: "tool_result", id: `fallback-${Date.now()}`, name: p.tool, result: r.summary || "已生成", error: false });
          }
        } catch (e) {
          onEvent({ type: "tool_result", id: `fallback-${Date.now()}`, name: p.tool, result: e.message, error: true });
        }
      }
      text = stripToolCalls(text);
    }
  }

  return {
    text: text.trim(),
    thinking,
    artifacts,
    used_thinking: result.used_thinking,
    used_tools: result.used_tools,
    used_stream: result.used_stream,
  };
}

async function streamHostSummary({ projectCtx, history, userMsg, expertOutputs, onDelta, signal }) {
  let emitted = "";
  const result = await runHostAgentic({
    projectCtx,
    history,
    userMsg,
    expertOutputs,
    signal,
    onEvent: (ev) => {
      if (ev.type === "text_delta" && ev.text) {
        emitted += ev.text;
        onDelta?.(ev.text);
      }
    },
  });
  if (!emitted && result.text) onDelta?.(result.text);
  return result.text;
}

// ── 工具调用解析 ───────────────────────────────────────────

function parseToolCalls(content) {
  const re = /<TOOL_CALL>([\s\S]*?)<\/TOOL_CALL>/g;
  const calls = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    try {
      const raw = m[1].trim();
      const parsed = extractJson(raw) || JSON.parse(raw);
      if (parsed && (parsed.tool || parsed.id)) calls.push(parsed);
    } catch (err) {
      console.warn("[Workspace] tool_call JSON 解析失败:", err.message);
    }
  }
  return calls;
}

function stripToolCalls(content) {
  return content.replace(/<TOOL_CALL>[\s\S]*?<\/TOOL_CALL>/g, "").trim();
}

function taskTypeToTool(taskType) {
  if (taskType === "generate_onepager") return "generate_onepager";
  if (taskType === "generate_pptx") return "generate_pptx";
  if (taskType === "generate_docx") return "generate_docx";
  if (taskType === "generate_xlsx") return "generate_xlsx";
  return null;
}

// "一页纸 / 投资亮点 / 速览" 这类硬性要求单页 pitch 的措辞 → 走 onepager 工具
function isOnePagerRequest(userMsg = "") {
  if (!userMsg) return false;
  return (
    /投资亮点|亮点单页|单\s*页\s*(PPT|ppt|演示|材料)?|一\s*页\s*(纸|PPT|ppt|材料|速览)?|1\s*页\s*(PPT|ppt)?|one[-\s]?pager|speed\s*read|速览|pitch\s*deck/i.test(userMsg)
  );
}

// 兼容原 isOnePagePptRequest 调用点（构造 slides 时的旧 hint）
function isOnePagePptRequest(userMsg = "") {
  return isOnePagerRequest(userMsg);
}

function compactLines(text = "", limit = 7) {
  const banned = /^(已为您生成|页码|内容|封面|备注|输出要求|工具调用|TOOL_CALL|项目投资亮点|投资亮点分析|综合研判|核心判断|各专家|一、|二、|三、|四、|五、|---+|\|?\s*页码\s*\|)/i;
  const lines = text
    .replace(/\*\*/g, "")
    .replace(/^>\s*/gm, "")
    .split(/\n+/)
    .map((line) => line.replace(/^[-*#\d.\s|]+/, "").replace(/\|/g, " ").trim())
    .filter((line) => (
      line &&
      line.length <= 120 &&
      !banned.test(line) &&
      !/^(请|你是|用户|根据用户|我的理解是|这页|本页|要求|需要).*?(生成|输出|写成|追加|调用|PPT)/i.test(line)
    ));
  return [...new Set(lines)].slice(0, limit);
}

function firstUsefulLine(text = "", fallback = "") {
  return compactLines(text, 1)[0] || fallback;
}

function agentContent(expertOutputs, agentName) {
  return expertOutputs.find((e) => e.agent === agentName)?.content || "";
}

function buildPptSlides({ userMsg, title, cleanContent, expertOutputs }) {
  const sourceText = `${cleanContent}\n${expertOutputs.map((e) => `${e.agent}: ${e.content}`).join("\n")}`;
  const onePage = isOnePagePptRequest(userMsg);
  const market = agentContent(expertOutputs, "market");
  const finance = agentContent(expertOutputs, "finance");
  const tech = agentContent(expertOutputs, "tech");
  const risk = agentContent(expertOutputs, "risk");

  if (onePage) {
    const expertBullets = [
      firstUsefulLine(market, ""),
      firstUsefulLine(tech, ""),
      firstUsefulLine(finance, ""),
      firstUsefulLine(risk, ""),
    ].filter(Boolean);
    const bullets = expertBullets.length >= 4
      ? expertBullets
      : [...expertBullets, ...compactLines(sourceText, 8)];
    const fallback = ["赛道机会明确，但商业化验证仍需补强", "技术路线具备潜力，需验证量产与客户定点", "财务模型和估值锚点仍待核实", "建议以关键里程碑和风险条款保护投资安全"];
    const uniqueBullets = [...new Set(bullets)].slice(0, 6);
    return [{ title, bullets: uniqueBullets.length ? uniqueBullets : fallback }];
  }

  const conclusionBullets = compactLines(cleanContent, 5);
  return [
    { title: "投资结论", bullets: conclusionBullets.length ? conclusionBullets : compactLines(sourceText, 5) },
    { title: "市场与竞争", bullets: compactLines(market || sourceText, 5) },
    { title: "技术与产品", bullets: compactLines(tech || sourceText, 5) },
    { title: "财务与估值", bullets: compactLines(finance || sourceText, 5) },
    { title: "风险与尽调重点", bullets: compactLines(risk || sourceText, 5) },
  ].filter((slide) => slide.bullets.length > 0);
}

// 从用户消息里嗅探公司名（"《...》" / "公司名为..." / "做...的投资亮点"）
function inferCompanyNameFromMsg(userMsg = "") {
  if (!userMsg) return "";
  // 允许引号内含空格，但不含换行
  const quoted = userMsg.match(/[《"]([^》"\n]{2,30})[》"]/);
  if (quoted) return quoted[1].trim();
  const m1 = userMsg.match(/(?:做|生成|为|关于|项目)\s*([^，。,.\n《》"]{2,20}?)(?:的|项目)?\s*(?:投资亮点|一页纸|单页|one[-\s]?pager|速览)/i);
  if (m1) return m1[1].trim();
  return "";
}

// 兜底构造一份 OnePagerPayload。normalizeOnePager 会把缺失字段填 "暂无"。
function buildFallbackOnepagerArgs({ userMsg, cleanContent, expertOutputs }) {
  const market = agentContent(expertOutputs, "market");
  const finance = agentContent(expertOutputs, "finance");
  const tech = agentContent(expertOutputs, "tech");
  const risk = agentContent(expertOutputs, "risk");
  const companyName = inferCompanyNameFromMsg(userMsg) || "（未知公司）";
  const headline = firstUsefulLine(cleanContent || market || tech, "投资亮点速览");

  return {
    company_name: companyName,
    headline,
    company_overview: {
      summary: firstUsefulLine(cleanContent || tech, ""),
      products: [],
    },
    market_opportunity: {
      kpis: [],
      drivers: [],
      competition: firstUsefulLine(market, ""),
    },
    highlights: [
      { title: "市场机会", desc: firstUsefulLine(market, "") },
      { title: "技术与产品", desc: firstUsefulLine(tech, "") },
      { title: "财务与估值", desc: firstUsefulLine(finance, "") },
      { title: "团队与执行", desc: firstUsefulLine(cleanContent, "") },
    ],
    risks: [
      { title: "尽调重点", desc: firstUsefulLine(risk, "") },
      { title: "关键里程碑", desc: "" },
    ],
    footer: { founded: "", team_size: "", funding_total: "", ai_grade: "" },
  };
}

function isPromptLikePptArgs(args = {}) {
  const text = JSON.stringify(args).slice(0, 8000);
  return /TOOL_CALL|argShape|输出格式|工具调用|生成一份|请生成|你是.*?AI|用户要求|根据用户指令|slides\s*数组|不要写页码|必须且只能/i.test(text);
}

function inferTitle(userMsg = "", fallback = "投委会简报") {
  const quoted = userMsg.match(/[《"]([^》"]{4,40})[》"]/);
  if (quoted) return quoted[1];
  if (isOnePagerRequest(userMsg)) return "投资要点速览";
  if (/ppt|PPT|演示|幻灯片|slide/i.test(userMsg)) return "投委会演示";
  if (/word|docx|文档|报告|memo|备忘录/i.test(userMsg)) return "投资分析备忘录";
  if (/excel|xlsx|表格|模型/i.test(userMsg)) return "投研分析表";
  return fallback;
}

function buildFallbackToolCall({ routing, userMsg, cleanContent, expertOutputs }) {
  // isOnePagerRequest 优先级最高：路由层若没识别到（如 LLM routing 失败），
  // 在这里再兜一次，保证用户说"一页纸/投资亮点"时不会落到多页 generate_pptx。
  const onePager = isOnePagerRequest(userMsg);
  const tool = onePager ? "generate_onepager" : taskTypeToTool(routing?.task_type);
  if (!tool) return null;

  const title = inferTitle(userMsg);

  if (tool === "generate_onepager") {
    return {
      tool,
      args: buildFallbackOnepagerArgs({ userMsg, cleanContent, expertOutputs }),
    };
  }

  if (tool === "generate_pptx") {
    const onePage = isOnePagePptRequest(userMsg);
    return {
      tool,
      args: {
        title,
        subtitle: onePage ? "One Page" : "Workspace 生成",
        slides: buildPptSlides({ userMsg, title, cleanContent, expertOutputs }),
      },
    };
  }

  if (tool === "generate_docx") {
    return {
      tool,
      args: {
        title,
        sections: [
          { heading: "综合结论", paragraphs: [cleanContent || "见以下专家分析。"] },
          ...expertOutputs.map((e) => ({
            heading: `${e.agent} 专家意见`,
            bullets: compactLines(e.content, 8),
          })),
        ],
      },
    };
  }

  if (tool === "generate_xlsx") {
    return {
      tool,
      args: {
        title,
        sheets: [{
          name: "分析要点",
          headers: ["模块", "要点"],
          rows: expertOutputs.flatMap((e) => compactLines(e.content, 6).map((line) => [e.agent, line])).slice(0, 40),
        }],
      },
    };
  }

  return null;
}

function normalizeToolCalls(calls, { routing, userMsg, cleanContent, expertOutputs }) {
  const normalized = Array.isArray(calls) ? [...calls] : [];
  const requestedTool = taskTypeToTool(routing?.task_type);
  if (!requestedTool) return normalized;

  const idx = normalized.findIndex((c) => c.tool === requestedTool);
  if (idx < 0) {
    const fallback = buildFallbackToolCall({ routing, userMsg, cleanContent, expertOutputs });
    return fallback ? [fallback] : normalized;
  }

  if (
    requestedTool === "generate_pptx" &&
    (isOnePagePptRequest(userMsg) || isPromptLikePptArgs(normalized[idx]?.args))
  ) {
    const fallback = buildFallbackToolCall({ routing, userMsg, cleanContent, expertOutputs });
    if (fallback) normalized[idx] = fallback;
  }
  return normalized;
}

/**
 * 执行生成文档工具：调用 doc-service /generate/*，
 * 把返回的二进制保存到本地 artifacts 目录，并写入 workspace_artifacts。
 */
async function executeDocumentTool({ tool, args, conversationId, messageId }) {
  if (!config.docServiceUrl) throw new Error("doc-service 未配置");
  const toolDef = assertToolAllowed(tool, "host");

  const bodyBuilders = {
    generate_onepager: {
      summary: (body) => `一页投资亮点：${body.company_name || body.headline || toolDef.defaultTitle}`,
      buildBody: () => {
        // 用 pptService.normalizeOnePager 兜底所有缺失字段（4 highlights / 2 risks / 4 KPIs / 3 drivers / 3 products）
        const normalized = normalizeOnePager(args || {}, args?.company_name || toolDef.defaultTitle);
        return normalized;
      },
    },
    generate_pptx: {
      summary: (body) => `${body.slides.length} 页 PPT：${body.title}`,
      buildBody: () => {
        const slides = Array.isArray(args?.slides) ? args.slides : [];
        if (slides.length === 0) throw new Error("slides 为空");
        return { title: args?.title || toolDef.defaultTitle, subtitle: args?.subtitle || undefined, slides };
      },
    },
    generate_docx: {
      summary: (body) => `${body.sections.length} 节 Word：${body.title}`,
      buildBody: () => {
        const sections = Array.isArray(args?.sections) ? args.sections : [];
        if (sections.length === 0) throw new Error("sections 为空");
        return { title: args?.title || toolDef.defaultTitle, subtitle: args?.subtitle || undefined, sections };
      },
    },
    generate_xlsx: {
      summary: (body) => `${body.sheets.length} 个工作表：${body.title}`,
      buildBody: () => {
        const sheets = Array.isArray(args?.sheets) ? args.sheets : [];
        if (sheets.length === 0) throw new Error("sheets 为空");
        return { title: args?.title || toolDef.defaultTitle, sheets };
      },
    },
  };

  const builder = bodyBuilders[tool];
  if (!builder) throw new Error(`工具尚未实现: ${tool}`);
  const body = builder.buildBody();

  const resp = await fetch(`${config.docServiceUrl}${toolDef.endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`doc-service 错误: ${t}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());

  const convDir = path.join(ARTIFACTS_ROOT, conversationId);
  if (!fs.existsSync(convDir)) fs.mkdirSync(convDir, { recursive: true });
  const safeTitle = (body.title || toolDef.defaultTitle).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 40);
  const filename = `${safeTitle}-${Date.now()}.${toolDef.extension}`;
  const fullPath = path.join(convDir, filename);
  fs.writeFileSync(fullPath, buf);

  return insertArtifact({
    conversationId,
    messageId,
    kind: toolDef.artifactKind,
    filename,
    storagePath: fullPath,
    mimeType: toolDef.mimeType,
    sizeBytes: buf.length,
    summary: builder.summary(body),
  });
}

async function executeToolCalls(calls, { conversationId, messageId, projectId, userId }) {
  const results = [];
  let skills = null;
  try {
    skills = require("../skills");
    skills.init();
  } catch (err) {
    console.warn("[Workspace] skill registry 不可用，回退文档工具:", err.message);
  }

  for (const c of calls) {
    const skillId = c.id || c.tool;
    try {
      if (!skillId) {
        results.push({ tool: null, error: "工具名为空" });
        continue;
      }

      if (["generate_onepager", "generate_pptx", "generate_docx", "generate_xlsx"].includes(skillId)) {
        const art = await executeDocumentTool({ tool: skillId, args: c.args || {}, conversationId, messageId });
        results.push({ tool: skillId, artifact: art });
        continue;
      }

      const skill = skills?.registry?.get?.(skillId);
      if (skill) {
        let project = null;
        if (projectId && userId) {
          project = getDb().prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?").get(projectId, userId);
        }
        const out = await skills.registry.execute({
          skillId,
          params: c.args || {},
          project,
          userId,
          ctx: { conversationId, messageId },
        });
        if (out.ok) results.push({ tool: skillId, runId: out.runId, artifact: out.artifact });
        else results.push({ tool: skillId, error: out.error });
        continue;
      }

      results.push({ tool: skillId, error: `未知工具或 skill: ${skillId}` });
    } catch (err) {
      results.push({ tool: skillId, error: err.message });
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

async function processUploadMemory({ taskId, userId, filename, summary }) {
  return keeper.processUploadSummary({ taskId, userId, filename, summary });
}

async function processHostMemory({ taskId, userId, content, taskType }) {
  return keeper.processAgentOutput({
    taskId,
    userId,
    agentName: "host",
    content,
    taskType,
  });
}

function processSkillCandidate(args) {
  return keeper.processSkillCandidate(args);
}

module.exports = {
  VALID_AGENTS,
  createOrGetConversation,
  createOrGetConversationByProject,
  appendMessage,
  listMessages,
  listArtifacts,
  getArtifact,
  getArtifactForUser,
  deleteArtifact,
  insertArtifact,
  saveArtifactExtractedText,
  clearConversation,
  buildProjectContext,
  runHostRouting,
  runExpertsParallel,
  runHostAgentic,
  streamHostSummary,
  executeDocumentTool,
  parseToolCalls,
  stripToolCalls,
  normalizeToolCalls,
  executeToolCalls,
  inferRoutingFromText,
  taskTypeToTool,
  isOnePagerRequest,
  buildFallbackToolCall,
  buildFallbackOnepagerArgs,
  HOST_TOOL_SCHEMAS,
  summarizeUploadedText,
  processUploadMemory,
  processHostMemory,
  processSkillCandidate,
  runWorkspaceMemoryGc,
  queryMemory,
  listWorkspaceCapabilities,
  ARTIFACTS_ROOT,
};
