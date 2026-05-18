// ============================================================
// skills/_evidenceMaterial.js
//
// For template-based artifacts, keep visual/layout rendering deterministic
// while injecting the same Evidence Pack used by standardized JSON skills.
// ============================================================

const {
  buildEvidencePack,
  buildSearchPlan,
  formatFactPackForPrompt,
} = require("./_factPack");
const { priorityHintForPrompt } = require("./_fieldPriorities");

async function augmentMaterialsWithEvidence({
  project,
  ctx = {},
  skillId,
  materials,
  companyHint = "",
  industryHint = "",
  useSearch = true,
  // 兼容 9 个 skill 旧的 enable_bp_deep_parsing 参数：buildEvidencePack 已不再
  // 从 BP 原文跑 deep parsing（上传材料结构化抽取在上传时就完成了），这里只
  // 透传以避免老调用方崩，下游不消费。
  enableBpDeepParsing,
  enableInstitutionalMemory,
  maxFacts,
  imLimit,
}) {
  const evidence = await buildEvidencePack(project, {
    ctx,
    skillId,
    companyHint,
    industryHint,
    materialsHint: materials,
    useSearch,
    enableBpDeepParsing,
    enableInstitutionalMemory,
    maxFacts,
    imLimit,
  });
  const evidenceText = formatFactPackForPrompt(evidence.factPack);
  const priorityHint = priorityHintForPrompt(skillId);
  // P2-3: 把"稳定长前缀"（Evidence Pack 主体 + 通用产出约束）和"动态尾部"分开
  // 给调用方做 prompt caching。同时保留 combined materials 字段向后兼容。
  const cacheablePrefix = [
    "【Evidence Pack v2：生成时必须优先引用，禁止编造】",
    evidenceText,
    "",
    "【产出约束】",
    "1. 用户上传材料优先级最高；若上传材料与 BP 或外部检索冲突，必须标注冲突/待核实。",
    "2. 市场规模、竞品、融资、估值、创始人背景、政策、客户名等外部事实只能来自 Evidence Pack 或明确写待核实。",
    "3. 视觉设计、页数、坐标、字体、颜色由模板渲染器控制，内容 JSON 不得包含 layout/style/font/color/position 等字段。",
    priorityHint ? "" : null,
    priorityHint || null,
  ]
    .filter((line) => line !== null)
    .join("\n");
  const dynamicTail = materials || "";
  const augmented = dynamicTail
    ? `${dynamicTail}\n\n${cacheablePrefix}`
    : cacheablePrefix;
  return {
    materials: augmented,
    cacheablePrefix,
    dynamicTail,
    evidence,
    searchQueries: buildSearchPlan(evidence.factPack, {
      skillId,
      companyHint,
      industryHint,
      materialsHint: materials,
    }),
  };
}

module.exports = { augmentMaterialsWithEvidence };
