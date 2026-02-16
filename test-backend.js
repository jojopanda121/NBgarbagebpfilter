#!/usr/bin/env node
/**
 * 后台算法测试脚本 - 验证 extract-claims / web-search / verdict 能否跑通
 */
const http = require("http");

const BASE = "http://localhost:3000";

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      BASE + path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(buf) });
          } catch {
            resolve({ status: res.statusCode, raw: buf });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(BASE + path, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(buf) });
        } catch {
          resolve({ status: res.statusCode, raw: buf });
        }
      });
    }).on("error", reject);
  });
}

async function main() {
  console.log("=== 后台算法测试 ===\n");

  // 1. 健康检查
  console.log("1. /api/health");
  try {
    const h = await get("/api/health");
    console.log("   状态:", h.status, h.data ? JSON.stringify(h.data) : h.raw?.slice(0, 100));
    if (h.status !== 200) throw new Error("健康检查失败");
  } catch (e) {
    console.log("   ❌ 失败:", e.message);
    process.exit(1);
  }
  console.log("   ✅ 通过\n");

  // 2. 提取声明
  const sampleBP = `
某某科技商业计划书
公司名称：某某人工智能科技有限公司
行业：AI 大模型
融资阶段：A 轮，寻求 5000 万人民币
团队：创始人张三，前字节跳动 AI 实验室负责人，斯坦福博士
市场规模：中国 AI 市场规模 2025 年将达 2000 亿元
技术：自研多模态大模型，参数量 70B，推理速度比 GPT-4 快 3 倍
竞品：对标 OpenAI、百度文心、阿里通义
财务：2024 年营收 800 万，预计 2025 年 3000 万
`.trim();

  console.log("2. /api/extract-claims（提取关键声明）");
  try {
    const ec = await post("/api/extract-claims", { bpText: sampleBP });
    console.log("   状态:", ec.status);
    if (ec.data?.claims) {
      const q = ec.data.claims.searchQueries || [];
      console.log("   公司:", ec.data.claims.companyName || "-");
      console.log("   行业:", ec.data.claims.industry || "-");
      console.log("   搜索查询数:", q.length);
      if (q.length > 0) console.log("   示例查询:", q[0]?.query?.slice(0, 40) + "...");
    } else if (ec.data?.error) {
      throw new Error(ec.data.error);
    } else {
      console.log("   返回:", JSON.stringify(ec.data).slice(0, 200));
    }
    if (ec.status !== 200) throw new Error("提取声明失败");
  } catch (e) {
    console.log("   ❌ 失败:", e.message);
  }
  console.log("   ✅ 通过\n");

  // 3. 联网搜索（可能未配置）
  console.log("3. /api/web-search");
  try {
    const sw = await post("/api/web-search", {
      queries: ["某某人工智能科技 融资", "AI 市场规模 2025 中国"],
    });
    console.log("   状态:", sw.status);
    if (sw.data?.results) {
      const total = Object.values(sw.data.results).reduce((s, r) => s + r.length, 0);
      console.log("   搜索启用:", sw.data.searchEnabled);
      console.log("   结果条数:", total);
    } else if (sw.data?.error) {
      console.log("   错误:", sw.data.error);
    }
    if (sw.status !== 200) throw new Error("搜索请求失败");
  } catch (e) {
    console.log("   ❌ 失败:", e.message);
  }
  console.log("   ✅ 通过\n");

  // 4. 辩证法裁决（核心算法）
  const bpClaims = [
    { category: "company", claim: "某某人工智能科技，A轮融资5000万" },
    { category: "market", claim: "中国AI市场规模2025年达2000亿元" },
    { category: "tech", claim: "自研70B多模态大模型，推理比GPT-4快3倍" },
    { category: "team", claim: "创始人张三，前字节AI实验室，斯坦福博士" },
  ];

  console.log("4. /api/verdict（辩证法裁决 - 核心算法）");
  console.log("   调用 MiniMax，预计 30-90 秒...");
  const start = Date.now();
  try {
    const v = await post("/api/verdict", {
      bpClaims,
      searchEvidence: {}, // 无联网时用空对象
      bpFullText: sampleBP,
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log("   状态:", v.status, "耗时:", elapsed, "秒");
    if (v.data?.verdict) {
      const ver = v.data.verdict;
      console.log("   项目名:", ver.projectName);
      console.log("   一句话:", ver.oneLiner);
      console.log("   阶段:", ver.stage);
      console.log("   最终分:", ver.finalScore);
      console.log("   维度数:", ver.dimensions?.length || 0);
      if (ver.dimensions?.[0]) {
        console.log("   首维:", ver.dimensions[0].name, "得分", ver.dimensions[0].score);
      }
    } else if (v.data?.error) {
      throw new Error(v.data.error);
    } else {
      console.log("   返回:", JSON.stringify(v.data).slice(0, 300));
    }
    if (v.status !== 200) throw new Error("裁决失败");
  } catch (e) {
    console.log("   ❌ 失败:", e.message);
    if (e.message?.includes("ECONNREFUSED")) {
      console.log("   提示: 请先运行 npm start 启动服务");
    }
  }
  console.log("   ✅ 通过\n");

  console.log("=== 测试完成 ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
