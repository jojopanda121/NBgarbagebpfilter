// ============================================================
// server/services/memory/contextBuilder.js
//
// 给 Hermes 拼装"最小必要上下文"。Hermes-first plan §7：
//   "整份 BP 全文永不出境"——只发必要片段。
//   Hermes 需要更多上下文时通过 tool call (fetch_bp_section) 主动拉取。
//
// 输出的对象交给 redactor 处理，再走 Hermes API。
//
// 当前 MVP 上下文片段：
//   1. 项目概要（一句话标的描述）—— 来自 workspace_memory_shared 'project_summary'
//   2. 当前对话最近 6 条消息（不包含本轮 user 消息）
//   3. 用户偏好（top-K from workspace_memory_longterm WHERE user_id=...）
//   4. 平台共享技能（top-K matchSkills(user_id IS NULL)）
//   5. 平台共享知识（institutional_memory，按 industry 筛 top-K）
//
// 不发：
//   * BP 全文 / artifact 二进制
//   * 其他项目 / 其他用户的私有事实
// ============================================================

const { getDb } = require("../../db");

const MAX_HISTORY = 6;
const MAX_SKILLS = 3;
const MAX_LONGTERM = 5;
const MAX_INSTITUTIONAL = 3;

function safeListMessages(conversationId, limit) {
  try {
    const db = getDb();
    return db.prepare(`
      SELECT role, agent_name, content, created_at
      FROM workspace_messages
      WHERE conversation_id = ? AND (metadata IS NULL OR json_extract(metadata, '$.internal') IS NOT 1)
      ORDER BY id DESC
      LIMIT ?
    `).all(conversationId, limit).reverse();
  } catch {
    return [];
  }
}

function safeProjectSummary(taskId) {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT claim_text FROM workspace_memory_shared
      WHERE task_id = ? AND category = 'project_summary' AND status = 'active'
      ORDER BY updated_at DESC LIMIT 1
    `).get(taskId);
    return row?.claim_text || null;
  } catch {
    return null;
  }
}

function safeLongTermPrefs(userId, limit) {
  try {
    const db = getDb();
    return db.prepare(`
      SELECT trigger, rule, confidence
      FROM workspace_memory_longterm
      WHERE user_id = ? AND status = 'active'
      ORDER BY confidence DESC, updated_at DESC
      LIMIT ?
    `).all(userId, limit);
  } catch {
    return [];
  }
}

function safeSkills(userId, userMsg, limit) {
  try {
    const { matchSkills } = require("./skillRegistry");
    return matchSkills({ userId, userMessage: userMsg, limit });
  } catch {
    return [];
  }
}

function safeInstitutional(industry, limit) {
  try {
    const db = getDb();
    if (industry) {
      return db.prepare(`
        SELECT title, body
        FROM institutional_memory
        WHERE industry = ? AND status = 'active'
        ORDER BY upvotes DESC, created_at DESC
        LIMIT ?
      `).all(industry, limit);
    }
    return db.prepare(`
      SELECT title, body
      FROM institutional_memory
      WHERE status = 'active'
      ORDER BY upvotes DESC, created_at DESC
      LIMIT ?
    `).all(limit);
  } catch {
    return [];
  }
}

/**
 * @param {Object} args
 * @param {number} args.userId
 * @param {string} args.taskId
 * @param {string} args.conversationId
 * @param {string} args.userMsg
 * @param {string} [args.industry]
 * @param {string} [args.projectContext] —— 调用方已用 workspaceService.buildEnhancedProjectContext()
 *   构造好的完整 BP 项目上下文（BP 快照 / 五维 / claim_verdicts / 深度研究 / 上传材料）。
 *   如果传入，**优先**使用，跳过这里的 mini "# 项目概要"。
 *   这是 Hermes 路径的主要数据通道——legacy 路径走自己的链路，不调本函数。
 * @returns {{ text: string, stats: { historyCount, skillCount, longtermCount, institutionalCount, projectSummaryPresent, projectContextBytes, bytesEstimate } }}
 */
function build({ userId, taskId, conversationId, userMsg, industry, projectContext }) {
  const lines = [];
  let bytes = 0;
  let projectContextBytes = 0;
  let summaryUsed = false;

  // 1. 项目上下文 —— 优先用调用方传入的 full context（Hermes 路径），
  //    退化到 mini summary（被其他路径调用时）。
  if (projectContext && typeof projectContext === "string" && projectContext.trim()) {
    lines.push(projectContext.trim());
    lines.push("");
    projectContextBytes = Buffer.byteLength(projectContext, "utf8");
    summaryUsed = true; // 满足 projectSummaryPresent 语义
  } else {
    const summary = safeProjectSummary(taskId);
    if (summary) {
      lines.push("# 项目概要");
      lines.push(summary.slice(0, 600));
      lines.push("");
      summaryUsed = true;
    }
  }

  // 2. 历史（精简）
  const history = safeListMessages(conversationId, MAX_HISTORY);
  if (history.length > 0) {
    lines.push("# 近期对话");
    for (const m of history) {
      const role = m.role === "user" ? "User" : (m.agent_name || "Assistant");
      const content = String(m.content || "").slice(0, 400);
      lines.push(`- ${role}: ${content}`);
    }
    lines.push("");
  }

  // 3. 用户偏好
  const prefs = safeLongTermPrefs(userId, MAX_LONGTERM);
  if (prefs.length > 0) {
    lines.push("# 用户偏好（仅当前用户）");
    for (const p of prefs) {
      lines.push(`- 当 ${p.trigger} → ${p.rule} (conf ${Number(p.confidence || 0).toFixed(2)})`);
    }
    lines.push("");
  }

  // 4. 平台共享技能
  const skills = safeSkills(userId, userMsg, MAX_SKILLS);
  if (skills.length > 0) {
    lines.push("# 可用平台技能（程序性知识）");
    for (const s of skills) {
      lines.push(`- ${s.name}: ${(s.description || "").slice(0, 200)}`);
    }
    lines.push("");
  }

  // 5. 平台共享知识
  const inst = safeInstitutional(industry, MAX_INSTITUTIONAL);
  if (inst.length > 0) {
    lines.push("# 平台沉淀知识");
    for (const i of inst) {
      lines.push(`- 【${i.title}】${String(i.body || "").slice(0, 300)}`);
    }
    lines.push("");
  }

  // 6. 本轮用户消息（放最后，原文不截断）
  lines.push("# 用户当前问题");
  lines.push(userMsg || "");

  const text = lines.join("\n");
  bytes = Buffer.byteLength(text, "utf8");

  return {
    text,
    stats: {
      historyCount: history.length,
      skillCount: skills.length,
      longtermCount: prefs.length,
      institutionalCount: inst.length,
      projectSummaryPresent: summaryUsed,
      projectContextBytes,
      bytesEstimate: bytes,
    },
  };
}

module.exports = { build };
