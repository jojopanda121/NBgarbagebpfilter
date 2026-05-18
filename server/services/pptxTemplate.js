// ============================================================
// server/services/pptxTemplate.js
//
// PPT 模板 harness 共享框架.
//
// 每个 PPT 模板都是同一套范式:
//   - content_schema.json          内容合约
//   - AGENT_SYSTEM_PROMPT.md       让 sub-agent 产 JSON 的 system prompt
//   - example_*.json               few-shot 示例(选填)
//   - {endpoint} doc-service POST  对应的 Python 渲染端点
//
// 调用 createTemplate({...}) 即可得到一个 { generateJson, render, generate } 三件套.
// 加新模板时只用 fill schema/prompt/example/renderer/endpoint, 不写重复代码.
// ============================================================

const fs = require("fs");
const path = require("path");
const { validate, formatErrors } = require("../utils/jsonSchema");
const { callLLMJson } = require("./llmService");
const config = require("../config");
const logger = require("../utils/logger");
const { precheck } = require("../agents/quality/materialPrecheck");
const { critique, blockerInstructions } = require("../agents/quality/contentCritic");

class TemplateSchemaError extends Error {
  constructor(message, errors) {
    super(message);
    this.name = "TemplateSchemaError";
    this.validationErrors = errors || [];
  }
}

class TemplateRenderError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "TemplateRenderError";
    this.status = status || 500;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.name           人类可读名(打日志用)
 * @param {string} opts.assetsDir      schema/prompt/example 文件所在目录
 * @param {string} [opts.schemaFile="content_schema.json"]
 * @param {string} [opts.promptFile="AGENT_SYSTEM_PROMPT.md"]
 * @param {string} [opts.exampleFile]  few-shot 示例 JSON(可选)
 * @param {string} opts.endpoint       doc-service 渲染端点 e.g. "/generate/project_brief"
 * @param {(json:object)=>string} [opts.filenameOf]  根据 JSON 生成 .pptx 文件名
 * @param {number} [opts.maxTokens=4096] LLM JSON 输出 token 上限
 *
 * @returns {{
 *   schema: object,
 *   systemPrompt: string,
 *   example: object|null,
 *   generateJson: (materials:string, opts?:{useSearch?:boolean}) => Promise<{json, searchUsed, repairs}>,
 *   validate: (json:object) => true,
 *   render: (json:object) => Promise<Buffer>,
 *   generate: (materials:string, opts?:{useSearch?:boolean}) => Promise<{json, buffer, searchUsed, repairs}>,
 *   filename: (json:object) => string,
 *   SchemaError: typeof TemplateSchemaError,
 *   RenderError: typeof TemplateRenderError,
 * }}
 */
