// ============================================================
// server/services/llmCredentialService.js — 用户自带模型（BYOK）凭证
//
// 职责：加密存取用户的 API Key、把它组装成分析任务用的 LLM 上下文、
//      以及**保存前的真实连通性校验**。
//
// 校验为什么必须做：本仓库的流水线高度依赖"模型能按 JSON Schema 稳定输出"
// （callLLMJson 有 schema 校验 + 修复重试，但修不动完全不听指令的模型）。
// 一个能聊天但不会按格式输出的模型，接进来的表现是"分析跑到一半失败"，
// 而用户会以为是平台坏了。所以在保存凭证这一步就用**真实调用链**跑一个
// 最小结构化任务，过不了直接拒绝保存，并如实告诉用户是哪一环不行。
//
// 安全约束（不可放松）：
//   - 明文 key 只存在于内存与本次请求；落库一律 AES-256-GCM 密文
//   - 任何日志、任何返回给前端的结构，都只出现掩码（sk-…abcd）
//   - 未配置 ENCRYPTION_KEY 时整个 BYOK 功能不可用，而不是降级成明文存
// ============================================================

const crypto = require("crypto");
const config = require("../config");
const { getDb } = require("../db");
const providers = require("./llm/providers");
const { resolveCapabilities } = require("./llm/capabilities");
const { runWithLlmContext } = require("../runtime/llmContext");

const VALIDATION_TIMEOUT_MS = 90 * 1000;

/** BYOK 是否可用：功能开关 + 加密密钥都就位才算 */
function isByokAvailable() {
  return !!config.byokEnabled && !!config.encryptionKey && config.encryptionKey.length >= 64;
}

function _key() {
  // 没有密钥就不该走到这里。明确抛错，绝不退化成明文或弱加密。
  if (!isByokAvailable()) {
    const e = new Error("BYOK 不可用：服务端未配置 ENCRYPTION_KEY（64 位 hex），无法安全保存用户的 API Key");
    e.status = 503;
    throw e;
  }
  return Buffer.from(String(config.encryptionKey).slice(0, 64), "hex");
}

function encryptKey(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", _key(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${enc.toString("hex")}:${cipher.getAuthTag().toString("hex")}`;
}

