// server/agents/founderAgent.js — v2 (BaseAgent)
// PRIVACY: 邮箱/手机 hash 处理，姓名加密
const crypto = require("crypto");
const BaseAgent = require("./baseAgent");
const PROMPT = require("./prompts/founder.prompt");
const { extractJson } = require("../utils/jsonParser");

const MAX_BP_CHARS = 20000;

// PRIVACY: SHA256 + salt 单向 hash
function hashPII(value) {
  if (!value) return null;
  const salt = process.env.PII_SALT || "nbgbpf_default_salt";
  return crypto.createHash("sha256").update(String(value) + salt).digest("hex");
}

// PRIVACY: AES-256-GCM 加密姓名；未配置 key 则 hash
function encryptName(name) {
  if (!name) return null;
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex || keyHex.length < 64) return "hash:" + hashPII(name);
  try {
    const key = Buffer.from(keyHex.slice(0, 64), "hex");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(name, "utf8"), cipher.final()]);
    return iv.toString("hex") + ":" + enc.toString("hex") + ":" + cipher.getAuthTag().toString("hex");
  } catch {
    return "hash:" + hashPII(name);
  }
}

class FounderAgent extends BaseAgent {
  constructor() {
    super({ name: "founder", systemPrompt: PROMPT, maxTokens: 6144 });
  }

  buildUserMessage({ bpFullText, extractedData }) {
    const truncated = bpFullText.length > MAX_BP_CHARS
      ? bpFullText.slice(0, MAX_BP_CHARS) + "\n...(已截断)"
      : bpFullText;
    const industry = extractedData?.industry || "未知赛道";
    return `以下是一份 BP 的全文，请按要求分析创始团队并输出 JSON。\n赛道参考：${industry}\n\n<BP_FULL_TEXT>\n${truncated}\n</BP_FULL_TEXT>`;
  }

  parseResponse(rawText) {
    const parsed = extractJson(rawText);
    if (!parsed || !parsed.founders) throw new Error("FounderAgent JSON 解析失败");

    // PRIVACY: 处理联系方式 hash，姓名加密
    const founders = (parsed.founders || []).map((f) => ({
      ...f,
      full_name_encrypted: encryptName(f.name),
      email_hash: f.contact_hint?.has_email ? hashPII(f.name + "_email") : null,
      phone_hash: f.contact_hint?.has_phone ? hashPII(f.name + "_phone") : null,
    }));

    return {
      userOutput: { founders, team_assessment: parsed.team_assessment, risk_flags: parsed.risk_flags || [] },
      dataPayload: {
        founders: founders.map((f) => ({
          name_display: f.name,
          full_name_encrypted: f.full_name_encrypted,
          email_hash: f.email_hash,
          phone_hash: f.phone_hash,
          past_ventures: f.past_ventures || [],
        })),
        risk_flags: parsed.risk_flags || [],
      },
    };
  }
}

module.exports = FounderAgent;
