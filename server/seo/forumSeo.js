// ============================================================
// server/seo/forumSeo.js — 论坛页「无 JS 爬虫」SEO 注入 + 动态 sitemap
//
// 问题：本站是 CRA SPA，论坛是动态路由(/forum、/forum/post/:id)，未被 react-snap
//   预渲染。服务器对这些路由只回一个空壳 index.html —— 百度、各类 AI 爬虫
//   (GPTBot/ClaudeBot/PerplexityBot/Bytespider…) 大多不执行 JS，因此抓不到任何论坛内容。
//
// 方案：在 SPA 兜底(catch-all)之前拦截论坛 GET 文档请求，用「游客软墙级」的公开数据
//   (标题 + 截断摘要，无联系方式/附件/完整报告) 把真实内容烘进 <head> 元信息 +
//   一段 <noscript> 正文。
//     · 无 JS 爬虫：直接读到结构化标题/描述/JSON-LD + noscript 正文 → 可索引。
//     · 真实浏览器：#root 仍为空 → 前端走 createRoot 正常挂载；<noscript> 不渲染，
//       服务端注入的 head 标签由前端 index.js 在挂载时移除([data-seo-ssr])，交还
//       react-helmet 管理，无重复、无水合冲突。
//
// 隐私：只暴露公开可索引内容；项目分析结果(/report、/project、/teaser)不在此列，
//   仍由 robots Disallow + 登录鉴权双重封死。
// ============================================================

const fs = require("fs");
const path = require("path");

const config = require("../config");
const forum = require("../services/forumService");

const SITE_URL = config.siteUrl;
const BUILD_DIR = path.join(__dirname, "..", "..", "client", "build");
// 注入模板必须是「空 #root」的原始壳：
//   · 200.html —— react-snap 预渲染时另存的原始壳（首选）。
//   · index.html —— 仅当 react-snap 未运行(被跳过/失败)时它才是空壳；若已被预渲染成
//     首页(#root 有内容)则不能用，否则会把论坛 meta 注进首页 DOM。
const EMPTY_ROOT = '<div id="root"></div>';

const CATEGORY_LABELS = {
  project: "优质项目",
  discussion: "行业讨论",
  market: "找钱 / 找项目",
};

let templateCache = null;
let templateMissing = false;

function loadTemplate() {
  if (templateCache) return templateCache;
  if (templateMissing) return null;

  for (const name of ["200.html", "index.html"]) {
    try {
      const html = fs.readFileSync(path.join(BUILD_DIR, name), "utf-8");
      if (html.includes(EMPTY_ROOT)) {   // 只接受空 #root 的壳
        templateCache = html;
        return templateCache;
      }
    } catch { /* try next */ }
  }
  templateMissing = true;   // 无可用空壳：请求回落到 SPA 兜底
  return null;
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// JSON-LD 注入需把 < 转义，避免 </script> 提前闭合
function jsonLdScript(obj) {
  const json = JSON.stringify(obj).replace(/</g, "\\u003c");
  return `<script type="application/ld+json" data-seo-ssr="1">${json}</script>`;
}

function absUrl(p) {
  return `${SITE_URL}${p.startsWith("/") ? p : `/${p}`}`;
}

// 构建 <head> 内 SEO 标签。除 <title> 外都打 data-seo-ssr，前端挂载时统一清除。
function buildHead({ title, description, canonical, ogType = "website", noindex = false, jsonLd = null }) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const c = escapeHtml(canonical);
  const tags = [
    `<meta name="description" content="${d}" data-seo-ssr="1"/>`,
    `<link rel="canonical" href="${c}" data-seo-ssr="1"/>`,
    `<meta name="robots" content="${noindex ? "noindex, nofollow" : "index, follow"}" data-seo-ssr="1"/>`,
    `<meta property="og:site_name" content="垃圾BP过滤机" data-seo-ssr="1"/>`,
    `<meta property="og:type" content="${ogType}" data-seo-ssr="1"/>`,
    `<meta property="og:title" content="${t}" data-seo-ssr="1"/>`,
    `<meta property="og:description" content="${d}" data-seo-ssr="1"/>`,
    `<meta property="og:url" content="${c}" data-seo-ssr="1"/>`,
    `<meta property="og:image" content="${escapeHtml(absUrl("/og-image.png"))}" data-seo-ssr="1"/>`,
    `<meta property="og:locale" content="zh_CN" data-seo-ssr="1"/>`,
    `<meta name="twitter:card" content="summary_large_image" data-seo-ssr="1"/>`,
    `<meta name="twitter:title" content="${t}" data-seo-ssr="1"/>`,
    `<meta name="twitter:description" content="${d}" data-seo-ssr="1"/>`,
  ];
  if (jsonLd) tags.push(jsonLdScript(jsonLd));
  return tags.join("");
}

// 把 head/body 内容注入模板。#root 保持为空，前端走 createRoot 不触发水合。
function render(template, { title, headExtra, bodyExtra }) {
  let html = template.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  html = html.replace("</head>", `${headExtra}</head>`);
  html = html.replace("</body>", `${bodyExtra}</body>`);
  return html;
}