function decryptKey(cipherText) {
  const parts = String(cipherText || "").split(":");
  if (parts.length !== 3) return "";
  if (!isByokAvailable()) return "";
  try {
    const [ivHex, dataHex, tagHex] = parts;
    const decipher = crypto.createDecipheriv("aes-256-gcm", _key(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
  } catch (err) {
    // 解不开通常意味着 ENCRYPTION_KEY 换过了。不抛异常：让上层当"没有凭证"处理，
    // 提示用户重新保存，而不是把整个分析入口炸掉。
    console.warn("[BYOK] 凭证解密失败（ENCRYPTION_KEY 可能已变更）:", err.message);
    return "";
  }
}

/** 掩码：只留头 4 位和尾 4 位，中间一律省略 */
function maskKey(plaintext) {
  const s = String(plaintext || "");
  if (s.length <= 10) return "****";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

// ── 存取 ────────────────────────────────────────────────────

function getCredentialRow(userId) {
  if (!userId) return null;
  return getDb()
    .prepare("SELECT * FROM user_llm_credentials WHERE user_id = ?")
    .get(userId) || null;
}

/** 给前端看的安全视图：不含密文，key 只给掩码 */
function getCredentialForUser(userId) {
  const row = getCredentialRow(userId);
  if (!row) return null;
  const plain = decryptKey(row.api_key_cipher);
  return {
    provider: row.provider,
    api_key_masked: plain ? maskKey(plain) : "（无法解密，请重新保存）",
    base_url: row.base_url || "",
    models: {
      default: row.model_default || "",
      heavy: row.model_heavy || "",
      light: row.model_light || "",
    },
    max_output_tokens: row.max_output_tokens || null,
    context_window: row.context_window || null,
    last_validated_at: row.last_validated_at,
    last_validation_status: row.last_validation_status,
    last_validation_message: row.last_validation_message,
    usable: !!plain && row.last_validation_status === "ok",
  };
}

function deleteCredential(userId) {
  getDb().prepare("DELETE FROM user_llm_credentials WHERE user_id = ?").run(userId);
}

/**
 * 保存（upsert）。调用方须先跑 validateCredential 并把结果传进来——
 * 未通过校验的凭证不写库。
 */
function saveCredential(userId, payload, validation) {
  const db = getDb();
  const now = new Date().toISOString();
  const row = {
    user_id: userId,
    provider: payload.provider,
    api_key_cipher: encryptKey(payload.apiKey),
    base_url: payload.baseURL || null,
    model_default: payload.models?.default || null,
    model_heavy: payload.models?.heavy || null,
    model_light: payload.models?.light || null,
    max_output_tokens: payload.maxOutputTokens || null,
    context_window: payload.contextWindow || null,
    last_validated_at: now,
    last_validation_status: validation?.ok ? "ok" : "failed",
    last_validation_message: (validation?.message || "").slice(0, 500),
  };
  db.prepare(`
    INSERT INTO user_llm_credentials
      (user_id, provider, api_key_cipher, base_url, model_default, model_heavy, model_light,
       max_output_tokens, context_window, last_validated_at, last_validation_status, last_validation_message, updated_at)
    VALUES
      (@user_id, @provider, @api_key_cipher, @base_url, @model_default, @model_heavy, @model_light,
       @max_output_tokens, @context_window, @last_validated_at, @last_validation_status, @last_validation_message, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      provider = excluded.provider,
      api_key_cipher = excluded.api_key_cipher,
      base_url = excluded.base_url,
      model_default = excluded.model_default,
      model_heavy = excluded.model_heavy,
      model_light = excluded.model_light,
      max_output_tokens = excluded.max_output_tokens,
      context_window = excluded.context_window,
      last_validated_at = excluded.last_validated_at,
      last_validation_status = excluded.last_validation_status,
      last_validation_message = excluded.last_validation_message,
      updated_at = datetime('now')
  `).run(row);
  return getCredentialForUser(userId);
}

/**
 * 组装分析任务用的 LLM 上下文。
 * 返回 null 表示"这个用户没有可用的自带模型"，调用方应回到平台模型
 * （或按用户的显式选择直接报错，见 analyzeController）。
 */
function buildContextForUser(userId) {
  if (!isByokAvailable()) return null;
  const row = getCredentialRow(userId);
  if (!row) return null;
  const apiKey = decryptKey(row.api_key_cipher);
  if (!apiKey) return null;

  const provider = providers.getProvider(row.provider);
  if (!provider) return null;

  const fallback = row.model_default || provider.defaultModels.default;
  return {
    source: "byok",
    providerId: row.provider,
    apiKey,
    baseURL: row.base_url || "",
    models: {
      default: fallback,
      heavy: row.model_heavy || fallback,
      light: row.model_light || fallback,
    },
    capabilityOverrides: {
      ...(row.max_output_tokens ? { maxOutputTokens: row.max_output_tokens } : {}),
      ...(row.context_window ? { contextWindow: row.context_window } : {}),
    },
    userId,
  };
}

// ── 连通性 + 结构化输出校验 ──────────────────────────────────

// 这个 schema 刻意做得像流水线里的真任务：有必填字符串、有枚举、有数组、
// 有数值。能过这一关的模型，跑 BP 抽取和声明核查才有基本保障。
const PROBE_SCHEMA = {
  type: "object",
  required: ["verdict", "confidence", "reasons"],
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["支持", "存疑", "证伪"] },
    confidence: { type: "number" },
    reasons: { type: "array", items: { type: "string" } },
  },
};

const PROBE_SYSTEM = "你是投资尽调分析师。只输出 JSON 对象，不要任何解释文字。";
const PROBE_USER = [
  "【被核查声明】某公司自称“已与三家世界 500 强签署年框协议”，但材料中未提供合同、客户名称或收入确认。",
  "请判断该声明可信度：verdict 从「支持 / 存疑 / 证伪」三选一，confidence 给 0-1 的小数，reasons 给 1-3 条理由。",
].join("\n");

/**
 * 用**真实调用链**跑一次最小结构化任务。
 * 走 runWithLlmContext + callLLMJson，与分析流水线完全同一条路径，
 * 所以这里能过 = 流水线的基本盘能过。
 *
 * @returns {Promise<{ok:boolean, message:string, detail?:object}>}
 */
async function validateCredential({ provider, apiKey, baseURL, models, maxOutputTokens, contextWindow }) {
  if (!providers.getProvider(provider)) {
    return { ok: false, message: `不支持的模型厂商：${provider}` };
  }
  const hostCheck = providers.validateHost(provider, baseURL, { allowCustom: config.allowCustomLlmEndpoint });
  if (!hostCheck.ok) {
    return { ok: false, message: hostCheck.reason };
  }

  const model = models?.default || providers.getProvider(provider).defaultModels.default;
  const caps = resolveCapabilities(provider, model, { maxOutputTokens, contextWindow });

  // 延迟 require：llmService 会 require 本模块的兄弟模块，避免循环依赖
  const { callLLMJson } = require("./llmService");

  const ctx = {
    source: "byok",
    providerId: provider,
    apiKey,
    baseURL: baseURL || "",
    models: {
      default: model,
      heavy: models?.heavy || model,
      light: models?.light || model,
    },
    capabilityOverrides: {
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      ...(contextWindow ? { contextWindow } : {}),
    },
  };

  const started = Date.now();
  try {
    const result = await runWithLlmContext(ctx, () =>
      Promise.race([
        callLLMJson(PROBE_SYSTEM, PROBE_USER, PROBE_SCHEMA, {
          // 探针要便宜：不开检索、不开思考、预算压到能力允许的最小值
          maxTokens: Math.min(2048, caps.maxOutputTokens),
          maxRepairs: 1,
          thinking: false,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("校验超时（90 秒）：接口地址或网络不通")), VALIDATION_TIMEOUT_MS)
        ),
      ])
    );

    return {
      ok: true,
      message: `连通正常，模型能按 JSON Schema 输出（${result.repairs > 0 ? `修复 ${result.repairs} 次后通过` : "一次通过"}）`,
      detail: {
        model,
        latency_ms: Date.now() - started,
        repairs: result.repairs,
        capabilities: {
          max_output_tokens: caps.maxOutputTokens,
          context_window: caps.contextWindow,
          thinking_style: caps.thinkingStyle,
          supports_tools: caps.supportsTools !== false,
        },
        // 能力不足的地方要在保存时就说清楚，别等分析跑完了用户才发现结论偏松
        warnings: buildCapabilityWarnings(caps),
      },
    };
  } catch (err) {
    return { ok: false, message: _friendlyValidationError(err), detail: { model, latency_ms: Date.now() - started } };
  }
}

