// ============================================================
// server/services/agentRuntimeRouter.js
//
// Hermes-first Runtime with Legacy Backup —— 主路径 / fallback 决策中枢。
//
// 上游 routes/workspace.js 不再直接调 runHostRouting / runExpertsParallel /
// runHostStreamingPhase；它只调 router.runWorkspaceConversation()，
// 由本文件决定走 Hermes 还是 legacy。
//
// 关键规则（见 plan §3）：
//   - 流开始前失败（healthcheck / 建连 / 401 / 5xx）→ 自动 fallback legacy
//   - 流开始后失败（mid-stream 断流 / Hermes 内部错）→ 不切，前端收到友好错误
//   - SSE event name 与 legacy 完全兼容，前端无感
//   - 每次决策写 runtime_fallback_log
//
// 出境数据策略：
//   上下文原文出境，**不做脱敏**。脱敏会把公司名 / 创始人 / 财务数字等
//   替换成占位符，Hermes 就无法联网做竞品检索与横向对比，返回质量会塌。
//   合规由网络层（专线 / VPN）与 Hermes 侧访问控制兜底，不在应用层削数据。
// ============================================================

const { flags, useHermes, canFallback } = require("../config/featureFlags");
const hermesHealth = require("./hermesHealth");
const hermes = require("./hermesClient");
const fallbackLogger = require("./fallbackLogger");
const ws = require("./workspaceService");
const contextBuilder = require("./memory/contextBuilder");

const { TARGETS, REASONS, PHASES } = fallbackLogger;

/**
 * Workspace 对话主入口。
 *
 * @param {Object} args
 * @param {number} args.userId
 * @param {Object} args.conv             —— ws.createOrGetConversation 的返回
 * @param {string} args.taskId
 * @param {string} args.runId
 * @param {string} args.userMsg          —— 不含附件附加段的纯用户消息
 * @param {string} args.effectiveUserMsg —— legacy 链路使用：含附件附加段
 * @param {Object} args.projectCtx       —— ws.buildEnhancedProjectContext 结果
 * @param {Array}  args.history          —— 最近 30 条消息
 * @param {Object} args.ownTask          —— checkTaskOwnership 拿到的 task 对象
 * @param {AbortSignal} args.signal
 * @param {Function} args.sendEvent      —— (event, data) => bool
 */
