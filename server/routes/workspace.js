// ============================================================
// server/routes/workspace.js — 多 Agent 工作区路由（含 SSE）
// ============================================================

const { Router } = require("express");
const multer = require("multer");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { requireAuth } = require("../middleware/auth");
const { getDb } = require("../db");
const { getTask } = require("../services/taskService");
const ws = require("../services/workspaceService");
const { persistWorkspaceUpload } = require("../services/workspaceUploads");
const { workspaceRateLimit } = require("../middleware/workspaceQuota");
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


/** 校验任务归属：只有 owner 或 admin 可访问 */
function checkTaskOwnership(taskId, userId) {
  const task = getTask(taskId);
  if (!task) return { error: "任务不存在", status: 404 };
  const db = getDb();
  const user = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
  if (task.user_id !== userId && user?.role !== "admin") {
    return { error: "无权访问此项目工作区", status: 403 };
  }
  return { task };
}

// ── GET workspace agent/tool capabilities ───────────────────
router.get("/capabilities", requireAuth, (req, res) => {
  res.json(ws.listWorkspaceCapabilities());
});

// ── GET 历史消息 ────────────────────────────────────────────
router.get("/:taskId/messages", requireAuth, (req, res) => {
  const { taskId } = req.params;
  const own = checkTaskOwnership(taskId, req.user.id);
  if (own.error) return res.status(own.status).json({ error: own.error });

  const conv = ws.createOrGetConversation(taskId, req.user.id);
  const messages = ws.listMessages(conv.id);
  const artifacts = ws.listArtifacts(conv.id);
  res.json({ conversation_id: conv.id, messages, artifacts });
});

// ── GET artifacts ───────────────────────────────────────────
router.get("/:taskId/artifacts", requireAuth, (req, res) => {
  const { taskId } = req.params;
  const own = checkTaskOwnership(taskId, req.user.id);
  if (own.error) return res.status(own.status).json({ error: own.error });

  const conv = ws.createOrGetConversation(taskId, req.user.id);
  res.json({ artifacts: ws.listArtifacts(conv.id) });
});

// ── 下载 artifact ──────────────────────────────────────────
router.get("/:taskId/artifacts/:artifactId/download", requireAuth, (req, res) => {
  const { taskId, artifactId } = req.params;
  const own = checkTaskOwnership(taskId, req.user.id);
  if (own.error) return res.status(own.status).json({ error: own.error });

  const conv = ws.createOrGetConversation(taskId, req.user.id);
  const art = ws.getArtifact(artifactId);
  if (!art || art.conversation_id !== conv.id) {
    return res.status(404).json({ error: "文件不存在" });
  }
  if (!fs.existsSync(art.storage_path)) {
    return res.status(410).json({ error: "文件已被删除" });
  }
  res.download(art.storage_path, art.filename);
});

// ── 删除 artifact ──────────────────────────────────────────
router.delete("/:taskId/artifacts/:artifactId", requireAuth, (req, res) => {
  const { taskId, artifactId } = req.params;
  const own = checkTaskOwnership(taskId, req.user.id);
  if (own.error) return res.status(own.status).json({ error: own.error });

  const conv = ws.createOrGetConversation(taskId, req.user.id);
  const ok = ws.deleteArtifact(artifactId, conv.id);
  if (!ok) return res.status(404).json({ error: "文件不存在" });
  res.json({ ok: true });
});

// ── 上传补充材料 ───────────────────────────────────────────
router.post("/:taskId/upload", requireAuth, upload.single("file"), async (req, res) => {
  const { taskId } = req.params;
  const own = checkTaskOwnership(taskId, req.user.id);
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

  const conv = ws.createOrGetConversation(taskId, req.user.id);

  try {
    const { artifact } = await persistWorkspaceUpload({
      file: req.file,
      conversationId: conv.id,
      scope: "task",
      taskId,
      userId: req.user.id,
    });
    res.json({ artifact });
  } catch (err) {
    console.error("[Workspace] 上传处理失败:", err);
    res.status(500).json({ error: err.message || "上传处理失败" });
  } finally {
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
  }
});

// ── 按 scope 清空（chat | uploads | outputs | all） ────────
const VALID_CLEAR_SCOPES = new Set(["chat", "uploads", "outputs", "all"]);

router.delete("/:taskId/messages", requireAuth, (req, res) => {
  const { taskId } = req.params;
  const own = checkTaskOwnership(taskId, req.user.id);
  if (own.error) return res.status(own.status).json({ error: own.error });

  const scope = (req.query.scope || "chat").toString();
  if (!VALID_CLEAR_SCOPES.has(scope)) {
    return res.status(400).json({ error: `非法 scope: ${scope}` });
  }

  const conv = ws.createOrGetConversation(taskId, req.user.id);
  const result = ws.clearConversation(conv.id, scope);
  res.json({ ok: true, ...result });
});

