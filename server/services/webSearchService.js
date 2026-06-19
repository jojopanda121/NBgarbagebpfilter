// ============================================================
// server/services/webSearchService.js
//
// Server-side Kimi official $web_search builtin tool for workspace agents.
// Keep search execution outside model-visible text so agents do not leak
// "I will call the search tool" messages into the chat.
// ============================================================

const config = require("../config");
const { resolveKimiChatEndpoint } = require("../utils/kimiEndpoints");

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

function getKimiSearchKey() {
  return (process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || "").trim();
}

function resolveKimiWebSearchEndpoint() {
  return resolveKimiChatEndpoint(process.env.KIMI_API_HOST || process.env.MOONSHOT_BASE_URL);
}

function normalizeKimiResult(query, output, usage = null) {
  if (!output) return [];
  return [{
    title: "Kimi $web_search result",
    url: "",
    snippet: String(output),
    source: "kimi_web_search",
    usage,
    date: "",
    query,
  }];
}

async function searchWithKimi(query) {
  const key = getKimiSearchKey();
  if (!key || /你的|your|example|placeholder/i.test(key)) return [];
  const endpoint = resolveKimiWebSearchEndpoint();
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const tools = [{ type: "builtin_function", function: { name: "$web_search" } }];
  const messages = [
    {
      role: "system",
      content:
        "你是 Kimi。请使用联网搜索核验用户问题，并返回中文、可用于投研判断的事实摘要。" +
        "硬性要求：每条事实必须标注来源（媒体/机构名 + 可点击 URL + 发布日期，格式如 [36氪 2025-08-12](https://...)），" +
        "无法给出来源的信息不要写入摘要。优先官方公告、主流财经媒体、研报，不引自媒体。",
    },
    { role: "user", content: query },
  ];

  for (let round = 0; round < 3; round++) {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.kimiModel || "kimi-k2.6",
        messages,
        tools,
        thinking: { type: "disabled" },
        max_tokens: 4096,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Kimi $web_search 失败 (${resp.status}): ${text.slice(0, 160)}`);
    }
    const data = await resp.json();
    const choice = data?.choices?.[0] || {};
    const message = choice.message || {};
    if (choice.finish_reason !== "tool_calls") {
      return normalizeKimiResult(query, message.content || "", data.usage || null);
    }
    messages.push(message);
    for (const toolCall of message.tool_calls || []) {
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        name: toolCall.function?.name || "$web_search",
        content: toolCall.function?.arguments || "{}",
      });
    }
  }

  throw new Error("Kimi $web_search 未在 3 轮内返回最终结果");
}

/**
 * Kimi 原生 agentic 检索对话 —— 深挖 Kimi 自带能力的核心入口。
 *
 * 与 searchWithKimi（单查询→摘要）不同：把**整个任务**（系统提示+用户输入）
 * 直接放在 Kimi OpenAI 兼容端点上执行，挂官方 builtin $web_search 工具，
 * 由 Kimi 自主决定"要不要搜、搜什么、搜几轮"（搜索在 Moonshot 服务端执行）。
 * 用于声明核查、深度研究等需要模型边查边判的场景，检索贴合每条声明本身，
 * 比服务端预检索注入的覆盖面和针对性都强。
 *
 * @param {object} p
 * @param {string} p.system      系统提示
 * @param {string} p.user        用户输入（任务全文）
 * @param {number} [p.maxTokens=6144]
 * @param {number} [p.maxRounds=8]  工具轮上限（每轮可含多次搜索）
 * @returns {Promise<{ text: string, searchUsed: boolean, searchRounds: number }>}
 * @throws 网络/HTTP 错误（调用方负责降级）
 */
async function kimiAgenticChatWithSearch({ system, user, maxTokens = 6144, maxRounds = 8 }) {
  const key = getKimiSearchKey();
  if (!key || /你的|your|example|placeholder/i.test(key)) {
    throw new Error("KIMI_API_KEY 未配置，无法使用 Kimi 原生检索");
  }
  const endpoint = resolveKimiWebSearchEndpoint();
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const tools = [{ type: "builtin_function", function: { name: "$web_search" } }];
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  let searchRounds = 0;
  for (let round = 0; round < maxRounds; round++) {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.kimiModel || "kimi-k2.6",
        messages,
        tools,
        thinking: { type: "disabled" },
        max_tokens: maxTokens,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Kimi agentic search 失败 (${resp.status}): ${text.slice(0, 160)}`);
    }
    const data = await resp.json();
    const choice = data?.choices?.[0] || {};
    const message = choice.message || {};
    if (choice.finish_reason !== "tool_calls") {
      return {
        text: String(message.content || ""),
        searchUsed: searchRounds > 0,
        searchRounds,
      };
    }
    // builtin $web_search：把工具调用参数原样回灌，搜索由 Moonshot 服务端执行
    searchRounds++;
    messages.push(message);
    for (const toolCall of message.tool_calls || []) {
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        name: toolCall.function?.name || "$web_search",
        content: toolCall.function?.arguments || "{}",
      });
    }
  }
  throw new Error(`Kimi agentic search 未在 ${maxRounds} 轮内收敛`);
}

const { filterAndRankResults } = require("./retrievalDiscipline");

async function runWebSearch(queries = []) {
  const unique = [...new Set(queries.map(cleanQuery).filter(Boolean))].slice(0, 3);
  const results = [];
  for (const query of unique) {
    try {
      const items = await searchWithKimi(query);
      for (const item of items) results.push({ query, ...item });
    } catch (err) {
      console.warn("[WebSearch] 查询失败:", query, err.message);
    }
  }
  // 检索纪律：丢弃命理/玄学/SEO 农场，按来源可信度排序去重（官方>财经媒体>行研>其他）
  return filterAndRankResults(results).slice(0, 10);
}

function formatSearchContext(results = []) {
  if (!results.length) return "";
  return [
    "# 后端实时检索结果（Kimi web_search）",
    "以下结果由服务端 Kimi 官方 $web_search 内置工具取得。请综合成投研判断，不要向用户描述工具调用过程。",
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
  resolveKimiWebSearchEndpoint,
  searchWithKimi,
  kimiAgenticChatWithSearch,
};