async function runWorkspaceConversation(args) {
  const { userId, conv, signal, sendEvent } = args;
  const conversationId = conv.id;

  // 1. 检查主开关
  if (!useHermes()) {
    fallbackLogger.record({
      runtime: "legacy",
      reason: REASONS.HERMES_DISABLED,
      phase: PHASES.PRE_STREAM,
      target: TARGETS.WORKSPACE_CONVERSATION,
      userId, conversationId,
    });
    return runLegacy(args);
  }

  // 2. 请求前 healthcheck —— 读缓存（10s TTL），首次启动会同步探测一次
  const health = await hermesHealth.getFresh();
  if (health.status !== "ok") {
    if (!canFallback()) {
      // 不允许 fallback：直接报错
      sendEvent("error", { message: `AI 服务暂时不可用 (${health.reason || "unknown"})` });
      fallbackLogger.record({
        runtime: "hermes",
        reason: health.reason || REASONS.HEALTHCHECK_FAILED,
        phase: PHASES.PRE_STREAM,
        target: TARGETS.WORKSPACE_CONVERSATION,
        userId, conversationId,
        errorMessage: health.lastError ? String(health.lastError) : null,
      });
      return;
    }
    fallbackLogger.record({
      runtime: "legacy",
      reason: health.reason || REASONS.HEALTHCHECK_FAILED,
      phase: PHASES.PRE_STREAM,
      target: TARGETS.WORKSPACE_CONVERSATION,
      userId, conversationId,
      errorMessage: health.lastError ? String(health.lastError) : null,
    });
    return runLegacy(args);
  }

  // 3. 尝试 Hermes 主路径
  const start = Date.now();
  try {
    await runHermes(args);
    fallbackLogger.record({
      runtime: "hermes",
      phase: PHASES.PRE_STREAM,
      target: TARGETS.WORKSPACE_CONVERSATION,
      userId, conversationId,
      latencyMs: Date.now() - start,
    });
  } catch (err) {
    if (err && err.name === "HermesPreStreamError") {
      // pre-stream 失败 → 允许 fallback
      if (canFallback()) {
        fallbackLogger.record({
          runtime: "legacy",
          reason: err.reason,
          phase: PHASES.PRE_STREAM,
          target: TARGETS.WORKSPACE_CONVERSATION,
          userId, conversationId,
          latencyMs: Date.now() - start,
          errorMessage: err.message,
        });
        // 标记健康状态为 unhealthy，避免下一个请求又踩坑
        hermesHealth.probe().catch(() => {});
        return runLegacy(args);
      }
      fallbackLogger.record({
        runtime: "hermes",
        reason: err.reason,
        phase: PHASES.PRE_STREAM,
        target: TARGETS.WORKSPACE_CONVERSATION,
        userId, conversationId,
        latencyMs: Date.now() - start,
        errorMessage: err.message,
      });
      sendEvent("error", { message: `AI 服务暂时不可用 (${err.reason})` });
      return;
    }
    if (err && err.name === "HermesMidStreamError") {
      // mid-stream 失败 → 不切，记录并友好错误
      fallbackLogger.record({
        runtime: "hermes",
        reason: err.reason,
        phase: PHASES.MID_STREAM,
        target: TARGETS.WORKSPACE_CONVERSATION,
        userId, conversationId,
        latencyMs: Date.now() - start,
        errorMessage: err.message,
      });
      sendEvent("error", {
        message: "AI 响应中断，请重试。下一次请求会自动检测服务状态。",
      });
      // 立即标记 unhealthy，下个请求若主开关允许会走 legacy
      hermesHealth.probe().catch(() => {});
      return;
    }
    // 未知异常：当作 mid-stream 处理，不切
    fallbackLogger.record({
      runtime: "hermes",
      reason: "unknown",
      phase: PHASES.MID_STREAM,
      target: TARGETS.WORKSPACE_CONVERSATION,
      userId, conversationId,
      latencyMs: Date.now() - start,
      errorMessage: err?.message || String(err),
    });
    throw err;
  }
}

// ============================================================
// Hermes 主路径
// ============================================================
async function runHermes(args) {
  const { userId, conv, taskId, runId, userMsg, signal, sendEvent } = args;
  const conversationId = conv.id;
  let assistantText = "";

  sendEvent("phase", { phase: "hermes", run_id: runId });

  // 1. 拼上下文。
  //
  //   workspace.js 已经用 ws.buildEnhancedProjectContext() 拼好了
  //   富 BP 上下文（BP 快照、五维、claim_verdicts、深度研究、上传材料正文/BM25）。
  //   不调用方传入的 projectCtx 视为冷启动 / 老用户 fallback ——
  //   现场用同一函数补一份，确保 Hermes 永远不"瞎"。
  //
  //   contextBuilder 在此之上再叠加 memory 层（最近对话/用户偏好/skills/沉淀知识）。
  let projectContext = args.projectCtx;
  if (!projectContext) {
    try {
      projectContext = ws.buildEnhancedProjectContext(taskId, conversationId, userMsg);
    } catch (err) {
      console.warn("[router] buildEnhancedProjectContext fallback failed:", err.message);
      projectContext = null;
    }
  }

  const ctx = contextBuilder.build({
    userId,
    taskId,
    conversationId,
    userMsg,
    industry: args.industry || null,
    projectContext,
  });

  // 2. 上下文原文出境，不脱敏（理由见文件头）。
  const input = ctx.text;

  // 出境字节统计（监控用 + 排障 Hermes 是否拿到 BP 上下文）
  sendEvent("hermes_context_stats", {
    run_id: runId,
    bytes: Buffer.byteLength(input, "utf8"),
    project_context_bytes: ctx.stats.projectContextBytes || 0,
    history: ctx.stats.historyCount,
    skills: ctx.stats.skillCount,
    longterm: ctx.stats.longtermCount,
    institutional: ctx.stats.institutionalCount,
  });

  // 3. 调用 Hermes，流式收事件
  const emitDelta = (text) => {
    if (!text) return;
    sendEvent("host_text_delta", { run_id: runId, delta: text });
    assistantText += text;
  };

  const result = await hermes.streamResponse({
    userId,
    conversationId,
    input,
    signal,
    onEvent: (evt) => {
      switch (evt.type) {
        case "delta":
          emitDelta(evt.text || "");
          break;
        case "tool_call":
          sendEvent("tool_call", {
            run_id: runId,
            call_id: evt.call_id,
            name: evt.name,
            arguments: evt.arguments,
            done: evt.done,
          });
          break;
        case "tool_progress":
          sendEvent("tool_progress", { run_id: runId, data: evt.data });
          break;
        case "tool_result":
          sendEvent("tool_result", {
            run_id: runId,
            call_id: evt.call_id,
            output: evt.output,
          });
          break;
        case "completed":
          sendEvent("phase", { phase: "host_done", run_id: runId, response_id: evt.response_id });
          break;
        case "error":
          break;
      }
    },
  });

  // 落库
  if (assistantText) {
    ws.appendMessage(conv.id, "agent", "host", assistantText, {
      run_id: runId,
      runtime: "hermes",
      response_id: result.responseId || null,
    });
  }

  sendEvent("done", { ok: true, runtime: "hermes" });
}

