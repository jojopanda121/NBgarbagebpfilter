// ── 站点级 SEO 常量 ──
// 规范域名可通过构建期环境变量覆盖（REACT_APP_SITE_URL）。
// 注意：这些值在 `npm run build` 时被烘焙进静态产物（含 react-snap 预渲染）。

export const SITE_URL = (
  process.env.REACT_APP_SITE_URL || "https://www.garbagebpfilter.cn"
).replace(/\/+$/, "");

export const SITE_NAME = "垃圾BP过滤机";

export const DEFAULT_TITLE =
  "垃圾BP过滤机 — 一级市场投资人的 AI 尽调工作台";

export const DEFAULT_DESCRIPTION =
  "专为一级市场投资人打造的 AI 工作台：独创量化评分体系精准评估每份商业计划书（BP），AI 逐条击破虚假陈述，多 Agent 协同覆盖项目分析、尽职调查与投资备忘录全链路。把繁琐留给 AI，把判断留给自己。";

// 1200×630 社交分享图。建议提供 PNG 以获得最佳兼容性（微信/Twitter/LinkedIn）。
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`;

// 绝对化一个站内路径，用于 canonical / og:url。
export function absoluteUrl(path = "/") {
  if (/^https?:\/\//i.test(path)) return path;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