// ── 列表页 /forum ──
function renderForumList() {
  const template = loadTemplate();
  if (!template) return null;

  const posts = forum.listRecentForSeo(60);
  const title = "投资人论坛 — 优质项目 / 行业讨论 / 找钱找项目";
  const description =
    "垃圾BP过滤机投资人社区：带平台实测评分的优质项目、一级市场赛道讨论，以及找钱/找项目供需对接。内容公开可检索，登录后参与讨论与撮合。";
  const canonical = absUrl("/forum");

  const listHtml = posts
    .map((p) => {
      const label = CATEGORY_LABELS[p.category] || "讨论";
      return `<li><a href="${absUrl(`/forum/post/${p.id}`)}">${escapeHtml(p.title)}</a><span>（${escapeHtml(label)}）</span><p>${escapeHtml(p.excerpt)}</p></li>`;
    })
    .join("");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    description,
    url: canonical,
    isPartOf: { "@type": "WebSite", name: "垃圾BP过滤机", url: SITE_URL },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: posts.slice(0, 30).map((p, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: absUrl(`/forum/post/${p.id}`),
        name: p.title,
      })),
    },
  };

  const bodyExtra =
    `<noscript><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p>` +
    `<ul>${listHtml}</ul></main></noscript>`;

  return render(template, {
    title,
    headExtra: buildHead({ title, description, canonical, jsonLd }),
    bodyExtra,
  });
}

// ── 详情页 /forum/post/:id ──
function renderForumPost(id) {
  const template = loadTemplate();
  if (!template) return null;

  const postId = Number(id);
  if (!Number.isInteger(postId) || postId <= 0) {
    return { status: 404, html: renderNotFound(template) };
  }

  const post = forum.getPostSeo(postId);
  if (!post) return { status: 404, html: renderNotFound(template) };

  const label = CATEGORY_LABELS[post.category] || "讨论";
  const title = post.title;
  const description = (post.excerpt && post.excerpt.trim()) || `${title}（${label}）— 垃圾BP过滤机投资人论坛`;
  const canonical = absUrl(`/forum/post/${post.id}`);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "DiscussionForumPosting",
    headline: title,
    articleSection: label,
    url: canonical,
    datePublished: post.created_at,
    dateModified: post.updated_at,
    inLanguage: "zh-CN",
    publisher: { "@type": "Organization", name: "垃圾BP过滤机", url: SITE_URL },
  };

  const codenameLine = post.codename ? `<p>项目代号：${escapeHtml(post.codename)}</p>` : "";
  const bodyExtra =
    `<noscript><article><nav><a href="${absUrl("/forum")}">投资人论坛</a> / ${escapeHtml(label)}</nav>` +
    `<h1>${escapeHtml(title)}</h1>${codenameLine}<p>${escapeHtml(post.excerpt)}</p>` +
    `<p>登录后查看完整内容、评分亮点与风险旗标，并参与讨论与撮合。</p></article></noscript>`;

  return {
    status: 200,
    html: render(template, {
      title,
      headExtra: buildHead({ title, description, canonical, ogType: "article", jsonLd }),
      bodyExtra,
    }),
  };
}

function renderNotFound(template) {
  const title = "帖子不存在 — 投资人论坛";
  return render(template, {
    title,
    headExtra: buildHead({
      title,
      description: "该帖子不存在或已下架。",
      canonical: absUrl("/forum"),
      noindex: true,
    }),
    bodyExtra: `<noscript><main><h1>${escapeHtml(title)}</h1><p>该帖子不存在或已下架。<a href="${absUrl("/forum")}">返回论坛</a></p></main></noscript>`,
  });
}

// ── 动态 sitemap：/forum + 最近公开帖 ──
function renderForumSitemap() {
  const posts = forum.listRecentForSeo(500);
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    `<url><loc>${absUrl("/forum")}</loc><changefreq>hourly</changefreq><priority>0.8</priority></url>`,
    ...posts.map((p) => {
      const lastmod = String(p.updated_at || p.created_at || today).slice(0, 10);
      return `<url><loc>${absUrl(`/forum/post/${p.id}`)}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>`;
    }),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

function mountForumSeo(app) {
  // 动态论坛 sitemap（robots.txt 已引用）
  app.get("/sitemap-forum.xml", (_req, res, next) => {
    try {
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=600");
      res.send(renderForumSitemap());
    } catch (e) {
      next(e);
    }
  });

  app.get("/forum", (req, res, next) => {
    try {
      const html = renderForumList();
      if (!html) return next();                 // 构建产物缺失 → 回落 SPA 兜底
      res.setHeader("Cache-Control", "no-cache");
      res.send(html);
    } catch (e) {
      next(e);
    }
  });

  app.get("/forum/post/:id", (req, res, next) => {
    try {
      const out = renderForumPost(req.params.id);
      if (!out) return next();
      res.status(out.status);
      res.setHeader("Cache-Control", "no-cache");
      res.send(out.html);
    } catch (e) {
      next(e);
    }
  });
}

module.exports = { mountForumSeo, renderForumList, renderForumPost, renderForumSitemap };
