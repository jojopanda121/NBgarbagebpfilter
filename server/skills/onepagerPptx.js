// ============================================================
// skills/onepagerPptx.js — 一页投资亮点 PPT
// 复用 pptService 的 LLM 抽取 + doc-service/pptxgenjs 双兜底渲染。
// 为 workspace 项目级调用提供包装:从 project.latest_task_id 取数据。
// ============================================================

const path = require("path");
const fs = require("fs");
// 服务模块懒加载,避免注册阶段触发 DB / config 链
function _loadDeps() {
  return {
    pptService: require("../services/pptService"),
    ws: require("../services/workspaceService"),
  };
}

module.exports = {
  id: "onepager_pptx",
  title: "一页投资亮点 PPT",
  description: "基于已完成的 BP 分析,生成一页可发给 LP/投委会的投资要点速览(.pptx)",
  category: "report",
  outputArtifactKind: "pptx",
  inputSchema: {
    type: "object",
    properties: {
      user_overrides: {
        type: "object",
        description: "可选,人工微调字段(如最新轮次/估值/重点客户),会覆盖 BP 抽取值",
        additionalProperties: true,
      },
      regenerate: { type: "boolean", description: "true 时清缓存重新生成" },
    },
    additionalProperties: false,
  },

  async run({ project, params, ctx }) {
    const taskId = project?.latest_task_id;
    if (!taskId) {
      return { ok: false, error: "项目无关联 BP 分析任务,请先上传并完成 BP 分析" };
    }

    const { pptService, ws } = _loadDeps();
    const cache = params.regenerate
      ? await pptService.regenerateOnePager(taskId, params.user_overrides || null)
      : await pptService.getOrGenerateOnePager(taskId, params.user_overrides || null, false);

    const pptxBuffer = await pptService.renderOnePagerPptx(cache.json);
    const filename = pptService.buildPptxFilename(cache.json.company_name);

    // 落盘到 workspace_artifacts(若有 conversationId 上下文)
    let artifactRow = null;
    if (ctx?.conversationId) {
      const dir = path.join(ws.ARTIFACTS_ROOT, ctx.conversationId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const fullPath = path.join(dir, `${Date.now()}-${filename}`);
      fs.writeFileSync(fullPath, pptxBuffer);
      artifactRow = ws.insertArtifact({
        conversationId: ctx.conversationId,
        messageId: ctx.messageId || null,
        kind: "generated_pptx",
        filename,
        storagePath: fullPath,
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        sizeBytes: pptxBuffer.length,
        summary: `一页投资亮点 PPT — ${cache.json.company_name}`,
      });
    }

    return {
      ok: true,
      artifact: {
        kind: "pptx",
        filename,
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        sizeBytes: pptxBuffer.length,
        summary: `一页 PPT — ${cache.json.company_name}`,
        // base64 给前端下载用(单页 PPT 通常 30-80KB,够小)
        bufferBase64: pptxBuffer.toString("base64"),
        workspaceArtifactId: artifactRow?.id || null,
        // 暴露 onepager JSON,前端可以做 in-app 预览
        payload: cache.json,
        searchUsed: cache.search_used,
        generatedAt: cache.generated_at,
      },
    };
  },
};
