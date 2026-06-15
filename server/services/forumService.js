// ============================================================
// server/services/forumService.js — 论坛服务层
//
// 核心纪律（产品红线）：
//   1. 评分帖的分数只能是"平台实测快照" —— 服务端从 tasks.result.$.verdict 现取，
//      用户不能手填。score_source 恒 'platform'。
//   2. 风险旗标(risk_flags)强制全带，发帖人无法删。
//   3. 脱敏只作用于"可识别信息"（公司名/项目名/产品名），按发帖人选择的
//      show_company_name / show_project_name 两个开关，对快照文本与正文做服务端
//      二次擦除兜底（参照 teaserGenerate 的泄漏扫描）。
//   4. 游客软墙：列表只给前 N 条精简字段；详情对游客截断正文、不返回评论。
// ============================================================

const { getDb } = require("../db");
const badgeService = require("./badgeService");

const GUEST_LIST_LIMIT = 6;       // 游客最多看前 6 条
const GUEST_BODY_CHARS = 140;     // 游客正文截断长度
const VALID_CATEGORIES = ["project", "discussion", "market"];
const VALID_USER_TYPES = ["investor", "founder", "fa", "unset"];

// ── 工具：解析 JSON 安全 ──
function safeParse(str, fallback = null) {
  if (str == null) return fallback;
  if (typeof str === "object") return str;
  try { return JSON.parse(str); } catch { return fallback; }
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// ── 项目代号生成（投行风格）──
const CODENAME_WORDS = [
  "Helios", "Aurora", "Cipher", "Orion", "Atlas", "Nova", "Vega", "Lyra",
  "Polaris", "Zephyr", "Quasar", "Meridian", "Cobalt", "Onyx", "Halcyon", "Solace",
];
function generateCodename() {
  const w = CODENAME_WORDS[Math.floor(Math.random() * CODENAME_WORDS.length)];
  const n = Math.floor(Math.random() * 90) + 10;
  return `Project ${w}-${n}`;
}

/**
 * 从 task 中抽取"评分结果第一部分"快照。
 * 只取分数 + 评级 + 一句话结论 + 亮点 + 风险，不含维度拆解/尽调/claim 等后续内容。
 */
function buildSnapshotFromTask(task) {
  const result = safeParse(task.result, null);
  const verdict = result?.verdict;
  if (!verdict || verdict.total_score == null) return null;
  return {
    total_score: verdict.total_score,
    grade: verdict.grade || "",
    grade_label: verdict.grade_label || "",
    grade_action: verdict.grade_action || "",
    grade_color: verdict.grade_color || "",
    verdict_summary: verdict.verdict_summary || "",
    strengths: Array.isArray(verdict.strengths) ? verdict.strengths.slice(0, 3) : [],
    risk_flags: Array.isArray(verdict.risk_flags) ? verdict.risk_flags : [],  // 强制全带
  };
}

/**
 * 收集需要擦除的可识别串（公司名/产品名/任务标题）。
 */
function collectIdentifiers(task) {
  const result = safeParse(task.result, {});
  const ex = result?.extracted_data || {};
  return {
    company: (ex.company_name || "").trim(),
    product: (ex.product_name || "").trim(),
    title: (task.title || result?.title || "").trim(),
  };
}

/**
 * 按披露开关擦除一段文本中的可识别信息。
 * @param {string} text
 * @param {object} ids   collectIdentifiers 产物
 * @param {object} opts  { showCompany, showProject, codename }
 */
function scrubText(text, ids, { showCompany, showProject, codename }) {
  if (typeof text !== "string" || !text) return text;
  let out = text;
  if (!showCompany && ids.company) {
    out = out.replace(new RegExp(escapeRegex(ids.company), "g"), "某公司");
  }
  if (!showProject) {
    if (ids.product) out = out.replace(new RegExp(escapeRegex(ids.product), "g"), codename);
    if (ids.title) out = out.replace(new RegExp(escapeRegex(ids.title), "g"), codename);
  }
  return out;
}

function scrubSnapshot(snapshot, ids, opts) {
  if (!snapshot) return snapshot;
  return {
    ...snapshot,
    verdict_summary: scrubText(snapshot.verdict_summary, ids, opts),
    grade_action: scrubText(snapshot.grade_action, ids, opts),
    strengths: (snapshot.strengths || []).map((s) => scrubText(s, ids, opts)),
    risk_flags: (snapshot.risk_flags || []).map((s) => scrubText(s, ids, opts)),
  };
}

// ── 作者展示信息 ──
function authorView(row) {
  if (!row) return null;
  return {
    id: row.author_id ?? row.id,
    name: row.display_name || row.username || "用户",
    user_type: row.user_type || "unset",
    type_verified: !!row.type_verified,
    org_name: row.org_name || null,
    avatar_url: row.avatar_url || null,
  };
}

// 给作者视图附上其「挂出」的徽章（仅用于帖子作者展示，避免在评论列表上 N+1）。
function attachBadges(author) {
  if (!author) return author;
  try { author.badges = badgeService.getBadges(author.id, { onlyDisplayed: true }); }
  catch { author.badges = []; }
  return author;
}

const POST_AUTHOR_JOIN = `
  LEFT JOIN users u ON u.id = p.author_id
`;
const AUTHOR_COLS = `
  u.username, u.display_name, u.user_type, u.type_verified, u.org_name, u.avatar_url
`;

// ============================================================
// 发帖
// ============================================================
/**
 * @param {object} args
 * @param {number} args.userId
 * @param {string} args.category      project|discussion|market
 * @param {string} args.title
 * @param {string} args.body
 * @param {string} [args.taskId]      评分帖必填：关联的真实分析任务
 * @param {boolean} [args.showProjectName]
 * @param {boolean} [args.showCompanyName]
 * @param {boolean} [args.allowContact]
 * @param {string} [args.publicContact]
 */
function createPost(args) {
  const db = getDb();
  const {
    userId, category = "project", title, body = "",
    taskId, showProjectName = false, showCompanyName = false,
    allowContact = true, publicContact = "",
  } = args;

  if (!VALID_CATEGORIES.includes(category)) throw badRequest("板块不存在");
  if (!title || !title.trim()) throw badRequest("请填写标题");
  if (title.length > 120) throw badRequest("标题过长");
  if ((body || "").length > 20000) throw badRequest("正文过长");

  let snapshot = null;
  let codename = null;
  let teaserPayload = null;
  let disclosureLevel = "public";
  let scrubbedBody = body;
  let resolvedTaskId = null;

  if (category === "project") {
    // 评分帖：必须关联真实任务，分数由服务端现取
    if (!taskId) throw badRequest("优质项目帖需关联一次真实分析（task_id）");
    const task = db.prepare(
      "SELECT id, user_id, title, result FROM tasks WHERE id = ?"
    ).get(taskId);
    if (!task) throw badRequest("关联的分析任务不存在");

    // 权限：只能转发自己的分析（管理员例外）
    const me = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
    const isAdmin = me?.role === "admin";
    if (task.user_id !== userId && !isAdmin) throw forbidden("只能转发自己的分析结果");

    snapshot = buildSnapshotFromTask(task);
    if (!snapshot) throw badRequest("该任务尚无有效评分结果，无法转发");

    resolvedTaskId = task.id;
    const ids = collectIdentifiers(task);
    codename = (!showProjectName) ? generateCodename() : null;
    const scrubOpts = { showCompany: showCompanyName, showProject: showProjectName, codename: codename || ids.title };

    snapshot = scrubSnapshot(snapshot, ids, scrubOpts);
    scrubbedBody = scrubText(body, ids, scrubOpts);

    disclosureLevel = showProjectName && showCompanyName ? "public"
      : (showProjectName || showCompanyName ? "semi" : "anonymous");

    teaserPayload = JSON.stringify({
      codename: codename || ids.title || ids.company || "项目",
      sector: safeParse(task.result, {})?.industry || null,
    });
  }

  const info = db.prepare(
    `INSERT INTO forum_posts
      (author_id, category, title, body, task_id, score_snapshot, score_source,
       disclosure_level, show_project_name, show_company_name, codename, teaser_payload,
       allow_contact, public_contact)
     VALUES (?, ?, ?, ?, ?, ?, 'platform', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId, category, title.trim(), scrubbedBody, resolvedTaskId,
    snapshot ? JSON.stringify(snapshot) : null,
    disclosureLevel, showProjectName ? 1 : 0, showCompanyName ? 1 : 0,
    codename, teaserPayload,
    allowContact ? 1 : 0, (publicContact || "").trim() || null
  );

  // 发帖后顺手重算徽章（用户活跃度/总量可能变化），失败不影响发帖
  try { badgeService.recompute(userId); } catch { /* noop */ }

  return getPostById(info.lastInsertRowid, userId);
}

/**
 * 发帖前预览脱敏后的评分快照（不落库）。
 */
function previewSnapshot({ userId, taskId, showProjectName, showCompanyName }) {
  const db = getDb();
  const task = db.prepare("SELECT id, user_id, title, result FROM tasks WHERE id = ?").get(taskId);
  if (!task) throw badRequest("分析任务不存在");
  const me = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
  if (task.user_id !== userId && me?.role !== "admin") throw forbidden("只能预览自己的分析结果");

  let snapshot = buildSnapshotFromTask(task);
  if (!snapshot) throw badRequest("该任务尚无有效评分结果");

  const ids = collectIdentifiers(task);
  const codename = (!showProjectName) ? generateCodename() : null;
  const opts = { showCompany: !!showCompanyName, showProject: !!showProjectName, codename: codename || ids.title };
  snapshot = scrubSnapshot(snapshot, ids, opts);
  return { snapshot, codename };
}

// ============================================================
// 列表 / 详情（含游客软墙）
// ============================================================
function listPosts({ category, sort = "latest", page = 1, pageSize = 20, viewerId = null }) {
  const db = getDb();
  const isGuest = !viewerId;
  const where = ["p.status = 'published'"];
  const params = [];
  if (category && VALID_CATEGORIES.includes(category)) {
    where.push("p.category = ?");
    params.push(category);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;

  let orderSql;
  switch (sort) {
    case "score":
      orderSql = "ORDER BY json_extract(p.score_snapshot, '$.total_score') DESC NULLS LAST, p.created_at DESC";
      break;
    case "hot":
      orderSql = "ORDER BY (p.like_count * 3 + p.comment_count * 2 + p.view_count) DESC, p.created_at DESC";
      break;
    default:
      orderSql = "ORDER BY p.created_at DESC";
  }

  // 游客只给前 N 条
  const effectivePageSize = isGuest ? GUEST_LIST_LIMIT : Math.min(Math.max(1, pageSize), 50);
  const offset = isGuest ? 0 : (Math.max(1, page) - 1) * effectivePageSize;

  const total = db.prepare(`SELECT COUNT(*) n FROM forum_posts p ${whereSql}`).get(...params).n;

  const rows = db.prepare(
    `SELECT p.*, ${AUTHOR_COLS}
     FROM forum_posts p ${POST_AUTHOR_JOIN}
     ${whereSql} ${orderSql} LIMIT ? OFFSET ?`
  ).all(...params, effectivePageSize, offset);

  const items = rows.map((r) => listItemView(r, viewerId, isGuest));

  return {
    items,
    total,
    page: isGuest ? 1 : Math.max(1, page),
    page_size: effectivePageSize,
    gated: isGuest && total > GUEST_LIST_LIMIT,  // 还有更多但需登录
  };
}

function listItemView(r, viewerId, isGuest) {
  const snap = safeParse(r.score_snapshot, null);
  const base = {
    id: r.id,
    category: r.category,
    title: r.title,
    codename: r.codename,
    disclosure_level: r.disclosure_level,
    author: attachBadges(authorView(r)),
    score: snap ? { total_score: snap.total_score, grade: snap.grade, grade_label: snap.grade_label } : null,
    score_source: r.score_source,
    like_count: r.like_count,
    comment_count: r.comment_count,
    interest_count: r.interest_count,
    view_count: r.view_count,
    created_at: r.created_at,
  };
  if (isGuest) {
    base.excerpt = (r.body || "").slice(0, 60);
    return base;
  }
  base.excerpt = (r.body || "").slice(0, 120);
  return base;
}

/**
 * 详情。游客返回 gated:true + 截断正文 + 无评论。
 */
function getPostDetail(postId, viewerId) {
  const db = getDb();
  const isGuest = !viewerId;
  const r = db.prepare(
    `SELECT p.*, ${AUTHOR_COLS} FROM forum_posts p ${POST_AUTHOR_JOIN} WHERE p.id = ?`
  ).get(postId);
  if (!r || r.status !== "published") {
    // 作者本人可见自己被下架的帖
    if (r && viewerId && r.author_id === viewerId) { /* fallthrough */ }
    else throw notFound("帖子不存在或已下架");
  }

  // 计数 +1（游客也算曝光）
  db.prepare("UPDATE forum_posts SET view_count = view_count + 1 WHERE id = ?").run(postId);

  const snap = safeParse(r.score_snapshot, null);
  const post = {
    id: r.id,
    category: r.category,
    title: r.title,
    codename: r.codename,
    disclosure_level: r.disclosure_level,
    author: attachBadges(authorView(r)),
    score: snap,                      // 完整快照（含 strengths / risk_flags）
    score_source: r.score_source,
    allow_contact: !!r.allow_contact,
    public_contact: r.public_contact || null,
    like_count: r.like_count,
    comment_count: r.comment_count,
    interest_count: r.interest_count,
    view_count: r.view_count + 1,
    created_at: r.created_at,
    is_author: !!viewerId && r.author_id === viewerId,
  };

  if (isGuest) {
    return {
      post: {
        ...post,
        body: (r.body || "").slice(0, GUEST_BODY_CHARS),
        // 游客看分数总分+评级即可，亮点/风险细节登录后看
        score: snap ? { total_score: snap.total_score, grade: snap.grade, grade_label: snap.grade_label } : null,
        public_contact: null,
      },
      comments: [],
      viewer: { liked: false, bookmarked: false },
      gated: true,
    };
  }

  post.body = r.body || "";
  const liked = !!db.prepare(
    "SELECT 1 FROM forum_likes WHERE user_id = ? AND target_type = 'post' AND target_id = ?"
  ).get(viewerId, postId);
  const bookmarked = !!db.prepare(
    "SELECT 1 FROM forum_bookmarks WHERE user_id = ? AND post_id = ?"
  ).get(viewerId, postId);

  return {
    post,
    comments: listComments(postId, viewerId),
    viewer: { liked, bookmarked },
    gated: false,
  };
}

function getPostById(postId, viewerId) {
  const db = getDb();
  const r = db.prepare(
    `SELECT p.*, ${AUTHOR_COLS} FROM forum_posts p ${POST_AUTHOR_JOIN} WHERE p.id = ?`
  ).get(postId);
  if (!r) return null;
  const snap = safeParse(r.score_snapshot, null);
  return {
    id: r.id, category: r.category, title: r.title, body: r.body,
    codename: r.codename, disclosure_level: r.disclosure_level,
    author: authorView(r), score: snap, score_source: r.score_source,
    allow_contact: !!r.allow_contact, public_contact: r.public_contact || null,
    like_count: r.like_count, comment_count: r.comment_count,
    interest_count: r.interest_count, view_count: r.view_count,
    created_at: r.created_at, is_author: r.author_id === viewerId,
  };
}

function deletePost(postId, userId) {
  const db = getDb();
  const r = db.prepare("SELECT author_id FROM forum_posts WHERE id = ?").get(postId);
  if (!r) throw notFound("帖子不存在");
  const me = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
  if (r.author_id !== userId && me?.role !== "admin") throw forbidden("无权删除");
  db.prepare("UPDATE forum_posts SET status = 'removed', updated_at = datetime('now') WHERE id = ?").run(postId);
  return { ok: true };
}

// ============================================================
// 评论
// ============================================================
function listComments(postId, viewerId) {
  const db = getDb();
  const rows = db.prepare(
    `SELECT c.*, u.username, u.display_name, u.user_type, u.type_verified, u.org_name, u.avatar_url
     FROM forum_comments c LEFT JOIN users u ON u.id = c.author_id
     WHERE c.post_id = ? AND c.status = 'published'
     ORDER BY c.created_at ASC`
  ).all(postId);
  return rows.map((c) => ({
    id: c.id,
    parent_id: c.parent_id,
    body: c.body,
    like_count: c.like_count,
    created_at: c.created_at,
    author: { id: c.author_id, name: c.display_name || c.username || "用户", user_type: c.user_type || "unset", type_verified: !!c.type_verified, avatar_url: c.avatar_url || null },
    is_author: !!viewerId && c.author_id === viewerId,
  }));
}

function addComment({ postId, userId, body, parentId = null }) {
  const db = getDb();
  if (!body || !body.trim()) throw badRequest("评论不能为空");
  if (body.length > 4000) throw badRequest("评论过长");
  const post = db.prepare("SELECT id, status FROM forum_posts WHERE id = ?").get(postId);
  if (!post || post.status !== "published") throw notFound("帖子不存在");
  if (parentId) {
    const parent = db.prepare("SELECT id FROM forum_comments WHERE id = ? AND post_id = ?").get(parentId, postId);
    if (!parent) throw badRequest("回复的评论不存在");
  }
  const info = db.transaction(() => {
    const r = db.prepare(
      "INSERT INTO forum_comments (post_id, author_id, parent_id, body) VALUES (?, ?, ?, ?)"
    ).run(postId, userId, parentId, body.trim());
    db.prepare("UPDATE forum_posts SET comment_count = comment_count + 1 WHERE id = ?").run(postId);
    return r;
  })();
  const c = db.prepare(
    `SELECT c.*, u.username, u.display_name, u.user_type, u.type_verified, u.avatar_url
     FROM forum_comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.id = ?`
  ).get(info.lastInsertRowid);
  return {
    id: c.id, parent_id: c.parent_id, body: c.body, like_count: 0, created_at: c.created_at,
    author: { id: c.author_id, name: c.display_name || c.username || "用户", user_type: c.user_type || "unset", type_verified: !!c.type_verified, avatar_url: c.avatar_url || null },
    is_author: true,
  };
}

function deleteComment({ commentId, userId }) {
  const db = getDb();
  const c = db.prepare("SELECT author_id, post_id FROM forum_comments WHERE id = ?").get(commentId);
  if (!c) throw notFound("评论不存在");
  const me = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
  if (c.author_id !== userId && me?.role !== "admin") throw forbidden("无权删除");
  db.transaction(() => {
    db.prepare("UPDATE forum_comments SET status = 'removed' WHERE id = ?").run(commentId);
    db.prepare("UPDATE forum_posts SET comment_count = MAX(0, comment_count - 1) WHERE id = ?").run(c.post_id);
  })();
  return { ok: true };
}

// ============================================================
// 点赞 / 收藏 / 举报
// ============================================================
function toggleLike({ userId, targetType, targetId }) {
  if (!["post", "comment"].includes(targetType)) throw badRequest("类型错误");
  const db = getDb();
  const table = targetType === "post" ? "forum_posts" : "forum_comments";
  const exists = db.prepare("SELECT 1 FROM forum_likes WHERE user_id = ? AND target_type = ? AND target_id = ?").get(userId, targetType, targetId);
  let liked;
  db.transaction(() => {
    if (exists) {
      db.prepare("DELETE FROM forum_likes WHERE user_id = ? AND target_type = ? AND target_id = ?").run(userId, targetType, targetId);
      db.prepare(`UPDATE ${table} SET like_count = MAX(0, like_count - 1) WHERE id = ?`).run(targetId);
      liked = false;
    } else {
      db.prepare("INSERT INTO forum_likes (user_id, target_type, target_id) VALUES (?, ?, ?)").run(userId, targetType, targetId);
      db.prepare(`UPDATE ${table} SET like_count = like_count + 1 WHERE id = ?`).run(targetId);
      liked = true;
    }
  })();
  const row = db.prepare(`SELECT like_count FROM ${table} WHERE id = ?`).get(targetId);
  return { liked, like_count: row?.like_count ?? 0 };
}

function toggleBookmark({ userId, postId }) {
  const db = getDb();
  const exists = db.prepare("SELECT 1 FROM forum_bookmarks WHERE user_id = ? AND post_id = ?").get(userId, postId);
  if (exists) {
    db.prepare("DELETE FROM forum_bookmarks WHERE user_id = ? AND post_id = ?").run(userId, postId);
    return { bookmarked: false };
  }
  db.prepare("INSERT INTO forum_bookmarks (user_id, post_id) VALUES (?, ?)").run(userId, postId);
  return { bookmarked: true };
}

function reportTarget({ userId, targetType, targetId, reason }) {
  if (!["post", "comment"].includes(targetType)) throw badRequest("类型错误");
  const db = getDb();
  db.prepare(
    "INSERT INTO forum_reports (reporter_id, target_type, target_id, reason) VALUES (?, ?, ?, ?)"
  ).run(userId, targetType, targetId, (reason || "").slice(0, 500) || null);
  return { ok: true };
}

// ============================================================
// 撮合
// ============================================================
function expressInterest({ postId, userId, message }) {
  const db = getDb();
  const post = db.prepare("SELECT id, author_id, allow_contact, status FROM forum_posts WHERE id = ?").get(postId);
  if (!post || post.status !== "published") throw notFound("帖子不存在");
  if (!post.allow_contact) throw badRequest("发帖人未开放撮合");
  if (post.author_id === userId) throw badRequest("不能对自己的帖子表达意向");

  try {
    db.transaction(() => {
      db.prepare(
        "INSERT INTO deal_connections (post_id, initiator_id, owner_id, message) VALUES (?, ?, ?, ?)"
      ).run(postId, userId, post.author_id, (message || "").slice(0, 1000) || null);
      db.prepare("UPDATE forum_posts SET interest_count = interest_count + 1 WHERE id = ?").run(postId);
    })();
  } catch (e) {
    if (/UNIQUE/.test(e.message)) throw badRequest("你已对该项目表达过意向");
    throw e;
  }
  return { ok: true };
}

function respondInterest({ connectionId, userId, accept }) {
  const db = getDb();
  const conn = db.prepare("SELECT * FROM deal_connections WHERE id = ?").get(connectionId);
  if (!conn) throw notFound("意向不存在");
  if (conn.owner_id !== userId) throw forbidden("无权处理");
  if (conn.status !== "pending") throw badRequest("该意向已处理");
  db.prepare(
    "UPDATE deal_connections SET status = ?, responded_at = datetime('now') WHERE id = ?"
  ).run(accept ? "accepted" : "declined", connectionId);
  return { ok: true, status: accept ? "accepted" : "declined" };
}

/**
 * 我的撮合：作为发帖人收到的意向 + 作为发起人发出的意向。
 * accepted 状态下互相解锁名片(contact_card)。
 */
function listMyConnections(userId) {
  const db = getDb();
  const received = db.prepare(
    `SELECT dc.*, p.title AS post_title, p.codename,
            u.id AS counterpart_id, u.display_name, u.username, u.user_type, u.org_name, u.avatar_url, u.contact_card
     FROM deal_connections dc
     LEFT JOIN forum_posts p ON p.id = dc.post_id
     LEFT JOIN users u ON u.id = dc.initiator_id
     WHERE dc.owner_id = ? ORDER BY dc.created_at DESC`
  ).all(userId);

  const sent = db.prepare(
    `SELECT dc.*, p.title AS post_title, p.codename,
            u.id AS counterpart_id, u.display_name, u.username, u.user_type, u.org_name, u.avatar_url, u.contact_card
     FROM deal_connections dc
     LEFT JOIN forum_posts p ON p.id = dc.post_id
     LEFT JOIN users u ON u.id = dc.owner_id
     WHERE dc.initiator_id = ? ORDER BY dc.created_at DESC`
  ).all(userId);

  const mapConn = (c, counterpartLabel) => ({
    id: c.id,
    post_id: c.post_id,
    post_title: c.post_title || c.codename || "（帖子已删除）",
    status: c.status,
    message: c.message,
    created_at: c.created_at,
    responded_at: c.responded_at,
    counterpart: {
      id: c.counterpart_id,
      name: c.display_name || c.username || "用户",
      user_type: c.user_type || "unset",
      org_name: c.org_name || null,
      avatar_url: c.avatar_url || null,
      // 名片仅在 accepted 后解锁
      contact_card: c.status === "accepted" ? (c.contact_card || null) : null,
    },
    role: counterpartLabel,
  });

  return {
    received: received.map((c) => mapConn(c, "owner")),
    sent: sent.map((c) => mapConn(c, "initiator")),
  };
}

// ============================================================
// 论坛资料
// ============================================================
function getMyProfile(userId) {
  const db = getDb();
  const u = db.prepare(
    "SELECT id, username, display_name, user_type, type_verified, org_name, bio, contact_card, avatar_url FROM users WHERE id = ?"
  ).get(userId);
  if (!u) throw notFound("用户不存在");
  // 打开自己资料时重算徽章（幂等，保留已挂出选择）
  let badges = [];
  try { badges = badgeService.recompute(userId); } catch { /* noop */ }
  return {
    id: u.id, username: u.username,
    display_name: u.display_name || "", user_type: u.user_type || "unset",
    type_verified: !!u.type_verified, org_name: u.org_name || "",
    bio: u.bio || "", contact_card: u.contact_card || "", avatar_url: u.avatar_url || null,
    badges,  // 全部已获得（含 displayed 标记），供资料页「挂/取消挂」
  };
}

function updateMyProfile(userId, { user_type, display_name, org_name, bio, contact_card }) {
  const db = getDb();
  if (user_type != null && !VALID_USER_TYPES.includes(user_type)) throw badRequest("身份类型无效");
  const fields = [];
  const params = [];
  if (user_type != null) { fields.push("user_type = ?"); params.push(user_type); }
  if (display_name != null) { fields.push("display_name = ?"); params.push(String(display_name).slice(0, 60) || null); }
  if (org_name != null) { fields.push("org_name = ?"); params.push(String(org_name).slice(0, 100) || null); }
  if (bio != null) { fields.push("bio = ?"); params.push(String(bio).slice(0, 300) || null); }
  if (contact_card != null) { fields.push("contact_card = ?"); params.push(String(contact_card).slice(0, 500) || null); }
  if (!fields.length) return getMyProfile(userId);
  params.push(userId);
  db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...params);
  return getMyProfile(userId);
}

/**
 * 公开主页：某用户 + 其已发布帖子。
 */
function getPublicProfile(targetUserId, viewerId) {
  const db = getDb();
  const u = db.prepare(
    "SELECT id, username, display_name, user_type, type_verified, org_name, bio, avatar_url FROM users WHERE id = ?"
  ).get(targetUserId);
  if (!u) throw notFound("用户不存在");
  const posts = db.prepare(
    `SELECT p.*, ${AUTHOR_COLS} FROM forum_posts p ${POST_AUTHOR_JOIN}
     WHERE p.author_id = ? AND p.status = 'published' ORDER BY p.created_at DESC LIMIT 30`
  ).all(targetUserId);
  let badges = [];
  try { badges = badgeService.getBadges(targetUserId, { onlyDisplayed: true }); } catch { /* noop */ }
  return {
    profile: {
      id: u.id, name: u.display_name || u.username || "用户",
      user_type: u.user_type || "unset", type_verified: !!u.type_verified,
      org_name: u.org_name || null, bio: u.bio || null, avatar_url: u.avatar_url || null,
      badges,  // 仅挂出的徽章（对外展示）
      is_me: !!viewerId && viewerId === targetUserId,
    },
    posts: posts.map((r) => listItemView(r, viewerId, false)),
  };
}

// ── 错误工具（带 status 给路由层）──
function err(status, message) { const e = new Error(message); e.status = status; return e; }
function badRequest(m) { return err(400, m); }
function forbidden(m) { return err(403, m); }
function notFound(m) { return err(404, m); }

module.exports = {
  createPost,
  previewSnapshot,
  listPosts,
  getPostDetail,
  deletePost,
  listComments,
  addComment,
  deleteComment,
  toggleLike,
  toggleBookmark,
  reportTarget,
  expressInterest,
  respondInterest,
  listMyConnections,
  getMyProfile,
  updateMyProfile,
  getPublicProfile,
  // 测试用
  _internal: { buildSnapshotFromTask, scrubText, generateCodename },
};
