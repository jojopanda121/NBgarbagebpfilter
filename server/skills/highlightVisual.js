const path = require("path");
const fs = require("fs");

function _loadDeps() {
  return {
    hv: require("../services/highlight_visual"),
    ws: require("../services/workspaceService"),
    augmentMaterialsWithEvidence: require("./_evidenceMaterial").augmentMaterialsWithEvidence,
  };
}

module.exports = {
  id: "highlight_visual",
  title: "一页纸项目亮点视觉图",
  description:
    "用结构化模板渲染一页投资亮点视觉信息图 PNG（藏蓝+香槟金品牌主色，与产品 UI 一致）。适合微信、邮件、FA 批量转发的视觉化项目摘要。",
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
      enable_bp_deep_parsing: {
        type: "boolean",
        description: "可选。兼容旧参数；上传材料结构化抽取现在会在上传后自动执行。",
      },
      enable_institutional_memory: {
        type: "boolean",
        description: "可选. 开启后注入机构历史先例 (K 编号). 默认走 env ENABLE_INSTITUTIONAL_MEMORY.",
      },
    },
    additionalProperties: false,
  },

  async run({ project, params, ctx, userId }) {
    const { hv, ws, augmentMaterialsWithEvidence } = _loadDeps();

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

    let materials = parts.join("\n\n").trim();
    if (materials.length < 20) {
      return {
        ok: false,
        error: "公司材料不足。请在 materials 参数提供原始资料文本，或先在 workspace 关联一个已分析的项目。",
      };
    }
    let evidenceMeta = {};
    try {
      const augmented = await augmentMaterialsWithEvidence({
        project,
        ctx,
        skillId: "highlight_visual",
        materials,
        companyHint: params.company_hint || "",
        enableBpDeepParsing: params.enable_bp_deep_parsing,
        enableInstitutionalMemory: params.enable_institutional_memory,
      });
      materials = augmented.materials;
      evidenceMeta = { ...(augmented.evidence || {}), searchQueries: augmented.searchQueries || [] };
    } catch (err) {
      console.warn("[highlight_visual] Evidence Pack 注入失败，继续使用原材料:", err.message);
    }

    let result;
    try {
      result = await hv.generateHighlightVisual(materials, {
        useSearch: !evidenceMeta.searchUsed,
        searchQueries: evidenceMeta.searchQueries || [],
      });
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
        mimeType: "image/png",
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
        mimeType: "image/png",
        sizeBytes: imageBuffer.length,
        summary: `亮点视觉图 — ${json?.brand?.company_name || "未命名项目"}`,
        bufferBase64: imageBuffer.toString("base64"),
        workspaceArtifactId: artifactRow?.id || null,
        payload: json,
        imagePrompt,
        searchUsed: searchUsed || !!evidenceMeta.searchUsed,
        evidence: {
          searchUsed: !!evidenceMeta.searchUsed,
          uploadCount: evidenceMeta.uploadCount || 0,
        },
      },
      // P3 fix-E：可观测指标统一放 result.metadata
      metadata: {
        evidence_search_used: !!(searchUsed || evidenceMeta.searchUsed),
        upload_facts_used: evidenceMeta.uploadCount || 0,
        upload_structured_used: !!evidenceMeta.uploadStructuredUsed,
        upload_structured_fact_count: evidenceMeta.uploadStructuredFactCount || 0,
        upload_structured_reason: evidenceMeta.uploadStructuredReason || null,
        institutional_memory_used: !!evidenceMeta.institutionalMemoryUsed,
        institutional_memory_count: evidenceMeta.institutionalMemoryCount || 0,
      },
    };
  },
};
