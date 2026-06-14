// ============================================================
// server/services/forumAdminService.js — 论坛管理服务层（管理员专用）
//
// 红线（呼应 forumService 产品纪律）：
//   - 管理动作只改 status / removed_reason / pinned / featured，
//     绝不触碰 score_snapshot / risk_flags（评分快照与风险旗标不可篡改）。
//   - 撮合名片(contact_card)仅在 accepted 后解锁；管理端列表同样不泄露未解锁名片。
// 写操作的审计日志由 routes 层 adminController.requireAdmin 统一记录。
// ============================================================

const { getDb } = require("../db");

function clampPage(page) { return Math.max(1, parseInt(page, 10) || 1); }
function clampSize(size, max = 50) { return Math.min(Math.max(1, parseInt(size, 10) || 20), max); }

// ── 错误工具（带 status 给路由层，与 forumService 对齐）──
function err(status, message) { const e = new Error(message); e.status = status; return e; }
function badRequest(m) { return err(400, m); }
function notFound(m) { return err(404, m); }

// 被举报内容摘要（帖子取标题，评论取正文片段）
function describeTarget(db, targetType, targetId) {
  if (targetType === "post") {
    const p = db.prepare("SELECT id, title, status, author_id FROM forum_posts WHERE id = ?").get(targetId);
    if (!p) return { exists: false, label: "（帖子已删除）", status: null, author_id: null };
    return { exists: true, label: p.title, status: p.status, author_id: p.author_id };
  }
  const c = db.prepare("SELECT id, body, status, author_id FROM forum_comments WHERE id = ?").get(targetId);
  if (!c) return { exists: false, label: "（评论已删除）", status: null, author_id: null };
  return { exists: true, label: (c.body || "").slice(0, 80), status: c.status, author_id: c.author_id };
}