// ============================================================
// Legacy fallback —— 直接复用现有 3 步链路
// ⚠️ DO NOT DELETE — Legacy execution path, retained as Hermes runtime fallback.
// Triggered by agentRuntimeRouter when Hermes is unreachable (pre-stream failures only).
// See plan: Hermes-first Runtime with Legacy Backup.
// ============================================================
async function runLegacy(args) {
  const {
    conv, taskId, userId, runId, effectiveUserMsg, projectCtx,
    history, ownTask, signal, sendEvent,
  } = args;

  // Step 1: routing
  sendEvent("phase", { phase: "routing", runtime: "legacy" });
  const routing = await ws.runHostRouting(projectCtx, history, effectiveUserMsg);
  sendEvent("routing", routing);

  // Step 2: experts
  let expertOutputs = [];
  const expertMsgIds = {};
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
        signal,
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

  // Step 3: host streaming
  sendEvent("phase", { phase: "host", run_id: runId });
  await ws.runHostStreamingPhase({
    conv: { ...conv, project_id: conv.project_id || ownTask?.workspace_project_id || null },
    projectCtx,
    history: ws.listMessages(conv.id, 30),
    userMsg: effectiveUserMsg,
    expertOutputs,
    runId,
    taskId,
    userId,
    projectId: conv.project_id || ownTask?.workspace_project_id || null,
    taskType: routing.task_type,
    routing,
    signal,
    sendEvent,
  });

  sendEvent("done", { ok: true, runtime: "legacy" });
}

// ============================================================
// BP Upload Pipeline 入口（Phase 2）
//
// Hermes 主路径：单次非流式调用，输入 BP 文本 + extractedData，
// 输出严格 6-field multiagent JSON。schema 校验失败 → fallback 旧 orchestrator。
//
// ⚠️ legacy orchestrator.runAllAgents 保留，不删除。
// ============================================================
async function runBpPipeline({ bpText, extractedData, taskId, userId, signal }) {
  const target = TARGETS.BP_PIPELINE;

  // 1. 主开关
  if (!useHermes()) {
    fallbackLogger.record({
      runtime: "legacy",
      reason: REASONS.HERMES_DISABLED,
      phase: PHASES.PRE_STREAM,
      target, userId,
    });
    return runLegacyBpPipeline({ bpText, extractedData, taskId, userId });
  }

  // 2. healthcheck
  const health = await hermesHealth.getFresh();
  if (health.status !== "ok") {
    if (!canFallback()) {
      fallbackLogger.record({
        runtime: "hermes",
        reason: health.reason || REASONS.HEALTHCHECK_FAILED,
        phase: PHASES.PRE_STREAM,
        target, userId,
        errorMessage: health.lastError ? String(health.lastError) : null,
      });
      throw new Error(`Hermes 不可用 (${health.reason})，fallback 已关闭`);
    }
    fallbackLogger.record({
      runtime: "legacy",
      reason: health.reason || REASONS.HEALTHCHECK_FAILED,
      phase: PHASES.PRE_STREAM,
      target, userId,
    });
    return runLegacyBpPipeline({ bpText, extractedData, taskId, userId });
  }

  // 3. 主路径
  const start = Date.now();
  try {
    const result = await runHermesBpPipeline({ bpText, extractedData, taskId, userId, signal });
    fallbackLogger.record({
      runtime: "hermes",
      phase: PHASES.PRE_STREAM,
      target, userId,
      latencyMs: Date.now() - start,
    });
    return result;
  } catch (err) {
    const reason = (err && err.reason) || "unknown";
    fallbackLogger.record({
      runtime: canFallback() ? "legacy" : "hermes",
      reason,
      phase: PHASES.PRE_STREAM,
      target, userId,
      latencyMs: Date.now() - start,
      errorMessage: err?.message || String(err),
    });
    if (canFallback()) {
      hermesHealth.probe().catch(() => {});
      return runLegacyBpPipeline({ bpText, extractedData, taskId, userId });
    }
    throw err;
  }
}

