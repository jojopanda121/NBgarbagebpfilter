// ============================================================
// server/services/projectMatchService.js
// 项目自动匹配：基于 Agent 输出的项目名 + 创始人姓名做模糊匹配
//
// 阈值（保守，宁可 ask_user 不要乱合并）：
//   score >= 0.75 → auto_merge
//   0.5 <= score < 0.75 → ask_user
//   score < 0.5 → create_new
// ============================================================

const { getDb } = require("../db");

/** 归一化 Levenshtein 相似度，返回 [0, 1]。 */
function similarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const x = String(a).trim().toLowerCase();
  const y = String(b).trim().toLowerCase();
  if (!x.length && !y.length) return 1;
  if (x === y) return 1;
  const len = Math.max(x.length, y.length);
  const dp = Array.from({ length: x.length + 1 }, () =>
    new Array(y.length + 1).fill(0)
  );
  for (let i = 0; i <= x.length; i++) dp[i][0] = i;
  for (let j = 0; j <= y.length; j++) dp[0][j] = j;
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return 1 - dp[x.length][y.length] / len;
}

/** 给两组创始人姓名取最大相似度（同一项目里的创始人有可能只匹配上一个） */
function maxFounderSimilarity(listA, listB) {
  if (!Array.isArray(listA) || !Array.isArray(listB)) return 0;
  if (!listA.length || !listB.length) return 0;
  let best = 0;
  for (const a of listA) {
    for (const b of listB) {
      const s = similarity(a, b);
      if (s > best) best = s;
    }
  }
  return best;
}

/**
 * 在用户名下的项目中，寻找最匹配的项目。
 * @param {Number} userId
 * @param {Object} extracted - { projectName, founders: string[] }
 * @returns {{ matched: object|null, confidence: 'auto_merge'|'ask_user'|'create_new', score: number }}
 */
function findMatchingProject(userId, extracted) {
  const db = getDb();
  const projects = db
    .prepare(`SELECT * FROM projects WHERE user_id = ?`)
    .all(userId);
  if (!projects.length) {
    return { matched: null, confidence: "create_new", score: 0 };
  }

  const targetName = extracted.projectName || "";
  const targetFounders = extracted.founders || [];

  let best = null;
  let bestScore = 0;

  for (const p of projects) {
    const nameSim = similarity(p.name, targetName);
    let founderList = [];
    try {
      founderList = p.founder_names ? JSON.parse(p.founder_names) : [];
    } catch (_) {
      founderList = [];
    }
    const founderSim = maxFounderSimilarity(founderList, targetFounders);
    // 项目名权重 0.6，创始人权重 0.4；缺创始人时仅看名字
    const score =
      founderList.length && targetFounders.length
        ? nameSim * 0.6 + founderSim * 0.4
        : nameSim;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  let confidence;
  if (bestScore >= 0.75) confidence = "auto_merge";
  else if (bestScore >= 0.5) confidence = "ask_user";
  else confidence = "create_new";

  return { matched: best, confidence, score: bestScore };
}

module.exports = {
  similarity,
  maxFounderSimilarity,
  findMatchingProject,
};
