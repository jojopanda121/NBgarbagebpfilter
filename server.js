// ============================================================
// server.js - 一体式服务：前端静态资源 + MiniMax 对话 API + 联网搜索 + 辩证法裁决
// 只需一条命令：npm run build && npm start，然后访问 http://localhost:3000
// ============================================================

require("dotenv").config();

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const os = require("os");

const BUILD_DIR = path.join(__dirname, "build");
const SCRIPT_DIR = path.join(__dirname, "scripts");
const PDF_TO_TEXT_SCRIPT = path.join(SCRIPT_DIR, "pdf_to_text.py");
// Zeabur 默认暴露 8080；本地开发可用 PORT=3000
const PORT = parseInt(process.env.PORT, 10) || 8080;

// ── MiniMax 配置 ──
if (!process.env.MINIMAX_API_KEY) {
  console.error(
    "[FATAL] 环境变量 MINIMAX_API_KEY 未设置！AI 分析功能将无法使用。请在 Zeabur 控制台 → 环境变量中配置该变量。"
  );
}
if (!process.env.SERPER_API_KEY) {
  console.warn(
    "[WARN] 环境变量 SERPER_API_KEY 未设置，联网搜索将以 Mock 模式运行（不影响 AI 分析）。"
  );
}

const CONFIG = {
  baseUrl: process.env.MINIMAX_BASE_URL || "https://api.minimax.io",
  apiPath: "/anthropic/v1/messages",
  apiKey: process.env.MINIMAX_API_KEY || "",
  model: process.env.MINIMAX_MODEL || "MiniMax-M2.5",
};

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

// ══════════════════════════════════════════════════════════════
// Promise 版 HTTPS 请求工具
// ══════════════════════════════════════════════════════════════

function httpsPost(url, data, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const postData = typeof data === "string" ? data : JSON.stringify(data);
    const options = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
        ...extraHeaders,
      },
    };
    const req = https.request(options, (proxyRes) => {
      let body = "";
      proxyRes.on("error", reject);
      proxyRes.on("data", (chunk) => (body += chunk));
      proxyRes.on("end", () =>
        resolve({ statusCode: proxyRes.statusCode, body })
      );
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (proxyRes) => {
        let body = "";
        proxyRes.on("error", reject);
        proxyRes.on("data", (chunk) => (body += chunk));
        proxyRes.on("end", () =>
          resolve({ statusCode: proxyRes.statusCode, body })
        );
      })
      .on("error", reject);
  });
}

// ══════════════════════════════════════════════════════════════
// 联网搜索服务 — 支持 Serper.dev / SerpAPI
// ══════════════════════════════════════════════════════════════

async function searchWithSerper(query, numResults = 5) {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];
  try {
    const resp = await httpsPost(
      "https://google.serper.dev/search",
      { q: query, num: numResults, gl: "cn", hl: "zh-cn" },
      { "X-API-KEY": key }
    );
    const data = JSON.parse(resp.body);
    return (data.organic || []).slice(0, numResults).map((r) => ({
      title: r.title || "",
      snippet: r.snippet || "",
      url: r.link || "",
      date: r.date || "",
    }));
  } catch (e) {
    console.error("Serper 搜索失败:", e.message);
    return [];
  }
}

async function searchWithSerpApi(query, numResults = 5) {
  const key = process.env.SERPAPI_KEY;
  if (!key) return [];
  try {
    const params = new URLSearchParams({
      q: query,
      api_key: key,
      engine: "google",
      num: String(numResults),
      gl: "cn",
      hl: "zh-cn",
    });
    const resp = await httpsGet(
      `https://serpapi.com/search.json?${params}`
    );
    const data = JSON.parse(resp.body);
    return (data.organic_results || []).slice(0, numResults).map((r) => ({
      title: r.title || "",
      snippet: r.snippet || "",
      url: r.link || "",
      date: r.date || "",
    }));
  } catch (e) {
    console.error("SerpAPI 搜索失败:", e.message);
    return [];
  }
}

