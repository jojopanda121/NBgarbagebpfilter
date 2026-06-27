// ============================================================
// server/services/forumReportService.js — 完整报告「授权解锁」
//
// 渐进披露阶梯第 3 档:发帖人把【完整评分报告】按人授权给感兴趣方查看。
//
// 红线(与 forumService 一脉相承):
//   1. 发帖人只控「给谁看」,不控「看什么」。报告永远从 tasks.result.$.verdict
//      现取、自动【递归脱敏】、风险旗标强制全带 —— 无任何发帖人可编辑入口。
//   2. 授权前置:被授权方必须先在该帖表达过 interest(deal_connections 存在)。
//   3. 逐人授权 + 水印(shared_to)可追溯,控制再识别/泄露。
// ============================================================

const { getDb } = require("../db");
const forum = require("./forumService");
const notificationService = require("./notificationService");

const { scrubText, collectIdentifiers, safeParse } = forum._internal;

function err(status, message) { const e = new Error(message); e.status = status; return e; }
function badRequest(m) { return err(400, m); }
function forbidden(m) { return err(403, m); }
function notFound(m) { return err(404, m); }

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function userName(db, userId) {
  const u = db.prepare("SELECT display_name, username FROM users WHERE id = ?").get(userId);
  return u ? (u.display_name || u.username || "用户") : "用户";
}

/**
 * 深度递归脱敏:遍历 verdict 任意嵌套,只对【字符串值】跑 scrubText。
 * 这样 verdict 结构演进(新增维度/证据字段)时,标识串仍被全擦 —— 再识别防线。
 * 纯函数,jest 可测。
 */
function scrubDeep(value, ids, opts) {
  if (typeof value === "string") return scrubText(value, ids, opts);
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, ids, opts));
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) out[k] = scrubDeep(value[k], ids, opts);
    return out;
  }
  return value;
}

function canViewReport(postId, viewerId) {
  if (!viewerId) return false;
  const db = getDb();
  const post = db.prepare("SELECT author_id FROM forum_posts WHERE id = ?").get(postId);
  if (!post) return false;
  if (post.author_id === viewerId) return true; // 作者本人始终可看自己的报告
  const g = db.prepare(
    "SELECT 1 FROM forum_report_grants WHERE post_id = ? AND grantee_id = ? AND status = 'active'"
  ).get(postId, viewerId);
  return !!g;
}

/**
 * 取解锁后的完整报告。无权 → 403。报告内容现取自任务并递归脱敏(发帖人不可改)。
 */
function getUnlockedReport({ postId, viewerId }) {
  const db = getDb();
  const post = db.prepare("SELECT * FROM forum_posts WHERE id = ?").get(postId);
  if (!post || post.status !== "published") throw notFound("帖子不存在");
  if (!canViewReport(postId, viewerId)) throw forbidden("尚未获得完整报告的访问权限");
  if (!post.task_id) throw badRequest("该帖无关联分析任务");
  const task = db.prepare("SELECT id, title, result FROM tasks WHERE id = ?").get(post.task_id);
  if (!task) throw notFound("分析任务不存在");

  const result = safeParse(task.result, {});
  const verdict = result?.verdict;
  if (!verdict) throw badRequest("该任务尚无完整评分报告");

  const ids = collectIdentifiers(task);
  const opts = {
    showCompany: !!post.show_company_name,
    showProject: !!post.show_project_name,
    codename: post.codename || ids.title,
  };
  const scrubbedVerdict = scrubDeep(verdict, ids, opts);

  return {
    post: { id: post.id, codename: post.codename, title: post.title },
    verdict: scrubbedVerdict,               // 完整脱敏报告(五维/证据/风险全带)
    score_source: "platform",
    watermark: { shared_to: userName(db, viewerId), shared_to_id: viewerId, date: todayStr() },
  };
}

/**
 * 感兴趣方申请查看完整报告(轻量,无表),只发通知给发帖人。
 */
function requestReport({ postId, requesterId }) {
  const db = getDb();
  const post = db.prepare("SELECT id, author_id, status, title, codename FROM forum_posts WHERE id = ?").get(postId);
  if (!post || post.status !== "published") throw notFound("帖子不存在");
  if (post.author_id === requesterId) throw badRequest("这是你自己的帖子");
  if (canViewReport(postId, requesterId)) return { ok: true, already_unlocked: true };

  try {
    notificationService.notify({
      userId: post.author_id, type: "report_requested", actorId: requesterId, postId,
      payload: { post_title: post.title || null, codename: post.codename || null, actor_name: notificationService.actorName(requesterId) },
      email: true,
    });
  } catch (e) { console.error("[ForumReport] notify request failed:", e.message); }
  return { ok: true };
}

