// ============================================================
// server/routes/llm.js — 模型厂商与用户自带凭证（BYOK）
//
//   GET    /api/llm/providers    可选厂商清单 + BYOK 是否可用
//   GET    /api/llm/credentials  当前用户已保存的凭证（掩码视图）
//   POST   /api/llm/credentials  校验并保存（不通过校验不落库）
//   DELETE /api/llm/credentials  删除
//   POST   /api/llm/validate     只校验不保存（前端"测试连接"按钮）
//
// 校验会真的打一次用户的模型，属于有成本、可被滥用的操作，所以单独限流。
// ============================================================

const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const config = require("../config");
const { requireAuth } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/errorHandler");
const providers = require("../services/llm/providers");
const credentials = require("../services/llmCredentialService");

const router = Router();

// 校验会调用外部 API，既费用户的钱也占我们的连接：每用户每小时 20 次足够调试用
const validateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: "模型校验请求过于频繁，请稍后再试" },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => (req.user && req.user.id ? `u:${req.user.id}` : `ip:${req.ip}`),
});

/** 解析并粗校验请求体 */
function parsePayload(body = {}) {
  const provider = String(body.provider || "").trim().toLowerCase();
  const apiKey = String(body.apiKey || "").trim();
  const baseURL = String(body.baseURL || "").trim();
  const models = {
    default: String(body.models?.default || "").trim(),
    heavy: String(body.models?.heavy || "").trim(),
    light: String(body.models?.light || "").trim(),
  };
  const maxOutputTokens = Number(body.maxOutputTokens) || null;
  const contextWindow = Number(body.contextWindow) || null;

  if (!providers.getProvider(provider)) return { error: "请选择有效的模型厂商" };
  if (!apiKey || apiKey.length < 8) return { error: "请填写有效的 API Key" };
  if (apiKey.length > 512) return { error: "API Key 长度异常" };

  const hostCheck = providers.validateHost(provider, baseURL, { allowCustom: config.allowCustomLlmEndpoint });
  if (!hostCheck.ok) return { error: hostCheck.reason };

  return { payload: { provider, apiKey, baseURL, models, maxOutputTokens, contextWindow } };
}

router.get("/providers", (req, res) => {
  res.json({
    byok_enabled: credentials.isByokAvailable(),
    // 平台模型是否可用。为 false 时站点处于「纯自带模型模式」（平台没配 LLM key，
    // 例如运营方停止续费），前端据此把"用自己的模型"从可选项变成必要条件。
    platform_model_available: config.platformModelAvailable,
    // 未配置 ENCRYPTION_KEY 时前端要能说明白为什么用不了，而不是入口莫名消失
    byok_disabled_reason: credentials.isByokAvailable()
      ? null
      : (config.byokEnabled ? "服务端未配置加密密钥，暂时无法安全保存你的 API Key" : "管理员已关闭自带模型功能"),
    allow_custom_endpoint: !!config.allowCustomLlmEndpoint,
    providers: providers.listProviders(),
  });
});

router.get("/credentials", requireAuth, (req, res) => {
  // platform_model_available 两个分支都要带上：上传页只调这一个接口，
  // BYOK 关着的时候它同样需要知道平台模型还在不在，才能给出正确的提示。
  const platform = config.platformModelAvailable;
  if (!credentials.isByokAvailable()) {
    return res.json({ credential: null, byok_enabled: false, platform_model_available: platform });
  }
  res.json({
    credential: credentials.getCredentialForUser(req.user.id),
    byok_enabled: true,
    platform_model_available: platform,
  });
});

router.post("/validate", requireAuth, validateLimiter, asyncHandler(async (req, res) => {
  if (!credentials.isByokAvailable()) {
    return res.status(503).json({ error: "自带模型功能当前不可用" });
  }
  const { error, payload } = parsePayload(req.body);
  if (error) return res.status(400).json({ error });

  const result = await credentials.validateCredential(payload);
  res.json(result);
}));

router.post("/credentials", requireAuth, validateLimiter, asyncHandler(async (req, res) => {
  if (!credentials.isByokAvailable()) {
    return res.status(503).json({ error: "自带模型功能当前不可用" });
  }
  const { error, payload } = parsePayload(req.body);
  if (error) return res.status(400).json({ error });

  // 先校验再落库：存一份跑不通的凭证，等于给用户埋一次必然失败的分析
  const validation = await credentials.validateCredential(payload);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.message, detail: validation.detail || null });
  }

  const saved = credentials.saveCredential(req.user.id, payload, validation);
  res.json({ credential: saved, validation });
}));

router.delete("/credentials", requireAuth, (req, res) => {
  credentials.deleteCredential(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