async function webSearch(query, numResults = 5) {
  if (process.env.SERPER_API_KEY)
    return searchWithSerper(query, numResults);
  if (process.env.SERPAPI_KEY)
    return searchWithSerpApi(query, numResults);
  return [];
}

function isSearchEnabled() {
  return !!(process.env.SERPER_API_KEY || process.env.SERPAPI_KEY);
}

// ══════════════════════════════════════════════════════════════
// MiniMax API 调用
// ══════════════════════════════════════════════════════════════

// 直接写入 HTTP Response 的版本 — 同时返回 text + thinking
function callMiniMax(reqBody, res) {
  const { messages, system, max_tokens } = reqBody;
  if (!CONFIG.apiKey) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "未配置 MINIMAX_API_KEY，请在 .env 中设置",
      })
    );
    return;
  }

  const postData = JSON.stringify({
    model: CONFIG.model,
    max_tokens: max_tokens || 32768,
    ...(system ? { system } : {}),
    messages,
  });

  const url = new URL(CONFIG.baseUrl + CONFIG.apiPath);
  const options = {
    hostname: url.hostname,
    port: 443,
    path: url.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CONFIG.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Length": Buffer.byteLength(postData),
    },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    let body = "";
    proxyRes.on("error", (e) => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    proxyRes.on("data", (chunk) => (body += chunk));
    proxyRes.on("end", () => {
      if (res.headersSent) return;
      try {
        const data = JSON.parse(body);

        const text = (data.content || [])
          .map((b) => b.text || "")
          .filter(Boolean)
          .join("\n");

        // 提取 thinking 字段（M2.5 深度思考）
        const thinking = (data.content || [])
          .map((b) => b.thinking || "")
          .filter(Boolean)
          .join("\n");

        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(
          JSON.stringify({
            text,
            thinking,
            stop_reason: data.stop_reason,
            raw: data,
          })
        );
      } catch (e) {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "解析 MiniMax 返回失败", body })
          );
        }
      }
    });
  });

  proxyReq.on("error", (e) => {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });

  proxyReq.write(postData);
  proxyReq.end();
}

