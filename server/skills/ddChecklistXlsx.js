// ============================================================
// skills/ddChecklistXlsx.js — 尽调问题清单 Excel 组合 skill
//
// Host 只调用这一个工具；后端内部完成:
//   1) dd_questions 生成结构化问题
//   2) generate_xlsx 写入 workspace artifact
//
// 这样不需要放宽 hostToolGuard 的"单轮最多 1 个工具调用"约束。
// ============================================================

const ddQuestions = require("./ddQuestions");

const CATEGORY_LABEL = {
  commercial: "商业/市场",
  technical: "产品/技术",
  financial: "财务/估值",
  legal: "法务/合规",
  founder: "团队/创始人",
};

function questionRows(payload) {
  const questions = Array.isArray(payload?.questions) ? payload.questions : [];
  return questions.map((q, idx) => [
    String(idx + 1),
    q.question || "",
    q.evidence || "",
    q.priority === 1 ? "高" : q.priority === 2 ? "中" : "低",
    q.expected_format || "",
    CATEGORY_LABEL[q.category] || q.category || "",
    q.verification_method || "",
    q.decision_standard || "",
    q.owner || "",
    q.status || "",
    Array.isArray(q.source_refs) ? q.source_refs.join(", ") : "",
  ]);
}

function categoryRows(payload) {
  const categories = Array.isArray(payload?.categories) ? payload.categories : [];
  return categories.map((c) => [
    CATEGORY_LABEL[c.key] || c.label || c.key || "",
    c.focus || "",
  ]);
}

function buildWorkbookArgs(payload, title) {
  const headers = [
    "序号", "核查事项", "核查原因 (基于 BP/上传材料/检索的存疑)",
    "优先级 (高/中/低)", "所需材料/数据", "类别",
    "验证方法", "判断标准", "负责人", "状态", "事实来源",
  ];
  return {
    title,
    sheets: [
      {
        name: "尽调问题清单",
        headers,
        rows: questionRows(payload),
      },
      {
        name: "高优先级问题",
        headers,
        rows: questionRows({
          questions: (payload?.questions || []).filter((q) => q.priority === 1),
        }),
      },
      {
        name: "类目重点",
        headers: ["类别", "关注重点"],
        rows: categoryRows(payload),
      },
      {
        name: "摘要",
        headers: ["项目", "内容"],
        rows: [
          ["摘要", payload?.summary || ""],
          ["说明", "priority: 1=不问不能投, 2=重点问, 3=补强信息"],
        ],
      },
    ],
  };
}

module.exports = {
  id: "dd_checklist_xlsx",
  title: "尽调问题清单 Excel",
  description: "一次调用生成结构化尽调追问清单并导出 Excel，内部复用 dd_questions + generate_xlsx",
  category: "artifact",
  outputArtifactKind: "xlsx",
  inputSchema: {
    type: "object",
    properties: {
      focus_areas: {
        type: "array",
        items: { type: "string", enum: ["commercial", "technical", "financial", "legal", "founder"] },
        description: "可选,只生成指定类目;空表示全部",
      },
      stage_context: {
        type: "string",
        description: "可选,如 '种子轮首谈' / 'A 轮投决前' — 影响问题侧重",
      },
      title: {
        type: "string",
        description: "可选, Excel 文件标题",
      },
    },
    additionalProperties: false,
  },

  async run({ project, params = {}, ctx = {}, userId }) {
    if (!project) return { ok: false, error: "需要项目上下文" };
    if (!ctx?.conversationId) return { ok: false, error: "需要 workspace conversation 上下文" };

    const q = await ddQuestions.run({ project, params, ctx, userId });
    if (!q?.ok) return q;

    const payload = q.artifact?.payload;
    const rows = questionRows(payload);
    if (rows.length === 0) return { ok: false, error: "未生成任何尽调问题" };

    const ws = require("../services/workspaceService");
    const title = params.title || "尽调问题清单";
    try {
      const artifact = await ws.executeDocumentTool({
        tool: "generate_xlsx",
        args: { ...buildWorkbookArgs(payload, title), artifactTitle: "尽调清单Excel" },
        conversationId: ctx.conversationId,
        messageId: ctx.messageId,
        userId: userId || ctx.userId,
      });

      return {
        ok: true,
        artifact,
        metadata: {
          question_count: rows.length,
          dd_questions_repairs: q.metadata?.llm_repairs || 0,
        },
      };
    } catch (err) {
      return {
        ok: true,
        artifact: {
          kind: "json",
          summary: `${rows.length} 条尽调问题(Excel 渲染失败,已降级为结构化数据)`,
          payload,
        },
        metadata: {
          question_count: rows.length,
          dd_questions_repairs: q.metadata?.llm_repairs || 0,
          degraded: true,
          degradation_reason: "xlsx_render_failed",
          xlsx_error: err.message,
        },
      };
    }
  },
};
