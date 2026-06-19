// ============================================================
// server/services/webSearchService.js
//
// 服务端联网检索：走 MiniMax Token Plan 的 coding_plan/search HTTP 端点
// （即 minimax-coding-plan-mcp 里 web_search 工具底层调用的接口）。
// 把检索执行放在 model-visible 文本之外，避免 agent 把"我要调用搜索工具"
// 这类过程描述泄漏进对话。
//
// 端点：POST {host}/v1/coding_plan/search   body: { q }
//   响应：{ organic:[{title,link,snippet,date}], related_searches:[{query}],
//          base_resp:{status_code,status_msg} }   status_code !== 0 即错误。
// 与 M3 推理共用同一个 MINIMAX_API_KEY（Token Plan 订阅 key）。
// ============================================================

const config = require("../config");
const { resolveLLMSearchEndpoint } = require("../utils/llmEndpoints");
const { filterAndRankResults } = require("./retrievalDiscipline");

function cleanQuery(q = "") {
  return String(q)
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 120);
}

function buildSearchQueries(agentName, userMsg = "", projectCtx = "") {
  const company = (projectCtx.match(/公司:\s*([^\n]+)/) || [])[1]?.replace(/（未知）|—/g, "").trim();
  const industry = (projectCtx.match(/行业:\s*([^\n]+)/) || [])[1]?.replace(/（未知）|—/g, "").trim();
  const base = [company, industry].filter(Boolean).join(" ");
  const msg = userMsg.replace(/# 本轮用户随消息上传的附件[\s\S]*/g, "").slice(0, 160);

  if (agentName === "product_team_risk" || agentName === "risk") {
    return [
      `${base || msg} 监管 风险 处罚 诉讼`,
      `${base || msg} 创始人 负面 新闻 合规`,
    ].map(cleanQuery).filter(Boolean);
  }

  return [
    `${base || msg} 市场 规模 竞争格局 最新`,
    `${base || msg} 行业 政策 趋势 2026`,
  ].map(cleanQuery).filter(Boolean);
}

function getSearchKey() {
  return (config.minimaxApiKey || "").trim();
}

function resolveSearchEndpoint() {
  return resolveLLMSearchEndpoint(config.minimaxApiHost);
}

function normalizeMinimaxResults(query, data) {
  const organic = Array.isArray(data?.organic) ? data.organic : [];
  return organic
    .map((item) => ({
      title: item?.title || "",
      url: item?.link || item?.url || "",
      snippet: item?.snippet || "",
      source: "minimax_web_search",
      date: item?.date || "",
      query,
    }))
    .filter((r) => r.title || r.snippet || r.url);
}

async function searchWithMinimax(query) {
  const key = getSearchKey();
  if (!key || /你的|your|example|placeholder/i.test(key)) return [];
  const endpoint = resolveSearchEndpoint();
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "MM-API-Source": "Minimax-MCP",
    },
    body: JSON.stringify({ q: query }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`MiniMax search 失败 (${resp.status}): ${text.slice(0, 160)}`);
  }
  const data = await resp.json();
  const status = data?.base_resp?.status_code;
  if (status !== undefined && status !== 0) {
    throw new Error(`MiniMax search 业务错误 (${status}): ${data?.base_resp?.status_msg || ""}`);
  }
  return normalizeMinimaxResults(query, data);
}

async function runWebSearch(queries = []) {
  const unique = [...new Set(queries.map(cleanQuery).filter(Boolean))].slice(0, 3);
  const results = [];
  for (const query of unique) {
    try {
      const items = await searchWithMinimax(query);
      for (const item of items) results.push(item);
    } catch (err) {
      console.warn("[WebSearch] 查询失败:", query, err.message);
    }
  }
  return filterAndRankResults(results).slice(0, 10);
}

function formatSearchContext(results = []) {
  if (!results.length) return "";
  return [
    "# 后端实时检索结果（MiniMax web_search）",
    "以下结果由服务端 MiniMax coding_plan/search 取得。请综合成投研判断，不要向用户描述工具调用过程。",
    ...results.map((r, idx) => [
      `## 结果 ${idx + 1}`,
      `查询: ${r.query}`,
      `标题: ${r.title}`,
      `链接: ${r.url}`,
      r._source ? `来源可信度: ${r._source.label}(T${r._source.tier})` : "",
      `摘要: ${r.snippet}`,
    ].filter(Boolean).join("\n")),
  ].join("\n\n");
}

module.exports = {
  buildSearchQueries,
  runWebSearch,
  formatSearchContext,
  resolveSearchEndpoint,
  searchWithMinimax,
};
