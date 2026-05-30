// ============================================================
// server/services/hermesToolGateway.js
//
// Hermes 反向 HTTP 工具调用闸门。Hermes-first plan §6 全部 8 道校验：
//
//   1. Allowlist        —— 必须在 TOOL_REGISTRY 内
//   2. Caller 校验      —— host/market_deal/... 在 allowedCallers 内
//   3. Session 合法性    —— session_id ↔ user_id ↔ conversation_id 一致
//   4. 参数 schema       —— PPT 禁版式字段 / arg 类型基础校验
//   5. Quota             —— 按工具类型扣减
//   6. Artifact ownership—— 操作 artifact 时校验归属
//   7. Audit log         —— 全量写 tool_call_audit
//   8. Rate limit        —— 单 user 单 conversation 每分钟上限
//
// 这里只做"决定"——执行委托给 workspaceService.executeWorkspaceTool。
// 协议设计 MCP-ready：所有 8 步对 HTTP/MCP 都适用，HTTP 路由层 (hermesTools.js)
// 把 HTTP 请求归一为 invoke({ ... }) 即可；后续切 MCP 只改路由层。
// ============================================================

const { getDb } = require("../db");
const {
  getToolDefinition,
  getCallableToolNames,
} = require("../utils/workspaceRegistry");
const { guardSingleToolCall } = require("../agents/workspace/hostToolGuard");
const { deductQuota, refundQuota } = require("../middleware/quota");
const { executeWorkspaceTool } = require("./workspaceService");

// ── 速率限制（内存版；多实例上线时换 Redis）──
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const rateBuckets = new Map(); // key=user:conv -> [timestamps]

function rateAllow(userId, conversationId) {
  const key = `${userId}:${conversationId}`;
  const now = Date.now();
  const arr = (rateBuckets.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (arr.length >= RATE_LIMIT_MAX) {
    rateBuckets.set(key, arr);
    return false;
  }
  arr.push(now);
  rateBuckets.set(key, arr);
  return true;
}

function summarize(args) {
  try {
    const s = JSON.stringify(args);
    return s.length > 1000 ? `${s.slice(0, 1000)}…` : s;
  } catch {
    return String(args).slice(0, 1000);
  }
}

function audit(row) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO tool_call_audit
        (call_id, tool, caller, user_id, conversation_id,
         args_summary, outcome, reason, latency_ms, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.call_id || null,
      row.tool,
      row.caller || null,
      row.user_id || null,
      row.conversation_id || null,
      row.args_summary || null,
      row.outcome,
      row.reason || null,
      row.latency_ms || null,
      row.error_message ? String(row.error_message).slice(0, 500) : null,
    );
  } catch (err) {
    console.error("[hermesToolGateway.audit]", err.message);
  }
}

function denied(reason, message, ctx, status = 403) {
  audit({ ...ctx, outcome: "denied", reason });
  return { ok: false, status, error: { reason, message } };
}

function findConversation(conversationId) {
  try {
    const db = getDb();
    return db.prepare(`
      SELECT id, task_id, user_id FROM workspace_conversations WHERE id = ?
    `).get(conversationId);
  } catch {
    return null;
  }
}

/**
 * 调用入口。请求来自 /api/hermes/tools/call。
 *
 * @param {Object} req
 * @param {string} req.tool
 * @param {Object} req.args
 * @param {string} req.caller            —— Hermes 自报角色
 * @param {string} req.conversation_id
 * @param {string} req.call_id           —— Hermes function call id
 * @returns {{ ok: boolean, status: number, result?: any, error?: { reason, message } }}
 */
async function invoke(req) {
  const start = Date.now();
  const tool = String(req.tool || "");
  const args = req.args || {};
  const caller = String(req.caller || "host");
  const conversationId = String(req.conversation_id || "");
  const callId = req.call_id || null;
  const ctx = {
    call_id: callId,
    tool,
    caller,
    conversation_id: conversationId,
    args_summary: summarize(args),
  };

  // 1. Allowlist
  const callable = new Set(getCallableToolNames());
  if (!callable.has(tool)) {
    return denied("tool_not_callable", `工具 "${tool}" 不在允许列表`, ctx);
  }

  const def = getToolDefinition(tool);

  // 2. Caller
  if (!def.allowedCallers.includes(caller)) {
    return denied("caller_not_allowed", `${caller} 不允许调用 ${tool}`, ctx);
  }

  // 3. Session 合法性
  const conv = findConversation(conversationId);
  if (!conv) {
    return denied("conversation_not_found", "会话不存在或已删除", ctx, 404);
  }
  ctx.user_id = conv.user_id;

  // 4. 参数 schema (PPT 禁版式 + 工具名归一)
  if (tool !== "web_search") {
    const guard = guardSingleToolCall(tool, args);
    if (!guard.ok) {
      const reason = guard.errors.map((e) => e.reason).join("; ");
      return denied("schema_invalid", reason, ctx, 400);
    }
  }

  // 5. Quota —— 仅对 artifact 类工具扣减
  let quotaTicket = null;
  if (def.category === "artifact") {
    try {
      quotaTicket = deductQuota(conv.user_id);
      if (!quotaTicket?.ok) {
        return denied("quota_exhausted", quotaTicket?.error || "额度不足", ctx, 402);
      }
    } catch (err) {
      return denied("quota_check_failed", err.message, ctx, 500);
    }
  }

  // 6. Artifact ownership —— 当前 MVP 不在 args 里直接引用其他 artifact，未来扩展时校验

  // 7. Rate limit
  if (!rateAllow(conv.user_id, conversationId)) {
    if (quotaTicket?.type) refundQuota(conv.user_id, quotaTicket.type);
    return denied("rate_limit", "工具调用过频，请稍后重试", ctx, 429);
  }

  // 8. 执行
  try {
    const result = await executeWorkspaceTool({
      tool,
      args,
      conversationId,
      messageId: null,
      projectId: conv.project_id || null,
      userId: conv.user_id,
      taskId: conv.task_id,
    });
    audit({ ...ctx, outcome: "ok", latency_ms: Date.now() - start });
    return { ok: true, status: 200, result };
  } catch (err) {
    if (quotaTicket?.type) {
      try { refundQuota(conv.user_id, quotaTicket.type); } catch {}
    }
    audit({
      ...ctx,
      outcome: "error",
      reason: "execution_failed",
      latency_ms: Date.now() - start,
      error_message: err.message,
    });
    return {
      ok: false,
      status: 500,
      error: { reason: "execution_failed", message: err.message },
    };
  }
}

module.exports = { invoke };
