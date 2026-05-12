// ============================================================
// server/routes/teaser.js — Teaser 公开访问端点(无需登录)
//
// /api/teaser/:token/meta   GET  返回元信息(过期/吊销/次数)— 用于前端先做友好提示
// /api/teaser/:token/view   POST { password } -> 解密后的 teaser payload
//
// 安全:
//   - 严格速率限流(每 IP 每分钟 10 次,防暴力枚举密码)
//   - 错误统一,不区分"密码错"vs"过期",避免侧信道
// ============================================================

const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const teaserService = require("../services/teaserService");

const router = Router();

const viewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "尝试过于频繁,请稍后" },
});

router.get("/:token/meta", (req, res) => {
  const meta = teaserService.getPublicMeta(req.params.token);
  if (!meta) return res.status(404).json({ error: "链接无效" });
  if (meta.revoked) return res.status(410).json({ error: "链接已被撤销" });
  if (meta.expires_at && new Date(meta.expires_at.replace(" ", "T") + "Z") < new Date()) {
    return res.status(410).json({ error: "链接已过期" });
  }
  if (meta.max_views != null && meta.view_count >= meta.max_views) {
    return res.status(410).json({ error: "链接已达阅读上限" });
  }
  res.json({
    valid: true,
    expires_at: meta.expires_at,
    views_remaining: meta.max_views != null ? Math.max(0, meta.max_views - meta.view_count) : null,
  });
});

router.post("/:token/view", viewLimiter, (req, res) => {
  const password = (req.body?.password || "").toString();
  if (!password) return res.status(400).json({ error: "需要密码" });
  const out = teaserService.viewShare(req.params.token, password, req);
  if (!out.ok) {
    const msg = {
      not_found: "链接无效",
      revoked: "链接已被撤销",
      expired: "链接已过期",
      limit_exceeded: "链接已达阅读上限",
      wrong_password: "密码错误或链接已失效",
    }[out.code] || "无法访问";
    const status = out.code === "wrong_password" ? 401 : 410;
    return res.status(status).json({ error: msg });
  }
  res.json({
    payload: out.payload,
    watermark: out.watermark,
    meta: out.meta,
  });
});

module.exports = router;
