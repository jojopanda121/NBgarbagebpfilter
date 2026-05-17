// ============================================================
// Workspace Agent / Tool Registry
//
// 显式声明 Host、子 Agent、工具与 skill 的能力边界。
// 模型只能“请求”这些工具；真正执行仍由后端校验后完成。
// ============================================================

const HOST_DEFINITION = {
  name: "host",
  label: "投资负责人",
  role: "Investment Lead / Host",
  description: "拆解任务、制定执行计划、调度专家和 MiniMax 工具、选择模板产物，并把专家意见收敛成投不投、什么条件投、下一步怎么做。",
  skills: ["task_decomposition", "expert_orchestration", "template_selection", "investment_synthesis"],
  tools: [
    "web_search", "onepager_pptx", "investment_snapshot", "highlight_visual",
    "project_brief", "investment_deck_pptx", "generate_docx", "generate_xlsx",
    "dd_checklist_xlsx", "founder_interview_docx", "competitor_matrix_xlsx",
    "ic_questions_xlsx",
  ],
  searchEnabled: false,
};

const AGENT_REGISTRY = {
  market_deal: {
    label: "市场/交易",
    role: "Market & Deal Agent",
    description: "TAM/SAM/SOM、政策、竞品格局、GTM、客户预算、本轮融资信息、Pre-money、融资额、领投状态、cap table、data room 缺口。",
    skills: ["market_sizing", "competitive_mapping", "policy_scan", "deal_intake", "data_room_gap"],
    tools: ["web_search", "extract_document"],
    searchEnabled: true,
    mustNot: "不做 term sheet 最终条款建议，不替代财务模型，不输出投决结论。",
  },
  finance_valuation: {
    label: "财务/估值",
    role: "Finance & Valuation Agent",
    description: "收入质量、ARR/MRR、毛利、CAC/LTV、burn、runway、回款周期、预测可信度、估值区间、稀释比例、ownership target、条款保护。",
    skills: ["financial_model_review", "valuation_benchmark", "unit_economics", "scenario_analysis", "term_sheet_review"],
    tools: ["extract_document"],
    searchEnabled: false,
    mustNot: "不编造可比交易或估值倍数；缺数据时必须标待核实。",
  },
  product_team_risk: {
    label: "产品/团队/风险",
    role: "Product, Team & Risk Agent",
    description: "TRL、技术壁垒、产品成熟度、交付风险、创始人履历、关键岗位缺口、背调问题、监管、诉讼、夸大声明、客户集中、合规风险。",
    skills: ["product_due_diligence", "technical_moat_review", "founder_review", "red_flag_scan", "regulatory_scan"],
    tools: ["web_search", "extract_document"],
    searchEnabled: true,
    mustNot: "不因为 BP 话术夸张就复读卖点；团队和风险判断必须落到可验证尽调动作。",
  },
};

