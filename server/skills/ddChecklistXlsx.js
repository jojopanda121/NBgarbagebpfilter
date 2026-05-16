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
    CATEGORY_LABEL[q.category] || q.category || "",
    String(q.priority || ""),
    q.question || "",
    q.evidence || "",
    q.expected_format || "",
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
  return {
    title,
    sheets: [
      {
        name: "尽调问题清单",
        headers: ["序号", "类别", "优先级", "问题", "触发依据", "期望材料"],
        rows: questionRows(payload),
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

    const q = await ddQuestions.run({ project, params });
    if (!q?.ok) return q;

    const payload = q.artifact?.payload;
    const rows = questionRows(payload);
    if (rows.length === 0) return { ok: false, error: "未生成任何尽调问题" };

    const ws = require("../services/workspaceService");
    const title = params.title || "尽调问题清单";
    const artifact = await ws.executeDocumentTool({
      tool: "generate_xlsx",
      args: buildWorkbookArgs(payload, title),
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
  },
};
