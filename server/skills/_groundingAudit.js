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

module.exports = {
  auditGrounding,
  assertGrounded,
};