// Promise 版 — 返回 { text, thinking } 对象
function callMiniMaxAsync(messages, system, maxTokens = 32768) {
  return new Promise((resolve, reject) => {
    if (!CONFIG.apiKey)
      return reject(new Error("未配置 MINIMAX_API_KEY"));

    const postData = JSON.stringify({
      model: CONFIG.model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages,
    });

    const url = new URL(CONFIG.baseUrl + CONFIG.apiPath);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CONFIG.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (proxyRes) => {
      let body = "";
      proxyRes.on("error", reject);
      proxyRes.on("data", (chunk) => (body += chunk));
      proxyRes.on("end", () => {
        try {
          const data = JSON.parse(body);
          if (data.error) {
            return reject(
              new Error(
                data.error.message || JSON.stringify(data.error)
              )
            );
          }

          const text = (data.content || [])
            .map((b) => b.text || "")
            .filter(Boolean)
            .join("\n");

          // 提取 thinking 字段
          const thinking = (data.content || [])
            .map((b) => b.thinking || "")
            .filter(Boolean)
            .join("\n");

          resolve({ text, thinking });
        } catch (e) {
          reject(
            new Error(
              "解析 MiniMax 返回失败: " + body.slice(0, 300)
            )
          );
        }
      });
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

// ══════════════════════════════════════════════════════════════
// 联网搜索 API — 批量搜索
// ══════════════════════════════════════════════════════════════

function handleWebSearch(req, res) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      const { queries } = JSON.parse(body);
      if (!Array.isArray(queries) || queries.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({ error: "queries 必须是非空数组" })
        );
      }
      // 并行搜索（最多 12 个查询）
      const limited = queries.slice(0, 12);
      const results = {};
      await Promise.all(
        limited.map(async (q) => {
          results[q] = await webSearch(q, 5);
        })
      );
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(
        JSON.stringify({ results, searchEnabled: isSearchEnabled() })
      );
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

// ══════════════════════════════════════════════════════════════
// 提取关键声明 — 从 BP 中识别需要联网验证的信息
// ══════════════════════════════════════════════════════════════

function handleExtractClaims(req, res) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      const { bpText } = JSON.parse(body);
      if (!bpText || bpText.length < 30) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({ error: "bpText 内容太短" })
        );
      }

      const extractPrompt = `分析以下商业计划书(BP)，提取所有需要联网验证的关键声明。对每个声明，生成一个适合搜索引擎搜索的中文查询词。

只输出合法JSON对象，从{开始到}结束，不要任何其他文字或markdown代码块：
{"companyName":"公司名","industry":"行业","searchQueries":[{"category":"company","query":"公司名 融资 估值","claim":"BP声称..."},{"category":"market","query":"行业 市场规模 2024","claim":"BP声称市场规模..."},{"category":"tech","query":"技术关键词 原理 可行性","claim":"BP声称技术..."},{"category":"team","query":"创始人姓名 背景 经历","claim":"BP声称团队..."},{"category":"competition","query":"行业 竞争格局 竞品","claim":"BP声称竞品..."},{"category":"policy","query":"行业 政策 监管 合规","claim":"涉及的政策..."},{"category":"financial","query":"公司名 营收 财务","claim":"BP声称的财务数据..."}]}

要求：
- 生成 8-15 个搜索查询，覆盖 company/market/tech/team/competition/policy/financial 各类别
- 查询词要具体可搜，适合 Google / 百度
- 如果 BP 提到具体人名、公司名、技术名词、数据来源，务必包含在查询中
- 每个 claim 简要说明 BP 中的相关声称（20-50字）
- 只输出 JSON，不要任何其他文字

## BP 内容（前 10000 字）：
${bpText.slice(0, 10000)}`;

      const { text } = await callMiniMaxAsync(
        [{ role: "user", content: extractPrompt }],
        "你是信息提取专家。从商业计划书中提取需要联网验证的关键声明和实体，生成搜索查询词。只输出JSON。",
        4096
      );

      let claims;
      try {
        let str = text.trim();
        const codeBlock = str.match(
          /```(?:json)?\s*([\s\S]*?)```/
        );
        if (codeBlock) str = codeBlock[1].trim();
        const startIdx = str.indexOf("{");
        if (startIdx >= 0) str = str.slice(startIdx);
        const endIdx = str.lastIndexOf("}");
        if (endIdx >= 0) str = str.slice(0, endIdx + 1);
        claims = JSON.parse(str);
      } catch (e) {
        console.warn(
          "提取声明 JSON 解析失败，使用空结果:",
          e.message
        );
        claims = {
          companyName: "",
          industry: "",
          searchQueries: [],
        };
      }

      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ claims }));
    } catch (e) {
      console.error("提取声明失败:", e.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

// ══════════════════════════════════════════════════════════════
// 辩证法裁决引擎 — /api/verdict
// 三步走架构的核心：接收 BP声明 + 搜索证据 → 冲突计算 → 法官裁决
// ══════════════════════════════════════════════════════════════

function handleVerdict(req, res) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      const { bpClaims, searchEvidence, bpFullText } = JSON.parse(body);

      if (!bpClaims || !Array.isArray(bpClaims)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({ error: "bpClaims 必须是数组" })
        );
      }

      // ── 构造甲方主张 ──
      const claimsBlock = bpClaims
        .map((c, i) => `${i + 1}. [${c.category}] ${c.claim}`)
        .join("\n");

      // ── 构造乙方证据 ──
      let evidenceBlock =
        "（未启用联网搜索，以下为 AI 内置知识的判断）";
      if (
        searchEvidence &&
        Object.keys(searchEvidence).length > 0
      ) {
        const lines = [];
        for (const [query, results] of Object.entries(
          searchEvidence
        )) {
          if (results && results.length > 0) {
            lines.push(`\n搜索: "${query}"`);
            results.forEach((r, j) => {
              lines.push(
                `  ${j + 1}. [${r.title}] ${r.snippet} (${r.url})`
              );
            });
          }
        }
        if (lines.length > 0) {
          evidenceBlock = lines.join("\n");
        }
      }

      // ── 辩证法裁决 Prompt ──
      const verdictPrompt = `你是一名残酷且极度精确的投资尽调法官。你的任务不是总结信息，而是进行"事实核查 (Fact Check)"和"冲突计算 (Conflict Calculation)"。

现在有两组对立信息。你必须像法官审案一样，逐条裁决。

<BP_CLAIMS>
${claimsBlock}
</BP_CLAIMS>

<SEARCH_EVIDENCE>
${evidenceBlock}
</SEARCH_EVIDENCE>

${bpFullText ? `<BP_FULL_TEXT_EXCERPT>\n${bpFullText.slice(0, 30000)}\n</BP_FULL_TEXT_EXCERPT>` : ""}

## 裁决规则（冲突计算逻辑）

对每个维度执行以下判定：

1. **提取差异 (Diff)**：BP声称X，证据显示Y，差异是多少？
2. **判断性质 (Judgment)**：
   - BP数据 ≈ 搜索证据（±20%以内）→ 判定【诚实】→ 得分 8-10
   - BP数据 > 搜索证据 2-5倍 → 判定【夸大】→ 得分 3-5
   - BP数据 > 搜索证据 5倍以上 → 判定【严重夸大】→ 得分 0-2
   - BP隐瞒了搜索到的竞品 → 判定【信息不对称/欺诈】→ 得分 0-1
   - 搜索结果显示该技术已被淘汰 → 判定【技术证伪】→ 一票否决
   - 搜索无相关结果且BP数据无法验证 → 判定【存疑】→ 得分 4-6
3. **生成判决书**：必须引用 SEARCH_EVIDENCE 中的具体来源来驳斥或支持 BP_CLAIMS

## 输出格式

只输出合法JSON，不要任何其他文字：
{
  "projectName": "项目名",
  "oneLiner": "一句话总结（不超30字）",
  "stage": "天使轮|种子轮|A轮成长期|B轮+中后期",
  "stageReason": "判断依据",
  "knockout": false,
  "knockoutReason": "",
  "dimensions": [
    {
      "id": "market_size",
      "name": "市场规模真实性",
      "subtitle": "TAM/SAM 数据核实",
      "score": 7,
      "conflictLevel": "诚实|夸大|严重夸大|信息不对称|技术证伪|存疑",
      "bpClaim": "BP第X页声称：具体引用原文...",
      "searchEvidence": "搜索到的具体证据，引用来源标题和数据...",
      "diff": "BP说1000亿 vs 证据显示150亿，差异6.7倍",
      "verdict": "法官裁决：为什么给这个分，证据如何打脸或支持BP，逻辑推导过程...",
      "reasoning": "综合评分理由，至少80字"
    },
    {
      "id": "valuation",
      "name": "估值合理性",
      "subtitle": "PS/PE 对标分析",
      "score": 5,
      "conflictLevel": "",
      "bpClaim": "",
      "searchEvidence": "",
      "diff": "",
      "verdict": "",
      "reasoning": ""
    },
    {
      "id": "tech_feasibility",
      "name": "技术可行性",
      "subtitle": "原理与工程验证",
      "score": 7,
      "conflictLevel": "",
      "bpClaim": "",
      "searchEvidence": "",
      "diff": "",
      "verdict": "",
      "reasoning": ""
    },
    {
      "id": "tech_advance",
      "name": "技术先进性",
      "subtitle": "vs SOTA 参数对比",
      "score": 6,
      "conflictLevel": "",
      "bpClaim": "",
      "searchEvidence": "",
      "diff": "",
      "verdict": "",
      "reasoning": ""
    },
    {
      "id": "competition",
      "name": "竞争壁垒",
      "subtitle": "竞品格局与护城河",
      "score": 5,
      "conflictLevel": "",
      "bpClaim": "",
      "searchEvidence": "",
      "diff": "",
      "verdict": "",
      "reasoning": ""
    },
    {
      "id": "team_fit",
      "name": "创始团队匹配度",
      "subtitle": "经历与赛道契合度",
      "score": 7,
      "conflictLevel": "",
      "bpClaim": "",
      "searchEvidence": "",
      "diff": "",
      "verdict": "",
      "reasoning": ""
    },
    {
      "id": "team_complete",
      "name": "团队完整性",
      "subtitle": "关键岗位覆盖",
      "score": 6,
      "conflictLevel": "",
      "bpClaim": "",
      "searchEvidence": "",
      "diff": "",
      "verdict": "",
      "reasoning": ""
    },
    {
      "id": "pain",
      "name": "痛点刚性",
      "subtitle": "Must-have vs Nice-to-have",
      "score": 7,
      "conflictLevel": "",
      "bpClaim": "",
      "searchEvidence": "",
      "diff": "",
      "verdict": "",
      "reasoning": ""
    },
    {
      "id": "timing",
      "name": "入场时机",
      "subtitle": "行业周期定位",
      "score": 6,
      "conflictLevel": "",
      "bpClaim": "",
      "searchEvidence": "",
      "diff": "",
      "verdict": "",
      "reasoning": ""
    },
    {
      "id": "capital",
      "name": "资本适配度",
      "subtitle": "商业模式杠杆率",
      "score": 7,
      "conflictLevel": "",
      "bpClaim": "",
      "searchEvidence": "",
      "diff": "",
      "verdict": "",
      "reasoning": ""
    }
  ],
  "radarScores": {
    "market": 65,
    "valuation": 50,
    "tech": 70,
    "moat": 45,
    "team": 60,
    "timing": 55
  },
  "valuationData": {
    "bpMultiple": 40,
    "industryAvgMultiple": 25
  },
  "strengths": ["优势1", "优势2", "优势3"],
  "risks": ["风险1", "风险2", "风险3"],
  "finalScore": 62
}

## 核心要求
- conflictLevel 必须从以下选一个：诚实、夸大、严重夸大、信息不对称、技术证伪、存疑
- diff 要量化：BP说X vs 证据说Y，差异N倍
- verdict 是法官判决，要有推理链，不是总结
- searchEvidence 要引用具体来源标题
- 如果搜索没找到某维度的证据，conflictLevel 标记为"存疑"，score 给 4-6
- finalScore = 加权求和映射到0-100（市场15% 估值15% 技术可行10% 先进10% 壁垒10% 团队匹配15% 完整10% 痛点5% 时机5% 资本5%）
- radarScores 各项 = 对应维度 score * 10
- 只输出JSON，不要其他任何文字`;

      const systemPrompt = `你是投资尽调法官（Judge），不是分析师（Analyst）。
区别：分析师总结信息，法官裁决冲突。
你的每一句话都必须基于 SEARCH_EVIDENCE 中的具体证据。
没有证据支持的判断，标记为"存疑"。
你的思考过程（thinking）要展示完整的推理链。
Output your reasoning steps before the final JSON answer.
在最终JSON回答前，先进行充分的深度思考和推理。`;

      console.log("[Verdict] 开始辩证法裁决，声明数:", bpClaims.length,
        "搜索结果:", searchEvidence ? Object.keys(searchEvidence).length : 0, "条");

      const { text, thinking } = await callMiniMaxAsync(
        [{ role: "user", content: verdictPrompt }],
        systemPrompt,
        32768
      );

      console.log("[Verdict] 完成。thinking:", (thinking || "").length, "字, text:", (text || "").length, "字");

      // 解析 JSON
      let verdict;
      try {
        let str = text.trim();
        const codeBlock = str.match(
          /```(?:json)?\s*([\s\S]*?)```/
        );
        if (codeBlock) str = codeBlock[1].trim();
        const startIdx = str.indexOf("{");
        if (startIdx >= 0) str = str.slice(startIdx);
        const endIdx = str.lastIndexOf("}");
        if (endIdx >= 0) str = str.slice(0, endIdx + 1);
        verdict = JSON.parse(str);
      } catch (e) {
        console.warn("裁决 JSON 解析失败:", e.message);
        console.warn(
          "原始返回 (前500字):",
          text.slice(0, 500)
        );
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({
            error: "AI 返回的裁决无法解析为 JSON",
            rawText: text.slice(0, 1000),
            thinking: (thinking || "").slice(0, 2000),
          })
        );
      }

      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(
        JSON.stringify({
          verdict,
          thinking,
          searchUsed: !!(
            searchEvidence &&
            Object.keys(searchEvidence).length > 0
          ),
        })
      );
    } catch (e) {
      console.error("裁决失败:", e.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

// ══════════════════════════════════════════════════════════════
// PDF → 纯文本（Disk-Streaming + pdftotext from poppler-utils）
//
// Memory strategy (2 vCPU / 2 GB server):
//   1. req stream is piped straight to /tmp/<uid>.json — no body
//      string is ever accumulated in the Node.js heap.
//   2. fs.readFile reads the JSON, extracts only the `pdf` field,
//      then the raw buffer is immediately GC-eligible.
//   3. Base64 → binary decoding is done in 64 KiB aligned slices so
//      the full decoded PDF is never in memory at the same time as
//      the base64 string.
//   4. `pdftotext` (C++, poppler-utils) does the extraction; it is
//      far more memory-efficient than any JS-based PDF parser.
//   5. Both temp files (/tmp/<uid>.json and /tmp/<uid>.pdf) are
//      deleted immediately after use or on any error path.
// ══════════════════════════════════════════════════════════════

function handlePdfToText(req, res) {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tmpDir     = os.tmpdir();
  const tmpJsonPath = path.join(tmpDir, `bp-pdf-${uid}.json`);
  const tmpPdfPath  = path.join(tmpDir, `bp-pdf-${uid}.pdf`);

  let responded = false;
  let killTimer  = null;

  function cleanup() {
    fs.unlink(tmpJsonPath, () => {});
    fs.unlink(tmpPdfPath,  () => {});
  }

  function replyOnce(statusCode, jsonBody) {
    if (responded) return;
    responded = true;
    cleanup();
    if (killTimer) clearTimeout(killTimer);
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(jsonBody);
  }

  // ── Step 1: pipe the raw request body straight to disk ────────────────
  // Node.js heap only ever holds one I/O chunk (~64 KiB) at a time.
  const jsonFile = fs.createWriteStream(tmpJsonPath);

  req.on("error", (e) => {
    jsonFile.destroy();
    replyOnce(400, JSON.stringify({ error: "请求流错误: " + e.message }));
  });
  jsonFile.on("error", (e) => {
    replyOnce(500, JSON.stringify({ error: "写入临时文件失败: " + e.message }));
  });

  req.pipe(jsonFile);

  jsonFile.on("finish", () => {
    if (responded) return;

    // ── Step 2: parse JSON and validate ───────────────────────────────
    // fs.readFile keeps one Buffer in the heap; JSON.parse extracts the
    // pdf string and the raw Buffer becomes GC-eligible immediately.
    fs.readFile(tmpJsonPath, (errRead, rawBuf) => {
      // The JSON temp file is no longer needed once we've read it.
      fs.unlink(tmpJsonPath, () => {});

      if (errRead) {
        return replyOnce(500, JSON.stringify({ error: "读取临时文件失败: " + errRead.message }));
      }

      let pdfBase64;
      try {
        const parsed = JSON.parse(rawBuf); // rawBuf GC-eligible after this line
        pdfBase64 = parsed.pdf;
      } catch {
        return replyOnce(400, JSON.stringify({ error: "请求体需为 JSON，且包含 pdf 字段（base64）" }));
      }

      if (!pdfBase64 || typeof pdfBase64 !== "string") {
        return replyOnce(400, JSON.stringify({ error: "缺少 pdf 字段（base64 字符串）" }));
      }

      // ── Step 3: stream-decode base64 → temp PDF file ──────────────
      // We process 64 KiB of base64 text at a time (always a multiple
      // of 4 so base64 block boundaries stay aligned).  The decoded
      // binary slice is written and freed before the next slice is
      // created, so the peak in-memory footprint is ~96 KiB here.
      const pdfFile   = fs.createWriteStream(tmpPdfPath);
      const B64_CHUNK = 65536; // 64 KiB — must be a multiple of 4
      let offset = 0;

      function writeNextChunk() {
        while (offset < pdfBase64.length) {
          const rawEnd = Math.min(offset + B64_CHUNK, pdfBase64.length);
          // Align to a base64 4-char block boundary.
          const end = rawEnd === pdfBase64.length
            ? rawEnd
            : rawEnd - (rawEnd % 4);
          if (end <= offset) break; // safety guard — shouldn't happen

          const decoded = Buffer.from(pdfBase64.slice(offset, end), "base64");
          offset = end;

          // Honour write-stream back-pressure to avoid I/O queue pile-up.
          if (!pdfFile.write(decoded)) {
            pdfFile.once("drain", writeNextChunk);
            return;
          }
        }
        pdfFile.end();
      }

      pdfFile.on("error", (e) => {
        replyOnce(500, JSON.stringify({ error: "PDF 文件写入失败: " + e.message }));
      });

      pdfFile.on("finish", () => {
        pdfBase64 = null; // release the base64 string for GC

        // ── Step 4: extract text with pdftotext (poppler-utils, C++) ──
        // "-enc UTF-8" ensures consistent encoding; "-" sends output to
        // stdout so we never write a second temp file.
        const textChunks = [];
        let stderrBuf    = "";

        const pt = spawn("pdftotext", ["-enc", "UTF-8", tmpPdfPath, "-"], {
          stdio: ["ignore", "pipe", "pipe"],
        });

        // Hard timeout: kill the child and respond after 120 s.
        killTimer = setTimeout(() => {
          pt.kill("SIGKILL");
          replyOnce(504, JSON.stringify({ error: "PDF 解析超时（>120s），文件可能过大或环境异常" }));
        }, 120_000);

        pt.stdout.on("data", (chunk) => textChunks.push(chunk));
        pt.stderr.on("data", (chunk) => { stderrBuf += chunk; });

        pt.on("error", (e) => {
          replyOnce(500, JSON.stringify({
            error: "未找到 pdftotext，请安装 poppler-utils: apt-get install poppler-utils",
            detail: e.message,
          }));
        });

        pt.on("close", (code) => {
          if (code !== 0) {
            return replyOnce(500, JSON.stringify({
              error: "PDF 解析失败",
              detail: (stderrBuf || "").trim().slice(0, 500),
            }));
          }
          const text = Buffer.concat(textChunks).toString("utf8").trim();
          replyOnce(200, JSON.stringify({ text }));
        });
      });

      writeNextChunk();
    });
  });
}

// ── 返回静态文件或 SPA index ──
function serveFile(pathname, res) {
  const hasBuild = fs.existsSync(
    path.join(BUILD_DIR, "index.html")
  );
  if (!hasBuild) {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
    });
    res.end(`
      <!DOCTYPE html><html><head><meta charset="utf-8"><title>AI 垃圾 BP 过滤机</title></head>
      <body style="font-family:sans-serif;max-width:420px;margin:80px auto;padding:24px;background:#08080d;color:#e8e8ed;">
        <h1 style="color:#ff3a3a;">请先构建前端</h1>
        <p>在项目目录执行：<code style="background:#111;padding:6px 10px;border-radius:6px;">npm run build</code></p>
        <p>然后执行：<code style="background:#111;padding:6px 10px;border-radius:6px;">npm start</code></p>
        <p style="color:#8a8aa0;margin-top:24px;">或一键执行：<code style="background:#111;padding:6px 10px;border-radius:6px;">npm run dev</code></p>
      </body></html>
    `);
    return;
  }
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.join(BUILD_DIR, pathname);
  if (!filePath.startsWith(BUILD_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: 返回 index.html
      fs.readFile(
        path.join(BUILD_DIR, "index.html"),
        (err2, data2) => {
          if (err2) {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          res.setHeader("Content-Type", "text/html");
          res.end(data2);
        }
      );
      return;
    }
    const ext = path.extname(pathname);
    res.setHeader(
      "Content-Type",
      MIME[ext] || "application/octet-stream"
    );
    res.end(data);
  });
}

