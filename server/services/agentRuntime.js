// ============================================================
// server/services/agentRuntime.js
//
// Agent 执行入口 —— workspace 对话三步链路（routing / experts / host）
// 与 BP 上传 multiagent 管线（orchestrator.runAllAgents）。
//
// 历史说明：曾存在 Hermes 远端 runtime（agentRuntimeRouter + hermesClient），
// 已于 v3.x 移除，本文件是原 legacy 路径的直接收编，行为不变。
// ============================================================

const ws = require("./workspaceService");

/**
 * Workspace 对话主入口（routing → experts → host streaming）。
 *
 * @param {Object} args
 * @param {number} args.userId
 * @param {Object} args.conv             —— ws.createOrGetConversation 的返回
 * @param {string} args.taskId
 * @param {string} args.runId
 * @param {string} args.userMsg          —— 不含附件附加段的纯用户消息
 * @param {string} args.effectiveUserMsg —— 含附件附加段
 * @param {Object} args.projectCtx       —— ws.buildEnhancedProjectContext 结果
 * @param {Array}  args.history          —— 最近 30 条消息
 * @param {Object} args.ownTask          —— checkTaskOwnership 拿到的 task 对象
 * @param {AbortSignal} args.signal
 * @param {Function} args.sendEvent      —— (event, data) => bool
 */
async function runWorkspaceConversation(args) {
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

/**
 * BP 上传 multiagent 管线入口 —— 直接调用本地 orchestrator。
 */
async function runBpPipeline({ bpText, extractedData, taskId, userId }) {
  const orchestrator = require("../agents/orchestrator");
  return orchestrator.runAllAgents(bpText, extractedData, taskId, userId);
}

module.exports = {
  runWorkspaceConversation,
  runBpPipeline,
};
