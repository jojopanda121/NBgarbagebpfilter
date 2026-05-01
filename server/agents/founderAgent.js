// ============================================================
// server/agents/founderAgent.js — 创始人调查 Agent
// PRIVACY: 邮箱/手机号经 SHA256+salt hash 处理后才写入数据库
// ============================================================

const crypto = require("crypto");
const { callLLM } = require("../services/llmService");
const { extractJson } = require("../utils/jsonParser");
const { FOUNDER_AGENT_PROMPT } = require("../utils/prompts");
const logger = require("../utils/logger");

const MAX_BP_CHARS = 20000;

// PRIVACY: 单向 hash，附加环境变量 salt 增加彩虹表攻击难度
function hashPII(value) {
  if (!value) return null;
  const salt = process.env.PII_SALT || "nbgbpf_default_salt";
  return crypto.createHash("sha256").update(String(value) + salt).digest("hex");
}

// PRIVACY: AES-256-GCM 对称加密，只有持有 ENCRYPTION_KEY 的授权方可解密
function encryptName(name) {
  if (!name) return null;
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex || keyHex.length < 64) {
    // 未配置 ENCRYPTION_KEY 时，对姓名做 hash（不可逆，但不存明文）
    return "hash:" + hashPII(name);
  }
  try {
    const key = Buffer.from(keyHex.slice(0, 64), "hex");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(name, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return iv.toString("hex") + ":" + enc.toString("hex") + ":" + tag.toString("hex");
  } catch (err) {
    logger.warn("[FounderAgent] 加密失败，使用 hash 替代:", err.message);
    return "hash:" + hashPII(name);
  }
}

/**
 * @param {string} bpText
 * @param {object} extractedData
 * @returns {object} 创始人画像 + hash 后的 PII 字段
 */
async function founderAgent(bpText, extractedData) {
  // 只取 BP 前 20000 字中的团队相关内容
  const truncated = bpText.length > MAX_BP_CHARS
    ? bpText.slice(0, MAX_BP_CHARS) + "\n...(已截断)"
    : bpText;

  const userContent = [
    `【商业计划书全文节选】\n${truncated}`,
    `\n\n【已知信息】赛道：${extractedData.industry || "未知"}，公司：${extractedData.company_name || "未知"}`,
  ].join("");

  let raw;
  try {
    raw = await callLLM(FOUNDER_AGENT_PROMPT, userContent, 6144);
  } catch (err) {
    logger.warn("[FounderAgent] LLM 调用失败:", err.message);
    throw err;
  }

  let result = extractJson(raw);
  if (!result || !result.founders) {
    logger.warn("[FounderAgent] JSON 解析失败，重试...");
    raw = await callLLM(
      FOUNDER_AGENT_PROMPT + "\n\n【紧急提醒】只输出 JSON 对象，不要 markdown 代码块。",
      userContent,
      6144
    );
    result = extractJson(raw);
  }

  if (!result) throw new Error("FounderAgent JSON 解析失败");

  // PRIVACY: 对 founders 中的 emails_found 和 phones_found 做 hash 处理，删除原文
  if (Array.isArray(result.founders)) {
    result.founders = result.founders.map((f) => {
      const processed = { ...f };
      // PRIVACY: hash 邮箱和手机，并删除原文字段
      processed.email_hashes = (f.emails_found || []).map(hashPII).filter(Boolean);
      processed.phone_hashes = (f.phones_found || []).map(hashPII).filter(Boolean);
      processed.full_name_encrypted = encryptName(f.name);
      delete processed.emails_found;
      delete processed.phones_found;
      // name 保留（仅当前用户可见，不跨用户共享）
      return processed;
    });
  }

  logger.info("[FounderAgent] 完成", { founderCount: result.founders?.length });
  return result;
}

module.exports = founderAgent;
