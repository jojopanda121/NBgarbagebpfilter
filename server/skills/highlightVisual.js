const path = require("path");
const fs = require("fs");

function _loadDeps() {
  return {
    hv: require("../services/highlight_visual"),
    ws: require("../services/workspaceService"),
  };
}

module.exports = {
  id: "highlight_visual",
  title: "一页纸项目亮点视觉图",
  description:
    "调用 MiniMax image-01 生成一页投资亮点视觉信息图 JPEG。适合微信、邮件、FA 批量转发的视觉化项目摘要。",
  category: "report",
  outputArtifactKind: "image",
  inputSchema: {
    type: "object",
    properties: {
      materials: {
        type: "string",
        description: "可选，公司原始材料；留空则用 workspace 项目上下文。",
      },
      company_hint: {
        type: "string",
        description: "可选，公司名提示。",
      },
    },
    additionalProperties: false,
  },

  async run({ project, params, ctx, userId }) {
    const { hv, ws } = _loadDeps();

    const parts = [];
    if (params.company_hint) parts.push(`【目标公司】${params.company_hint}`);
    if (params.materials && params.materials.trim()) {
      parts.push("【用户提供材料】", params.materials.trim());
    }
    if (project?.latest_task_id) {
      try {
        const projCtx = ws.buildProjectContext(project.latest_task_id, ctx?.conversationId);
        if (projCtx && !projCtx.includes("项目数据不存在")) {
          parts.push("【workspace 项目快照】", projCtx);
        }
      } catch (_) {
        // 项目上下文缺失不阻断，只要用户材料足够即可继续。
      }
    }

    const materials = parts.join("\n\n").trim();
    if (materials.length < 20) {
      return {
        ok: false,
        error: "公司材料不足。请在 materials 参数提供原始资料文本，或先在 workspace 关联一个已分析的项目。",
      };
    }

    let result;
    try {
      result = await hv.generateHighlightVisual(materials, { useSearch: true });
    } catch (err) {
      if (err.name === "LLMJsonValidationError") {
        return {
          ok: false,
          error: `LLM 输出无法通过视觉图 schema 校验（已重试 ${err.validationErrors?.length || 0} 次）`,
        };
      }
      return { ok: false, error: `亮点视觉图生成失败：${err.message}` };
    }

    const { json, imageBuffer, imagePrompt, searchUsed } = result;
    const filename = hv.buildFilename(json);

    let artifactRow = null;
    if (ctx?.conversationId) {
      const dir = path.join(ws.ARTIFACTS_ROOT, ctx.conversationId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const fullPath = path.join(dir, `${Date.now()}-${filename}`);
      require("../services/workspaceUploadLimits").enforceWorkspaceOutputLimits({
        userId,
        sizeBytes: imageBuffer.length,
        artifactRoot: ws.ARTIFACTS_ROOT,
      });
      fs.writeFileSync(fullPath, imageBuffer);
      artifactRow = ws.insertArtifact({
        conversationId: ctx.conversationId,
        messageId: ctx.messageId || null,
        kind: "generated_image",
        filename,
        storagePath: fullPath,
        mimeType: "image/jpeg",
        sizeBytes: imageBuffer.length,
        summary: `一页纸项目亮点视觉图 — ${json?.brand?.company_name || "未命名项目"}`,
        userId,
        artifactTitle: "亮点视觉图",
      });
    }

    return {
      ok: true,
      artifact: {
        kind: "generated_image",
        filename,
        mimeType: "image/jpeg",
        sizeBytes: imageBuffer.length,
        summary: `亮点视觉图 — ${json?.brand?.company_name || "未命名项目"}`,
        bufferBase64: imageBuffer.toString("base64"),
        workspaceArtifactId: artifactRow?.id || null,
        payload: json,
        imagePrompt,
        searchUsed,
      },
    };
  },
};