// ============================================================
// 1. 举报审核队列
// ============================================================
function listReports({ status = "pending", page = 1, pageSize = 20 } = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (status && status !== "all") { where.push("r.status = ?"); params.push(status); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const p = clampPage(page);
  const size = clampSize(pageSize);

  const total = db.prepare(`SELECT COUNT(*) n FROM forum_reports r ${whereSql}`).get(...params).n;
  const rows = db.prepare(
    `SELECT r.*, u.username AS reporter_name, u.display_name AS reporter_display
     FROM forum_reports r LEFT JOIN users u ON u.id = r.reporter_id
     ${whereSql} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, size, (p - 1) * size);

  const items = rows.map((r) => {
    const target = describeTarget(db, r.target_type, r.target_id);
    return {
      id: r.id,
      target_type: r.target_type,
      target_id: r.target_id,
      target_label: target.label,
      target_status: target.status,
      target_author_id: target.author_id,
      reason: r.reason,
      status: r.status,
      reporter: { id: r.reporter_id, name: r.reporter_display || r.reporter_name || "用户" },
      created_at: r.created_at,
      reviewed_at: r.reviewed_at,
      reviewed_by: r.reviewed_by,
    };
  });
  return { items, total, page: p, page_size: size };
}

/**
 * 处理举报。action: 'remove'(下架被举报内容) | 'dismiss'(驳回)。
 */
function resolveReport({ reportId, adminId, action, reason }) {
  const db = getDb();
  const report = db.prepare("SELECT * FROM forum_reports WHERE id = ?").get(reportId);
  if (!report) throw notFound("举报不存在");
  if (report.status !== "pending") throw badRequest("该举报已处理");
  if (!["remove", "dismiss"].includes(action)) throw badRequest("操作类型无效");

  db.transaction(() => {
    if (action === "remove") {
      // 复用下架逻辑（只改 status / removed_reason）
      _removeTarget(db, report.target_type, report.target_id, reason || "举报处理：违规内容");
    }
    db.prepare(
      "UPDATE forum_reports SET status = ?, reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?"
    ).run(action === "remove" ? "reviewed" : "dismissed", adminId, reportId);
  })();
  return { ok: true, action };
}

// ============================================================
// 2. 内容审核（帖子 / 评论）
// ============================================================
function listAdminPosts({ status, category, q, page = 1, pageSize = 20 } = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (status && status !== "all") { where.push("p.status = ?"); params.push(status); }
  if (category) { where.push("p.category = ?"); params.push(category); }
  if (q && q.trim()) { where.push("p.title LIKE ?"); params.push(`%${q.trim()}%`); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const p = clampPage(page);
  const size = clampSize(pageSize);

  const total = db.prepare(`SELECT COUNT(*) n FROM forum_posts p ${whereSql}`).get(...params).n;
  const rows = db.prepare(
    `SELECT p.id, p.category, p.title, p.status, p.removed_reason, p.pinned, p.featured,
            p.like_count, p.comment_count, p.interest_count, p.view_count, p.created_at,
            p.author_id, u.username, u.display_name, u.user_type, u.type_verified
     FROM forum_posts p LEFT JOIN users u ON u.id = p.author_id
     ${whereSql} ORDER BY p.pinned DESC, p.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, size, (p - 1) * size);

  const items = rows.map((r) => ({
    id: r.id,
    category: r.category,
    title: r.title,
    status: r.status,
    removed_reason: r.removed_reason,
    pinned: !!r.pinned,
    featured: !!r.featured,
    like_count: r.like_count,
    comment_count: r.comment_count,
    interest_count: r.interest_count,
    view_count: r.view_count,
    created_at: r.created_at,
    author: {
      id: r.author_id,
      name: r.display_name || r.username || "用户",
      user_type: r.user_type || "unset",
      type_verified: !!r.type_verified,
    },
  }));
  return { items, total, page: p, page_size: size };
}

function listAdminComments({ status, page = 1, pageSize = 20 } = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (status && status !== "all") { where.push("c.status = ?"); params.push(status); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const p = clampPage(page);
  const size = clampSize(pageSize);

  const total = db.prepare(`SELECT COUNT(*) n FROM forum_comments c ${whereSql}`).get(...params).n;
  const rows = db.prepare(
    `SELECT c.id, c.post_id, c.body, c.status, c.like_count, c.created_at,
            c.author_id, u.username, u.display_name,
            p.title AS post_title
     FROM forum_comments c
     LEFT JOIN users u ON u.id = c.author_id
     LEFT JOIN forum_posts p ON p.id = c.post_id
     ${whereSql} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, size, (p - 1) * size);

  const items = rows.map((r) => ({
    id: r.id,
    post_id: r.post_id,
    post_title: r.post_title || "（帖子已删除）",
    body: r.body,
    status: r.status,
    like_count: r.like_count,
    created_at: r.created_at,
    author: { id: r.author_id, name: r.display_name || r.username || "用户" },
  }));
  return { items, total, page: p, page_size: size };
}

// 内部：下架目标（帖子会同步 comment_count 不变，仅改 status）
function _removeTarget(db, targetType, targetId, reason) {
  if (targetType === "post") {
    const exists = db.prepare("SELECT id FROM forum_posts WHERE id = ?").get(targetId);
    if (!exists) throw notFound("帖子不存在");
    db.prepare(
      "UPDATE forum_posts SET status = 'removed', removed_reason = ?, updated_at = datetime('now') WHERE id = ?"
    ).run((reason || "").slice(0, 500) || null, targetId);
  } else {
    const c = db.prepare("SELECT id, post_id, status FROM forum_comments WHERE id = ?").get(targetId);
    if (!c) throw notFound("评论不存在");
    if (c.status === "published") {
      db.prepare("UPDATE forum_posts SET comment_count = MAX(0, comment_count - 1) WHERE id = ?").run(c.post_id);
    }
    db.prepare("UPDATE forum_comments SET status = 'removed' WHERE id = ?").run(targetId);
  }
}

/**
 * 帖子审核操作。op: remove | restore | pin | unpin | feature | unfeature。
 * 只改 status / removed_reason / pinned / featured —— 绝不动 score_snapshot / risk_flags。
 */
function moderatePost({ postId, op, reason }) {
  const db = getDb();
  const post = db.prepare("SELECT id, status FROM forum_posts WHERE id = ?").get(postId);
  if (!post) throw notFound("帖子不存在");

  switch (op) {
    case "remove":
      db.prepare(
        "UPDATE forum_posts SET status = 'removed', removed_reason = ?, updated_at = datetime('now') WHERE id = ?"
      ).run((reason || "").slice(0, 500) || null, postId);
      break;
    case "restore":
      db.prepare(
        "UPDATE forum_posts SET status = 'published', removed_reason = NULL, updated_at = datetime('now') WHERE id = ?"
      ).run(postId);
      break;
    case "pin":
      db.prepare("UPDATE forum_posts SET pinned = 1, updated_at = datetime('now') WHERE id = ?").run(postId);
      break;
    case "unpin":
      db.prepare("UPDATE forum_posts SET pinned = 0, updated_at = datetime('now') WHERE id = ?").run(postId);
      break;
    case "feature":
      db.prepare("UPDATE forum_posts SET featured = 1, updated_at = datetime('now') WHERE id = ?").run(postId);
      break;
    case "unfeature":
      db.prepare("UPDATE forum_posts SET featured = 0, updated_at = datetime('now') WHERE id = ?").run(postId);
      break;
    default:
      throw badRequest("操作类型无效");
  }
  return { ok: true, op };
}

function moderateComment({ commentId, op }) {
  const db = getDb();
  const c = db.prepare("SELECT id, post_id, status FROM forum_comments WHERE id = ?").get(commentId);
  if (!c) throw notFound("评论不存在");

  if (op === "remove") {
    db.transaction(() => {
      if (c.status === "published") {
        db.prepare("UPDATE forum_posts SET comment_count = MAX(0, comment_count - 1) WHERE id = ?").run(c.post_id);
      }
      db.prepare("UPDATE forum_comments SET status = 'removed' WHERE id = ?").run(commentId);
    })();
  } else if (op === "restore") {
    db.transaction(() => {
      if (c.status !== "published") {
        db.prepare("UPDATE forum_posts SET comment_count = comment_count + 1 WHERE id = ?").run(c.post_id);
      }
      db.prepare("UPDATE forum_comments SET status = 'published' WHERE id = ?").run(commentId);
    })();
  } else {
    throw badRequest("操作类型无效");
  }
  return { ok: true, op };
}

// ============================================================
// 3. 撮合与身份治理
// ============================================================
function listDeals({ status, page = 1, pageSize = 20 } = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (status && status !== "all") { where.push("dc.status = ?"); params.push(status); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const p = clampPage(page);
  const size = clampSize(pageSize);

  const total = db.prepare(`SELECT COUNT(*) n FROM deal_connections dc ${whereSql}`).get(...params).n;
  const rows = db.prepare(
    `SELECT dc.id, dc.post_id, dc.status, dc.message, dc.created_at, dc.responded_at,
            dc.initiator_id, dc.owner_id,
            p.title AS post_title, p.codename,
            iu.display_name AS initiator_name, iu.username AS initiator_username, iu.user_type AS initiator_type,
            ou.display_name AS owner_name, ou.username AS owner_username, ou.user_type AS owner_type
     FROM deal_connections dc
     LEFT JOIN forum_posts p ON p.id = dc.post_id
     LEFT JOIN users iu ON iu.id = dc.initiator_id
     LEFT JOIN users ou ON ou.id = dc.owner_id
     ${whereSql} ORDER BY dc.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, size, (p - 1) * size);

  // 注意：管理端不返回任何 contact_card（即便 accepted），避免管理员越权读取双方名片
  const items = rows.map((r) => ({
    id: r.id,
    post_id: r.post_id,
    post_title: r.post_title || r.codename || "（帖子已删除）",
    status: r.status,
    message: r.message,
    created_at: r.created_at,
    responded_at: r.responded_at,
    initiator: { id: r.initiator_id, name: r.initiator_name || r.initiator_username || "用户", user_type: r.initiator_type || "unset" },
    owner: { id: r.owner_id, name: r.owner_name || r.owner_username || "用户", user_type: r.owner_type || "unset" },
  }));
  return { items, total, page: p, page_size: size };
}

/**
 * 介入撮合：op='close' 把异常/纠纷意向置为终态 declined（不强制换名片）。
 */
function interveneDeal({ dealId, op, reason }) {
  const db = getDb();
  const deal = db.prepare("SELECT id, status FROM deal_connections WHERE id = ?").get(dealId);
  if (!deal) throw notFound("撮合意向不存在");
  if (op !== "close") throw badRequest("操作类型无效");
  db.prepare(
    "UPDATE deal_connections SET status = 'declined', responded_at = datetime('now') WHERE id = ?"
  ).run(dealId);
  return { ok: true, op, reason: reason || null };
}

function listIdentity({ verified, page = 1, pageSize = 20 } = {}) {
  const db = getDb();
  // 只列已选社区身份的用户（user_type != 'unset'）
  const where = ["user_type != 'unset'"];
  const params = [];
  if (verified === "0" || verified === 0) { where.push("type_verified = 0"); }
  else if (verified === "1" || verified === 1) { where.push("type_verified = 1"); }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const p = clampPage(page);
  const size = clampSize(pageSize);

  const total = db.prepare(`SELECT COUNT(*) n FROM users ${whereSql}`).get(...params).n;
  const rows = db.prepare(
    `SELECT id, username, display_name, user_type, type_verified, org_name, bio, created_at
     FROM users ${whereSql} ORDER BY type_verified ASC, id DESC LIMIT ? OFFSET ?`
  ).all(...params, size, (p - 1) * size);

  const items = rows.map((u) => ({
    id: u.id,
    name: u.display_name || u.username || "用户",
    username: u.username,
    user_type: u.user_type,
    type_verified: !!u.type_verified,
    org_name: u.org_name || null,
    bio: u.bio || null,
    created_at: u.created_at,
  }));
  return { items, total, page: p, page_size: size };
}

function setIdentityVerified({ userId, verified }) {
  const db = getDb();
  const u = db.prepare("SELECT id, user_type FROM users WHERE id = ?").get(userId);
  if (!u) throw notFound("用户不存在");
  db.prepare("UPDATE users SET type_verified = ? WHERE id = ?").run(verified ? 1 : 0, userId);
  return { ok: true, user_id: userId, type_verified: !!verified };
}

// ============================================================
// 4. 论坛数据看板
// ============================================================
function analytics({ days = 30 } = {}) {
  const db = getDb();
  const d = Math.min(Math.max(1, parseInt(days, 10) || 30), 365);
  const since = `-${d} days`;

  const totals = {
    posts: db.prepare("SELECT COUNT(*) n FROM forum_posts WHERE status = 'published'").get().n,
    posts_removed: db.prepare("SELECT COUNT(*) n FROM forum_posts WHERE status = 'removed'").get().n,
    comments: db.prepare("SELECT COUNT(*) n FROM forum_comments WHERE status = 'published'").get().n,
    deals: db.prepare("SELECT COUNT(*) n FROM deal_connections").get().n,
    deals_accepted: db.prepare("SELECT COUNT(*) n FROM deal_connections WHERE status = 'accepted'").get().n,
    reports_pending: db.prepare("SELECT COUNT(*) n FROM forum_reports WHERE status = 'pending'").get().n,
    identity_unverified: db.prepare("SELECT COUNT(*) n FROM users WHERE user_type != 'unset' AND type_verified = 0").get().n,
  };

  const window = {
    new_posts: db.prepare(`SELECT COUNT(*) n FROM forum_posts WHERE created_at >= datetime('now', ?)`).get(since).n,
    new_comments: db.prepare(`SELECT COUNT(*) n FROM forum_comments WHERE created_at >= datetime('now', ?)`).get(since).n,
    new_deals: db.prepare(`SELECT COUNT(*) n FROM deal_connections WHERE created_at >= datetime('now', ?)`).get(since).n,
    new_reports: db.prepare(`SELECT COUNT(*) n FROM forum_reports WHERE created_at >= datetime('now', ?)`).get(since).n,
    active_authors: db.prepare(`SELECT COUNT(DISTINCT author_id) n FROM forum_posts WHERE created_at >= datetime('now', ?)`).get(since).n,
  };

  const byCategory = db.prepare(
    `SELECT category, COUNT(*) n FROM forum_posts WHERE status = 'published' GROUP BY category`
  ).all();

  const reportsTotal = db.prepare("SELECT COUNT(*) n FROM forum_reports").get().n;
  const reportsHandled = db.prepare("SELECT COUNT(*) n FROM forum_reports WHERE status != 'pending'").get().n;

  const topPosts = db.prepare(
    `SELECT p.id, p.title, p.category, p.like_count, p.comment_count, p.interest_count, p.view_count
     FROM forum_posts p WHERE p.status = 'published'
     ORDER BY (p.like_count * 3 + p.comment_count * 2 + p.interest_count * 5 + p.view_count) DESC
     LIMIT 10`
  ).all();

  return {
    days: d,
    totals,
    window,
    by_category: byCategory,
    deal_conversion_rate: totals.deals ? Math.round((totals.deals_accepted / totals.deals) * 1000) / 10 : 0,
    report_handle_rate: reportsTotal ? Math.round((reportsHandled / reportsTotal) * 1000) / 10 : 0,
    top_posts: topPosts,
  };
}

module.exports = {
  listReports,
  resolveReport,
  listAdminPosts,
  listAdminComments,
  moderatePost,
  moderateComment,
  listDeals,
  interveneDeal,
  listIdentity,
  setIdentityVerified,
  analytics,
};
