// ============================================================
// skills/teaserShare.js — 给 Teaser payload 套加密分享链接
//
// 调用方式:先跑 teaser_generate 得到 payload,再调本 skill 包成可分享 URL。
// 也接受调用方直接传入 teaser_payload(允许人工微调后再分享)。
// ============================================================

// 懒加载,避免注册阶段初始化 db
function _deps() {
  return {
    teaserService: require("../services/teaserService"),
    teaserGenerate: require("./teaserGenerate"),
  };
}

module.exports = {
  id: "teaser_share",
  title: "加密 Teaser 分享链接",
  description: "把脱敏 teaser 加密成密码保护的链接,带过期 / 阅读次数 / 撤销 / 访问审计",
  category: "share",
  outputArtifactKind: "link",
  permissions: ["project:read", "share:create"],
  inputSchema: {
    type: "object",
    required: ["recipient_label"],
    additionalProperties: false,
    properties: {
      teaser_payload: {
        type: ["object", "null"],
        description: "可选,直接传入 teaser_generate 的 payload;不传则现场生成",
      },
      password: {
        type: "string",
        description: "可选,4-32 字符;不传则随机生成 8 字符",
      },
      ttl_hours: {
        type: "integer",
        minimum: 1,
        maximum: 24 * 30,
        description: "链接有效期(小时),默认 168(7 天)",
      },
      max_views: {
        type: "integer",
        minimum: 1,
        maximum: 1000,
        description: "可选,阅读次数上限",
      },
      recipient_label: {
        type: "string",
        minLength: 1,
        maxLength: 80,
        description: "给 owner 自己看的备注:'发给红杉张三'",
      },
      watermark_text: {
        type: "string",
        maxLength: 80,
        description: "可选,显示在 teaser 页角的水印(常用收件人邮箱后缀)",
      },
    },
  },

  async run({ project, params, userId }) {
    if (!project) return { ok: false, error: "需要项目上下文" };
    const { teaserService, teaserGenerate } = _deps();

    let payload = params.teaser_payload;
    if (!payload) {
      const gen = await teaserGenerate.run({ project, params: {} });
      if (!gen?.ok) return { ok: false, error: `teaser 生成失败:${gen?.error || "未知"}` };
      payload = gen.artifact.payload;
    }

    const share = teaserService.createShare({
      userId,
      projectId: project.id,
      payload,
      password: params.password,
      ttlHours: params.ttl_hours,
      maxViews: params.max_views,
      recipientLabel: params.recipient_label,
      watermarkText: params.watermark_text,
    });

    return {
      ok: true,
      artifact: {
        kind: "link",
        summary: `Teaser 分享 — ${params.recipient_label}`,
        payload: {
          token: share.token,
          url_path: share.url_path,
          password: share.password,    // 一次性返回明文密码,owner 自己负责传给收件人
          expires_at: share.expires_at,
          max_views: share.max_views,
          recipient_label: params.recipient_label,
        },
      },
      metadata: { teaser_codename: payload.codename },
    };
  },
};
