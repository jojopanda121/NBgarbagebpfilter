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
const { callLLM, callLLMChat } = require("./llmService");
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

const ARTIFACTS_ROOT = path.join(__dirname, "..", "..", "data", "workspace_artifacts");
if (!fs.existsSync(ARTIFACTS_ROOT)) fs.mkdirSync(ARTIFACTS_ROOT, { recursive: true });

const VALID_AGENTS = getAgentNames();

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

function clearConversation(conversationId) {
  const db = getDb();
  const artifacts = db.prepare("SELECT * FROM workspace_artifacts WHERE conversation_id = ?").all(conversationId);
  for (const artifact of artifacts) removeArtifactFiles(artifact);
  db.prepare("DELETE FROM workspace_artifacts WHERE conversation_id = ?").run(conversationId);
  db.prepare("DELETE FROM workspace_messages WHERE conversation_id = ?").run(conversationId);
  db.prepare("UPDATE workspace_conversations SET updated_at = datetime('now') WHERE id = ?").run(conversationId);
  return { deleted_messages: true, deleted_artifacts: artifacts.length };
}

function runWorkspaceMemoryGc() {
  return runMemoryGc({ artifactRoot: ARTIFACTS_ROOT, artifactMaxAgeDays: 30 });
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
    `# 项目上下文`,
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
  ].join("\n");

  let text = await callLLM(sys, userPrompt, 1500);
  if (leakedToolCall(text)) {
    console.warn(`[Workspace] ${agentName} 输出了工具调用文本，重试最终回答`);
    text = await callLLM(
      `${sys}\n\n重要：服务端已经完成必要检索。不要输出“实时搜索工具”“我来检索”“web_search”、XML、JSON 工具调用语法；直接给最终分析结论。`,
      userPrompt,
      1500
    );
  }
  const content = stripModelToolCalls(text);
  appendWorkingFinding(runId, agentName, content.slice(0, 300));
  keeper.processAgentOutput({
    taskId: opts.taskId,
    userId: opts.userId,
    agentName,
    content,
    taskType: opts.taskType,
  }).catch((err) => console.warn(`[Keeper] ${agentName} 记忆提炼失败:`, err.message));
  return { agent: agentName, content, memory_used: memoryPack };
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

// ── Host 流式汇总 ──────────────────────────────────────────

async function streamHostSummary({ projectCtx, history, userMsg, expertOutputs, onDelta, signal, memoryPack }) {
  const expertBlock = expertOutputs.length > 0
    ? expertOutputs.map(e => `## ${e.agent} 专家意见\n${e.content}`).join("\n\n")
    : "（无专家协助，直接回答）";

  const userPrompt = [
    `# 项目上下文`,
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

function taskTypeToTool(taskType) {
  if (taskType === "generate_pptx") return "generate_pptx";
  if (taskType === "generate_docx") return "generate_docx";
  if (taskType === "generate_xlsx") return "generate_xlsx";
  return null;
}

function isOnePagePptRequest(userMsg = "") {
  return /一\s*页|1\s*页|one\s*page|single\s*page/i.test(userMsg);
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

function isPromptLikePptArgs(args = {}) {
  const text = JSON.stringify(args).slice(0, 8000);
  return /TOOL_CALL|argShape|输出格式|工具调用|生成一份|请生成|你是.*?AI|用户要求|根据用户指令|slides\s*数组|不要写页码|必须且只能/i.test(text);
}

function inferTitle(userMsg = "", fallback = "投委会简报") {
  const quoted = userMsg.match(/[《"]([^》"]{4,40})[》"]/);
  if (quoted) return quoted[1];
  if (/ppt|PPT|演示|一页纸|one\s*page/i.test(userMsg)) return "一页纸投资简报";
  if (/word|docx|文档|报告|memo|备忘录/i.test(userMsg)) return "投资分析备忘录";
  if (/excel|xlsx|表格|模型/i.test(userMsg)) return "投研分析表";
  return fallback;
}

function buildFallbackToolCall({ routing, userMsg, cleanContent, expertOutputs }) {
  const tool = taskTypeToTool(routing?.task_type);
  if (!tool) return null;

  const title = inferTitle(userMsg);

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

async function executeToolCalls(calls, { conversationId, messageId }) {
  const results = [];
  for (const c of calls) {
    try {
      if (c.tool) {
        const art = await executeDocumentTool({ tool: c.tool, args: c.args || {}, conversationId, messageId });
        results.push({ tool: c.tool, artifact: art });
      } else {
        results.push({ tool: null, error: "工具名为空" });
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
  appendMessage,
  listMessages,
  listArtifacts,
  getArtifact,
  deleteArtifact,
  insertArtifact,
  saveArtifactExtractedText,
  clearConversation,
  buildProjectContext,
  runHostRouting,
  runExpertsParallel,
  streamHostSummary,
  parseToolCalls,
  stripToolCalls,
  normalizeToolCalls,
  executeToolCalls,
  summarizeUploadedText,
  processUploadMemory,
  processHostMemory,
  processSkillCandidate,
  runWorkspaceMemoryGc,
  queryMemory,
  listWorkspaceCapabilities,
  ARTIFACTS_ROOT,
};