// ── 发送消息（SSE 流式） ───────────────────────────────────
router.post("/:taskId/messages", requireAuth, workspaceRateLimit, upload.single("file"), async (req, res) => {
  const { taskId } = req.params;
  const userId = req.user.id;
  const own = checkTaskOwnership(taskId, userId);
  if (own.error) return res.status(own.status).json({ error: own.error });

  const userMsg = (req.body?.content || "").toString().trim();
  if (!userMsg && !req.file) return res.status(400).json({ error: "消息内容为空" });
  if (userMsg.length > 4000) return res.status(400).json({ error: "消息过长（限 4000 字）" });

  // SSE 头
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

  // 客户端断开监听
  const ac = new AbortController();
  let completed = false;
  const runId = require("crypto").randomBytes(16).toString("hex");
  const abortIfOpen = () => {
    if (!completed) ac.abort();
  };
  req.on("aborted", abortIfOpen);
  res.on("close", abortIfOpen);

  try {
    const conv = ws.createOrGetConversation(taskId, userId);
    let attached = null;
    if (req.file) {
      attached = await persistWorkspaceUpload({
        file: req.file,
        conversationId: conv.id,
        scope: "task",
        taskId,
        userId,
      });
    }

    // 写入 user 消息
    const attachmentLine = attached?.artifact ? `\n\n[附件] ${attached.artifact.filename}` : "";
    const displayUserMsg = `${userMsg || "请分析附件"}${attachmentLine}`;
    const userMsgId = ws.appendMessage(conv.id, "user", null, displayUserMsg, attached?.artifact ? {
      artifact_id: attached.artifact.id,
      filename: attached.artifact.filename,
    } : null);
    sendEvent("user_message", {
      id: userMsgId,
      content: displayUserMsg,
      artifact: attached?.artifact || null,
    });
    if (attached?.artifact) sendEvent("artifact", attached.artifact);

    const projectCtx = ws.buildEnhancedProjectContext(taskId, conv.id, userMsg);
    const history = ws.listMessages(conv.id, 30).slice(0, -1); // 不含刚加入的 user 消息
    const attachmentPrompt = attached?.artifact ? [
      "",
      "# 本轮用户随消息上传的附件",
      `文件名: ${attached.artifact.filename}`,
      `摘要: ${attached.summary}`,
      attached.text ? `正文摘录:\n${attached.text.length > 12000 ? attached.text.slice(0, 12000) + "\n...（附件正文已截断）" : attached.text}` : "正文不可提取。",
    ].join("\n") : "";
    const effectiveUserMsg = `${userMsg || "请分析附件"}${attachmentPrompt}`;

    // Step 1: routing
    sendEvent("phase", { phase: "routing" });
    const routing = await ws.runHostRouting(projectCtx, history, effectiveUserMsg);
    sendEvent("routing", routing);

    // ── Step 2: experts —— 真 thinking + 流式 ──────────────
    // 每位专家自己有 expert_msg_id；thinking/text 都按 (run_id, agent, msg_id) 分组流给前端。
    let expertOutputs = [];
    const expertMsgIds = {}; // agent -> stable msg id
    if (routing.agents?.length > 0) {
      sendEvent("phase", { phase: "experts", agents: routing.agents, run_id: runId });
      for (const a of routing.agents) {
        const eid = require("crypto").randomBytes(16).toString("hex");
        expertMsgIds[a] = eid;
        sendEvent("expert_start", { id: eid, agent: a, run_id: runId });
      }
      expertOutputs = await ws.runExpertsParallel(
        routing.agents, projectCtx, history, effectiveUserMsg,
        (out) => {
          const eid = expertMsgIds[out.agent] || require("crypto").randomBytes(16).toString("hex");
          // 落库：标 internal + run_id，正文存 content，thinking 存 metadata（可大）
          ws.appendMessage(conv.id, "agent", out.agent, out.content, {
            internal: true,
            run_id: runId,
            thinking: out.thinking || "",
            error: !!out.error,
          });
          sendEvent("expert_done", {
            id: eid,
            agent: out.agent,
            content: out.content,
            run_id: runId,
            error: !!out.error,
          });
        },
        {
          taskId, userId, runId,
          taskType: routing.task_type,
          signal: ac.signal,
          onEvent: (ev) => {
            const eid = expertMsgIds[ev.agent];
            if (!eid) return;
            if (ev.type === "thinking") {
              sendEvent("expert_thinking_delta", { id: eid, agent: ev.agent, run_id: runId, delta: ev.text });
            } else if (ev.type === "text") {
              sendEvent("expert_text_delta", { id: eid, agent: ev.agent, run_id: runId, delta: ev.text });
            }
          },
        }
      );
    }

    // ── Step 3: host —— thinking + tools 真 agentic (共享实现) ──
    sendEvent("phase", { phase: "host", run_id: runId });
    await ws.runHostStreamingPhase({
      conv: { ...conv, project_id: conv.project_id || own.task.workspace_project_id || null },
      projectCtx,
      history: ws.listMessages(conv.id, 30),
      userMsg: effectiveUserMsg,
      expertOutputs,
      runId,
      taskId,
      userId,
      projectId: conv.project_id || own.task.workspace_project_id || null,
      taskType: routing.task_type,
      routing,
      signal: ac.signal,
      sendEvent,
    });

    completed = true;
    sendEvent("done", { ok: true });
  } catch (err) {
    if (ac.signal.aborted || err?.message === "客户端取消") {
      console.warn("[Workspace] SSE 连接已取消");
      return;
    }
    console.error("[Workspace] SSE 错误:", err);
    // 给前端一个可读的中文错误，便于排查"无法对话"的根因
    let msg = err.message || "服务器错误";
    if (err?.status === 401 || err?.status === 403 || /认证失败|MINIMAX_API_KEY/.test(msg)) {
      msg = `LLM 调用失败：${msg}（请检查服务端 .env 中的 MINIMAX_API_KEY 是否有效）`;
    }
    sendEvent("error", { message: msg });
  } finally {
    completed = true;
    clearInterval(heartbeatTimer);
    req.removeListener("aborted", abortIfOpen);
    res.removeListener("close", abortIfOpen);
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    try { require("../services/memory/workingMemoryStore").clearWorkingMemory(runId); } catch {}
    if (!res.destroyed && !res.writableEnded) res.end();
  }
});

module.exports = router;
