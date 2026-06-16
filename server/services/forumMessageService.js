// ============================================================
// server/services/forumMessageService.js — 站内信（门控私信）
//
// 一对一私信，会话用规范化配对 (user_lo, user_hi) 保证唯一。
//
// 不变量：
//   1. 仅会话的两名参与者可读写（本服务层强制，非纯前端）。
//   2. 私信门控 —— 两人之间必须先存在一条「已被发帖人同意」的撮合意向
//      (deal_connections.status = 'accepted')，才能开启会话/发消息。
//      流程：感兴趣方点「我有兴趣」→ 发帖人同意 → 双方解锁私信。
//      发帖人不同意（pending/declined）→ 不能私信。
// ============================================================

const { getDb } = require("../db");

function err(status, message) { const e = new Error(message); e.status = status; return e; }

const MAX_BODY = 4000;

function pair(a, b) {
  return a < b ? [a, b] : [b, a];
}

/**
 * 私信门控判定：两人之间是否存在「已同意」的撮合意向（任一方向均可）。
 * 一旦任意一条意向被同意，这对用户即解锁私信（不绑定具体帖子）。
 */
function canMessage(a, b) {
  if (!a || !b || a === b) return false;
  const db = getDb();
  const row = db.prepare(
    `SELECT 1 FROM deal_connections
      WHERE status = 'accepted'
        AND ((owner_id = ? AND initiator_id = ?) OR (owner_id = ? AND initiator_id = ?))
      LIMIT 1`
  ).get(a, b, b, a);
  return !!row;
}

/**
 * 取或建两人之间的会话。默认走门控；发帖人同意意向时由服务端用
 * bypassGate 顺手开会话（此刻门控前提刚成立，无需再查）。
 * @param {object} [opts]
 * @param {boolean} [opts.bypassGate]
 */
function getOrCreateConversation(meId, otherId, { bypassGate = false } = {}) {
  if (!otherId || otherId === meId) throw err(400, "不能和自己发起会话");
  const db = getDb();
  const other = db.prepare("SELECT id FROM users WHERE id = ?").get(otherId);
  if (!other) throw err(404, "用户不存在");
  if (!bypassGate && !canMessage(meId, otherId)) {
    throw err(403, "需对方在撮合中同意你的意向后才能私信");
  }
  const [lo, hi] = pair(meId, otherId);
  let conv = db.prepare("SELECT * FROM forum_conversations WHERE user_lo = ? AND user_hi = ?").get(lo, hi);
  if (!conv) {
    const info = db.prepare("INSERT INTO forum_conversations (user_lo, user_hi) VALUES (?, ?)").run(lo, hi);
    conv = db.prepare("SELECT * FROM forum_conversations WHERE id = ?").get(info.lastInsertRowid);
  }
  return conv;
}

function getConversationForUser(convId, meId) {
  const db = getDb();
  const conv = db.prepare("SELECT * FROM forum_conversations WHERE id = ?").get(convId);
  if (!conv) throw err(404, "会话不存在");
  if (conv.user_lo !== meId && conv.user_hi !== meId) throw err(403, "无权访问该会话");
  return conv;
}

function counterpartId(conv, meId) {
  return conv.user_lo === meId ? conv.user_hi : conv.user_lo;
}

function userBrief(db, userId) {
  const u = db.prepare(
    "SELECT id, username, display_name, user_type, type_verified, avatar_url FROM users WHERE id = ?"
  ).get(userId);
  if (!u) return { id: userId, name: "用户", user_type: "unset", avatar_url: null };
  return {
    id: u.id,
    name: u.display_name || u.username || "用户",
    user_type: u.user_type || "unset",
    type_verified: !!u.type_verified,
    avatar_url: u.avatar_url || null,
  };
}

/** 我的会话列表：对方资料 + 最后一条 + 未读数。 */
function listConversations(meId) {
  const db = getDb();
  const convs = db.prepare(
    `SELECT * FROM forum_conversations
     WHERE user_lo = ? OR user_hi = ?
     ORDER BY COALESCE(last_message_at, created_at) DESC`
  ).all(meId, meId);

  return convs.map((c) => {
    const otherId = counterpartId(c, meId);
    const last = db.prepare(
      "SELECT body, sender_id, created_at FROM forum_messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 1"
    ).get(c.id);
    const unread = db.prepare(
      "SELECT COUNT(*) AS n FROM forum_messages WHERE conversation_id = ? AND sender_id <> ? AND read_at IS NULL"
    ).get(c.id, meId);
    return {
      id: c.id,
      counterpart: userBrief(db, otherId),
      last_message: last ? { body: last.body, from_me: last.sender_id === meId, created_at: last.created_at } : null,
      unread_count: unread?.n || 0,
      last_message_at: c.last_message_at,
    };
  });
}

/** 会话内消息（仅参与者）；顺带把对方发来的未读标记为已读。 */
function listMessages(convId, meId) {
  const db = getDb();
  const conv = getConversationForUser(convId, meId);
  const rows = db.prepare(
    "SELECT id, sender_id, body, created_at, read_at FROM forum_messages WHERE conversation_id = ? ORDER BY created_at, id"
  ).all(convId);
  db.prepare(
    "UPDATE forum_messages SET read_at = datetime('now') WHERE conversation_id = ? AND sender_id <> ? AND read_at IS NULL"
  ).run(convId, meId);
  return {
    conversation_id: convId,
    counterpart: userBrief(db, counterpartId(conv, meId)),
    messages: rows.map((m) => ({
      id: m.id,
      body: m.body,
      from_me: m.sender_id === meId,
      created_at: m.created_at,
      read: !!m.read_at,
    })),
  };
}

/**
 * 发消息。可传 convId（已有会话）或 recipientId（新建/复用会话）。
 */
function sendMessage({ meId, convId = null, recipientId = null, body }) {
  const text = (body || "").trim();
  if (!text) throw err(400, "消息不能为空");
  if (text.length > MAX_BODY) throw err(400, "消息过长");
  const db = getDb();
  let conv;
  if (convId) conv = getConversationForUser(convId, meId);
  else if (recipientId) conv = getOrCreateConversation(meId, recipientId);
  else throw err(400, "缺少会话或收件人");

  let messageId;
  db.transaction(() => {
    const info = db.prepare(
      "INSERT INTO forum_messages (conversation_id, sender_id, body) VALUES (?, ?, ?)"
    ).run(conv.id, meId, text);
    messageId = info.lastInsertRowid;
    db.prepare("UPDATE forum_conversations SET last_message_at = datetime('now') WHERE id = ?").run(conv.id);
  })();

  return { conversation_id: conv.id, message_id: messageId };
}

/**
 * 发帖人同意意向时调用：确保两人之间存在会话（绕过门控，因为此刻同意刚落库）。
 * 仅创建空会话，不发系统消息——首条由任一方主动发。
 */
function openConversationOnAccept(ownerId, initiatorId) {
  return getOrCreateConversation(ownerId, initiatorId, { bypassGate: true });
}

module.exports = {
  canMessage,
  getOrCreateConversation,
  openConversationOnAccept,
  listConversations,
  listMessages,
  sendMessage,
};
