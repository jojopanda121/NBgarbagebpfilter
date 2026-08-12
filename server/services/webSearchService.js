// ============================================================
// server/services/webSearchService.js
//
// 服务端联网检索：走博查 Bocha Web Search API。
// DeepSeek API 不提供任何检索能力（既无检索端点也无内置工具），所以公开信息
// 检索独立成一个供应商，key 与 DEEPSEEK_API_KEY 无关。
//
// 端点：POST {host}/v1/web-search
//   body:     { query, count, summary, freshness }
//   响应：    { code, msg, data: { webPages: { value: [
//               { name, url, snippet, summary, siteName, datePublished } ] } } }
//   code !== 200 即错误。
//
// 把检索执行放在 model-visible 文本之外，避免 agent 把"我要调用搜索工具"
// 这类过程描述泄漏进对话。
//
// 未配置 BOCHA_API_KEY 时全部返回空数组：调用方（callLLMWithSearch /
// 各 skill）已有"无检索结果 → 标注待核实"的降级路径，不会阻塞分析流程。
// ============================================================

const config = require("../config");
const { resolveSearchEndpoint } = require("../utils/llmEndpoints");
const { filterAndRankResults } = require("./retrievalDiscipline");

// 单次查询取回条数。博查按次计费，与 runWebSearch 最终 slice(0,10) 配合，
// 单条查询给 10 条原始结果、再由 retrievalDiscipline 过滤排序。
const RESULTS_PER_QUERY = 10;

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
  return (config.searchApiKey || "").trim();
}

function isSearchConfigured() {
  const key = getSearchKey();
  return !!key && !/你的|your|example|placeholder/i.test(key);
}

function resolveSearchEndpointForConfig() {
  return resolveSearchEndpoint(config.searchApiHost);
}

function normalizeBochaResults(query, data) {
  const pages = data?.data?.webPages?.value || data?.webPages?.value;
  const rows = Array.isArray(pages) ? pages : [];
  return rows
    .map((item) => ({
      title: item?.name || item?.title || "",
      url: item?.url || item?.displayUrl || "",
      // summary 是博查的长摘要（summary:true 时才有），比 snippet 信息量大，优先用。
      snippet: item?.summary || item?.snippet || "",
      source: "bocha_web_search",
      siteName: item?.siteName || "",
      date: item?.datePublished || item?.dateLastCrawled || "",
      query,
    }))
    .filter((r) => r.title || r.snippet || r.url);
}

async function searchWithBocha(query) {
  if (!isSearchConfigured()) return [];
  const endpoint = resolveSearchEndpointForConfig();
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getSearchKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      count: RESULTS_PER_QUERY,
      summary: true,
      freshness: "noLimit",
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Bocha search 失败 (${resp.status}): ${text.slice(0, 160)}`);
  }
  const data = await resp.json();
  const code = data?.code;
  if (code !== undefined && Number(code) !== 200) {
    throw new Error(`Bocha search 业务错误 (${code}): ${data?.msg || data?.message || ""}`);
  }
  return normalizeBochaResults(query, data);
}

async function runWebSearch(queries = []) {
  if (!isSearchConfigured()) return [];
  const unique = [...new Set(queries.map(cleanQuery).filter(Boolean))].slice(0, 3);
  const results = [];
  for (const query of unique) {
    try {
      const items = await searchWithBocha(query);
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
    "# 后端实时检索结果（博查 Web Search）",
    "以下结果由服务端博查 Web Search API 取得。请综合成投研判断，不要向用户描述工具调用过程。",
    ...results.map((r, idx) => [
      `## 结果 ${idx + 1}`,
      `查询: ${r.query}`,
      `标题: ${r.title}`,
      `链接: ${r.url}`,
      r.siteName ? `站点: ${r.siteName}` : "",
      r.date ? `时间: ${r.date}` : "",
      r._source ? `来源可信度: ${r._source.label}(T${r._source.tier})` : "",
      `摘要: ${r.snippet}`,
    ].filter(Boolean).join("\n")),
  ].join("\n\n");
}

module.exports = {
  buildSearchQueries,
  runWebSearch,
  formatSearchContext,
  isSearchConfigured,
  resolveSearchEndpoint: resolveSearchEndpointForConfig,
  searchWithBocha,
};