// ══════════════════════════════════════════════════════════════
// HTTP 路由
// ══════════════════════════════════════════════════════════════

const server = http.createServer((req, res) => {
  // ── CORS 跨域头（对所有响应生效，包括错误响应）──
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Max-Age", "86400"); // 预检缓存 24 h

  // OPTIONS 预检请求立即返回 204，并在 writeHead 中显式携带 CORS 头
  // （避免某些反向代理在 writeHead 前剥离 setHeader 设置的头）
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  // 去掉末尾多余的斜杠（避免代理 301 重定向后浏览器改为 GET 导致 405）
  const rawPath = (req.url || "").split("?")[0];
  const pathname = rawPath.length > 1 ? rawPath.replace(/\/+$/, "") : rawPath;

  // 对 POST-Only API 端点提前拦截错误方法，返回 405 + CORS 头
  // （若代理将非 POST 请求转发过来，确保前端能拿到含 CORS 头的清晰错误）
  const POST_ONLY_PATHS = [
    "/api/chat",
    "/api/web-search",
    "/api/extract-claims",
    "/api/verdict",
    "/api/pdf-to-text",
  ];
  if (POST_ONLY_PATHS.includes(pathname) && req.method !== "POST") {
    res.writeHead(405, {
      "Content-Type": "application/json",
      "Allow": "POST, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    });
    res.end(JSON.stringify({ error: "Method Not Allowed — this endpoint only accepts POST" }));
    return;
  }

  // MiniMax 对话 API（透传）
  if (req.method === "POST" && pathname === "/api/chat") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        callMiniMax(parsed, res);
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "请求体不是合法 JSON" })
        );
      }
    });
    return;
  }

  // 健康检查
  if (pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        model: CONFIG.model,
        searchEnabled: isSearchEnabled(),
      })
    );
    return;
  }

  // 搜索服务状态
  if (pathname === "/api/search-status") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(
      JSON.stringify({
        enabled: isSearchEnabled(),
        provider: process.env.SERPER_API_KEY
          ? "serper"
          : process.env.SERPAPI_KEY
            ? "serpapi"
            : "none",
      })
    );
    return;
  }

  // 联网搜索 API（批量）
  if (req.method === "POST" && pathname === "/api/web-search") {
    handleWebSearch(req, res);
    return;
  }

  // 提取关键声明（Step 1: 从 BP 中提取需要验证的主张）
  if (req.method === "POST" && pathname === "/api/extract-claims") {
    handleExtractClaims(req, res);
    return;
  }

  // 辩证法裁决 API（Step 3: 冲突计算 + 法官判决）
  if (req.method === "POST" && pathname === "/api/verdict") {
    handleVerdict(req, res);
    return;
  }

  // PDF → 纯文本（Python PyMuPDF + OCR）
  if (req.method === "POST" && pathname === "/api/pdf-to-text") {
    handlePdfToText(req, res);
    return;
  }

  // 静态资源或 SPA
  serveFile(pathname, res);
});

