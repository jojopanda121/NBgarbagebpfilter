// ============================================================
// server/skills/_groundingAudit.js
//
// 轻量事实溯源审计。它不判断观点好坏，只确认 source_refs 没有乱指、
// 关键数组项没有完全脱离 Fact Pack。
// ============================================================

const { factIds } = require("./_factPack");

function walk(node, path = "$", out = []) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, `${path}[${i}]`, out));
    return out;
  }
  if (node && typeof node === "object") {
    if (Array.isArray(node.source_refs)) {
      out.push({ path: `${path}.source_refs`, refs: node.source_refs });
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === "source_refs") continue;
      walk(v, `${path}.${k}`, out);
    }
  }
  return out;
}

function auditGrounding(payload, factPack, opts = {}) {
  const ids = factIds(factPack);
  const refs = walk(payload);
  const errors = [];
  const warnings = [];
  const requiredPaths = opts.requiredPaths || [];

  for (const entry of refs) {
    for (const ref of entry.refs || []) {
      if (typeof ref !== "string" || !ids.has(ref)) {
        errors.push(`${entry.path} 引用了不存在的事实编号: ${ref}`);
      }
    }
  }

  for (const path of requiredPaths) {
    const values = getByPath(payload, path);
    const arr = Array.isArray(values) ? values : [];
    arr.forEach((item, idx) => {
      const itemRefs = Array.isArray(item?.source_refs) ? item.source_refs : [];
      const allowHypothesis = opts.allowHypothesis && item?.question_type === "假设挑战型";
      if (itemRefs.length === 0 && !allowHypothesis) {
        errors.push(`${path}[${idx}].source_refs 不能为空`);
      }
    });
  }

  if (refs.length === 0) {
    warnings.push("payload 中没有任何 source_refs 字段，无法做事实溯源审计");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    referenced_count: refs.reduce((n, x) => n + (x.refs?.length || 0), 0),
  };
}

function assertGrounded(payload, factPack, opts = {}) {
  const audit = auditGrounding(payload, factPack, opts);
  if (!audit.ok) {
    const err = new Error(`事实溯源审计失败: ${audit.errors.join(" | ")}`);
    err.audit = audit;
    throw err;
  }
  return audit;
}

function getByPath(obj, path) {
  if (!path || path === "$") return obj;
  const parts = path.replace(/^\$\./, "").split(".");
  let cur = obj;
  for (const p of parts) {
    if (!cur) return undefined;
    cur = cur[p];
  }
  return cur;
}

// ── 轻量 metadata 助手:统计关键字段中 source_refs 为空的位置 ────────
// 用法:在 skill 完成 LLM + assertGrounded 后调用,把结果丢进 metadata,
// 让 ops/前端可以提示用户"哪些字段没有事实支撑、需要人工核实",
// **但不阻塞 skill 出结果**。
//
// paths 接受 "dot.path" 形式;指向单对象时算单条,指向数组时按下标展开。
// 例: countMissingRefs(payload, ["thesis", "risks_mitigants", "company"])
function countMissingRefs(payload, paths = []) {
  const missing = [];
  if (!payload || typeof payload !== "object") return { count: 0, paths: missing };
  for (const p of paths) {
    const value = getByPath(payload, p);
    if (value == null) continue;
    if (Array.isArray(value)) {
      value.forEach((item, idx) => {
        const refs = Array.isArray(item?.source_refs) ? item.source_refs : null;
        // 项里完全没有 source_refs 字段时跳过(可能是非引用类节点),
        // 只在显式存在 source_refs 但为空时算一条 miss。
        if (refs && refs.length === 0) missing.push(`${p}[${idx}]`);
      });
    } else if (typeof value === "object") {
      const refs = Array.isArray(value.source_refs) ? value.source_refs : null;
      if (refs && refs.length === 0) missing.push(p);
    }
  }
  return { count: missing.length, paths: missing };
}

// ── Fallback / Priority 统计 ──────────────────────────────
// 对照 _fieldPriorities 表，统计 preferred 字段里有多少被 LLM 填成
// "未披露 / 待核实 / N/A — ..."。结果只写入 metadata，**不抛错**，
// 用来在 ops 后台监控数据稀疏度 + 给前端"data room 缺口"badge 数值。
//
// 用法：
//   const fallback = summarizeFallback(payload, "onepager_pptx");
//   // fallback = { preferred_missing: 4, preferred_total: 12, optional_missing: 1, optional_total: 1 }

const { getFieldPriorities, isMissingValue } = require("./_fieldPriorities");