function createTemplate(opts) {
  const {
    name,
    assetsDir,
    schemaFile = "content_schema.json",
    promptFile = "AGENT_SYSTEM_PROMPT.md",
    exampleFile,
    endpoint,
    filenameOf,
    maxTokens = 4096,
  } = opts;
  if (!name || !assetsDir || !endpoint) {
    throw new Error("createTemplate 需要 name/assetsDir/endpoint");
  }

  const schema = JSON.parse(fs.readFileSync(path.join(assetsDir, schemaFile), "utf-8"));
  const systemPrompt = fs.readFileSync(path.join(assetsDir, promptFile), "utf-8");
  const example = exampleFile
    ? JSON.parse(fs.readFileSync(path.join(assetsDir, exampleFile), "utf-8"))
    : null;
  const exampleText = example ? JSON.stringify(example, null, 2) : null;

  function _validate(json) {
    const { valid, errors } = validate(json, schema);
    if (!valid) {
      throw new TemplateSchemaError(
        `[${name}] JSON 不符合 schema:\n${formatErrors(errors)}`,
        errors
      );
    }
    return true;
  }

  function _buildUserContent(materials, extraInstructions) {
    const userParts = ["【目标公司材料】", materials];
    if (exampleText) {
      userParts.push(
        "",
        "【参考样例: 仅作为字段结构、字数、行文风格的样板, 不要照抄内容】",
        exampleText,
      );
    }
    userParts.push(
      "",
      "请按 system prompt 的要求, 结合上面的目标公司材料, 输出一个**仅含目标公司内容**的合法 JSON.",
    );
    if (extraInstructions) {
      userParts.push("", "【上一轮 critic 指出的必须修复项】", extraInstructions);
    }
    return userParts.join("\n");
  }

  async function generateJson(materials, runOpts = {}) {
    const { useSearch = true, extraInstructions = null, searchQueries = [] } = runOpts;
    if (!materials || typeof materials !== "string" || materials.trim().length < 20) {
      throw new Error(`[${name}] 公司材料不足, 至少 20 字`);
    }
    const userContent = _buildUserContent(materials, extraInstructions);
    const result = await callLLMJson(systemPrompt, userContent, schema, {
      maxTokens,
      maxRepairs: 2,
      useSearch,
      preSearchQueries: searchQueries,
      // P2-4 模型路由：template 名直接映射 skillId
      // (investment_snapshot / project_brief / investment_deck → 经 SKILL_TIER_MAP 路由)
      skillId: name,
    });
    return { json: result.data, searchUsed: !!result.searchUsed, repairs: result.repairs };
  }

  // 退化策略: critic 二次仍 block 时, 把所有 desc/summary/note/bio/rationale 字段
  // 替换为 "材料不足以支撑该字段, 建议补充原始资料."
  // 保留 enum / 数量 / 必填字段结构, 不破版式.
  // 注意: 这是 best-effort. 若 schema 对 minLength 强约束, 占位文本必须 ≥ 该长度.
  function _degradeToPlaceholder(json) {
    const PLACEHOLDER = "材料不足以支撑该字段，建议补充原始资料后重新生成。";
    const DESC_FIELDS = new Set([
      "desc", "summary", "note", "bio", "rationale",
      "mitigant", "comp_anchor",
    ]);
    function walk(node) {
      if (Array.isArray(node)) {
        node.forEach(walk);
      } else if (node && typeof node === "object") {
        for (const k of Object.keys(node)) {
          if (DESC_FIELDS.has(k) && typeof node[k] === "string") {
            node[k] = PLACEHOLDER;
          } else {
            walk(node[k]);
          }
        }
      }
    }
    walk(json);
    return json;
  }

  async function render(json) {
    _validate(json);
    if (!config.docServiceUrl) {
      throw new TemplateRenderError(
        `[${name}] doc-service 未配置(缺少 DOC_SERVICE_URL). 该 PPT 模板只支持 Python 渲染.`,
        503
      );
    }
    // doc-service 偶发抖动 → 一次重试再放弃, 避免单次 fetch failed 直接报错
    let resp;
    let lastFetchErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        resp = await fetch(`${config.docServiceUrl}${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(json),
        });
        lastFetchErr = null;
        break;
      } catch (err) {
        lastFetchErr = err;
        if (attempt === 0) {
          logger.warn(`[PptxTemplate/${name}] doc-service fetch 失败, 1.5s 后重试: ${err.message}`);
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }
    if (lastFetchErr) {
      throw new TemplateRenderError(
        `文档渲染服务暂时不可用, 请稍后重试. (后台细节: ${lastFetchErr.message})`,
        503
      );
    }
    if (!resp.ok) {
      let detail = "";
      try { const j = await resp.json(); detail = j.detail || JSON.stringify(j); }
      catch { detail = await resp.text().catch(() => ""); }
      throw new TemplateRenderError(
        `[${name}] doc-service 渲染失败 (${resp.status}): ${String(detail).slice(0, 300)}`,
        resp.status
      );
    }
    return Buffer.from(await resp.arrayBuffer());
  }

  // generate() 双道闸 harness:
  //   1) 材料预检 (无 LLM) → 不通过直接抛 TemplateSchemaError
  //   2) generateJson 首轮
  //   3) Critic 审查 → 若有 block, 把指令塞回上下文重生一次
  //   4) 二次仍 block, 退化为占位 JSON (版式完整, 内容老实标"材料不足")
  //   5) render
  //
  // 关键 runOpts:
  //   useSearch          (默认 true) — 透传给 generateJson
  //   skipQualityGates   (默认 false) — 测试或紧急绕过时用
  //   skipPrecheck       (默认 false) — 单独绕过预检
  //   skipCritic         (默认 false) — 单独绕过 critic
  async function generate(materials, runOpts = {}) {
    const {
      skipQualityGates = false,
      skipPrecheck = skipQualityGates,
      skipCritic = skipQualityGates,
    } = runOpts;

    // ── 道闸 1: 材料预检 (无 LLM) ─────────────────────────────
    let preStats = null;
    let preWarnings = [];
    if (!skipPrecheck) {
      const pre = precheck(materials, { templateName: name });
      preStats = pre.stats;
      preWarnings = pre.warnings;
      if (!pre.ok) {
        throw new TemplateSchemaError(
          `[${name}] 材料预检未通过: ${pre.errors.join(" | ")}`,
          pre.errors.map((m) => ({ path: "$materials", message: m }))
        );
      }
    }

    // ── 首轮生成 ─────────────────────────────────────────────
    let { json, searchUsed, repairs } = await generateJson(materials, runOpts);

    // ── 道闸 2: Critic ───────────────────────────────────────
    let criticIssues = [];
    let degraded = false;
    if (!skipCritic) {
      let judgment;
      try {
        judgment = await critique({ json, materials, templateName: name });
      } catch (e) {
        // Critic 失败不应阻断生成 — 记日志后跳过
        logger.warn(`[PptxTemplate/${name}] critic 调用失败, 跳过审查: ${e.message}`);
        judgment = { pass: true, issues: [] };
      }
      criticIssues = judgment.issues || [];
      const blockers = criticIssues.filter((i) => i.severity === "block");

      if (blockers.length > 0) {
        // 二次重生 (带修复指令)
        logger.warn(
          `[PptxTemplate/${name}] critic 发现 ${blockers.length} 条 block, 触发带提示重生`
        );
        const repairInstr = blockerInstructions(blockers);
        try {
          const retry = await generateJson(materials, {
            ...runOpts,
            extraInstructions: repairInstr,
          });
          json = retry.json;
          searchUsed = searchUsed || retry.searchUsed;
          repairs += retry.repairs + 1;

          // 二次再审
          let retryJudgment;
          try {
            retryJudgment = await critique({ json, materials, templateName: name });
          } catch (e) {
            logger.warn(`[PptxTemplate/${name}] critic 二次调用失败, 视为通过: ${e.message}`);
            retryJudgment = { pass: true, issues: [] };
          }
          criticIssues = retryJudgment.issues || [];
          const stillBlocked = criticIssues.filter((i) => i.severity === "block");
          if (stillBlocked.length > 0) {
            logger.warn(
              `[PptxTemplate/${name}] critic 二次仍 ${stillBlocked.length} 条 block, 降级为占位版本`
            );
            json = _degradeToPlaceholder(json);
            degraded = true;
          }
        } catch (e) {
          // 重生本身失败 (例如 LLM schema 反复不过), 直接保留首轮 json 但记 warning
          logger.warn(`[PptxTemplate/${name}] critic 触发的重生失败: ${e.message}`);
        }
      }
    }

    // ── 渲染 ─────────────────────────────────────────────────
    const buffer = await render(json);
    logger.info(
      `[PptxTemplate/${name}] generated (size=${buffer.length}, repairs=${repairs}, ` +
      `search=${searchUsed}, criticIssues=${criticIssues.length}, degraded=${degraded})`
    );
    return {
      json,
      buffer,
      searchUsed,
      repairs,
      qualityWarnings: [...preWarnings, ...criticIssues.map((i) => `[critic/${i.severity}] ${i.field}: ${i.detail}`)],
      criticIssues,
      preStats,
      degraded,
    };
  }

  function filename(json) {
    if (typeof filenameOf === "function") return filenameOf(json);
    const company =
      json?.company_full_name || json?.company_name || json?.title || "未命名";
    const safe = String(company).replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40);
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    return `${name}_${safe}_${ymd}.pptx`;
  }

  return {
    schema,
    systemPrompt,
    example,
    generateJson,
    validate: _validate,
    render,
    generate,
    filename,
    SchemaError: TemplateSchemaError,
    RenderError: TemplateRenderError,
  };
}

module.exports = {
  createTemplate,
  TemplateSchemaError,
  TemplateRenderError,
};
