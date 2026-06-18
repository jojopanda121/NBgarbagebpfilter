#!/usr/bin/env node
/**
 * 实证探针：Kimi 公开 API 到底能不能调到「同花顺/天眼查」这类内部数据源？
 *
 * 用法：
 *   1. 在 .env 里填好 KIMI_API_KEY
 *   2. node scripts/probe-kimi-datasource.js
 *
 * 它发三组请求，分别验证 Kimi 那段「内部代码」里的关键断言：
 *   A. 把 tools 声明成 {type:"data_source", data_source:{name:"ifind"}} —— API 是否接受这个类型？
 *   B. 把 tools 声明成 {type:"builtin_function", function:{name:"ifind_get_stock_info"}} —— 这个内置函数存在吗？
 *   C. 纯自然语言让它查 600519.SH 同花顺基本信息 —— 看它是真查还是现编。
 *   D.（对照组）官方真实存在的 $web_search builtin —— 证明 key 本身有效、内置工具机制能跑通。
 */
const path = require("path");
// dotenv 在 server/node_modules 里；.env 在项目根
require(path.join(__dirname, "..", "server", "node_modules", "dotenv"))
  .config({ path: path.join(__dirname, "..", ".env") });

const API_KEY = process.env.KIMI_API_KEY;
const HOST = (process.env.KIMI_API_HOST || "https://api.moonshot.ai/v1").replace(/\/+$/, "");
const MODEL = process.env.KIMI_MODEL || "kimi-k2.6";
const ENDPOINT = /\/v1$/.test(HOST) ? `${HOST}/chat/completions` : `${HOST}/v1/chat/completions`;

if (!API_KEY) {
  console.error("✗ .env 里 KIMI_API_KEY 是空的，先填上再跑。");
  process.exit(1);
}

async function call(label, body) {
  process.stdout.write(`\n=== ${label} ===\n`);
  try {
    const resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, ...body }),
    });
    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); } catch (_) { json = null; }
    console.log("HTTP", resp.status);
    if (!resp.ok) {
      console.log("ERROR BODY:", JSON.stringify(json?.error || text).slice(0, 600));
      return;
    }
    const msg = json?.choices?.[0]?.message || {};
    console.log("finish_reason:", json?.choices?.[0]?.finish_reason);
    if (msg.tool_calls) console.log("tool_calls:", JSON.stringify(msg.tool_calls, null, 2).slice(0, 800));
    if (msg.content) console.log("content:", String(msg.content).slice(0, 800));
  } catch (e) {
    console.log("REQUEST FAILED:", e.message);
  }
}

(async () => {
  console.log("endpoint:", ENDPOINT, "| model:", MODEL);

  // A: Kimi 声称的 {type:"data_source"} —— 如果 API 直接 400，就证明这个工具类型是它编的
  await call("A. tools 声明 type:data_source (ifind)", {
    messages: [{ role: "user", content: "查 600519.SH 的基本信息" }],
    tools: [{ type: "data_source", data_source: { name: "ifind" } }],
  });

  // B: Kimi 声称的内部函数名当成 builtin_function
  await call("B. tools 声明 builtin_function: ifind_get_stock_info", {
    messages: [{ role: "user", content: "查 600519.SH 的基本信息" }],
    tools: [{ type: "builtin_function", function: { name: "ifind_get_stock_info" } }],
  });

  // C: 纯自然语言，无工具 —— 看它返回的数字是真是假
  await call("C. 纯自然语言查同花顺数据（无工具）", {
    messages: [
      { role: "system", content: "你是金融数据助手，使用同花顺(iFinD)数据源返回准确数据。" },
      { role: "user", content: "用同花顺数据返回 600519.SH 贵州茅台的注册资本(ths_reg_capital_stock)和最新股价，JSON 格式。" },
    ],
  });

  // D: 对照组 —— 官方真实存在的内置联网搜索
  await call("D. 对照组：官方 $web_search builtin", {
    messages: [{ role: "user", content: "贵州茅台今天的股价是多少？" }],
    tools: [{ type: "builtin_function", function: { name: "$web_search" } }],
  });
})();
