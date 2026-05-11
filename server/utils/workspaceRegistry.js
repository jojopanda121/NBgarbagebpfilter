// ============================================================
// Workspace Agent / Tool Registry
//
// 显式声明 Host、子 Agent、工具与 skill 的能力边界。
// 模型只能“请求”这些工具；真正执行仍由后端校验后完成。
// ============================================================

const AGENT_REGISTRY = {
  market: {
    label: "市场/赛道",
    role: "Market Agent",
    description: "TAM/SAM/SOM、CAGR、渗透率、政策驱动、竞品格局、客户画像、GTM、渠道效率、市场时点。",
    skills: ["market_sizing", "competitive_mapping", "policy_scan", "gtm_diagnosis"],
    tools: ["web_search"],
    searchEnabled: true,
  },
  finance: {
    label: "财务/估值",
    role: "Finance Agent",
    description: "收入质量、毛利率、现金流、单位经济、回款周期、ARR/MRR、财务预测、估值倍数、融资金额合理性。",
    skills: ["financial_model_review", "valuation_benchmark", "unit_economics", "scenario_analysis"],
    tools: ["extract_document"],
    searchEnabled: false,
  },
  tech: {
    label: "技术/产品",
    role: "Tech Agent",
    description: "TRL、技术壁垒、产品成熟度、架构可行性、研发路线、专利/论文/开源依赖、交付复杂度。",
    skills: ["trl_assessment", "product_due_diligence", "technical_moat_review", "delivery_risk_review"],
    tools: ["extract_document"],
    searchEnabled: false,
  },
  risk: {
    label: "风险/合规",
    role: "Risk Agent",
    description: "监管、法律、供应链、创始人背景、夸大陈述、信息不对称、客户集中、数据安全、造假信号。",
    skills: ["red_flag_scan", "claim_verification", "regulatory_scan", "fraud_signal_review"],
    tools: ["web_search", "extract_document"],
    searchEnabled: true,
  },
};

const TOOL_REGISTRY = {
  web_search: {
    label: "公开信息检索",
    category: "research",
    executor: "llm_builtin",
    callableByModel: false,
    allowedCallers: ["market", "risk"],
    description: "由 MiniMax M2 内置 web_search 支持，用于市场、政策、竞品、监管、负面信息核验。",
  },
  extract_document: {
    label: "文档解析",
    category: "document",
    executor: "upload_pipeline",
    callableByModel: false,
    allowedCallers: ["market", "finance", "tech", "risk", "host"],
    description: "上传 PDF/PPTX/DOCX/XLSX/CSV/TXT/MD 后由后端提取摘要并注入项目上下文。",
  },
  generate_pptx: {
    label: "生成 PPT",
    category: "artifact",
    executor: "doc_service",
    callableByModel: true,
    allowedCallers: ["host"],
    endpoint: "/generate/pptx",
    extension: "pptx",
    artifactKind: "generated_pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    defaultTitle: "投委会简报",
    argShape: '{"title":"...","subtitle":"...","slides":[{"title":"...","bullets":["..."],"notes":"..."}]}',
    description: "生成投委会演示、路演材料、项目简报。",
  },
  generate_docx: {
    label: "生成 Word",
    category: "artifact",
    executor: "doc_service",
    callableByModel: true,
    allowedCallers: ["host"],
    endpoint: "/generate/docx",
    extension: "docx",
    artifactKind: "generated_docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    defaultTitle: "尽调备忘录",
    argShape: '{"title":"...","subtitle":"...","sections":[{"heading":"...","paragraphs":["..."],"bullets":["..."]}]}',
    description: "生成尽调备忘录、会议纪要、投资 memo、风险清单。",
  },
  generate_xlsx: {
    label: "生成 Excel",
    category: "artifact",
    executor: "doc_service",
    callableByModel: true,
    allowedCallers: ["host"],
    endpoint: "/generate/xlsx",
    extension: "xlsx",
    artifactKind: "generated_xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    defaultTitle: "投研表格",
    argShape: '{"title":"...","sheets":[{"name":"...","headers":["..."],"rows":[["..."]]}]}',
    description: "生成财务模型、尽调清单、风险台账、竞品表。",
  },
};

function getAgentNames() {
  return Object.keys(AGENT_REGISTRY);
}

function getAgentDefinition(name) {
  return AGENT_REGISTRY[name] || null;
}

function getSearchEnabledAgents() {
  return new Set(
    Object.entries(AGENT_REGISTRY)
      .filter(([, def]) => def.searchEnabled)
      .map(([name]) => name)
  );
}

function getToolDefinition(name) {
  return TOOL_REGISTRY[name] || null;
}

function getCallableToolNames() {
  return Object.entries(TOOL_REGISTRY)
    .filter(([, def]) => def.callableByModel)
    .map(([name]) => name);
}

function assertToolAllowed(toolName, caller = "host") {
  const def = getToolDefinition(toolName);
  if (!def) throw new Error(`未知工具: ${toolName}`);
  if (!def.callableByModel) throw new Error(`工具不可由模型直接调用: ${toolName}`);
  if (!def.allowedCallers.includes(caller)) {
    throw new Error(`工具 ${toolName} 不允许 ${caller} 调用`);
  }
  return def;
}

function renderAgentCatalog() {
  return Object.entries(AGENT_REGISTRY)
    .map(([name, def]) => `- "${name}" ${def.label}：${def.description}`)
    .join("\n");
}

function renderToolInstructions() {
  return getCallableToolNames()
    .map((name, idx) => {
      const def = TOOL_REGISTRY[name];
      return `${idx + 1}. ${name}（${def.label}）：${def.description}\n<TOOL_CALL>{"tool":"${name}","args":${def.argShape}}</TOOL_CALL>`;
    })
    .join("\n\n");
}

function renderAgentCapabilityBlock(agentName) {
  const def = getAgentDefinition(agentName);
  if (!def) return "";
  const tools = def.tools.map((t) => {
    const tool = TOOL_REGISTRY[t];
    return tool ? `${t}（${tool.label}）` : t;
  });
  return [
    `角色：${def.role} / ${def.label}`,
    `擅长：${def.description}`,
    `可用 skills：${def.skills.join("、")}`,
    `可用 tools：${tools.join("、") || "无直接工具"}`,
    `边界：你不能直接生成文件；如需产物，由 Host 汇总后调用文档生成工具。`,
  ].join("\n");
}

function listWorkspaceCapabilities() {
  return {
    agents: Object.entries(AGENT_REGISTRY).map(([name, def]) => ({
      name,
      label: def.label,
      role: def.role,
      description: def.description,
      skills: def.skills,
      tools: def.tools,
      searchEnabled: def.searchEnabled,
    })),
    tools: Object.entries(TOOL_REGISTRY).map(([name, def]) => ({
      name,
      label: def.label,
      category: def.category,
      callableByModel: def.callableByModel,
      allowedCallers: def.allowedCallers,
      description: def.description,
    })),
  };
}

module.exports = {
  AGENT_REGISTRY,
  TOOL_REGISTRY,
  getAgentNames,
  getAgentDefinition,
  getSearchEnabledAgents,
  getToolDefinition,
  getCallableToolNames,
  assertToolAllowed,
  renderAgentCatalog,
  renderToolInstructions,
  renderAgentCapabilityBlock,
  listWorkspaceCapabilities,
};
