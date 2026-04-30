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
const { extractDocText } = require("../services/extractionService");
const ws = require("../services/workspaceService");

const router = Router();
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 50 * 1024 * 1024 } });

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

// ── 上传补充材料 ───────────────────────────────────────────
router.post("/:taskId/upload", requireAuth, upload.single("file"), async (req, res) => {
  const { taskId } = req.params;
  const own = checkTaskOwnership(taskId, req.user.id);
  if (own.error) return res.status(own.status).json({ error: own.error });
  if (!req.file) return res.status(400).json({ error: "未上传文件" });

  const conv = ws.createOrGetConversation(taskId, req.user.id);
  const tmpPath = req.file.path;
  const originalName = req.file.originalname;
  const ext = (path.extname(originalName) || "").slice(1).toLowerCase();
  const mode = ext === "pdf" ? "pdf" : ext === "pptx" ? "pptx" : null;

  try {
    let text = "";
    if (mode) {
      try { text = await extractDocText(tmpPath, mode); }
      catch (err) { console.warn("[Workspace] 提取失败:", err.message); }
    } else if (req.file.mimetype?.startsWith("text/")) {
      text = fs.readFileSync(tmpPath, "utf-8");
    }
    const summary = text ? await ws.summarizeUploadedText(text, originalName) : "（无法提取文本，仅记录文件名）";

    // 持久化原文件到 artifacts 目录
    const convDir = path.join(ws.ARTIFACTS_ROOT, conv.id);
    if (!fs.existsSync(convDir)) fs.mkdirSync(convDir, { recursive: true });
    const safeName = originalName.replace(/[\\/:*?"<>|]+/g, "_");
    const dest = path.join(convDir, `${Date.now()}-${safeName}`);
    fs.copyFileSync(tmpPath, dest);

    const art = ws.insertArtifact({
      conversationId: conv.id,
      kind: "upload",
      filename: originalName,
      storagePath: dest,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      summary,
    });

    // 写一条 system 消息把摘要落到对话里
    ws.appendMessage(conv.id, "system", null,
      `[补充材料] ${originalName}\n摘要：${summary}`,
      { artifact_id: art.id }
    );

    res.json({ artifact: art });
  } catch (err) {
    console.error("[Workspace] 上传处理失败:", err);
    res.status(500).json({ error: err.message || "上传处理失败" });
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

// ── 发送消息（SSE 流式） ───────────────────────────────────
router.post("/:taskId/messages", requireAuth, async (req, res) => {
  const { taskId } = req.params;
  const userId = req.user.id;
  const own = checkTaskOwnership(taskId, userId);
  if (own.error) return res.status(own.status).json({ error: own.error });

  const userMsg = (req.body?.content || "").toString().trim();
  if (!userMsg) return res.status(400).json({ error: "消息内容为空" });
  if (userMsg.length > 4000) return res.status(400).json({ error: "消息过长（限 4000 字）" });

  // SSE 头
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // 客户端断开监听
  const ac = new AbortController();
  req.on("close", () => { ac.abort(); });

  try {
    const conv = ws.createOrGetConversation(taskId, userId);

    // 写入 user 消息
    const userMsgId = ws.appendMessage(conv.id, "user", null, userMsg);
    sendEvent("user_message", { id: userMsgId, content: userMsg });

    const projectCtx = ws.buildProjectContext(taskId, conv.id);
    const history = ws.listMessages(conv.id, 30).slice(0, -1); // 不含刚加入的 user 消息

    // Step 1: routing
    sendEvent("phase", { phase: "routing" });
    const routing = await ws.runHostRouting(projectCtx, history, userMsg);
    sendEvent("routing", routing);

    // Step 2: experts
    let expertOutputs = [];
    if (routing.agents?.length > 0) {
      sendEvent("phase", { phase: "experts", agents: routing.agents });
      expertOutputs = await ws.runExpertsParallel(
        routing.agents, projectCtx, history, userMsg,
        (out) => {
          // 写入 agent 消息
          const eid = ws.appendMessage(conv.id, "agent", out.agent, out.content, { error: !!out.error });
          sendEvent("expert", { id: eid, agent: out.agent, content: out.content, error: !!out.error });
        }
      );
    }

    // Step 3: host 流式汇总
    sendEvent("phase", { phase: "host" });
    const hostMsgId = require("crypto").randomBytes(16).toString("hex");
    sendEvent("host_start", { id: hostMsgId });

    let fullText = "";
    await ws.streamHostSummary({
      projectCtx,
      history: ws.listMessages(conv.id, 30), // 包含刚写入的 expert
      userMsg,
      expertOutputs,
      signal: ac.signal,
      onDelta: (delta) => {
        fullText += delta;
        sendEvent("token", { id: hostMsgId, delta });
      },
    });

    // 解析 tool calls
    const toolCalls = ws.parseToolCalls(fullText);
    const cleanContent = ws.stripToolCalls(fullText) || fullText;

    // 持久化 host 消息（用上面预先生成的 hostMsgId）
    const db = getDb();
    db.prepare(
      `INSERT INTO workspace_messages (id, conversation_id, role, agent_name, content, metadata)
       VALUES (?, ?, 'agent', 'host', ?, ?)`
    ).run(
      hostMsgId, conv.id, cleanContent,
      JSON.stringify({ routing, tool_calls: toolCalls })
    );
    db.prepare("UPDATE workspace_conversations SET updated_at = datetime('now') WHERE id = ?")
      .run(conv.id);

    sendEvent("host_done", { id: hostMsgId, content: cleanContent });

    // 执行 tool calls
    if (toolCalls.length > 0) {
      sendEvent("phase", { phase: "tools", count: toolCalls.length });
      const results = await ws.executeToolCalls(toolCalls, {
        conversationId: conv.id,
        messageId: hostMsgId,
      });
      for (const r of results) {
        if (r.artifact) sendEvent("artifact", r.artifact);
        else sendEvent("tool_error", { tool: r.tool, error: r.error });
      }
    }

    sendEvent("done", { ok: true });
  } catch (err) {
    console.error("[Workspace] SSE 错误:", err);
    sendEvent("error", { message: err.message || "服务器错误" });
  } finally {
    res.end();
  }
});

module.exports = router;
