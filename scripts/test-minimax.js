#!/usr/bin/env node
// ============================================================
// scripts/test-minimax.js — MiniMax 连通性自检
//
// 用真实 MINIMAX_API_KEY 验证两条链路都能通，再上生产：
//   1) M3 推理      : POST {host}/v1/chat/completions   （走翻译层 llmClient）
//   2) 联网检索      : POST {host}/v1/coding_plan/search  （走 webSearchService）
//
// 用法：
//   node scripts/test-minimax.js
//   （require ../server/config 时会自动加载项目根 .env：
//     MINIMAX_API_KEY / MINIMAX_API_HOST / MINIMAX_MODEL）
// ============================================================
const config = require("../server/config");
const { createLLMClient } = require("../server/utils/llmClient");
const { resolveLLMChatEndpoint, resolveLLMSearchEndpoint } = require("../server/utils/llmEndpoints");
const { runWebSearch } = require("../server/services/webSearchService");

async function main() {
  const key = config.minimaxApiKey;
  const host = config.minimaxApiHost;
  const model = config.minimaxModel;

  console.log("== MiniMax 配置 ==");
  console.log("  host  :", host);
  console.log("  model :", model);
  console.log("  key   :", key ? `${key.slice(0, 6)}…(${key.length} chars)` : "（空！请先在 .env 设置 MINIMAX_API_KEY）");
  console.log("  chat  :", resolveLLMChatEndpoint(host));
  console.log("  search:", resolveLLMSearchEndpoint(host));
  if (!key) process.exit(1);

  let chatOk = false;
  let searchOk = false;

  // 1) M3 推理
  console.log("\n== [1/2] M3 推理 (chat/completions) ==");
  try {
    const llm = createLLMClient({ apiKey: key, baseURL: host });
    const resp = await llm.messages.create({
      model,
      max_tokens: 64,
      messages: [{ role: "user", content: "用一句话确认你能正常工作，并说出你的模型名。" }],
    });
    const text = (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    console.log("  ✓ 回复:", text.slice(0, 200));
    console.log("  usage:", JSON.stringify(resp.usage || {}));
    chatOk = true;
  } catch (e) {
    console.error("  ✗ 失败:", e.message);
  }

  // 2) 联网检索
  console.log("\n== [2/2] 联网检索 (coding_plan/search) ==");
  try {
    const rows = await runWebSearch(["MiniMax M3 model release"]);
    if (rows.length) {
      console.log(`  ✓ 取得 ${rows.length} 条结果，首条:`);
      console.log("   ", rows[0].title, "—", rows[0].url);
      searchOk = true;
    } else {
      console.warn("  ⚠ 无结果（key 可能没有 Token Plan 检索权限，或 coding_plan/search 未开通）");
    }
  } catch (e) {
    console.error("  ✗ 失败:", e.message);
  }

  console.log("\n== 结论 ==");
  console.log(`  M3 推理   : ${chatOk ? "通 ✓" : "不通 ✗"}`);
  console.log(`  联网检索  : ${searchOk ? "通 ✓" : "不通 ✗"}`);
  process.exit(chatOk && searchOk ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