/**
 * 发帖人授权解锁完整报告给某个感兴趣方。前置:对方已表达过 interest。
 */
function grantReport({ postId, granterId, granteeId }) {
  const db = getDb();
  if (!granteeId) throw badRequest("缺少授权对象");
  const post = db.prepare("SELECT id, author_id, status, title, codename FROM forum_posts WHERE id = ?").get(postId);
  if (!post || post.status !== "published") throw notFound("帖子不存在");
  if (post.author_id !== granterId) throw forbidden("只有发帖人能授权");
  if (granteeId === granterId) throw badRequest("不能给自己授权");

  const interest = db.prepare(
    "SELECT 1 FROM deal_connections WHERE post_id = ? AND initiator_id = ?"
  ).get(postId, granteeId);
  if (!interest) throw badRequest("对方尚未对该项目表达兴趣，无法授权");

  const existing = db.prepare(
    "SELECT id, status FROM forum_report_grants WHERE post_id = ? AND grantee_id = ?"
  ).get(postId, granteeId);
  if (existing && existing.status === "active") {
    return { ok: true, already: true };
  }
  if (existing) {
    db.prepare(
      "UPDATE forum_report_grants SET status = 'active', revoked_at = NULL, created_at = datetime('now') WHERE id = ?"
    ).run(existing.id);
  } else {
    db.prepare(
      "INSERT INTO forum_report_grants (post_id, grantee_id, granter_id, status) VALUES (?, ?, ?, 'active')"
    ).run(postId, granteeId, granterId);
  }

  try {
    notificationService.notify({
      userId: granteeId, type: "report_unlocked", actorId: granterId, postId,
      payload: { post_title: post.title || null, codename: post.codename || null, actor_name: notificationService.actorName(granterId) },
      email: true,
    });
  } catch (e) { console.error("[ForumReport] notify unlock failed:", e.message); }
  return { ok: true };
}

function revokeReport({ postId, granterId, granteeId }) {
  const db = getDb();
  const post = db.prepare("SELECT id, author_id FROM forum_posts WHERE id = ?").get(postId);
  if (!post) throw notFound("帖子不存在");
  if (post.author_id !== granterId) throw forbidden("只有发帖人能撤销授权");
  db.prepare(
    "UPDATE forum_report_grants SET status = 'revoked', revoked_at = datetime('now') WHERE post_id = ? AND grantee_id = ? AND status = 'active'"
  ).run(postId, granteeId);
  return { ok: true };
}

/**
 * 我的报告库:① 解锁给我的(留存面)② 我授权出去的(发帖人管理)。
 */
function listMyReports(userId) {
  const db = getDb();
  const unlockedToMe = db.prepare(
    `SELECT g.post_id, g.created_at, p.title, p.codename, p.score_snapshot,
            u.display_name, u.username, u.avatar_url
     FROM forum_report_grants g
     JOIN forum_posts p ON p.id = g.post_id
     LEFT JOIN users u ON u.id = g.granter_id
     WHERE g.grantee_id = ? AND g.status = 'active' AND p.status = 'published'
     ORDER BY g.created_at DESC`
  ).all(userId);

  const grantedByMe = db.prepare(
    `SELECT g.post_id, g.grantee_id, g.created_at, p.title, p.codename,
            u.display_name, u.username, u.avatar_url
     FROM forum_report_grants g
     JOIN forum_posts p ON p.id = g.post_id
     LEFT JOIN users u ON u.id = g.grantee_id
     WHERE g.granter_id = ? AND g.status = 'active'
     ORDER BY g.created_at DESC`
  ).all(userId);

  return {
    unlocked_to_me: unlockedToMe.map((r) => ({
      post_id: r.post_id,
      title: r.title,
      codename: r.codename,
      granted_at: r.created_at,
      snapshot: safeParse(r.score_snapshot, null),
      from: { name: r.display_name || r.username || "用户", avatar_url: r.avatar_url || null },
    })),
    granted_by_me: grantedByMe.map((r) => ({
      post_id: r.post_id,
      title: r.title,
      codename: r.codename,
      granted_at: r.created_at,
      to: { id: r.grantee_id, name: r.display_name || r.username || "用户", avatar_url: r.avatar_url || null },
    })),
  };
}

module.exports = {
  canViewReport,
  getUnlockedReport,
  requestReport,
  grantReport,
  revokeReport,
  listMyReports,
  _internal: { scrubDeep },
};
