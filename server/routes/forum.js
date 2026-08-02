// ============================================================
// server/routes/forum.js — 论坛路由
//
// 浏览(list/detail/profile)用 optionalAuth：游客可看精简内容(软墙)，
// 登录后看完整。写操作(发帖/评论/点赞/撮合)一律 requireAuth。
// ============================================================

const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const { requireAuth, optionalAuth } = require("../middleware/auth");
const forum = require("../services/forumService");
const badges = require("../services/badgeService");
const messages = require("../services/forumMessageService");
const reports = require("../services/forumReportService");
const notifications = require("../services/notificationService");
const { getDb } = require("../db");

const router = Router();

// 发帖/评论限频，防刷
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "操作过于频繁，请稍后再试" },
});

// 统一把 service 抛出的 {status,message} 转成 HTTP 响应。
// P2-5: 旧版只支持同步 service —— 一旦有人接入 async service，返回的 Promise
// 会被 res.json 序列化成 {}，异常则逃逸成 unhandledRejection（触发进程优雅重启）。
// 现改为 Promise 感知：错误统一交给全局 errorHandler（含 requestId + stack 落盘）。
function handle(fn) {
  return (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .then((out) => {
        if (out !== undefined && !res.headersSent) res.json(out);
      })
      .catch(next);
  };
}

// ── 免责声明文案（公开）──
router.get("/disclaimer", (_req, res) => {
  try {
    const row = getDb().prepare("SELECT title, body FROM site_content WHERE slug = 'forum_disclaimer'").get();
    res.json(row || { title: "论坛免责声明", body: "" });
  } catch {
    res.json({ title: "论坛免责声明", body: "" });
  }
});

// ── 列表 / 详情 ──
router.get("/posts", optionalAuth, handle((req) =>
  forum.listPosts({
    category: req.query.category,
    sort: req.query.sort,
    page: Number(req.query.page) || 1,
    pageSize: Number(req.query.page_size) || 20,
    viewerId: req.user?.id || null,
  })
));

router.get("/posts/:id", optionalAuth, handle((req) =>
  forum.getPostDetail(Number(req.params.id), req.user?.id || null)
));

// ── 发帖 ──
router.post("/posts", requireAuth, writeLimiter, handle((req) =>
  forum.createPost({
    userId: req.user.id,
    category: req.body.category,
    title: req.body.title,
    body: req.body.body,
    taskId: req.body.task_id,
    showProjectName: !!req.body.show_project_name,
    showCompanyName: !!req.body.show_company_name,
    allowContact: req.body.allow_contact !== false,
    publicContact: req.body.public_contact,
  })
));

router.post("/preview-snapshot", requireAuth, handle((req) =>
  forum.previewSnapshot({
    userId: req.user.id,
    taskId: req.body.task_id,
    showProjectName: !!req.body.show_project_name,
    showCompanyName: !!req.body.show_company_name,
  })
));

router.delete("/posts/:id", requireAuth, handle((req) =>
  forum.deletePost(Number(req.params.id), req.user.id)
));

// ── 评论 ──
router.post("/posts/:id/comments", requireAuth, writeLimiter, handle((req) =>
  forum.addComment({
    postId: Number(req.params.id),
    userId: req.user.id,
    body: req.body.body,
    parentId: req.body.parent_id ? Number(req.body.parent_id) : null,
  })
));

router.delete("/comments/:id", requireAuth, handle((req) =>
  forum.deleteComment({ commentId: Number(req.params.id), userId: req.user.id })
));

// ── 点赞 / 收藏 / 举报 ──
router.post("/like", requireAuth, handle((req) =>
  forum.toggleLike({ userId: req.user.id, targetType: req.body.target_type, targetId: Number(req.body.target_id) })
));

router.post("/posts/:id/bookmark", requireAuth, handle((req) =>
  forum.toggleBookmark({ userId: req.user.id, postId: Number(req.params.id) })
));

router.post("/report", requireAuth, handle((req) =>
  forum.reportTarget({ userId: req.user.id, targetType: req.body.target_type, targetId: Number(req.body.target_id), reason: req.body.reason })
));