const TOOL_REGISTRY = {
  web_search: {
    label: "公开信息检索",
    category: "research",
    executor: "minimax_coding_plan",
    callableByModel: true,
    allowedCallers: ["host", "market_deal", "product_team_risk"],
    description: "通过 MiniMax Token Plan / Coding Plan web_search 执行公开网络检索，用于最新市场、政策、竞品、监管、负面新闻核验。",
  },
  extract_document: {
    label: "文档解析",
    category: "document",
    executor: "upload_pipeline",
    callableByModel: false,
    allowedCallers: ["market_deal", "finance_valuation", "product_team_risk", "host"],
    description: "上传 PDF/PPTX/DOCX/XLSX/CSV/TXT/MD 后由后端提取摘要并注入项目上下文。",
  },
  onepager_pptx: {
    label: "一页投资亮点 PPT",
    category: "artifact",
    executor: "skill_template",
    callableByModel: true,
    allowedCallers: ["host"],
    argShape:
      '默认: {"source_mode":"bp_analysis"} | ' +
      '即时材料: {"source_mode":"materials","materials":"<原文>","company_hint":"<公司全称>"}',
    description:
      "调用模板 skill 生成 1 页 16:9 投资亮点 PPT。" +
      "默认 (bp_analysis) 基于项目已落库 BP 多 Agent 分析, 保证跨公司一致; " +
      "用户明确说 '基于这段材料' 时切到 materials 模式. 视觉和版式由模板锁定.",
  },
  investment_snapshot: {
    label: "一页纸投决速览",
    category: "artifact",
    executor: "skill_template",
    callableByModel: true,
    allowedCallers: ["host"],
    argShape: '{"materials":"<可选，公司原始材料；留空则用项目上下文>","company_hint":"<可选，公司全称>"}',
    description: "调用模板 skill 生成 1 页 A4 横版投决速览。适合投决/速览/one-pager，视觉和版式由 Python 渲染器锁定。",
  },
  highlight_visual: {
    label: "一页纸亮点视觉图",
    category: "artifact",
    executor: "skill_template",
    callableByModel: true,
    allowedCallers: ["host"],
    argShape: '{"materials":"<可选，公司原始材料；留空则用项目上下文>","company_hint":"<可选，公司全称>"}',
    description: "调用 MiniMax image-01 生成 1 页投资亮点视觉信息图 JPEG。适合微信、邮件、FA 批量转发的视觉化项目摘要。",
  },
  project_brief: {
    label: "项目简报 3 页 deck",
    category: "artifact",
    executor: "skill_template",
    callableByModel: true,
    allowedCallers: ["host"],
    argShape: '{"materials":"<可选，公司原始材料；留空则用项目上下文>","company_hint":"<可选，公司全称>"}',
    description: "调用模板 skill 生成 3 页项目简报 deck（封面 / 概况+亮点 / 团队+财务+估值）。视觉和版式由 Python 渲染器锁定。",
  },
  investment_deck_pptx: {
    label: "可变页数投决材料 PPT",
    category: "artifact",
    executor: "skill_template",
    callableByModel: true,
    allowedCallers: ["host"],
    argShape: '{"target_pages":16,"deck_type":"investment_committee","materials":"<可选，公司原始材料；留空则用项目上下文>","company_hint":"<可选，公司全称>"}',
    description: "调用模板 skill 生成 8-30 页投决报告/可研报告/尽调汇报 PPT。适合用户要求 10页、15页、20页、30页、完整投委会材料等场景。视觉和版式由 Python 渲染器锁定。",
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
  dd_checklist_xlsx: {
    label: "尽调问题清单 Excel",
    category: "artifact",
    executor: "skill_template",
    callableByModel: true,
    allowedCallers: ["host"],
    argShape: '{"focus_areas":["commercial","financial"],"stage_context":"A 轮投决前"}',
    description: "一次调用生成结构化尽调追问清单并导出 Excel。当用户要求尽调清单/DD checklist/尽调追问时优先使用；内部复用 dd_questions + generate_xlsx，不要求模型连续调用两个工具。",
  },
  founder_interview_docx: {
    label: "创始人访谈提纲",
    category: "artifact",
    executor: "skill_template",
    callableByModel: true,
    allowedCallers: ["host"],
    argShape: '{"interview_stage":"IC 前复核","focus_areas":["商业化","团队治理"]}',
    description: "生成标准化创始人访谈提纲 Word：问题、为什么问、追问、好答案信号、红旗信号、事实来源。",
  },
  competitor_matrix_xlsx: {
    label: "竞品对比矩阵 Excel",
    category: "artifact",
    executor: "skill_template",
    callableByModel: true,
    allowedCallers: ["host"],
    argShape: '{"include_hypothesis":true,"focus_dimension":"产品能力/商业模式/客户渠道"}',
    description: "生成标准化竞品对比矩阵 Excel，明确区分已确认竞品与待确认假设竞品，缺失数据不编造。",
  },
  ic_questions_xlsx: {
    label: "IC 投委问题清单",
    category: "artifact",
    executor: "skill_template",
    callableByModel: true,
    allowedCallers: ["host"],
    argShape: '{"ic_stage":"投委会汇报前预演","question_count":12}',
    description: "通过 Bull/Bear 左右脑互搏，生成投委可能追问的 Top 问题、建议回答、需补材料和负责人。",
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
    .map(([name, def]) => `- "${name}" ${def.label}：${def.description} 边界：${def.mustNot || "只回答本专业范围。"}`)
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
    def.mustNot ? `禁区：${def.mustNot}` : null,
    `边界：你不能直接生成文件；如需产物，由 Host 汇总后调用文档生成工具。`,
  ].filter(Boolean).join("\n");
}

function listWorkspaceCapabilities() {
  return {
    agents: [
      HOST_DEFINITION,
      ...Object.entries(AGENT_REGISTRY).map(([name, def]) => ({
      name,
      label: def.label,
      role: def.role,
      description: def.description,
      skills: def.skills,
      tools: def.tools,
      searchEnabled: def.searchEnabled,
      mustNot: def.mustNot || "",
    })),
    ],
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
  HOST_DEFINITION,
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