function getByPathDeep(obj, dottedPath) {
  if (!obj) return [];
  const parts = dottedPath.split(".");
  let cursors = [obj];
  for (const raw of parts) {
    const arrMatch = raw.match(/^(.+)\[\]$/);
    const key = arrMatch ? arrMatch[1] : raw;
    const nextCursors = [];
    for (const c of cursors) {
      if (c == null || typeof c !== "object") continue;
      const v = c[key];
      if (arrMatch) {
        if (Array.isArray(v)) nextCursors.push(...v);
      } else {
        nextCursors.push(v);
      }
    }
    cursors = nextCursors;
  }
  return cursors;
}

function summarizeFallback(payload, skillId) {
  const p = getFieldPriorities(skillId);
  const out = {
    preferred_total: 0,
    preferred_missing: 0,
    optional_total: 0,
    optional_missing: 0,
    missing_fields: [],
  };
  for (const f of p.preferred || []) {
    const values = getByPathDeep(payload, f);
    for (const v of values) {
      out.preferred_total++;
      if (isMissingValue(v)) {
        out.preferred_missing++;
        out.missing_fields.push({ field: f, tier: "preferred" });
      }
    }
  }
  for (const f of p.optional || []) {
    const values = getByPathDeep(payload, f);
    for (const v of values) {
      out.optional_total++;
      if (isMissingValue(v)) {
        out.optional_missing++;
        out.missing_fields.push({ field: f, tier: "optional" });
      }
    }
  }
  return out;
}

// 包含完整 fallback + grounding 审计的一站式入口。
// required (Ajv 已通过) → grounding 强校验（throw）
// preferred missing      → warning + 计数（不 throw）
// optional missing       → silent
function auditWithFallback(payload, factPack, opts = {}) {
  const grounding = auditGrounding(payload, factPack, opts);
  const fallback = summarizeFallback(payload, opts.skillId);
  if (!grounding.ok) {
    const err = new Error(`事实溯源审计失败: ${grounding.errors.join(" | ")}`);
    err.audit = { ...grounding, fallback };
    throw err;
  }
  return { ...grounding, fallback };
}

// ── 语义抽样校验 (semantic grounding audit) ─────────────────
// 上面的 auditGrounding 只做"引用完整性"校验：F023 存在 ✓。
// 这一段做"语义正确性"抽样：随机 30% 断言反向问 LLM
// "F023 是否真的支持该断言"，输出 entailed / contradicted / unclear
// 的统计 + 详情。结果只写入 metadata，不抛错（语义偏差可能是 LLM 过严
// 或 LLM 自身误判，由人工 review 决定是否回炉）。
//
// 用法：
//   const semantic = await semanticGroundingAudit(payload, factPack, {
//     sampleRate: 0.3, maxSamples: 15, skillId: "ic_questions_xlsx",
//   });
//   // semantic = { sampled: 12, entailed: 9, contradicted: 1, unclear: 2, details: [...] }

const CLAIM_FIELD_HINTS = [
  // 优先抽样这些字段名做语义校验；其他 source_refs 也会被纳入候选池但 priority 较低
  "evidence", "summary", "thesis_statement", "thesis", "logic", "fact_summary",
  "objection", "killer_question", "question", "why_ask", "why_asked", "desc",
  "rationale", "note", "subject_implied", "industry_median", "claim",
  "point", "headline", "insight",
];

function collectClaimRefPairs(node, path = "$", out = [], _parentText = "") {
  // 收集所有 (text, refs) 配对：node 包含 source_refs 数组 + 同级有可读文本字段
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectClaimRefPairs(v, `${path}[${i}]`, out));
    return out;
  }
  if (!node || typeof node !== "object") return out;

  if (Array.isArray(node.source_refs) && node.source_refs.length > 0) {
    // 找该 node 内最适合做"断言"的文本（优先 CLAIM_FIELD_HINTS）
    let claimText = "";
    for (const k of CLAIM_FIELD_HINTS) {
      if (typeof node[k] === "string" && node[k].trim().length >= 8) {
        claimText = node[k];
        break;
      }
    }
    if (!claimText) {
      // 退而求其次：取该 node 第一个非 source_refs 的字符串字段
      for (const [k, v] of Object.entries(node)) {
        if (k === "source_refs") continue;
        if (typeof v === "string" && v.trim().length >= 8) {
          claimText = v;
          break;
        }
      }
    }
    if (claimText) {
      out.push({ path, claim: claimText, refs: node.source_refs, priority: CLAIM_FIELD_HINTS.some((h) => node[h]) ? 1 : 2 });
    }
  }

  for (const [k, v] of Object.entries(node)) {
    if (k === "source_refs") continue;
    collectClaimRefPairs(v, `${path}.${k}`, out);
  }
  return out;
}

