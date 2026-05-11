const crypto = require("crypto");

function uuid() {
  return crypto.randomBytes(16).toString("hex");
}

function safeJsonParse(value, fallback) {
  try {
    if (value == null || value === "") return fallback;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function json(value) {
  return JSON.stringify(value == null ? null : value);
}

function clampText(value = "", max = 2000) {
  const text = String(value || "").trim();
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeKey(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .slice(0, 120);
}

function scoreRecency(updatedAt) {
  const t = new Date(updatedAt || Date.now()).getTime();
  const days = Math.max(0, (Date.now() - t) / 86400000);
  return Math.max(0, 1 - days / 90);
}

function rankMemory(row) {
  const usage = Number(row.usage_count || 0);
  const success = Number(row.success_count || 0);
  const successRate = usage > 0 ? success / usage : 0.5;
  return (
    Number(row.confidence || 0.5) * 0.45 +
    successRate * 0.25 +
    scoreRecency(row.updated_at) * 0.2 +
    Math.min(usage, 10) / 10 * 0.1
  );
}

module.exports = {
  uuid,
  safeJsonParse,
  json,
  clampText,
  normalizeKey,
  rankMemory,
};
