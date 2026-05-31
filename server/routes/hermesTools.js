// ============================================================
// server/routes/hermesTools.js
//
// Hermes → 北京 反向 HTTP 工具调用端点。
//
// 协议：HTTP MVP（Phase 2 可升级到 MCP，只换路由层不动 gateway）。
//
// 认证：复用 HERMES_API_KEY（与北京 → 新加坡同 key，双向同密钥简化运维）
//
// 请求体：
// {
//   "tool":            "onepager_pptx",
//   "args":            { ... },
//   "caller":          "host",            // Hermes 自报
//   "conversation_id": "wsconv_abc",
//   "call_id":         "call_xyz"        // 可选，用于幂等
// }
//
// 响应（成功）：200
// { "ok": true, "result": { ... 工具返回 } }
//
// 响应（拒绝/失败）：4xx / 5xx
// { "ok": false, "error": { "reason": "...", "message": "..." } }
// ============================================================

const { Router } = require("express");
const { flags } = require("../config/featureFlags");
const gateway = require("../services/hermesToolGateway");

const router = Router();

// curator/reviewer callback 子路由
router.use("/curator", require("./hermesCurator"));

function requireHermesAuth(req, res, next) {
  if (!flags.hermesApiKey) {
    return res.status(500).json({ ok: false, error: { reason: "config", message: "HERMES_API_KEY 未配置" } });
  }
  const header = req.get("authorization") || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  const provided = m ? m[1].trim() : null;
  if (!provided || provided !== flags.hermesApiKey) {
    return res.status(401).json({ ok: false, error: { reason: "auth_failed", message: "Bearer token 校验失败" } });
  }
  next();
}

router.post("/tools/call", requireHermesAuth, async (req, res) => {
  const body = req.body || {};
  try {
    const result = await gateway.invoke({
      tool: body.tool,
      args: body.args || {},
      caller: body.caller || "host",
      conversation_id: body.conversation_id,
      call_id: body.call_id || null,
    });
    return res.status(result.status || (result.ok ? 200 : 500)).json({
      ok: result.ok,
      result: result.ok ? result.result : undefined,
      error: result.ok ? undefined : result.error,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: { reason: "internal", message: err.message },
    });
  }
});

module.exports = router;
