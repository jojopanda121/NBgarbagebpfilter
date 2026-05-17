function cleanText(v, max = 80) {
  return String(v == null ? "" : v)
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, max);
}

function joinList(items, pick, maxItems, maxChars) {
  const lines = (Array.isArray(items) ? items : [])
    .slice(0, maxItems)
    .map(pick)
    .map((s) => cleanText(s, maxChars))
    .filter(Boolean);
  return lines.join("；");
}

function buildImagePrompt(json) {
  const brand = json?.brand || {};
  const sections = json?.sections || {};

  const metrics = joinList(
    json?.top_metrics,
    (m) => `${m.title}: ${m.value}${m.description ? `(${m.description})` : ""}`,
    4,
    48
  );
  const tech = joinList(sections.technology_flow, (x) => `${x.label}-${x.summary}`, 4, 48);
  const team = joinList(sections.team_capital, (x) => `${x.label}-${x.summary}`, 4, 48);
  const clients = joinList(sections.clients, (x) => x, 5, 24);
  const milestones = joinList(sections.ipo_milestones, (x) => x, 4, 42);
  const highlights = joinList(sections.investment_highlights, (x) => x, 5, 44);
  const finance = joinList(sections.financial_table, (x) => `${x.metric}: ${x.value}`, 4, 36);

  const prompt = [
    "生成一张专业的一页纸投资亮点信息图，横版16:9，JPEG质感。",
    "风格：高端商务、投融资路演、机构研究报告；白色背景，深蓝/藏蓝主色，香槟金强调色，少量灰色分割线。",
    "排版：顶部大标题区；其下4个核心指标卡片；中部左右分栏展示技术路径、团队资本、客户场景；底部展示里程碑、投资亮点和小型财务数据区。",
    "视觉：圆角卡片、细线图标、清晰网格、充足留白；信息密度高但整齐可读；不要炫酷霓虹，不要复杂背景。",
    "文字要求：全部中文文字必须大号、清晰、端正；避免小字长段落；每块最多两行；数字加粗突出；不要生成乱码。",
    `公司：${cleanText(brand.company_name, 36)}${brand.english_name ? ` / ${cleanText(brand.english_name, 36)}` : ""}`,
    `主标题：${cleanText(brand.title, 48)}`,
    `副标题：${cleanText(brand.subtitle, 60)}`,
    `核心指标：${metrics}`,
    `技术/业务路径：${tech}`,
    `团队资本：${team}`,
    `客户/场景：${clients}`,
    `里程碑：${milestones}`,
    `投资亮点：${highlights}`,
    `财务/交易数据：${finance}`,
  ].filter((line) => !/：$/.test(line)).join("\n");

  return prompt.slice(0, 1500);
}

module.exports = { buildImagePrompt, cleanText };