server.listen(PORT, () => {
  const hasBuild = fs.existsSync(
    path.join(BUILD_DIR, "index.html")
  );
  const searchStatus = isSearchEnabled()
    ? `联网搜索: ✅ ${process.env.SERPER_API_KEY ? "Serper" : "SerpAPI"}`
    : "联网搜索: ❌ 未配置（请设置 SERPER_API_KEY 或 SERPAPI_KEY）";
  console.log(`
╔══════════════════════════════════════════════════╗
║     🗑️  AI 垃圾 BP 过滤机 — 辩证法裁决版        ║
╠══════════════════════════════════════════════════╣
║  服务: http://localhost:${String(PORT).padEnd(5)}                      ║
║  模型: ${CONFIG.model.padEnd(40)}║
║  ${searchStatus.padEnd(47)}║
║                                                  ║
║  API 端点:                                       ║
║    POST /api/chat           MiniMax 透传          ║
║    POST /api/extract-claims Step1 提取声明        ║
║    POST /api/web-search     Step2 联网搜索        ║
║    POST /api/verdict        Step3 辩证法裁决      ║
║    POST /api/pdf-to-text    PDF 解析              ║
║                                                  ║
${!hasBuild ? "║  首次使用请先执行: npm run build                 ║\n" : ""}╚══════════════════════════════════════════════════╝
  `);
});
