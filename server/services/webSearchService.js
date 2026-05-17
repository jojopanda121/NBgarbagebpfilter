// ============================================================
// server/services/webSearchService.js
//
// Server-side MiniMax Coding Plan search for workspace agents.
// Keep search execution outside model-visible text so agents do not leak
// "I will call the search tool" messages into the chat.
// ============================================================

const config = require("../config");
const { resolveMinimaxSearchEndpoint: buildMinimaxSearchEndpoint } = require("../utils/minimaxEndpoints");

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

function getMinimaxSearchKey() {
  const key = (config.minimaxCodePlanKey || "").trim();
  if (key) return key;
  // OpenClaw documents MINIMAX_API_KEY as a compatibility fallback when it
  // already points at a coding-plan token.
  return (config.minimaxApiKey || "").trim();
}

function resolveMinimaxSearchEndpoint() {
  return buildMinimaxSearchEndpoint(config.minimaxApiHost);
}

function normalizeMinimaxResults(data) {
  const baseResp = data?.base_resp;
  if (baseResp && baseResp.status_code != null && baseResp.status_code !== 0) {
    throw new Error(`MiniMax Search API 错误 ${baseResp.status_code}: ${baseResp.status_msg || "unknown"}`);
  }
  const organic = Array.isArray(data?.organic)
    ? data.organic
    : Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data?.data?.organic)
        ? data.data.organic
        : [];
  return organic.slice(0, 8).map((item) => ({
    title: item.title || item.name || "",
    url: item.link || item.url || "",
    snippet: item.snippet || item.summary || item.description || "",
    source: "minimax",
    date: item.date || item.published_at || "",
  }));
}

async function searchWithMinimax(query, count = 5) {
  const key = getMinimaxSearchKey();
  if (!key || /你的|your|example|placeholder/i.test(key)) return [];
  const endpoint = resolveMinimaxSearchEndpoint();
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "MM-API-Source": "GarbageBPFilter-Workspace",
  };

  let resp = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ q: query }),
  });
  // Some MiniMax Coding Plan-compatible tools accept "query"; retry once for
  // compatibility without introducing a second provider.
  if (resp.status === 400 || resp.status === 422) {
    resp = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, count }),
    });
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`MiniMax Search 失败 (${resp.status}): ${text.slice(0, 160)}`);
  }
  const data = await resp.json();
  return normalizeMinimaxResults(data);
}

async function runWebSearch(queries = []) {
  const unique = [...new Set(queries.map(cleanQuery).filter(Boolean))].slice(0, 3);
  const results = [];
  for (const query of unique) {
    try {
      const items = await searchWithMinimax(query, 5);
      for (const item of items) results.push({ query, ...item });
    } catch (err) {
      console.warn("[WebSearch] 查询失败:", query, err.message);
    }
  }
  return results.slice(0, 10);
}

function formatSearchContext(results = []) {
  if (!results.length) return "";
  return [
    "# 后端实时检索结果",
    "以下结果由服务端搜索工具取得。请只把可核实事实融入结论，不要向用户描述工具调用过程。",
    ...results.map((r, idx) => [
      `## 结果 ${idx + 1}`,
      `查询: ${r.query}`,
      `标题: ${r.title}`,
      `链接: ${r.url}`,
      `摘要: ${r.snippet}`,
    ].join("\n")),
  ].join("\n\n");
}

module.exports = {
  buildSearchQueries,
  runWebSearch,
  formatSearchContext,
  resolveMinimaxSearchEndpoint,
};
