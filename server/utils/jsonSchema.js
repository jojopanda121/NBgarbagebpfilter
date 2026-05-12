// ============================================================
// server/utils/jsonSchema.js
// 极简 JSON Schema 校验器 — 够 LLM 输出契约用，不引入新依赖。
//
// 支持子集（够覆盖一级市场投研结构化输出）：
//   - type: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null"
//   - required: [string]
//   - properties: { key: schema }
//   - additionalProperties: bool（默认 true）
//   - items: schema
//   - minItems / maxItems
//   - minLength / maxLength
//   - minimum / maximum
//   - enum: [literal]
//   - oneOf / anyOf: [schema]
//   - $description: string（仅给 LLM 看的字段说明）
// ============================================================

function _typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (Number.isInteger(v)) return "integer";
  return typeof v; // "string" | "number" | "boolean" | "object" | "undefined"
}

function _matchesType(v, t) {
  if (t === "number") return typeof v === "number" && Number.isFinite(v);
  if (t === "integer") return Number.isInteger(v);
  if (t === "string") return typeof v === "string";
  if (t === "boolean") return typeof v === "boolean";
  if (t === "null") return v === null;
  if (t === "array") return Array.isArray(v);
  if (t === "object") return v !== null && typeof v === "object" && !Array.isArray(v);
  return false;
}

/**
 * @param {*} value
 * @param {object} schema
 * @param {string} [path="$"]
 * @returns {{ valid: boolean, errors: Array<{path:string,message:string}> }}
 */
function validate(value, schema, path = "$") {
  const errors = [];
  _validate(value, schema, path, errors);
  return { valid: errors.length === 0, errors };
}

function _validate(value, schema, path, errors) {
  if (!schema || typeof schema !== "object") return;

  if (schema.enum) {
    if (!schema.enum.some((e) => _deepEqual(e, value))) {
      errors.push({ path, message: `必须是 ${JSON.stringify(schema.enum)} 之一,实际 ${JSON.stringify(value)}` });
      return;
    }
  }

  if (schema.oneOf || schema.anyOf) {
    const branches = schema.oneOf || schema.anyOf;
    let matched = 0;
    let lastErrors = [];
    for (const sub of branches) {
      const sub_errors = [];
      _validate(value, sub, path, sub_errors);
      if (sub_errors.length === 0) matched++;
      else lastErrors = sub_errors;
    }
    if (schema.oneOf && matched !== 1) {
      errors.push({ path, message: `必须严格匹配 oneOf 之一(实际匹配 ${matched} 个)` });
      errors.push(...lastErrors);
      return;
    }
    if (schema.anyOf && matched === 0) {
      errors.push({ path, message: `必须匹配 anyOf 之一` });
      errors.push(...lastErrors);
      return;
    }
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => _matchesType(value, t))) {
      errors.push({ path, message: `期望类型 ${types.join("|")},实际 ${_typeOf(value)}` });
      return;
    }
  }

  if (typeof value === "string") {
    if (schema.minLength != null && value.length < schema.minLength) {
      errors.push({ path, message: `字符串至少 ${schema.minLength} 字符,实际 ${value.length}` });
    }
    if (schema.maxLength != null && value.length > schema.maxLength) {
      errors.push({ path, message: `字符串最多 ${schema.maxLength} 字符,实际 ${value.length}` });
    }
  }

  if (typeof value === "number") {
    if (schema.minimum != null && value < schema.minimum) {
      errors.push({ path, message: `数值不得小于 ${schema.minimum},实际 ${value}` });
    }
    if (schema.maximum != null && value > schema.maximum) {
      errors.push({ path, message: `数值不得大于 ${schema.maximum},实际 ${value}` });
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) {
      errors.push({ path, message: `数组至少 ${schema.minItems} 项,实际 ${value.length}` });
    }
    if (schema.maxItems != null && value.length > schema.maxItems) {
      errors.push({ path, message: `数组最多 ${schema.maxItems} 项,实际 ${value.length}` });
    }
    if (schema.items) {
      value.forEach((v, i) => _validate(v, schema.items, `${path}[${i}]`, errors));
    }
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (Array.isArray(schema.required)) {
      for (const k of schema.required) {
        if (!(k in value)) errors.push({ path, message: `缺少必填字段 "${k}"` });
      }
    }
    if (schema.properties) {
      for (const [k, sub] of Object.entries(schema.properties)) {
        if (k in value) _validate(value[k], sub, `${path}.${k}`, errors);
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const k of Object.keys(value)) {
        if (!(k in schema.properties)) {
          errors.push({ path, message: `不允许的额外字段 "${k}"` });
        }
      }
    }
  }
}

function _deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => _deepEqual(v, b[i]));
  }
  if (typeof a === "object") {
    const ak = Object.keys(a), bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => _deepEqual(a[k], b[k]));
  }
  return false;
}

/** 把 schema 压缩成给 LLM 看的紧凑文本 — 节省 token,且更易让模型理解契约 */
function stringifyForPrompt(schema) {
  return JSON.stringify(schema, null, 2);
}

/** 把校验错误格式化成给 LLM 看的"修复指令" */
function formatErrors(errors) {
  return errors.map((e) => `- ${e.path}: ${e.message}`).join("\n");
}

module.exports = { validate, stringifyForPrompt, formatErrors };
