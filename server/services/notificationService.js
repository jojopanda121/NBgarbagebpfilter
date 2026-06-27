// ============================================================
// server/services/notificationService.js — 站内通知 + 邮件
//
// 论坛留存的发动机:"发生了某事 → 通知对的人 → 他回来"。
//   - 站内:notifications 表(同步落库)。
//   - 邮件:best-effort,仅当收件人有 email 且 notify_email=1 才发;
//     发送异步 fire-and-forget,失败只记日志,绝不阻断触发动作。
// ============================================================

const { getDb } = require("../db");
const emailService = require("./emailService");

const VALID_TYPES = [
  "interest_received",   // 有人对你的项目表达兴趣
  "report_requested",    // 有人申请查看你项目的完整报告
  "report_unlocked",     // 发帖人给你解锁了完整报告
  "interest_accepted",   // 发帖人同意了你的撮合意向
];

// 站内/邮件文案。payload 里通常带 { post_title, codename, actor_name }。
function renderText(type, payload = {}) {
  const who = payload.actor_name || "有人";
  const proj = payload.codename || payload.post_title || "你的项目";
  switch (type) {
    case "interest_received":
      return { subject: "有人对你的项目感兴趣", body: `${who} 对「${proj}」表达了兴趣。回到论坛的「撮合」里查看，可解锁完整报告或同意换名片。` };
    case "report_requested":
      return { subject: "有人想看你项目的完整报告", body: `${who} 申请查看「${proj}」的完整评分报告。回到论坛「撮合」里，可一键解锁给 TA。` };
    case "report_unlocked":
      return { subject: "完整报告已为你解锁", body: `${who} 给你解锁了「${proj}」的完整评分报告。回到论坛「我的报告库」即可查看。` };
    case "interest_accepted":
      return { subject: "你的撮合意向已被同意", body: `${who} 同意了你对「${proj}」的意向，现在可以互换名片并私信沟通。` };
    default:
      return { subject: "论坛通知", body: "你在论坛有一条新通知。" };
  }
}

/**
 * 落一条站内通知;可选发邮件(best-effort)。
 * @param {object} a
 * @param {number} a.userId   收件人
 * @param {string} a.type     VALID_TYPES 之一
 * @param {number} [a.actorId]
 * @param {number} [a.postId]
 * @param {object} [a.payload]
 * @param {boolean} [a.email] 是否尝试发邮件
 * @returns {number} notificationId
 */
function notify({ userId, type, actorId = null, postId = null, payload = {}, email = false }) {
  if (!userId || !VALID_TYPES.includes(type)) return null;
  const db = getDb();
  const info = db.prepare(
    "INSERT INTO notifications (user_id, type, actor_id, post_id, payload) VALUES (?, ?, ?, ?, ?)"
  ).run(userId, type, actorId, postId, JSON.stringify(payload || {}));

  if (email) {
    try {
      const u = db.prepare("SELECT email, notify_email FROM users WHERE id = ?").get(userId);
      if (u && u.email && u.notify_email !== 0) {
        const { subject, body } = renderText(type, payload);
        // fire-and-forget:不 await、不阻断、不抛
        Promise.resolve(emailService.sendForumNotificationEmail(u.email, { subject, body }))
          .catch((e) => console.error("[Notify] email send failed:", e?.message));
      }
    } catch (e) {
      console.error("[Notify] email prep failed:", e?.message);
    }
  }
  return info.lastInsertRowid;
}

function actorName(userId) {
  if (!userId) return null;
  try {
    const u = getDb().prepare("SELECT display_name, username FROM users WHERE id = ?").get(userId);
    return u ? (u.display_name || u.username || null) : null;
  } catch { return null; }
}

function listNotifications(userId, { unreadOnly = false, page = 1, pageSize = 30 } = {}) {
  const db = getDb();
  const size = Math.min(Math.max(1, pageSize), 50);
  const offset = (Math.max(1, page) - 1) * size;
  const where = unreadOnly ? "WHERE n.user_id = ? AND n.read_at IS NULL" : "WHERE n.user_id = ?";
  const rows = db.prepare(
    `SELECT n.*, u.display_name AS actor_display, u.username AS actor_username, u.avatar_url AS actor_avatar
     FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
     ${where} ORDER BY n.created_at DESC, n.id DESC LIMIT ? OFFSET ?`
  ).all(userId, size, offset);
  return {
    items: rows.map((n) => {
      let payload = {};
      try { payload = n.payload ? JSON.parse(n.payload) : {}; } catch { payload = {}; }
      const { subject, body } = renderText(n.type, payload);
      return {
        id: n.id,
        type: n.type,
        post_id: n.post_id,
        actor: n.actor_id ? { id: n.actor_id, name: n.actor_display || n.actor_username || "用户", avatar_url: n.actor_avatar || null } : null,
        title: subject,
        body,
        read: !!n.read_at,
        created_at: n.created_at,
      };
    }),
    page: Math.max(1, page),
    page_size: size,
  };
}

function unreadCount(userId) {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL").get(userId);
  return { count: row?.n || 0 };
}

/**
 * 标记已读。ids 为空/未传 → 全部已读。仅能标记自己的通知。
 */
function markRead(userId, ids = null) {
  const db = getDb();
  if (Array.isArray(ids) && ids.length) {
    const clean = ids.map((x) => Number(x)).filter((x) => Number.isInteger(x));
    if (!clean.length) return { ok: true };
    const placeholders = clean.map(() => "?").join(",");
    db.prepare(
      `UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL AND id IN (${placeholders})`
    ).run(userId, ...clean);
  } else {
    db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(userId);
  }
  return { ok: true };
}

module.exports = {
  notify,
  actorName,
  listNotifications,
  unreadCount,
  markRead,
  _internal: { renderText, VALID_TYPES },
};