function _pickSamples(pairs, sampleRate, maxSamples) {
  if (!pairs.length) return [];
  // 先按 priority 排序（高优先级先抽），同优先级内随机
  pairs.sort((a, b) => a.priority - b.priority);
  const targetN = Math.min(
    maxSamples || 15,
    Math.max(3, Math.ceil(pairs.length * (sampleRate || 0.3))),
  );
  const high = pairs.filter((p) => p.priority === 1);
  const low = pairs.filter((p) => p.priority !== 1);
  const sampled = [];
  // 高优先级全取（或填满 targetN）
  for (const p of high) {
    if (sampled.length >= targetN) break;
    sampled.push(p);
  }
  // 低优先级随机抽满
  if (sampled.length < targetN && low.length) {
    const shuffled = low.slice().sort(() => Math.random() - 0.5);
    for (const p of shuffled) {
      if (sampled.length >= targetN) break;
      sampled.push(p);
    }
  }
  return sampled;
}

const SEMANTIC_AUDIT_SCHEMA = {
  type: "object",
  required: ["results"],
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        required: ["idx", "verdict", "reason"],
        additionalProperties: false,
        properties: {
          idx: { type: "integer", minimum: 1 },
          verdict: { type: "string", enum: ["entailed", "contradicted", "unclear"] },
          reason: { type: "string", maxLength: 200 },
        },
      },
    },
  },
};

const SEMANTIC_AUDIT_SYSTEM = `你是事实校验员。每条配对给你一个断言 + 它引用的 F 编号（来自 Fact Pack）。
你的任务：判断这些 F 编号对应的事实是否真的**支撑**该断言。

verdict 三档：
- entailed: F 编号的事实确实能支撑断言（不需要完美匹配，能合理推出即可）
- contradicted: F 编号的事实与断言**直接冲突**或方向相反（高确定性才标这个）
- unclear: F 编号事实与断言无明显关联 / 信息不足 / 跨度太大需要额外推理

reason ≤ 80 字，引用具体 F 编号说明判断。
仅输出 JSON，无 Markdown。`;

async function semanticGroundingAudit(payload, factPack, opts = {}) {
  const { sampleRate = 0.3, maxSamples = 15, skillId = "" } = opts;
  const pairs = collectClaimRefPairs(payload);
  if (pairs.length === 0) {
    return { sampled: 0, entailed: 0, contradicted: 0, unclear: 0, error: null, details: [] };
  }
  const samples = _pickSamples(pairs, sampleRate, maxSamples);
  if (samples.length === 0) {
    return { sampled: 0, entailed: 0, contradicted: 0, unclear: 0, error: null, details: [] };
  }

  // 懒加载 LLM 服务（避免循环依赖 + 注册阶段触发 config）
  const { callLLMJson } = require("../services/llmService");
  const { formatFactPackForPrompt } = require("./_factPack");

  const pairsBlock = samples
    .map((p, i) => `${i + 1}. 断言: "${p.claim.slice(0, 200)}"\n   引用: ${p.refs.join(", ")}`)
    .join("\n");
  const userMsg = [
    formatFactPackForPrompt(factPack),
    "",
    "【待校验配对】",
    pairsBlock,
    "",
    `请按 schema 输出 ${samples.length} 条 verdict JSON，idx 从 1 到 ${samples.length}。`,
  ].join("\n");

  let result;
  try {
    const out = await callLLMJson(SEMANTIC_AUDIT_SYSTEM, userMsg, SEMANTIC_AUDIT_SCHEMA, {
      maxTokens: 2048,
      maxRepairs: 1,
      // 标记给 P2-4 模型路由用：抽样校验是轻任务，可走轻量模型
      taskHint: "semantic_audit",
      skillId,
    });
    result = out.data;
  } catch (e) {
    return { sampled: samples.length, entailed: 0, contradicted: 0, unclear: 0, error: e.message, details: [] };
  }

  let entailed = 0, contradicted = 0, unclear = 0;
  const details = [];
  for (const r of result.results || []) {
    const sample = samples[r.idx - 1];
    if (!sample) continue;
    if (r.verdict === "entailed") entailed++;
    else if (r.verdict === "contradicted") contradicted++;
    else unclear++;
    if (r.verdict !== "entailed") {
      details.push({
        path: sample.path,
        claim: sample.claim.slice(0, 120),
        refs: sample.refs,
        verdict: r.verdict,
        reason: r.reason,
      });
    }
  }
  return {
    sampled: samples.length,
    entailed,
    contradicted,
    unclear,
    error: null,
    details,
  };
}

module.exports = {
  auditGrounding,
  assertGrounded,
  countMissingRefs,
  summarizeFallback,
  auditWithFallback,
  semanticGroundingAudit,
  _private: { collectClaimRefPairs, _pickSamples, SEMANTIC_AUDIT_SCHEMA },
};
