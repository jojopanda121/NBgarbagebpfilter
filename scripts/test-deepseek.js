#!/usr/bin/env node
// ============================================================
// scripts/test-deepseek.js — LLM + 检索连通性自检
//
// 用真实 key 验证两条链路都能通，再上生产：
//   1) DeepSeek 推理 : POST {host}/v1/chat/completions  （走翻译层 llmClient）
//   2) 联网检索      : POST {host}/v1/web-search        （走 webSearchService → 博查）
//
// 两条链路的 key 相互独立：DeepSeek 不提供检索，检索是博查这个独立供应商。
// 检索不通不影响推理，只是所有外部事实会退化为“待核实”。
//
// 用法：
//   node scripts/test-deepseek.js
//   （require ../server/config 时会自动加载项目根 .env：
//     DEEPSEEK_API_KEY / DEEPSEEK_API_HOST / DEEPSEEK_MODEL / BOCHA_API_KEY）
// ============================================================
const config = require("../server/config");
const { createLLMClient } = require("../server/utils/llmClient");
const { resolveLLMChatEndpoint } = require("../server/utils/llmEndpoints");
const { runWebSearch, resolveSearchEndpoint, isSearchConfigured } = require("../server/services/webSearchService");

function mask(key) {
  return key ? `${key.slice(0, 6)}…(${key.length} chars)` : "（空）";
}

async function main() {
  const key = config.deepseekApiKey;
  const host = config.deepseekApiHost;
  const model = config.deepseekModel;

  console.log("== 配置 ==");
  console.log("  LLM host    :", host);
  console.log("  LLM model   :", model, `(heavy: ${config.deepseekModelHeavy || model})`);
  console.log("  LLM key     :", key ? mask(key) : "（空！请先在 .env 设置 DEEPSEEK_API_KEY）");
  console.log("  chat        :", resolveLLMChatEndpoint(host));
  console.log("  search key  :", mask(config.searchApiKey));
  console.log("  search      :", resolveSearchEndpoint());
  if (!key) process.exit(1);

  let chatOk = false;
  let searchOk = false;

  // 1) DeepSeek 推理
  console.log("\n== [1/2] DeepSeek 推理 (chat/completions) ==");
  try {
    const llm = createLLMClient({ apiKey: key, baseURL: host });
    const resp = await llm.messages.create({
      model,
      max_tokens: 256,
      messages: [{ role: "user", content: "用一句话确认你能正常工作，并说出你的模型名。" }],
    });
    const thinking = (resp.content || []).filter((b) => b.type === "thinking").map((b) => b.thinking).join("");
    const text = (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    if (thinking) console.log("  · 收到 reasoning_content", `(${thinking.length} chars)`);
    console.log("  ✓ 回复:", text.slice(0, 200));
    console.log("  usage:", JSON.stringify(resp.usage || {}));
    chatOk = !!text;
    if (!text) console.warn("  ⚠ 只有思考没有正文，检查 max_tokens 是否够用");
  } catch (e) {
    console.error("  ✗ 失败:", e.message);
  }

  // 2) 联网检索
  console.log("\n== [2/2] 联网检索 (博查 web-search) ==");
  if (!isSearchConfigured()) {
    console.warn("  ⚠ 未配置 BOCHA_API_KEY，检索链路整体关闭（推理仍可用，但外部事实全部标待核实）");
  } else {
    try {
      const rows = await runWebSearch(["DeepSeek V4 模型 发布"]);
      if (rows.length) {
        console.log(`  ✓ 取得 ${rows.length} 条结果，首条:`);
        console.log("   ", rows[0].title, "—", rows[0].url);
        searchOk = true;
      } else {
        console.warn("  ⚠ 无结果（key 可能无效或余额不足）");
      }
    } catch (e) {
      console.error("  ✗ 失败:", e.message);
    }
  }

  console.log("\n== 结论 ==");
  console.log(`  DeepSeek 推理 : ${chatOk ? "通 ✓" : "不通 ✗"}`);
  console.log(`  联网检索      : ${searchOk ? "通 ✓" : (isSearchConfigured() ? "不通 ✗" : "未配置 —")}`);
  // 检索未配置不算失败：它是可选能力，推理通就能跑。
  process.exit(chatOk ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