async function runHermesBpPipeline({ bpText, extractedData, taskId, userId, signal }) {
  const bpPipelineSchema = require("./bpPipelineSchema");

  // BP 全文 + 抽取数据原文出境，不脱敏（理由见文件头）。
  const input = [
    "# BP 全文",
    bpText || "",
    "",
    "# Agent A 抽取的结构化数据",
    JSON.stringify(extractedData || {}),
    "",
    "# 任务",
    "请按 bp_pipeline_playbook skill 的 schema 返回完整 6 字段 JSON。",
    "不要 markdown wrap。不要前缀说明。",
  ].join("\n");

  const { text, responseId } = await hermes.completeResponse({
    input,
    conversation: `bp_${taskId}`,
    signal,
  });

  // 解析 JSON
  let parsed;
  try {
    // 容忍模型偶尔加 ```json fence
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    parsed = JSON.parse(cleaned);
  } catch (err) {
    const e = new Error(`Hermes BP 输出 JSON 解析失败: ${err.message}`);
    e.reason = "schema_parse_failed";
    throw e;
  }

  // schema 校验
  const check = bpPipelineSchema.validate(parsed);
  if (!check.ok) {
    const e = new Error(`Hermes BP schema 校验失败: ${check.errors.join("; ")}`);
    e.reason = "schema_invalid";
    throw e;
  }

  // 包装成 legacy 兼容格式
  const { randomUUID } = require("crypto");
  const runId = randomUUID();

  // 挂 workspace project（与 orchestrator 同逻辑）
  let workspaceAttach = null;
  try {
    if (userId) {
      const workspaceProjectService = require("./workspaceProjectService");
      workspaceAttach = workspaceProjectService.createOrAttachProject({
        userId,
        taskId,
        agentRunId: runId,
        agentOutputs: {
          project_summary: parsed.project_summary,
          founder: parsed.founder_profile,
          financial: parsed.financial_analysis,
          competitor: parsed.competitor_analysis,
          valuation: parsed.valuation_analysis,
          red_flag: parsed.red_flags,
        },
      });
    }
  } catch (err) {
    console.warn("[Hermes BP] workspace attach failed:", err.message);
  }

  return {
    runId,
    multiagent: {
      run_id: runId,
      workspace_project_id: workspaceAttach?.projectId || null,
      workspace_version_number: workspaceAttach?.versionNumber || null,
      runtime: "hermes",
      response_id: responseId,
      project_summary: parsed.project_summary,
      founder_profile: parsed.founder_profile,
      financial_analysis: parsed.financial_analysis,
      competitor_analysis: parsed.competitor_analysis,
      valuation_analysis: parsed.valuation_analysis,
      red_flags: parsed.red_flags,
    },
  };
}

// ⚠️ DO NOT DELETE — Legacy execution path, retained as Hermes runtime fallback.
// See plan: Hermes-first Runtime with Legacy Backup.
async function runLegacyBpPipeline({ bpText, extractedData, taskId, userId }) {
  const orchestrator = require("../agents/orchestrator");
  return orchestrator.runAllAgents(bpText, extractedData, taskId, userId);
}

module.exports = {
  runWorkspaceConversation,
  runBpPipeline,
};
