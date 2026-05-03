// ============================================================
// server/services/bpVersionDiffService.js
// Sprint 2: BP 版本对比 — 数字字段自动算 deltaPct
// ============================================================

const { getDb } = require("../db");

function makeChange(a, b) {
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  const isNumA = typeof a === "number" && !Number.isNaN(a);
  const isNumB = typeof b === "number" && !Number.isNaN(b);
  const changed = a !== b;
  let delta = null;
  let deltaPct = null;
  if (changed && isNumA && isNumB) {
    delta = b - a;
    deltaPct = a !== 0 ? (b - a) / Math.abs(a) : null;
  }
  return { from: a, to: b, changed, delta, deltaPct };
}

function diffMetrics(metricsA = [], metricsB = []) {
  const norm = (list) =>
    Array.isArray(list)
      ? list.filter((m) => m && (m.name || m.label))
      : [];
  const arrA = norm(metricsA);
  const arrB = norm(metricsB);
  const mapA = new Map(arrA.map((m) => [m.name || m.label, m]));
  const mapB = new Map(arrB.map((m) => [m.name || m.label, m]));
  const allNames = new Set([...mapA.keys(), ...mapB.keys()]);
  return Array.from(allNames).map((name) => {
    const ma = mapA.get(name);
    const mb = mapB.get(name);
    let status;
    if (!ma) status = "added";
    else if (!mb) status = "removed";
    else status = "changed";
    return { name, a: ma || null, b: mb || null, status };
  });
}

/**
 * 对比同一项目的两个版本。所有查询带 user_id 校验（PRIVACY）。
 */
function compareVersions(projectId, userId, vA, vB) {
  const db = getDb();
  const proj = db
    .prepare(`SELECT id FROM projects WHERE id = ? AND user_id = ?`)
    .get(projectId, userId);
  if (!proj) throw new Error("项目不存在或无权访问");

  const va = db
    .prepare(
      `SELECT * FROM project_versions WHERE project_id = ? AND version_number = ?`
    )
    .get(projectId, vA);
  const vb = db
    .prepare(
      `SELECT * FROM project_versions WHERE project_id = ? AND version_number = ?`
    )
    .get(projectId, vB);
  if (!va || !vb) throw new Error("版本不存在");

  const parse = (raw) => {
    try {
      return JSON.parse(raw || "[]");
    } catch (_) {
      return [];
    }
  };

  return {
    versionA: { number: vA, uploadedAt: va.uploaded_at },
    versionB: { number: vB, uploadedAt: vb.uploaded_at },
    changes: {
      claimed_valuation: makeChange(va.claimed_valuation, vb.claimed_valuation),
      claimed_revenue: makeChange(va.claimed_revenue, vb.claimed_revenue),
      claimed_users: makeChange(va.claimed_users, vb.claimed_users),
      funding_round: makeChange(va.funding_round, vb.funding_round),
      funding_amount: makeChange(va.funding_amount, vb.funding_amount),
      total_score: makeChange(va.total_score, vb.total_score),
    },
    coreMetricsDiff: diffMetrics(parse(va.core_metrics), parse(vb.core_metrics)),
  };
}

module.exports = { compareVersions, makeChange, diffMetrics };
