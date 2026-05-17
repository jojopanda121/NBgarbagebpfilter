// ============================================================
// skills/projectBrief.js — 项目简报 3 页 deck
// 第二个 PPT 模板, 证明 harness 范式可复用.
// 加新模板照葫芦画瓢, 见 server/services/_HOW_TO_ADD_PPTX_TEMPLATE.md
// ============================================================

const path = require("path");
const fs = require("fs");

function _loadDeps() {
  return {
    tmpl: require("../services/project_brief"),
    ws: require("../services/workspaceService"),
  };
}

module.exports = {
  id: "project_brief",
  title: "项目简报 3 页 deck",
  description:
    "根据公司材料生成 3 页项目简报 PPT(封面 / 概况+亮点 / 风险+下一步). " +
    "适用于内部团队评估、IC 前置 brief、新项目立项介绍.",
  category: "report",
  outputArtifactKind: "pptx",
  pptxTemplate: {
    useCase:
      "3 页内部项目简报(封面 / 项目概况+4 亮点 / 3 风险+3 下一步). " +
      "适合: 内部团队评估、IC 前置 brief、新项目立项, 比 1 页速览更完整, 但比正式投决报告短.",
    pageCount: "exactly 3",
    argsHint:
      '<TOOL_CALL>{"id":"project_brief","args":{"materials":"<公司原始材料原文>","company_hint":"<公司全称>"}}</TOOL_CALL>',
  },
  inputSchema: {
    type: "object",
    properties: {
      materials: {
        type: "string",
        description: "目标公司原始材料(招股书/年报/调研笔记等). 留空则用 workspace 项目上下文.",
      },
      company_hint: {
        type: "string",
        description: "可选, 公司名提示",
      },
    },
    additionalProperties: false,
  },

  async run({ project, params, ctx }) {
    const { tmpl, ws } = _loadDeps();

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
      } catch { /* swallow; 没有项目上下文不阻塞 */ }
    }
    const materials = parts.join("\n\n").trim();
    if (materials.length < 20) {
      return {
        ok: false,
        error:
          "公司材料不足. 请在 materials 参数提供原始资料, 或先在 workspace 关联一个已分析的项目.",
      };
    }

    let result;
    try {
      result = await tmpl.generate(materials, { useSearch: true });
    } catch (err) {
      if (err.name === "TemplateSchemaError") {
        return { ok: false, error: `内容 JSON 不合 schema: ${err.message}` };
      }
      if (err.name === "TemplateRenderError") {
        return { ok: false, error: `渲染失败: ${err.message}` };
      }
      if (err.name === "LLMJsonValidationError") {
        return { ok: false, error: "LLM 输出无法通过 schema 校验" };
      }
      return { ok: false, error: `项目简报生成失败: ${err.message}` };
    }

    const { json, buffer, searchUsed } = result;
    const filename = tmpl.filename(json);

    let artifactRow = null;
    if (ctx?.conversationId) {
      const dir = path.join(ws.ARTIFACTS_ROOT, ctx.conversationId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const fullPath = path.join(dir, `${Date.now()}-${filename}`);
      require("../services/workspaceUploadLimits").enforceWorkspaceOutputLimits({
        userId: ctx.userId,
        sizeBytes: buffer.length,
        artifactRoot: ws.ARTIFACTS_ROOT,
      });
      fs.writeFileSync(fullPath, buffer);
      artifactRow = ws.insertArtifact({
        conversationId: ctx.conversationId,
        messageId: ctx.messageId || null,
        kind: "generated_pptx",
        filename: artifactRow?.filename || filename,
        storagePath: fullPath,
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        sizeBytes: buffer.length,
        summary: `项目简报 3 页 — ${json.company_full_name}`,
        userId: ctx.userId,
        artifactTitle: "项目简报",
      });
    }

    return {
      ok: true,
      artifact: {
        kind: "generated_pptx",
        filename,
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        sizeBytes: buffer.length,
        summary: `项目简报 3 页 — ${json.company_full_name}`,
        bufferBase64: buffer.toString("base64"),
        workspaceArtifactId: artifactRow?.id || null,
        payload: json,
        searchUsed,
      },
    };
  },
};
