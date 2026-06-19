// ============================================================
// server/routes/workspaceProjectChat.js
// 项目级聊天:挂在 /api/workspace-projects/:projectId/conversation/*
//
// 与 /api/workspace/:taskId/* 共享 SSE 流式逻辑,只是把"取对话"
// 改为按 project_id。这样上传新版 BP 时聊天上下文不丢。
// ============================================================

const { Router } = require("express");
const multer = require("multer");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { requireAuth } = require("../middleware/auth");
const { getDb } = require("../db");
const ws = require("../services/workspaceService");
const { persistWorkspaceUpload } = require("../services/workspaceUploads");
const { workspaceRateLimit, getWorkspaceUsage } = require("../middleware/workspaceQuota");
const { enforceWorkspaceUploadLimits } = require("../services/workspaceUploadLimits");

const router = Router();
const ALLOWED_EXTENSIONS = new Set([".pdf",".pptx",".docx",".xlsx",".csv",".txt",".md",".png",".jpg",".jpeg"]);
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) cb(null, true);
    else cb(new Error("不支持的文件类型"));
  },
});

function _checkOwn(projectId, userId) {
  const db = getDb();
  const proj = db.prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`).get(projectId, userId);
  if (!proj) return { error: "项目不存在或无权访问", status: 404 };
  return { project: proj };
}

router.get("/:projectId/conversation/usage", requireAuth, (req, res) => {
  res.json(getWorkspaceUsage(req.user.id));
});

// ── 取对话 + 历史 ─────────────────────────────────────────
router.get("/:projectId/conversation/messages", requireAuth, (req, res) => {
  const { projectId } = req.params;
  const own = _checkOwn(projectId, req.user.id);
  if (own.error) return res.status(own.status).json({ error: own.error });

  const conv = ws.createOrGetConversationByProject(projectId, req.user.id);
  res.json({
    conversation_id: conv.id,
    messages: ws.listMessages(conv.id),
    artifacts: ws.listArtifacts(conv.id),
  });
});

// ── artifacts 列表 + 下载(沿用 user-level 校验函数) ─────
router.get("/:projectId/conversation/artifacts/:artifactId/download", requireAuth, (req, res) => {
  const { projectId, artifactId } = req.params;
  const own = _checkOwn(projectId, req.user.id);
  if (own.error) return res.status(own.status).json({ error: own.error });

  const art = ws.getArtifactForUser(artifactId, req.user.id);
  if (!art) return res.status(404).json({ error: "文件不存在或无权访问" });
  const conv = ws.createOrGetConversationByProject(projectId, req.user.id);
  if (art.conversation_id !== conv.id) return res.status(404).json({ error: "文件不存在" });
  if (!fs.existsSync(art.storage_path)) return res.status(410).json({ error: "文件已被删除" });
  res.download(art.storage_path, art.filename);
});

// ── 上传补充材料 ───────────────────────────────────────────
router.post("/:projectId/conversation/upload", requireAuth, upload.single("file"), async (req, res) => {
  const { projectId } = req.params;
  const own = _checkOwn(projectId, req.user.id);
  if (own.error) return res.status(own.status).json({ error: own.error });
  if (!req.file) return res.status(400).json({ error: "未上传文件" });

  try {
    enforceWorkspaceUploadLimits({
      userId: req.user.id,
      fileSize: req.file.size || 0,
      artifactRoot: ws.ARTIFACTS_ROOT,
    });
  } catch (err) {
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(err.status || 429).json({ error: err.message, code: err.code });
  }

  const conv = ws.createOrGetConversationByProject(projectId, req.user.id);
  const tmpPath = req.file.path;

  try {
    const { artifact, summary } = await persistWorkspaceUpload({
      file: req.file,
      conversationId: conv.id,
      scope: "project",
      userId: req.user.id,
    });

    if (artifact) {
      ws.appendMessage(conv.id, "system", null,
        `[补充材料] ${artifact.filename}\n摘要:${summary}`,
        { artifact_id: artifact.id }
      );
    }

    res.json({ artifact });
  } catch (err) {
    console.error("[ProjChat] 上传处理失败:", err);
    res.status(500).json({ error: err.message || "上传处理失败" });
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

// ── SSE 流式对话 ───────────────────────────────────────────
router.post("/:projectId/conversation/messages", requireAuth, workspaceRateLimit, async (req, res) => {
  const { projectId } = req.params;
  const userId = req.user.id;
  const own = _checkOwn(projectId, userId);
  if (own.error) return res.status(own.status).json({ error: own.error });

  const userMsg = (req.body?.content || "").toString().trim();
  if (!userMsg) return res.status(400).json({ error: "消息内容为空" });
  if (userMsg.length > 4000) return res.status(400).json({ error: "消息过长(限 4000 字)" });

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  const sendEvent = (event, data) => {
    if (res.destroyed || res.writableEnded) return false;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    return true;
  };
  const heartbeatTimer = setInterval(() => {
    sendEvent("heartbeat", { t: Date.now() });
  }, 15000);
  const ac = new AbortController();
  let completed = false;
  const abortIfOpen = () => {
    if (!completed) ac.abort();
  };
  req.on("close", abortIfOpen);

  const runId = require("crypto").randomBytes(16).toString("hex");

  try {
    const conv = ws.createOrGetConversationByProject(projectId, userId);

    const userMsgId = ws.appendMessage(conv.id, "user", null, userMsg);
    sendEvent("user_message", { id: userMsgId, content: userMsg });

    // 项目级 ctx:沿用 buildProjectContext,但传 latest_task_id 作为底层数据来源
    const project = own.project;
    const projectCtx = ws.buildEnhancedProjectContext(project.latest_task_id, conv.id, userMsg);
    const history = ws.listMessages(conv.id, 30).slice(0, -1);

    sendEvent("phase", { phase: "routing" });
    const routing = await ws.runHostRouting(projectCtx, history, userMsg);
    sendEvent("routing", routing);

    let expertOutputs = [];
    if (routing.agents?.length > 0) {
      sendEvent("phase", { phase: "experts", agents: routing.agents, run_id: runId });
      expertOutputs = await ws.runExpertsParallel(
        routing.agents, projectCtx, history, userMsg,
        (out) => {
          const eid = ws.appendMessage(conv.id, "agent", out.agent, out.content, { error: !!out.error, run_id: runId });
          sendEvent("expert", { id: eid, agent: out.agent, content: out.content, error: !!out.error, run_id: runId });
          sendEvent("expert_done", { id: eid, agent: out.agent, content: out.content, error: !!out.error, run_id: runId });
        }
      );
    }

    sendEvent("phase", { phase: "host", run_id: runId });
    await ws.runHostStreamingPhase({
      conv,
      projectCtx,
      history: ws.listMessages(conv.id, 30),
      userMsg,
      expertOutputs,
      runId,
      taskId: project.latest_task_id || null,
      userId,
      projectId: project.id,
      taskType: routing.task_type,
      routing,
      signal: ac.signal,
      sendEvent,
    });

    completed = true;
    sendEvent("done", { ok: true });
  } catch (err) {
    if (ac.signal.aborted || err?.message === "客户端取消") {
      console.warn("[ProjChat] SSE 连接已取消");
      return;
    }
    console.error("[ProjChat] SSE 错误:", err);
    let msg = err.message || "服务器错误";
    if (err?.status === 401 || err?.status === 403 || /认证失败|MINIMAX_API_KEY/.test(msg)) {
      msg = `LLM 调用失败:${msg}(请检查服务端 .env 中的 MINIMAX_API_KEY 是否有效)`;
    }
    sendEvent("error", { message: msg });
  } finally {
    completed = true;
    clearInterval(heartbeatTimer);
    req.removeListener("close", abortIfOpen);
    if (!res.destroyed && !res.writableEnded) res.end();
  }
});

module.exports = router;
