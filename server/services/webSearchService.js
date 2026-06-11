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
  return (config.kimiApiKey || "").trim();
}

function resolveKimiWebSearchEndpoint() {
  return resolveKimiChatEndpoint(config.kimiApiHost);
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
    { role: "system", content: "你是 Kimi。请使用联网搜索核验用户问题，并返回中文、可用于投研判断的简洁事实摘要。" },
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
  return results.slice(0, 10);
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
      `摘要: ${r.snippet}`,
    ].join("\n")),
  ].join("\n\n");
}

module.exports = {
  buildSearchQueries,
  runWebSearch,
  formatSearchContext,
  resolveKimiWebSearchEndpoint,
  searchWithKimi,
};
