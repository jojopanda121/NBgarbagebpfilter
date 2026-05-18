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
const { extractJson } = require("../utils/jsonParser");
const {
  buildStandardArtifactFilename,
  standardizeArtifactFile,
} = require("../utils/artifactNaming");

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
    `SELECT id, kind, filename, mime_type, size_bytes, summary, created_at, message_id, expires_at
     FROM workspace_artifacts WHERE conversation_id = ? ORDER BY created_at DESC`
  ).all(conversationId);
}

function listArtifactsInternal(conversationId) {
  const db = getDb();
  return db.prepare(
    `SELECT * FROM workspace_artifacts WHERE conversation_id = ? ORDER BY created_at DESC`
  ).all(conversationId);
}

function getArtifact(artifactId) {
  const db = getDb();
  return db.prepare("SELECT * FROM workspace_artifacts WHERE id = ?").get(artifactId);
}

function publicArtifact(row) {
  if (!row) return row;
  const { storage_path, ...safe } = row;
  return safe;
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
  try { require("./evidenceStore").deleteEvidenceForArtifact(db, artifactId); } catch (_) {}
  db.prepare("DELETE FROM workspace_artifacts WHERE id = ?").run(artifactId);
  return true;
}

function insertArtifact({ conversationId, messageId, kind, filename, storagePath, mimeType, sizeBytes, summary, userId, artifactTitle }) {
  const db = getDb();
  const id = uuid();
  const standardized = standardizeArtifactFile({
    db,
    conversationId,
    kind,
    filename,
    storagePath,
    artifactTitle,
  });
  filename = standardized.filename;
  storagePath = standardized.storagePath;
  db.prepare(
    `INSERT INTO workspace_artifacts
       (id, conversation_id, message_id, kind, filename, storage_path, mime_type, size_bytes, summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, conversationId, messageId || null, kind, filename, storagePath, mimeType || null, sizeBytes || null, summary || null);

  // Retention:
  // - VIP/admin: permanent while VIP/admin is active.
  // - Free upload materials: 3 days.
  // - Generated artifacts: short-lived cache (7 days) for non-VIP users.
  try {
    const cols = db.prepare("PRAGMA table_info(workspace_artifacts)").all();
    if (cols.some((c) => c.name === "expires_at")) {
      const { computeArtifactExpiresAt } = require("./evidenceStore");
      db.prepare("UPDATE workspace_artifacts SET expires_at = ? WHERE id = ?")
        .run(computeArtifactExpiresAt({ db, userId, kind }), id);
    }
  } catch {}

  return publicArtifact(db.prepare("SELECT * FROM workspace_artifacts WHERE id = ?").get(id));
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
 *   - "outputs": 只清 AI 生成产物（kind LIKE 'generated_%'，兼容旧 pptx/docx/xlsx）
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
    try {
      const evidenceStore = require("./evidenceStore");
      for (const a of uploads) evidenceStore.deleteEvidenceForArtifact(db, a.id);
    } catch (_) {}
    const info = db.prepare(
      "DELETE FROM workspace_artifacts WHERE conversation_id = ? AND kind = 'upload'"
    ).run(conversationId);
    result.deleted_artifacts += info.changes;
  }

  if (scope === "outputs" || scope === "all") {
    const outs = db.prepare(
      "SELECT * FROM workspace_artifacts WHERE conversation_id = ? AND (kind LIKE 'generated_%' OR kind IN ('pptx','docx','xlsx'))"
    ).all(conversationId);
    for (const a of outs) removeArtifactFiles(a);
    const info = db.prepare(
      "DELETE FROM workspace_artifacts WHERE conversation_id = ? AND (kind LIKE 'generated_%' OR kind IN ('pptx','docx','xlsx'))"
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
    const arts = listArtifactsInternal(conversationId).filter(a => a.summary).slice(0, 5);
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

// ── 增强上下文: BM25 检索上传材料 ──────────────────────────────

function buildEnhancedProjectContext(taskId, conversationId, userQuery) {
  const base = buildProjectContext(taskId, conversationId);
  if (!conversationId) return base;

  const arts = listArtifactsInternal(conversationId).filter((a) => a.kind === "upload");
  if (arts.length === 0) return base;

  // Collect full extracted text for all uploads
  const docs = [];
  let totalLen = 0;
  for (const a of arts) {
    const text = readArtifactExtract(a.storage_path, 100000);
    if (text) {
      docs.push({ filename: a.filename, text });
      totalLen += text.length;
    }
  }
  if (docs.length === 0) return base;

  const MAX_INLINE = 20000;
  if (totalLen <= MAX_INLINE) {
    const sections = docs.map((d) => `## ${d.filename}\n${d.text}`).join("\n\n");
    return `${base}\n\n# 用户上传材料全文\n${sections}`;
  }

  // BM25 retrieval for large corpora
  const { chunkText, bm25Search } = require("./docSearchService");
  const allChunks = [];
  for (const d of docs) {
    const chunks = chunkText(d.text, 800, 100);
    for (const c of chunks) {
      allChunks.push({ text: c, source: d.filename });
    }
  }
  const results = bm25Search(userQuery, allChunks, 8);
  if (results.length === 0) return base;

  const sections = results
    .map((r) => `[${r.source}] ${r.text}`)
    .join("\n---\n");
  return `${base}\n\n# 用户上传材料相关片段（BM25 检索 top-${results.length}）\n${sections}`;
}

// ── Routing：决定调度哪些专家 ───────────────────────────────

async function runHostRouting(projectCtx, history, userMsg) {
  const forcedTool = forcedToolFromUserMsg(userMsg);
  if (forcedTool) {
    return {
      task_type: taskTypeForForcedTool(forcedTool),
      agents: ["market_deal", "finance_valuation", "product_team_risk"],
      tools: [forcedTool],
      reason: "quick_output_forced_tool",
    };
  }
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
  if (/尽调清单|尽调问题|尽调追问|dd checklist|due diligence checklist/i.test(userMsg)) {
    obj.task_type = "generate_dd_checklist";
    obj.tools = ["dd_checklist_xlsx"];
  }
  if (isFounderInterviewRequest(userMsg)) {
    obj.task_type = "generate_founder_interview";
    obj.tools = ["founder_interview_docx"];
  }
  if (isCompetitorMatrixRequest(userMsg)) {
    obj.task_type = "generate_competitor_matrix";
    obj.tools = ["competitor_matrix_xlsx"];
  }
  if (isIcQuestionsRequest(userMsg)) {
    obj.task_type = "generate_ic_questions";
    obj.tools = ["ic_questions_xlsx"];
  }
  if (isHighlightVisualRequest(userMsg)) {
    obj.task_type = "generate_highlight_visual";
    obj.tools = ["highlight_visual"];
  }
  if (isLongInvestmentDeckRequest(userMsg)) {
    obj.task_type = "generate_pptx_template";
    obj.tools = ["investment_deck_pptx"];
  }
  obj.agents = obj.agents.filter(a => VALID_AGENTS.includes(a)).slice(0, 4);
  if (!obj.task_type) obj.task_type = inferRoutingFromText(userMsg).task_type;
  return obj;
}