/** 能力矩阵层面的提醒：不阻止使用，但必须让用户知道代价 */
function buildCapabilityWarnings(caps) {
  const warnings = [];
  if (caps.thinkingStyle === "none") {
    warnings.push("该模型不支持深度思考开关。声明核查等判定类任务会退回普通模式，判定偏松的概率高于平台默认模型。");
  }
  if (caps.maxOutputTokens < 12000) {
    warnings.push(`该模型单次输出上限约 ${caps.maxOutputTokens} tokens，低于平台默认预算，长报告类任务会自动压缩篇幅。`);
  }
  if (caps.contextWindow < 128000) {
    warnings.push(`该模型上下文窗口约 ${caps.contextWindow} tokens，超长 BP 会被截断，截断部分不参与分析。`);
  }
  if (caps.supportsTools === false) {
    warnings.push("该模型不支持工具调用，联网检索改由服务端预检索注入，检索轮次少于平台默认模型。");
  }
  return warnings;
}

function _friendlyValidationError(err) {
  const msg = err?.message || String(err);
  const status = err?.status;
  if (status === 401 || status === 403 || /认证失败|invalid api key|unauthorized/i.test(msg)) {
    return "API Key 认证失败：请确认 Key 正确、未过期，且对所选模型有权限";
  }
  if (status === 404 || /model.*not.*(found|exist)|无此模型/i.test(msg)) {
    return "模型名不存在：请到厂商控制台确认模型名称（注意大小写和版本后缀）";
  }
  if (status === 402 || /balance|insufficient|余额|欠费/i.test(msg)) {
    return "账户余额不足或未开通该模型的付费权限";
  }
  if (/schema 校验|未通过 schema|提取合法 JSON/i.test(msg)) {
    return "该模型无法稳定按 JSON 格式输出，接入后分析会中途失败。建议换用能力更强的模型";
  }
  if (/超时|timeout/i.test(msg)) {
    return "请求超时：接口地址不可达，或该模型响应过慢";
  }
  return `校验失败：${msg.slice(0, 200)}`;
}

module.exports = {
  isByokAvailable,
  encryptKey,
  decryptKey,
  maskKey,
  getCredentialRow,
  getCredentialForUser,
  saveCredential,
  deleteCredential,
  buildContextForUser,
  validateCredential,
  buildCapabilityWarnings,
  PROBE_SCHEMA,
};