// ── 表情回应(emoji + 贴纸)──
router.post("/react", requireAuth, writeLimiter, handle((req) =>
  forum.toggleReaction({
    userId: req.user.id,
    targetType: req.body.target_type,
    targetId: Number(req.body.target_id),
    reaction: req.body.reaction,
  })
));

// ── 完整报告:申请 / 授权解锁 / 撤销 / 查看 / 我的报告库 ──
router.post("/posts/:id/report-request", requireAuth, writeLimiter, handle((req) =>
  reports.requestReport({ postId: Number(req.params.id), requesterId: req.user.id })
));
router.post("/posts/:id/grant-report", requireAuth, handle((req) =>
  reports.grantReport({ postId: Number(req.params.id), granterId: req.user.id, granteeId: Number(req.body.grantee_id) })
));
router.post("/posts/:id/revoke-report", requireAuth, handle((req) =>
  reports.revokeReport({ postId: Number(req.params.id), granterId: req.user.id, granteeId: Number(req.body.grantee_id) })
));
router.get("/posts/:id/report", requireAuth, handle((req) =>
  reports.getUnlockedReport({ postId: Number(req.params.id), viewerId: req.user.id })
));
router.get("/reports", requireAuth, handle((req) => reports.listMyReports(req.user.id)));

// ── 站内通知 ──
router.get("/notifications", requireAuth, handle((req) =>
  notifications.listNotifications(req.user.id, {
    unreadOnly: req.query.unread === "1" || req.query.unread === "true",
    page: Number(req.query.page) || 1,
  })
));
router.get("/notifications/unread-count", requireAuth, handle((req) =>
  notifications.unreadCount(req.user.id)
));
router.post("/notifications/read", requireAuth, handle((req) =>
  notifications.markRead(req.user.id, Array.isArray(req.body.ids) ? req.body.ids : null)
));

// ── 撮合 ──
router.post("/posts/:id/interest", requireAuth, writeLimiter, handle((req) =>
  forum.expressInterest({ postId: Number(req.params.id), userId: req.user.id, message: req.body.message })
));

router.post("/connections/:id/respond", requireAuth, handle((req) =>
  forum.respondInterest({ connectionId: Number(req.params.id), userId: req.user.id, accept: !!req.body.accept })
));

router.get("/connections", requireAuth, handle((req) =>
  forum.listMyConnections(req.user.id)
));

// ── 论坛资料 ──
router.get("/profile", requireAuth, handle((req) => forum.getMyProfile(req.user.id)));
router.put("/profile", requireAuth, handle((req) => forum.updateMyProfile(req.user.id, req.body)));
router.get("/users/:id", optionalAuth, handle((req) =>
  forum.getPublicProfile(Number(req.params.id), req.user?.id || null)
));

// ── 徽章 ──
// /badges/me 返回完整目录（含未解锁，用于资料页全目录灰显）
router.get("/badges/me", requireAuth, handle((req) => ({ badges: badges.getCatalogProgress(req.user.id) })));
router.put("/badges/display", requireAuth, handle((req) => {
  badges.setDisplay(req.user.id, req.body.badge_code, !!req.body.displayed);
  return { badges: badges.getCatalogProgress(req.user.id) };
}));

// ── 站内信（轻量私信，独立于撮合）──
router.get("/conversations", requireAuth, handle((req) => ({
  conversations: messages.listConversations(req.user.id),
})));
router.post("/conversations", requireAuth, writeLimiter, handle((req) =>
  messages.sendMessage({ meId: req.user.id, recipientId: Number(req.body.recipient_id), body: req.body.body })
));
router.get("/conversations/:id/messages", requireAuth, handle((req) =>
  messages.listMessages(Number(req.params.id), req.user.id)
));
router.post("/conversations/:id/messages", requireAuth, writeLimiter, handle((req) =>
  messages.sendMessage({ meId: req.user.id, convId: Number(req.params.id), body: req.body.body })
));

module.exports = router;