function inferRoutingFromText(userMsg = "", reason = "heuristic") {
  const text = userMsg.toLowerCase();
  const forcedTool = forcedToolFromUserMsg(userMsg);
  if (forcedTool) {
    return {
      task_type: taskTypeForForcedTool(forcedTool),
      agents: ["market_deal", "finance_valuation", "product_team_risk"],
      tools: [forcedTool],
      reason,
    };
  }
  if (isHighlightVisualRequest(userMsg)) {
    return { task_type: "generate_highlight_visual", agents: ["market_deal", "finance_valuation", "product_team_risk"], tools: ["highlight_visual"], reason };
  }
  // one-pager 必须先匹配，否则会被下面的通用 PPT 规则吃掉
  if (isOnePagerRequest(userMsg)) {
    const tool = /投资亮点|pitch\s*deck/i.test(userMsg) ? "onepager_pptx" : "investment_snapshot";
    return { task_type: "generate_pptx_template", agents: ["market_deal", "finance_valuation", "product_team_risk"], tools: [tool], reason };
  }
  if (isLongInvestmentDeckRequest(userMsg)) {
    return { task_type: "generate_pptx_template", agents: ["market_deal", "finance_valuation", "product_team_risk"], tools: ["investment_deck_pptx"], reason };
  }
  if (/ppt|pptx|演示|幻灯片|slide|一页纸/.test(text)) {
    const tool = /项目简报|brief|3\s*页|三\s*页|立项/i.test(userMsg) ? "project_brief" : null;
    return { task_type: "generate_pptx_template", agents: ["market_deal", "finance_valuation", "product_team_risk"], tools: tool ? [tool] : [], reason };
  }
  if (/尽调清单|尽调问题|尽调追问|dd checklist|due diligence checklist/i.test(userMsg)) {
    return { task_type: "generate_dd_checklist", agents: ["finance_valuation", "product_team_risk"], tools: ["dd_checklist_xlsx"], reason };
  }
  if (isFounderInterviewRequest(userMsg)) {
    return { task_type: "generate_founder_interview", agents: ["market_deal", "finance_valuation", "product_team_risk"], tools: ["founder_interview_docx"], reason };
  }
  if (isCompetitorMatrixRequest(userMsg)) {
    return { task_type: "generate_competitor_matrix", agents: ["market_deal", "product_team_risk"], tools: ["competitor_matrix_xlsx"], reason };
  }
  if (isIcQuestionsRequest(userMsg)) {
    return { task_type: "generate_ic_questions", agents: ["market_deal", "finance_valuation", "product_team_risk"], tools: ["ic_questions_xlsx"], reason };
  }
  if (/word|docx|文档|报告|memo|备忘录/.test(text)) {
    return { task_type: "generate_docx", agents: ["market_deal", "finance_valuation", "product_team_risk"], tools: ["generate_docx"], reason };
  }
  if (/excel|xlsx|表格|模型|清单/.test(text)) {
    return { task_type: "generate_xlsx", agents: ["finance_valuation", "product_team_risk"], tools: ["generate_xlsx"], reason };
  }
  if (/附件|材料|文件|分析.*(docx|xlsx|pdf|pptx|csv)/.test(text)) {
    return { task_type: "analyze_file", agents: ["market_deal", "finance_valuation", "product_team_risk"], tools: [], reason };
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

// 由 registry 声明哪些专家可使用服务端 MiniMax web_search 预检索。
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
    `先在 thinking 块里**真实地推理**：筛选 2-4 个关键证据，完成必要的口径校准/冲突检查，再判断哪些信息应交给 Host 做最终投决。`,
    `再写最终回答 250-550 字，专业结论先行。不要复述项目上下文原文，不要替 Host 下最终投决。`,
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
    name: "web_search",
    description: "联网检索公开信息。用户要求联网/搜索/检索/最新信息, 或需要近期市场、政策、竞品、监管、诉讼、负面新闻时使用。返回 MiniMax Coding Plan web_search 的结构化搜索结果。",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索查询词，建议 3-8 个关键词，包含公司/行业/主题。" },
        queries: {
          type: "array",
          items: { type: "string" },
          description: "可选的多个查询词。优先使用 query；需要覆盖市场/政策/负面等角度时使用 queries。",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "onepager_pptx",
    description:
      "调用模板 skill 生成【1 页】投资亮点 PPT（pitch 视角）。" +
      "默认基于项目已落库的 BP 分析结果生成 (强耦合, 保证跨公司一致). " +
      "用户显式说 '基于这段材料 / 给一段 BP' 时, 传 source_mode='materials' + materials 走临时材料模式. " +
      "视觉、字号、坐标由模板锁定; 严禁传 slides、颜色、字体、坐标。",
    input_schema: {
      type: "object",
      properties: {
        source_mode: {
          type: "string",
          enum: ["bp_analysis", "materials"],
          description: "默认 bp_analysis (用已落库 BP 分析). materials 时必须同时传 materials 字段.",
        },
        materials: { type: "string", description: "source_mode='materials' 时必填, 公司原始材料文本 (>=200 字)." },
        company_hint: { type: "string", description: "可选, 公司名提示, 仅 materials 模式生效." },
        user_overrides: { type: "object", description: "可选，人工微调字段，如轮次/估值/重点客户。", additionalProperties: true },
        regenerate: { type: "boolean", description: "true 时清缓存重新生成 (仅 bp_analysis 模式生效)." },
      },
    },
  },
  {
    name: "investment_snapshot",
    description: "调用模板 skill 生成【1 页】A4 横版投决速览 PPT。适合投决速览、一页纸、one-pager、把任意材料浓缩成 1 页。视觉、字号、坐标由模板锁定；严禁传 slides、颜色、字体、坐标。",
    input_schema: {
      type: "object",
      properties: {
        materials: { type: "string", description: "可选，公司原始材料；留空则用 workspace 项目上下文。" },
        company_hint: { type: "string", description: "可选，公司名提示。" },
      },
    },
  },
  {
    name: "highlight_visual",
    description: "调用 MiniMax image-01 生成【1 页】投资亮点视觉信息图 JPEG。适合用户明确要求视觉图、信息图、图片、海报、转发图。不是 PPT；不要传 slides、颜色、字体、坐标。",
    input_schema: {
      type: "object",
      properties: {
        materials: { type: "string", description: "可选，公司原始材料；留空则用 workspace 项目上下文。" },
        company_hint: { type: "string", description: "可选，公司名提示。" },
      },
    },
  },
  {
    name: "project_brief",
    description: "调用模板 skill 生成【3 页】项目简报 PPT（封面 / 概况+亮点 / 团队+财务+估值）。适合内部立项、IC 前置 brief、项目快速介绍。视觉、字号、坐标由模板锁定；严禁传 slides、颜色、字体、坐标。",
    input_schema: {
      type: "object",
      properties: {
        materials: { type: "string", description: "可选，公司原始材料；留空则用 workspace 项目上下文。" },
        company_hint: { type: "string", description: "可选，公司名提示。" },
      },
    },
  },
  {
    name: "investment_deck_pptx",
    description: "调用模板 skill 生成【8-30 页】可变页数投决报告/可研报告/尽调汇报 PPT。适合用户要求 10页、15页、20页、30页、完整投委会材料等。视觉、字号、坐标由模板锁定；严禁传 slides、颜色、字体、坐标。",
    input_schema: {
      type: "object",
      properties: {
        materials: { type: "string", description: "可选，公司原始材料；留空则用 workspace 项目上下文。" },
        company_hint: { type: "string", description: "可选，公司名提示。" },
        target_pages: { type: "integer", minimum: 8, maximum: 30, description: "目标页数，当前模板支持 8-30 页。" },
        deck_type: {
          type: "string",
          enum: ["investment_committee", "feasibility_study", "diligence_report"],
          description: "材料类型：投决报告/可研报告/尽调汇报。",
        },
      },
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
    name: "dd_checklist_xlsx",
    description: "生成 Excel 格式的尽调问题清单 / DD checklist。内部先基于项目风险和夸大声明生成结构化尽调追问，再导出 xlsx。用户要求尽调清单、尽调问题、DD checklist、尽调追问时优先调用这个工具。",
    input_schema: {
      type: "object",
      properties: {
        focus_areas: {
          type: "array",
          items: { type: "string", enum: ["commercial", "technical", "financial", "legal", "founder"] },
          description: "可选,只生成指定类目;空表示全部",
        },
        stage_context: { type: "string", description: "可选,如 '种子轮首谈' / 'A 轮投决前'" },
        title: { type: "string", description: "可选, Excel 标题" },
      },
    },
  },
  {
    name: "founder_interview_docx",
    description: "生成 Word 格式的创始人访谈提纲。每个问题包含为什么问、追问、好答案信号、红旗信号和事实来源。用户要求创始人访谈/面谈提纲时调用。",
    input_schema: {
      type: "object",
      properties: {
        interview_stage: { type: "string", description: "可选, 如 '首次面谈' / 'IC 前复核' / '条款会前'" },
        focus_areas: { type: "array", items: { type: "string" }, description: "可选, 额外关注方向" },
      },
    },
  },
  {
    name: "competitor_matrix_xlsx",
    description: "生成 Excel 格式的竞品对比矩阵。明确区分已确认竞品和待确认假设竞品；缺失数据不编造。用户要求竞品对比/竞品矩阵时调用。",
    input_schema: {
      type: "object",
      properties: {
        include_hypothesis: { type: "boolean", description: "是否允许列出待确认假设竞品, 默认 true" },
        focus_dimension: { type: "string", description: "可选, 如 产品能力/商业模式/价格/客户渠道" },
      },
    },
  },
  {
    name: "ic_questions_xlsx",
    description: "生成 Excel 格式的 IC 投委问题清单。内部执行 Bull/Bear 左右脑互搏，输出投委可能追问的 Top 问题、建议回答、需补材料和负责人。",
    input_schema: {
      type: "object",
      properties: {
        ic_stage: { type: "string", description: "可选, 如 '首次 IC' / '最终 IC' / '条款会前'" },
        question_count: { type: "integer", minimum: 10, maximum: 15, description: "目标问题数量, 默认 12" },
      },
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
  routing,
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
    routing?.tools?.length
      ? `# 后端已判定应调用的工具\n${routing.tools.join(", ")}\n不要向用户请求确认；如果用户当前消息已经要求生成文件，必须立即调用上述工具。`
      : "",
    "",
    `# 各专家本轮意见（你的审计素材，不要逐条复读）`,
    expertBlock,
    "",
    `# 你的任务`,
    `1. 先在 thinking 块里**真实地推理**：先做市场-财务-产品逻辑闭环检查，再审计专家意见之间的矛盾，最后凝结成 IC Memo 级 thesis 与 Verdict。`,
    `2. 如果用户要生成文件，先在 thinking 里判断文件类型和模板匹配，再调用对应工具（onepager_pptx / investment_snapshot / highlight_visual / project_brief / investment_deck_pptx / generate_docx / generate_xlsx / dd_checklist_xlsx / founder_interview_docx / competitor_matrix_xlsx / ic_questions_xlsx），args 必须是合法 JSON。`,
    `2a. PPT 硬规则：任何 PPT 都必须走模板 skill。可用模板只有 onepager_pptx（1 页投资亮点 pitch）、investment_snapshot（1 页 A4 投决速览）、project_brief（3 页项目简报）、investment_deck_pptx（8-30 页投决/可研/尽调 deck）。用户要求视觉图/信息图/图片/海报时调用 highlight_visual，它输出 PNG，不是 PPT。严禁输出 slides 数组，严禁调用 generate_pptx，严禁传颜色/字号/坐标/字体。`,
    `2b. 如果用户要 5 页、10 页、路演完整 deck、竞品地图等当前没有模板的 PPT，不要硬凑；直接说明当前模板库只支持上述模板，并建议按 harness 范式新增对应模板。`,
    `2c. 标准化投研工具硬规则：尽调清单用 dd_checklist_xlsx；创始人访谈提纲用 founder_interview_docx；竞品对比矩阵用 competitor_matrix_xlsx；IC/投委问题清单/左右脑互搏用 ic_questions_xlsx。不要用 generate_xlsx/generate_docx 临时拼这些标准产物。`,
    `3. 工具返回 tool_result 后，写最终答复给用户：投资备忘录口吻，不复述上下文，不复读专家原话，必须给出核心矛盾、决策结论和杀手级问题。`,
    `4. 如果只是普通问答且不需要联网/最新信息，跳过工具直接写答复；如果用户要求搜索或问题依赖近期外部信息，最多调用一次 web_search，拿到 tool_result 后必须直接综合成最终答复，不要继续搜索。`,
  ].join("\n");

  const artifacts = [];
  let thinking = "";
  let text = "";
  let toolResultContext = "";
  let webSearchUsed = false;

  const toolRunner = async (name, input) => {
    if (typeof hostToolRunner !== "function") {
      return `工具暂不可用：缺少 hostToolRunner`;
    }
    try {
      if (name === "web_search") {
        if (webSearchUsed) {
          return "本轮已经完成过联网检索。请基于已有 tool_result 直接给用户最终答复，不要继续搜索。";
        }
        webSearchUsed = true;
      }
      const r = await hostToolRunner(name, input);
      if (r?.artifact) {
        artifacts.push(r.artifact);
        return r.summary || `已生成 ${r.artifact.filename}`;
      }
      if (typeof r?.context === "string" && r.context.trim()) {
        return r.context;
      }
      if (Array.isArray(r?.results)) {
        return JSON.stringify({ summary: r.summary || "工具执行完成", results: r.results }, null, 2);
      }
      return r?.summary || "工具执行完成";
    } catch (e) {
      throw e;
    }
  };

  let result;
  try {
    const { validateNativeToolUses } = require("../agents/workspace/hostToolGuard");
    result = await callLLMAgentic({
      system: WORKSPACE_HOST_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      tools: HOST_TOOL_SCHEMAS,
      toolRunner,
      // 整批守卫: 单轮 tool_use 多于 1 个 / skill_id 不在 catalog / PPT 传版式字段
      // 都在执行前驳回, 不会先跑第一个工具.
      toolBatchGuard: (toolUses) => validateNativeToolUses(toolUses),
      thinkingBudget: 5000,
      maxTokens: 6000,
      // 文件生成类请求在工具成功后不再强制追加一轮 LLM 总结，避免 PPT 已生成但 SSE
      // 长时间静默导致前端显示 network error。搜索类问题仍保留第二轮综合。
      maxToolRounds: isFileGenerationRequest(userMsg) ? 1 : 2,
      signal,
      onEvent: (ev) => {
        if (ev.type === "thinking_delta") thinking += ev.text;
        if (ev.type === "text_delta") text += ev.text;
        if (ev.type === "tool_result") {
          const resultText = typeof ev.result === "string" ? ev.result : JSON.stringify(ev.result || {});
          toolResultContext += `\n\n## ${ev.name || "tool"}\n${resultText.slice(0, 6000)}`;
        }
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

  if (artifacts.length > 0) {
    const completionText = buildArtifactCompletionText(artifacts);
    const cleanExisting = stripModelToolCalls(stripToolCalls(text)).trim();
    if (!cleanExisting) {
      text = completionText;
      onEvent({ type: "text_delta", text: completionText });
    } else if (!cleanExisting.includes(artifacts[0]?.filename || completionText)) {
      text = `${cleanExisting}\n\n${completionText}`;
      onEvent({ type: "text_delta", text: `\n\n${completionText}` });
    } else {
      text = cleanExisting;
    }
  }

  if (!text.trim() && toolResultContext.trim()) {
    console.warn("[Workspace] host 工具调用后未产出正文，启动无工具综合兜底");
    const fallbackUser = [
      "# 项目上下文",
      projectCtx,
      "",
      "# 用户当前消息",
      userMsg,
      "",
      "# 专家意见",
      expertBlock,
      "",
      "# 工具结果",
      toolResultContext,
      "",
      "请基于上述工具结果和项目上下文，直接给用户一段中文最终答复。不要再调用工具，不要输出 thinking，不要解释工具过程；如果检索结果相关性不足，要明确说明并给出可执行的下一步检索/尽调建议。",
    ].join("\n");
    const fallbackText = await callLLM(
      `${WORKSPACE_HOST_SYSTEM_PROMPT}\n\n你现在处于工具调用后的最终综合阶段：只能输出给用户看的正文，严禁继续搜索或输出工具调用。`,
      fallbackUser,
      1800
    );
    text = stripModelToolCalls(fallbackText || "").trim();
    if (text) onEvent({ type: "text_delta", text });
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

  if (isFileGenerationRequest(userMsg) && artifacts.length === 0 && hostToolRunner) {
    const fallback = buildFallbackToolCall({
      routing: routing || inferRoutingFromText(userMsg),
      userMsg,
      cleanContent: stripModelToolCalls(stripToolCalls(text)).trim(),
      expertOutputs,
    });
    if (fallback?.tool) {
      const toolId = `forced-${Date.now()}`;
      console.warn("[Workspace] 文件生成请求未触发 tool_use，按路由强制执行工具:", fallback.tool);
      onEvent({ type: "tool_use_start", id: toolId, name: fallback.tool });
      onEvent({ type: "tool_use", id: toolId, name: fallback.tool, input: fallback.args || {} });
      const r = await hostToolRunner(fallback.tool, fallback.args || {});
      if (r?.artifact) {
        artifacts.push(r.artifact);
        onEvent({
          type: "tool_result",
          id: toolId,
          name: fallback.tool,
          result: r.summary || "已生成",
          error: false,
        });
        const completionText = buildArtifactCompletionText(artifacts);
        text = completionText;
        onEvent({ type: "text_delta", text: completionText });
      }
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

/**
 * 共享 host 阶段执行器 — task-level 和 project-level chat 路由共用.
 *
 * 职责:
 *   - emit host_start
 *   - 拉记忆 (taskId+userId 时)
 *   - 构造 hostToolRunner (executeWorkspaceTool + sendEvent("artifact"))
 *   - runHostAgentic + onEvent → SSE (host_thinking_delta / host_text_delta /
 *     host_tool_use_start / host_tool_use / host_tool_result, 同时兼容老 token 事件)
 *   - 持久化 host 消息 (含 routing/run_id/artifacts/used_*)
 *   - emit host_done
 *   - 异步: processHostMemory (taskId 时) + processSkillCandidate (有 artifact 时)
 *
 * @returns {Promise<{hostMsgId, hostResult, hostArtifacts}>}
 */
async function runHostStreamingPhase({
  conv,
  projectCtx,
  history,
  userMsg,
  expertOutputs,
  runId,
  taskId,
  userId,
  projectId,
  taskType,
  routing,
  hostMsgId,
  signal,
  sendEvent,
}) {
  if (!hostMsgId) hostMsgId = require("crypto").randomBytes(16).toString("hex");
  sendEvent("host_start", { id: hostMsgId, run_id: runId });

  let memoryPack = null;
  if (taskId && userId) {
    memoryPack = await queryMemory({
      userId,
      taskId,
      agentName: "host",
      taskType,
      userMessage: userMsg,
      intent: taskType,
    });
  }

  const hostToolRunner = async (toolName, input) => {
    const r = await executeWorkspaceTool({
      tool: toolName,
      args: input || {},
      conversationId: conv.id,
      messageId: hostMsgId,
      projectId: projectId || conv.project_id || null,
      userId,
      taskId,
    });
    if (r.artifact) sendEvent("artifact", r.artifact);
    return r;
  };

  const hostResult = await runHostAgentic({
    projectCtx,
    history,
    userMsg,
    expertOutputs,
    memoryPack,
    routing,
    signal,
    hostToolRunner,
    onEvent: (ev) => {
      if (ev.type === "thinking_delta") {
        sendEvent("host_thinking_delta", { id: hostMsgId, run_id: runId, delta: ev.text });
      } else if (ev.type === "text_delta") {
        sendEvent("host_text_delta", { id: hostMsgId, run_id: runId, delta: ev.text });
        sendEvent("token", { id: hostMsgId, delta: ev.text }); // 兼容老前端
      } else if (ev.type === "tool_use_start") {
        sendEvent("host_tool_use_start", { id: hostMsgId, run_id: runId, tool_id: ev.id, name: ev.name });
      } else if (ev.type === "tool_use") {
        sendEvent("host_tool_use", { id: hostMsgId, run_id: runId, tool_id: ev.id, name: ev.name, input: ev.input });
      } else if (ev.type === "tool_result") {
        sendEvent("host_tool_result", {
          id: hostMsgId, run_id: runId, tool_id: ev.id, name: ev.name,
          result: typeof ev.result === "string" ? ev.result.slice(0, 500) : ev.result,
          error: !!ev.error,
        });
      }
    },
  });

  const cleanContent = (hostResult.text || "").trim();
  const hostArtifacts = hostResult.artifacts || [];

  const db = getDb();
  db.prepare(
    `INSERT INTO workspace_messages (id, conversation_id, role, agent_name, content, metadata)
     VALUES (?, ?, 'agent', 'host', ?, ?)`
  ).run(
    hostMsgId, conv.id, cleanContent,
    JSON.stringify({
      routing,
      run_id: runId,
      thinking: hostResult.thinking || "",
      artifacts: hostArtifacts.map((a) => ({ id: a.id, filename: a.filename, kind: a.kind })),
      used_thinking: hostResult.used_thinking,
      used_tools: hostResult.used_tools,
      used_stream: hostResult.used_stream,
    })
  );
  db.prepare("UPDATE workspace_conversations SET updated_at = datetime('now') WHERE id = ?").run(conv.id);

  sendEvent("host_done", { id: hostMsgId, content: cleanContent, run_id: runId });

  if (taskId && userId) {
    processHostMemory({
      taskId, userId, content: cleanContent, taskType,
    }).catch((err) => console.warn("[Workspace] Host 记忆提炼失败:", err.message));
  }

  if (hostArtifacts.length > 0) {
    processSkillCandidate({
      userId,
      taskType,
      userMessage: userMsg,
      toolCalls: hostArtifacts.map((a) => ({ tool: a.kind?.replace(/^generated_/, "generate_") })),
      artifactResults: hostArtifacts.map((a) => ({ artifact: a })),
      runId,
    });
  }

  return { hostMsgId, hostResult, hostArtifacts };
}

async function streamHostSummary({ projectCtx, history, userMsg, expertOutputs, onDelta, signal, hostToolRunner, onEvent }) {
  let emitted = "";
  const result = await runHostAgentic({
    projectCtx,
    history,
    userMsg,
    expertOutputs,
    signal,
    hostToolRunner,
    onEvent: (ev) => {
      if (ev.type === "text_delta" && ev.text) {
        emitted += ev.text;
        onDelta?.(ev.text);
      }
      onEvent?.(ev);
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
  if (taskType === "generate_highlight_visual") return "highlight_visual";
  if (taskType === "generate_onepager") return "onepager_pptx"; // legacy alias
  if (taskType === "generate_pptx") return "project_brief"; // legacy alias; free PPT is disabled
  if (taskType === "generate_pptx_template") return "investment_deck_pptx";
  if (taskType === "generate_docx") return "generate_docx";
  if (taskType === "generate_xlsx") return "generate_xlsx";
  if (taskType === "generate_dd_checklist") return "dd_checklist_xlsx";
  if (taskType === "generate_founder_interview") return "founder_interview_docx";
  if (taskType === "generate_competitor_matrix") return "competitor_matrix_xlsx";
  if (taskType === "generate_ic_questions") return "ic_questions_xlsx";
  return null;
}

function forcedToolFromUserMsg(userMsg = "") {
  const m = String(userMsg || "").match(/必须(?:立即)?调用\s*([a-zA-Z0-9_]+)\s*(?:工具|模板|skill)?/);
  const tool = m?.[1];
  const allowed = new Set([
    "onepager_pptx",
    "investment_snapshot",
    "highlight_visual",
    "dd_checklist_xlsx",
    "founder_interview_docx",
    "competitor_matrix_xlsx",
    "ic_questions_xlsx",
    "investment_deck_pptx",
    "project_brief",
  ]);
  return allowed.has(tool) ? tool : "";
}

function taskTypeForForcedTool(tool) {
  if (tool === "highlight_visual") return "generate_highlight_visual";
  if (tool === "dd_checklist_xlsx") return "generate_dd_checklist";
  if (tool === "founder_interview_docx") return "generate_founder_interview";
  if (tool === "competitor_matrix_xlsx") return "generate_competitor_matrix";
  if (tool === "ic_questions_xlsx") return "generate_ic_questions";
  if (["onepager_pptx", "investment_snapshot", "investment_deck_pptx", "project_brief"].includes(tool)) {
    return "generate_pptx_template";
  }
  return "answer";
}

function isHighlightVisualRequest(userMsg = "") {
  if (!userMsg) return false;
  return /亮点视觉图|视觉图|信息图|infographic|海报|转发图|宣传图|图片|生成图|生成一张图|image/i.test(userMsg);
}

function isFounderInterviewRequest(userMsg = "") {
  if (!userMsg) return false;
  return /创始人.*(访谈|采访|面谈|提纲|问题)|founder.*(interview|questions)|访谈提纲|面谈提纲/i.test(userMsg);
}

function isCompetitorMatrixRequest(userMsg = "") {
  if (!userMsg) return false;
  return /竞品.*(矩阵|对比|分析|表格|excel|xlsx)|竞争对手.*(矩阵|对比)|competitor.*(matrix|comparison)/i.test(userMsg);
}

function isIcQuestionsRequest(userMsg = "") {
  if (!userMsg) return false;
  return /IC.*(问题|清单|预演|投委)|投委.*(问题|清单|预演|追问)|左右脑|Bull|Bear|投委会.*(问题|追问)/i.test(userMsg);
}

// "一页纸 / 投资亮点 / 速览" 这类硬性要求单页 pitch 的措辞 → 走 onepager 工具
function isOnePagerRequest(userMsg = "") {
  if (!userMsg) return false;
  return (
    /投资亮点|亮点单页|单\s*页\s*(PPT|ppt|演示|材料)?|一\s*页\s*(纸|PPT|ppt|材料|速览)?|1\s*页\s*(PPT|ppt)?|one[-\s]?pager|speed\s*read|速览|pitch\s*deck/i.test(userMsg)
  );
}

function extractRequestedPageCount(userMsg = "") {
  const m = String(userMsg || "").match(/(\d{1,2})\s*(?:页|p|P|slides?|张)/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(60, Math.round(n)));
}

function isLongInvestmentDeckRequest(userMsg = "") {
  const text = String(userMsg || "");
  if (!text) return false;
  if (isOnePagerRequest(text)) return false;
  if (/项目简报|brief|3\s*页|三\s*页|立项/i.test(text)) return false;
  const pageCount = extractRequestedPageCount(text);
  const wantsDeck = /ppt|pptx|演示|幻灯片|deck|材料|报告/i.test(text);
  const longIntent = /投决|投委会|投资决策|可研|可行性研究|尽调汇报|尽调报告|完整|详细|长|中长|多页/i.test(text);
  return (wantsDeck && longIntent) || (wantsDeck && pageCount != null && pageCount >= 8);
}

function isFileGenerationRequest(userMsg = "") {
  const text = String(userMsg || "");
  return (
    isHighlightVisualRequest(text) ||
    isFounderInterviewRequest(text) ||
    isCompetitorMatrixRequest(text) ||
    isIcQuestionsRequest(text) ||
    isOnePagerRequest(text) ||
    /ppt|pptx|演示|幻灯片|slide|项目简报|brief|word|docx|文档|报告|memo|备忘录|excel|xlsx|表格|模型|清单/i.test(text)
  );
}

function buildArtifactCompletionText(artifacts = []) {
  const first = artifacts[0] || {};
  const filename = first.filename || "文件";
  return `已生成 ${filename}，可以在右侧“AI 生成产出”里下载。`;
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
  const aliases = {
    market: ["market", "market_deal"],
    finance: ["finance", "finance_valuation"],
    tech: ["tech", "product_team_risk"],
    risk: ["risk", "product_team_risk"],
  };
  const names = aliases[agentName] || [agentName];
  return expertOutputs.find((e) => names.includes(e.agent))?.content || "";
}

function collectMaterialsForTemplate({ userMsg, cleanContent, expertOutputs }) {
  return [
    userMsg ? `【用户要求】\n${userMsg}` : "",
    cleanContent ? `【Host 初步判断】\n${cleanContent}` : "",
    expertOutputs.length ? `【专家意见】\n${expertOutputs.map((e) => `## ${e.agent}\n${e.content}`).join("\n\n")}` : "",
  ].filter(Boolean).join("\n\n").slice(0, 16000);
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

// 兼容旧单测/旧调用的兜底 OnePagerPayload 构造；新 PPT 生成路径走 onepager_pptx skill。
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

function inferDeckType(userMsg = "") {
  if (/可研|可行性研究/i.test(userMsg)) return "feasibility_study";
  if (/尽调汇报|尽调报告|due diligence/i.test(userMsg)) return "diligence_report";
  return "investment_committee";
}

function buildFallbackToolCall({ routing, userMsg, cleanContent, expertOutputs }) {
  const forcedTool = forcedToolFromUserMsg(userMsg);
  if (forcedTool) {
    const baseMaterials = {
      materials: collectMaterialsForTemplate({ userMsg, cleanContent, expertOutputs }),
      company_hint: inferCompanyNameFromMsg(userMsg) || undefined,
    };
    if (forcedTool === "onepager_pptx") return { tool: forcedTool, args: {} };
    if (forcedTool === "investment_deck_pptx") {
      const pages = extractRequestedPageCount(userMsg);
      return {
        tool: forcedTool,
        args: {
          ...baseMaterials,
          target_pages: pages ? Math.max(8, Math.min(30, pages)) : 16,
          deck_type: inferDeckType(userMsg),
        },
      };
    }
    if (["investment_snapshot", "highlight_visual", "project_brief"].includes(forcedTool)) {
      return { tool: forcedTool, args: baseMaterials };
    }
    if (forcedTool === "founder_interview_docx") {
      return { tool: forcedTool, args: { interview_stage: inferIcStage(userMsg) || "IC 前创始人访谈" } };
    }
    if (forcedTool === "competitor_matrix_xlsx") {
      return { tool: forcedTool, args: { include_hypothesis: true } };
    }
    if (forcedTool === "ic_questions_xlsx") {
      return { tool: forcedTool, args: { ic_stage: inferIcStage(userMsg) || "投委会汇报前预演", question_count: 12 } };
    }
    if (forcedTool === "dd_checklist_xlsx") {
      return { tool: forcedTool, args: { stage_context: "投决前尽调" } };
    }
  }

  if (isHighlightVisualRequest(userMsg)) {
    return {
      tool: "highlight_visual",
      args: {
        materials: collectMaterialsForTemplate({ userMsg, cleanContent, expertOutputs }),
        company_hint: inferCompanyNameFromMsg(userMsg) || undefined,
      },
    };
  }
  // isOnePagerRequest 优先级最高：路由层若没识别到（如 LLM routing 失败），
  // 在这里再兜一次，保证用户说"一页纸/投资亮点"时不会落到多页 generate_pptx。
  const onePager = isOnePagerRequest(userMsg);
  const routedTool = Array.isArray(routing?.tools) && routing.tools.length ? routing.tools[0] : null;
  const legacyPptTool = routing?.task_type === "generate_pptx"
    ? (isLongInvestmentDeckRequest(userMsg) ? "investment_deck_pptx" : "project_brief")
    : taskTypeToTool(routing?.task_type);
  const tool = onePager
    ? (/投资亮点|pitch\s*deck/i.test(userMsg) ? "onepager_pptx" : "investment_snapshot")
    : (routedTool || legacyPptTool);
  if (!tool) return null;

  const title = inferTitle(userMsg);

  if (tool === "onepager_pptx") {
    return { tool, args: {} };
  }

  if (tool === "investment_snapshot" || tool === "project_brief" || tool === "investment_deck_pptx") {
    const args = {
      materials: collectMaterialsForTemplate({ userMsg, cleanContent, expertOutputs }),
      company_hint: inferCompanyNameFromMsg(userMsg) || undefined,
    };
    if (tool === "investment_deck_pptx") {
      const pages = extractRequestedPageCount(userMsg);
      if (pages) args.target_pages = Math.max(8, Math.min(30, pages));
      args.deck_type = inferDeckType(userMsg);
    }
    return {
      tool,
      args,
    };
  }

  if (tool === "generate_pptx") {
    return { tool: "project_brief", args: { materials: collectMaterialsForTemplate({ userMsg, cleanContent, expertOutputs }) } };
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

  if (tool === "founder_interview_docx") {
    return { tool, args: { interview_stage: inferIcStage(userMsg) || "IC 前创始人访谈" } };
  }

  if (tool === "competitor_matrix_xlsx") {
    return { tool, args: { include_hypothesis: true } };
  }

  if (tool === "ic_questions_xlsx") {
    return { tool, args: { ic_stage: inferIcStage(userMsg) || "投委会汇报前预演", question_count: 12 } };
  }

  return null;
}

function inferIcStage(userMsg = "") {
  if (/最终|final/i.test(userMsg)) return "最终 IC";
  if (/条款|term/i.test(userMsg)) return "条款会前";
  if (/首次|first/i.test(userMsg)) return "首次 IC";
  return "";
}

function normalizeToolCalls(calls, { routing, userMsg, cleanContent, expertOutputs }) {
  const normalized = Array.isArray(calls) ? [...calls] : [];
  let requestedTool = Array.isArray(routing?.tools) && routing.tools.length
    ? routing.tools[0]
    : taskTypeToTool(routing?.task_type);
  if (requestedTool === "generate_onepager") requestedTool = "onepager_pptx";
  if (requestedTool === "generate_pptx") {
    requestedTool = isOnePagerRequest(userMsg) ? "onepager_pptx" : (isLongInvestmentDeckRequest(userMsg) ? "investment_deck_pptx" : "project_brief");
  }
  if (!requestedTool) return normalized;

  for (const c of normalized) {
    const id = c.tool || c.id;
    if (id === "generate_onepager") c.tool = "onepager_pptx";
    if (id === "generate_pptx") c.tool = isOnePagerRequest(userMsg) ? "onepager_pptx" : (isLongInvestmentDeckRequest(userMsg) ? "investment_deck_pptx" : "project_brief");
  }

  const idx = normalized.findIndex((c) => (c.tool || c.id) === requestedTool);
  if (idx < 0) {
    const fallback = buildFallbackToolCall({ routing, userMsg, cleanContent, expertOutputs });
    return fallback ? [fallback] : normalized;
  }

  if (
    ["project_brief", "investment_snapshot", "onepager_pptx", "investment_deck_pptx", "highlight_visual"].includes(requestedTool) &&
    isPromptLikePptArgs(normalized[idx]?.args)
  ) {
    const fallback = buildFallbackToolCall({ routing, userMsg, cleanContent, expertOutputs });
    if (fallback) normalized[idx] = fallback;
  }
  return normalized;
}

async function executeWebSearchTool(input = {}) {
  assertToolAllowed("web_search", "host");
  const queries = Array.isArray(input.queries) && input.queries.length
    ? input.queries
    : [input.query || input.q || ""];
  const startedAt = Date.now();
  console.info("[Workspace/WebSearch] start", { queries });
  const results = await runWebSearch(queries);
  console.info("[Workspace/WebSearch] done", { count: results.length, durationMs: Date.now() - startedAt });
  const context = formatSearchContext(results);
  return {
    summary: results.length ? `联网检索完成：${results.length} 条结果` : "联网检索未取得可用结果",
    results,
    context,
  };
}

function getWorkspaceToolProject({ projectId, userId, taskId }) {
  const db = getDb();
  if (projectId && userId) {
    const p = db.prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?").get(projectId, userId);
    if (p) return p;
  }
  if (taskId) {
    const task = db.prepare("SELECT id, title, workspace_project_id FROM tasks WHERE id = ?").get(taskId);
    if (task?.workspace_project_id && userId) {
      const p = db.prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?").get(task.workspace_project_id, userId);
      if (p) return p;
    }
    return {
      id: null,
      name: task?.title || "",
      latest_task_id: taskId,
    };
  }
  return null;
}

function artifactRowFromSkillArtifact(artifact) {
  const id = artifact?.workspaceArtifactId || artifact?.workspace_artifact_id || artifact?.id;
  if (!id) return null;
  try {
    return publicArtifact(getArtifact(id));
  } catch (_) {
    return null;
  }
}

async function executeWorkspaceTool({ tool, args, conversationId, messageId, projectId, userId, taskId }) {
  // ── 单调用 guard (service 入口) ──
  // 工具名 allowlist + PPT 禁版式字段 + legacy alias 归一. 所有路径都收口在这里:
  // 来自 callLLMAgentic 的 native tool_use, 以及来自 executeToolCalls 的 <TOOL_CALL> 文本.
  if (tool !== "web_search") {
    const { guardSingleToolCall } = require("../agents/workspace/hostToolGuard");
    const guardRes = guardSingleToolCall(tool, args);
    if (!guardRes.ok) {
      const reason = guardRes.errors.map((e) => e.reason).join("; ");
      throw new Error(`[host_tool_guard] ${reason}`);
    }
    // alias 归一: validateToolCalls 把 generate_onepager → onepager_pptx, 这里同步.
    if (guardRes.accepted[0] && guardRes.accepted[0].id && guardRes.accepted[0].id !== tool) {
      tool = guardRes.accepted[0].id;
    }
  }

  if (tool === "web_search") return executeWebSearchTool(args || {});
  const toolDef = assertToolAllowed(tool, "host");

  if (toolDef.executor === "doc_service") {
    const artifact = await executeDocumentTool({ tool, args: args || {}, conversationId, messageId, userId });
    return { artifact, summary: artifact.summary || `已生成 ${artifact.filename}` };
  }

  if (toolDef.executor === "skill_template") {
    let skills = null;
    try {
      skills = require("../skills");
      skills.init();
    } catch (err) {
      throw new Error(`skill registry 不可用: ${err.message}`);
    }
    const skill = skills.registry.get(tool);
    if (!skill) throw new Error(`模板 skill 未注册: ${tool}`);
    const project = getWorkspaceToolProject({ projectId, userId, taskId });
    const out = await skills.registry.execute({
      skillId: tool,
      params: args || {},
      project,
      userId,
      ctx: { conversationId, messageId, userId },
    });
    if (!out.ok) throw new Error(out.error || `${tool} 执行失败`);
    const artifact = artifactRowFromSkillArtifact(out.artifact) || out.artifact;
    return {
      artifact,
      summary: artifact?.summary || out.artifact?.summary || `${tool} 已生成`,
      skillRunId: out.runId,
    };
  }

  throw new Error(`工具尚未实现: ${tool}`);
}

/**
 * 执行生成文档工具：调用 doc-service /generate/*，
 * 把返回的二进制保存到本地 artifacts 目录，并写入 workspace_artifacts。
 */
async function executeDocumentTool({ tool, args, conversationId, messageId, userId }) {
  if (!config.docServiceUrl) throw new Error("doc-service 未配置");
  const toolDef = assertToolAllowed(tool, "host");

  const bodyBuilders = {
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

  const url = `${config.docServiceUrl}${toolDef.endpoint}`;
  const fetchWithRetry = async () => {
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);
        return r;
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        if (attempt === 0) {
          console.warn(`[doc-service] ${tool} fetch 失败,1.5s 后重试: ${err.message}`);
          await new Promise((res) => setTimeout(res, 1500));
        }
      }
    }
    throw new Error(
      `文档渲染服务暂时不可用, 请稍后重试. (后台细节: ${url} ${lastErr?.message || "fetch failed"})`
    );
  };

  const resp = await fetchWithRetry();
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`doc-service 错误 (${resp.status}): ${t}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  try {
    require("./workspaceUploadLimits").enforceWorkspaceOutputLimits({
      userId,
      sizeBytes: buf.length,
      artifactRoot: ARTIFACTS_ROOT,
    });
  } catch (err) {
    throw new Error(err.message || "workspace 存储空间不足");
  }

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
    userId,
    artifactTitle: args?.artifactTitle || body.title || toolDef.defaultTitle,
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

  // ── 道闸: validateToolCalls (paipai 风格守卫) ──
  // 单轮 1 个工具调用、skill_id 必在 catalog、PPT 模板严禁版式字段、legacy alias 归一.
  // 不通过的整条变 error 入 results 不阻断其他成功调用.
  const { validateToolCalls } = require("../agents/workspace/hostToolGuard");
  const validation = validateToolCalls(calls);
  for (const e of validation.errors) {
    results.push({ tool: e.tool || null, error: `[host_tool_guard] ${e.reason}` });
  }
  const acceptedCalls = validation.accepted;

  for (const c of acceptedCalls) {
    // validateToolCalls 已经把 legacy alias 归一并写到 .tool/.id;
    // 这里再做一次保险防御.
    let skillId = c.id || c.tool;
    try {
      if (!skillId) {
        results.push({ tool: null, error: "工具名为空" });
        continue;
      }
      if (skillId === "generate_onepager") skillId = "onepager_pptx";

      // ── PPT 硬规则 guard ──
      // generate_pptx 是"自由幻灯片"老路径,版式由 LLM 即兴决定,产物质量不稳定.
      // validateToolCalls 已经把它列为 legacy null alias 拒掉了, 这里是 belt-and-suspenders.
      if (skillId === "generate_pptx") {
        const tmplList = skills?.registry?.listPptxTemplates?.() || [];
        const tmplLines = tmplList.length
          ? tmplList.map((t) => `- ${t.id}: ${t.title} — ${t.useCase}`).join("\n")
          : "(当前没有任何 PPT 模板注册)";
        results.push({
          tool: skillId,
          error:
            "PPT 自由生成 (generate_pptx) 已禁用 —— 它的版式不可控,会输出乱排版.\n" +
            "请改用 PPT 模板 catalog 里的具体 skill (按 id 调用):\n" +
            tmplLines +
            "\n如果 catalog 里没有匹配场景,请告知用户描述需求,工程团队会按 harness 范式新增一个模板.",
        });
        continue;
      }

      if ([
        "onepager_pptx", "investment_snapshot", "highlight_visual", "project_brief",
        "investment_deck_pptx", "generate_docx", "generate_xlsx", "dd_checklist_xlsx",
        "founder_interview_docx", "competitor_matrix_xlsx", "ic_questions_xlsx",
      ].includes(skillId)) {
        const r = await executeWorkspaceTool({
          tool: skillId,
          args: c.args || {},
          conversationId,
          messageId,
          projectId,
          userId,
        });
        results.push({ tool: skillId, artifact: r.artifact });
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
          ctx: { conversationId, messageId, userId },
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
  listArtifactsInternal,
  publicArtifact,
  getArtifact,
  getArtifactForUser,
  deleteArtifact,
  insertArtifact,
  saveArtifactExtractedText,
  clearConversation,
  buildProjectContext,
  buildEnhancedProjectContext,
  runHostRouting,
  runExpertsParallel,
  runHostAgentic,
  runHostStreamingPhase,
  streamHostSummary,
  executeWebSearchTool,
  executeWorkspaceTool,
  executeDocumentTool,
  parseToolCalls,
  stripToolCalls,
  normalizeToolCalls,
  executeToolCalls,
  inferRoutingFromText,
  taskTypeToTool,
  isHighlightVisualRequest,
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
  buildStandardArtifactFilename,
  ARTIFACTS_ROOT,
};
