// 配色严格对齐 client/src/index.css 的 CSS 变量
const C = {
  navy: "#0D2145",
  navy2: "#163069",
  accent: "#1B4FD8",
  accent2: "#3B6EF5",
  gold: "#A0700A",
  bg: "#F6F7FA",
  bg2: "#FFFFFF",
  bg3: "#EEF1F7",
  bg4: "#E5E9F4",
  border: "#D8DCE8",
  border2: "#BFC5D6",
  text: "#0F1C36",
  mid: "#4B5A72",
  dim: "#8E9BB0",
};

const CANVAS_W = 1600;
const CANVAS_H = 900;

function h(type, style, children) {
  return {
    type,
    props: {
      style,
      children: children == null
        ? undefined
        : Array.isArray(children)
          ? children.filter((c) => c != null && c !== false)
          : children,
    },
  };
}

function clip(s, max) {
  const v = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  if (v.length <= max) return v;
  return v.slice(0, Math.max(1, max - 1)) + "…";
}

function safeArr(a) {
  return Array.isArray(a) ? a.filter(Boolean) : [];
}

function Header(brand) {
  const company = clip(brand?.company_name || "未命名公司", 14);
  const english = clip(brand?.english_name || "", 28);
  const title = clip(brand?.title || "一页纸投资亮点", 22);
  const subtitle = clip(brand?.subtitle || "", 44);

  return h(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      width: "100%",
      height: 96,
      borderRadius: 14,
      overflow: "hidden",
      border: `1px solid ${C.border}`,
    },
    [
      h(
        "div",
        {
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 28px",
          width: 420,
          background: `linear-gradient(135deg, ${C.navy} 0%, ${C.navy2} 100%)`,
          color: "#FFFFFF",
        },
        [
          h(
            "div",
            { display: "flex", fontSize: 30, fontWeight: 700, color: "#FFFFFF", lineHeight: 1.15 },
            company,
          ),
          english
            ? h(
                "div",
                { display: "flex", fontSize: 13, fontWeight: 400, color: "#C7D1E6", marginTop: 6, letterSpacing: 0.5 },
                english,
              )
            : null,
        ],
      ),
      h(
        "div",
        {
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 28px",
          flex: 1,
          background: C.bg2,
          overflow: "hidden",
        },
        [
          h("div", { display: "flex", fontSize: 22, fontWeight: 700, color: C.text, lineHeight: 1.2 }, title),
          subtitle
            ? h("div", { display: "flex", fontSize: 14, fontWeight: 400, color: C.mid, marginTop: 8, lineHeight: 1.35 }, subtitle)
            : null,
        ],
      ),
      h(
        "div",
        {
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-end",
          padding: "0 24px",
          width: 150,
          background: C.bg2,
          borderLeft: `1px solid ${C.border}`,
        },
        [
          h("div", { display: "flex", fontSize: 11, fontWeight: 400, color: C.dim, letterSpacing: 1 }, "INVESTMENT"),
          h("div", { display: "flex", fontSize: 18, fontWeight: 700, color: C.gold, marginTop: 4 }, "亮点速览"),
        ],
      ),
    ],
  );
}

function MetricCard(m) {
  return h(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      flex: 1,
      height: "100%",
      padding: "18px 20px",
      background: C.bg2,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      overflow: "hidden",
    },
    [
      h(
        "div",
        { display: "flex", fontSize: 12, fontWeight: 400, color: C.dim, letterSpacing: 0.5 },
        clip(m?.title || "", 14),
      ),
      h(
        "div",
        { display: "flex", fontSize: 32, fontWeight: 700, color: C.navy, marginTop: 8, lineHeight: 1.1 },
        clip(m?.value || "—", 14),
      ),
      m?.description
        ? h(
            "div",
            { display: "flex", fontSize: 12, fontWeight: 400, color: C.mid, marginTop: 8, lineHeight: 1.3 },
            clip(m.description, 26),
          )
        : null,
    ],
  );
}

function MetricsRow(metrics) {
  const cards = safeArr(metrics).slice(0, 4);
  while (cards.length < 4) cards.push({ title: " ", value: " " });
  return h(
    "div",
    { display: "flex", flexDirection: "row", width: "100%", height: 150, gap: 16 },
    cards.map(MetricCard),
  );
}

function SectionCard({ title, subtitle, flex, children }) {
  return h(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      flex,
      height: "100%",
      padding: 22,
      background: C.bg2,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      overflow: "hidden",
    },
    [
      h(
        "div",
        { display: "flex", flexDirection: "row", alignItems: "center", marginBottom: 14 },
        [
          h("div", { display: "flex", width: 4, height: 16, background: C.accent, borderRadius: 2, marginRight: 10 }, ""),
          h("div", { display: "flex", fontSize: 14, fontWeight: 700, color: C.text, letterSpacing: 0.5 }, title),
          subtitle
            ? h("div", { display: "flex", fontSize: 11, fontWeight: 400, color: C.dim, marginLeft: 10 }, subtitle)
            : null,
        ],
      ),
      h("div", { display: "flex", flexDirection: "column", flex: 1, gap: 6, overflow: "hidden" }, children),
    ],
  );
}

function LabelSummaryItem(item) {
  return h(
    "div",
    { display: "flex", flexDirection: "column", padding: "8px 10px", background: C.bg3, borderRadius: 8 },
    [
      h(
        "div",
        { display: "flex", fontSize: 13, fontWeight: 700, color: C.navy, lineHeight: 1.25 },
        clip(item?.label || "—", 18),
      ),
      h(
        "div",
        { display: "flex", fontSize: 12, fontWeight: 400, color: C.mid, marginTop: 4, lineHeight: 1.35 },
        clip(item?.summary || "", 44),
      ),
    ],
  );
}

function TextChip(label) {
  return h(
    "div",
    {
      display: "flex",
      padding: "8px 12px",
      background: C.bg4,
      border: `1px solid ${C.border}`,
      borderRadius: 999,
      fontSize: 13,
      fontWeight: 400,
      color: C.text,
    },
    clip(label, 18),
  );
}

function MiddleRow(sections) {
  // 3 项是中卡 290px 高度内能稳定容纳的上限（带 summary 两行不溢出）
  const tech = safeArr(sections?.technology_flow).slice(0, 3);
  const team = safeArr(sections?.team_capital).slice(0, 3);
  const clients = safeArr(sections?.clients).slice(0, 6);

  return h(
    "div",
    { display: "flex", flexDirection: "row", width: "100%", height: 290, gap: 16 },
    [
      SectionCard({
        title: "技术 / 业务路径",
        flex: 1.2,
        children: tech.length
          ? tech.map(LabelSummaryItem)
          : [h("div", { display: "flex", fontSize: 12, color: C.dim }, "暂无信息")],
      }),
      SectionCard({
        title: "团队 / 资本",
        flex: 1.2,
        children: team.length
          ? team.map(LabelSummaryItem)
          : [h("div", { display: "flex", fontSize: 12, color: C.dim }, "暂无信息")],
      }),
      SectionCard({
        title: "客户 / 场景",
        flex: 1,
        children: [
          h(
            "div",
            { display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 8 },
            clients.length
              ? clients.map(TextChip)
              : [h("div", { display: "flex", fontSize: 12, color: C.dim }, "暂无信息")],
          ),
        ],
      }),
    ],
  );
}

function HighlightItem(text, idx) {
  return h(
    "div",
    { display: "flex", flexDirection: "row", alignItems: "flex-start", padding: "3px 0" },
    [
      h(
        "div",
        {
          display: "flex",
          width: 22,
          height: 22,
          background: C.accent,
          color: "#FFFFFF",
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 700,
          alignItems: "center",
          justifyContent: "center",
          marginRight: 10,
          flexShrink: 0,
        },
        String(idx + 1),
      ),
      h(
        "div",
        { display: "flex", flex: 1, fontSize: 13, fontWeight: 400, color: C.text, lineHeight: 1.4 },
        clip(text, 56),
      ),
    ],
  );
}

function MilestoneItem(text) {
  return h(
    "div",
    { display: "flex", flexDirection: "row", alignItems: "center", padding: "4px 0" },
    [
      h("div", { display: "flex", width: 6, height: 6, borderRadius: 3, background: C.gold, marginRight: 10, flexShrink: 0 }, ""),
      h("div", { display: "flex", flex: 1, fontSize: 12, fontWeight: 400, color: C.mid, lineHeight: 1.35 }, clip(text, 36)),
    ],
  );
}

function FinanceRow(item, last) {
  return h(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "8px 0",
      borderBottom: last ? "none" : `1px solid ${C.border}`,
    },
    [
      h("div", { display: "flex", fontSize: 12, fontWeight: 400, color: C.mid }, clip(item?.metric || "", 14)),
      h("div", { display: "flex", fontSize: 14, fontWeight: 700, color: C.navy }, clip(item?.value || "—", 14)),
    ],
  );
}

function BottomRow(sections) {
  // 底部行 208px：亮点 4 条、里程碑 3 条、财务 3 行 是安全容纳上限
  const highlights = safeArr(sections?.investment_highlights).slice(0, 4);
  const milestones = safeArr(sections?.ipo_milestones).slice(0, 3);
  const finance = safeArr(sections?.financial_table).slice(0, 3);

  return h(
    "div",
    { display: "flex", flexDirection: "row", width: "100%", height: 208, gap: 16 },
    [
      h(
        "div",
        {
          display: "flex",
          flexDirection: "row",
          flex: 1.7,
          gap: 16,
          height: "100%",
        },
        [
          SectionCard({
            title: "核心投资亮点",
            flex: 1.3,
            children: highlights.length
              ? highlights.map((t, i) => HighlightItem(t, i))
              : [h("div", { display: "flex", fontSize: 12, color: C.dim }, "暂无信息")],
          }),
          SectionCard({
            title: "里程碑 / 路径",
            flex: 1,
            children: milestones.length
              ? milestones.map(MilestoneItem)
              : [h("div", { display: "flex", fontSize: 12, color: C.dim }, "暂无信息")],
          }),
        ],
      ),
      SectionCard({
        title: "财务 / 交易",
        flex: 1,
        children: finance.length
          ? finance.map((f, i) => FinanceRow(f, i === finance.length - 1))
          : [h("div", { display: "flex", fontSize: 12, color: C.dim }, "暂无信息")],
      }),
    ],
  );
}

// ============================================================
// 三模板 panel：value_chain / ue_flywheel / positioning_map
// 每个 panel 顶替原 MiddleRow（290px 高，1520px 宽，扣去 padding 后）
// 都返回单个 div，与 SectionCard 视觉风格一致
// ============================================================

function TemplatePanel({ title, badge, children }) {
  return h(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      width: "100%",
      height: 290,
      padding: 22,
      background: C.bg2,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      overflow: "hidden",
    },
    [
      h(
        "div",
        { display: "flex", flexDirection: "row", alignItems: "center", marginBottom: 14 },
        [
          h("div", { display: "flex", width: 4, height: 16, background: C.accent, borderRadius: 2, marginRight: 10 }, ""),
          h("div", { display: "flex", fontSize: 14, fontWeight: 700, color: C.text, letterSpacing: 0.5 }, title),
          badge
            ? h(
                "div",
                {
                  display: "flex",
                  marginLeft: 10,
                  padding: "2px 8px",
                  background: C.bg4,
                  border: `1px solid ${C.border}`,
                  borderRadius: 999,
                  fontSize: 10,
                  color: C.mid,
                  letterSpacing: 0.5,
                },
                badge,
              )
            : null,
        ],
      ),
      h("div", { display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }, children),
    ],
  );
}

function ValueChainPanel(vc) {
  const nodes = safeArr(vc?.nodes).slice(0, 6);
  const targetIdx = Number.isInteger(vc?.company_position_index) ? vc.company_position_index : -1;
  return TemplatePanel({
    title: "产业链价值流转图",
    badge: "Value Chain Map",
    children: [
      h(
        "div",
        { display: "flex", flexDirection: "row", flex: 1, gap: 10, alignItems: "stretch" },
        nodes.length === 0
          ? [h("div", { display: "flex", fontSize: 12, color: C.dim }, "暂无产业链数据")]
          : nodes.flatMap((n, i) => {
              const isTarget = i === targetIdx;
              const card = h(
                "div",
                {
                  display: "flex",
                  flexDirection: "column",
                  flex: 1,
                  padding: 12,
                  background: isTarget ? C.navy : C.bg3,
                  color: isTarget ? "#FFFFFF" : C.text,
                  borderRadius: 10,
                  border: isTarget ? `2px solid ${C.gold}` : `1px solid ${C.border}`,
                },
                [
                  h(
                    "div",
                    {
                      display: "flex",
                      fontSize: 11,
                      fontWeight: 700,
                      color: isTarget ? C.gold : C.accent,
                      letterSpacing: 0.5,
                    },
                    clip(n?.stage || `环节${i + 1}`, 12),
                  ),
                  h(
                    "div",
                    {
                      display: "flex",
                      fontSize: 13,
                      fontWeight: 700,
                      marginTop: 6,
                      color: isTarget ? "#FFFFFF" : C.navy,
                      lineHeight: 1.3,
                    },
                    clip(n?.role || "—", 28),
                  ),
                  h(
                    "div",
                    {
                      display: "flex",
                      fontSize: 11,
                      fontWeight: 400,
                      marginTop: 8,
                      color: isTarget ? "#C7D1E6" : C.mid,
                      lineHeight: 1.3,
                    },
                    clip(n?.value_capture || "待核实", 36),
                  ),
                ],
              );
              const arrow =
                i < nodes.length - 1
                  ? h(
                      "div",
                      {
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 18,
                        fontSize: 18,
                        color: C.accent,
                        fontWeight: 700,
                      },
                      "→",
                    )
                  : null;
              return arrow ? [card, arrow] : [card];
            }),
      ),
      vc?.profit_pool_note
        ? h(
            "div",
            {
              display: "flex",
              marginTop: 12,
              padding: "8px 12px",
              background: C.bg4,
              borderRadius: 8,
              fontSize: 12,
              color: C.text,
              lineHeight: 1.35,
            },
            `利润池注解：${clip(vc.profit_pool_note, 80)}`,
          )
        : null,
    ],
  });
}

function UEFlywheelPanel(ue) {
  const nodes = safeArr(ue?.nodes).slice(0, 6);
  // 圆形飞轮在 satori 上模拟困难，退而求其次：横向闭环箭头链
  return TemplatePanel({
    title: "单位经济飞轮",
    badge: "UE Flywheel",
    children: [
      h(
        "div",
        { display: "flex", flexDirection: "row", flex: 1, gap: 6, alignItems: "stretch" },
        nodes.length === 0
          ? [h("div", { display: "flex", fontSize: 12, color: C.dim }, "暂无 UE 数据")]
          : nodes.flatMap((n, i) => {
              const card = h(
                "div",
                {
                  display: "flex",
                  flexDirection: "column",
                  flex: 1,
                  padding: 12,
                  background: C.bg3,
                  borderRadius: 10,
                  border: `1px solid ${C.border}`,
                  justifyContent: "center",
                },
                [
                  h(
                    "div",
                    { display: "flex", fontSize: 13, fontWeight: 700, color: C.navy, lineHeight: 1.25 },
                    clip(n?.label || `节点${i + 1}`, 14),
                  ),
                  h(
                    "div",
                    { display: "flex", fontSize: 11, fontWeight: 400, color: C.mid, marginTop: 6, lineHeight: 1.3 },
                    clip(n?.metric || "待核实", 28),
                  ),
                ],
              );
              const arrowChar = i === nodes.length - 1 ? "↺" : "→";
              const arrow = h(
                "div",
                {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 14,
                  fontSize: 16,
                  color: C.gold,
                  fontWeight: 700,
                },
                arrowChar,
              );
              return [card, arrow];
            }),
      ),
      h(
        "div",
        { display: "flex", flexDirection: "row", marginTop: 12, gap: 16 },
        [
          h(
            "div",
            {
              display: "flex",
              flex: 1,
              padding: "10px 14px",
              background: C.navy,
              color: "#FFFFFF",
              borderRadius: 8,
            },
            [
              h("div", { display: "flex", fontSize: 11, color: C.gold, letterSpacing: 0.5 }, "LTV / CAC"),
              h(
                "div",
                { display: "flex", fontSize: 18, fontWeight: 700, marginLeft: 12, color: "#FFFFFF" },
                clip(ue?.ltv_cac || "待核实", 20),
              ),
            ],
          ),
          h(
            "div",
            {
              display: "flex",
              flex: 1,
              padding: "10px 14px",
              background: C.navy,
              color: "#FFFFFF",
              borderRadius: 8,
            },
            [
              h("div", { display: "flex", fontSize: 11, color: C.gold, letterSpacing: 0.5 }, "回本月数"),
              h(
                "div",
                { display: "flex", fontSize: 18, fontWeight: 700, marginLeft: 12, color: "#FFFFFF" },
                clip(ue?.payback_months || "待核实", 20),
              ),
            ],
          ),
        ],
      ),
    ],
  });
}

function PositioningMapPanel(pm) {
  const xLabel = pm?.x_axis?.label || "X";
  const yLabel = pm?.y_axis?.label || "Y";
  const xLow = pm?.x_axis?.low_anchor || "低";
  const xHigh = pm?.x_axis?.high_anchor || "高";
  const yLow = pm?.y_axis?.low_anchor || "低";
  const yHigh = pm?.y_axis?.high_anchor || "高";
  const points = safeArr(pm?.points).slice(0, 8);

  // 画布尺寸：内部坐标系 720 x 200，points 映射时 x*720, y 翻转 (1-y)*200
  const PLOT_W = 720;
  const PLOT_H = 200;
  const DOT_SIZE = 12;

  return TemplatePanel({
    title: "竞对站位图",
    badge: "Positioning Map",
    children: [
      h(
        "div",
        { display: "flex", flexDirection: "row", flex: 1 },
        [
          // Y 轴标签
          h(
            "div",
            {
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              alignItems: "flex-end",
              paddingRight: 8,
              width: 110,
              fontSize: 11,
              color: C.mid,
            },
            [
              h("div", { display: "flex", textAlign: "right" }, clip(yHigh, 14)),
              h("div", { display: "flex", fontWeight: 700, color: C.navy, fontSize: 12 }, clip(yLabel, 14)),
              h("div", { display: "flex", textAlign: "right" }, clip(yLow, 14)),
            ],
          ),
          // 散点图区
          h(
            "div",
            {
              display: "flex",
              position: "relative",
              width: PLOT_W,
              height: PLOT_H,
              background: C.bg3,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
            },
            points.map((p) => {
              const x = Math.max(0, Math.min(1, Number(p?.x ?? 0.5)));
              const y = Math.max(0, Math.min(1, Number(p?.y ?? 0.5)));
              const left = Math.round(x * (PLOT_W - DOT_SIZE - 80));
              const top = Math.round((1 - y) * (PLOT_H - DOT_SIZE - 20));
              const isTarget = !!p?.is_target;
              return h(
                "div",
                {
                  display: "flex",
                  position: "absolute",
                  left,
                  top,
                  flexDirection: "row",
                  alignItems: "center",
                },
                [
                  h(
                    "div",
                    {
                      display: "flex",
                      width: isTarget ? DOT_SIZE + 4 : DOT_SIZE,
                      height: isTarget ? DOT_SIZE + 4 : DOT_SIZE,
                      borderRadius: 999,
                      background: isTarget ? C.gold : C.accent,
                      border: isTarget ? `2px solid ${C.navy}` : "none",
                    },
                    "",
                  ),
                  h(
                    "div",
                    {
                      display: "flex",
                      marginLeft: 6,
                      fontSize: 11,
                      fontWeight: isTarget ? 700 : 400,
                      color: isTarget ? C.navy : C.mid,
                    },
                    clip(p?.name || "—", 14),
                  ),
                ],
              );
            }),
          ),
        ],
      ),
      // X 轴标签
      h(
        "div",
        {
          display: "flex",
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 6,
          paddingLeft: 110,
          fontSize: 11,
          color: C.mid,
        },
        [
          h("div", { display: "flex" }, clip(xLow, 14)),
          h("div", { display: "flex", fontWeight: 700, color: C.navy, fontSize: 12 }, clip(xLabel, 18)),
          h("div", { display: "flex" }, clip(xHigh, 14)),
        ],
      ),
    ],
  });
}

function MiddleSpotlight(json) {
  const used = json?.template_used || "generic_kpi";
  if (used === "value_chain" && json?.value_chain) return ValueChainPanel(json.value_chain);
  if (used === "ue_flywheel" && json?.ue_flywheel) return UEFlywheelPanel(json.ue_flywheel);
  if (used === "positioning_map" && json?.positioning_map) return PositioningMapPanel(json.positioning_map);
  return MiddleRow(json?.sections || {});
}

function Footer() {
  return h(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      width: "100%",
      marginTop: 4,
    },
    [
      h(
        "div",
        { display: "flex", fontSize: 10, color: C.dim, letterSpacing: 0.5 },
        "本图由 AI 自动生成，仅作内部速览，不构成投资建议。",
      ),
      h(
        "div",
        { display: "flex", fontSize: 10, color: C.dim, letterSpacing: 0.5 },
        new Date().toISOString().slice(0, 10),
      ),
    ],
  );
}

function buildTree(json) {
  const brand = json?.brand || {};
  const metrics = safeArr(json?.top_metrics);
  const sections = json?.sections || {};

  return h(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      width: CANVAS_W,
      height: CANVAS_H,
      padding: 40,
      background: C.bg,
      fontFamily: "NotoSansSC",
      color: C.text,
      gap: 18,
    },
    [
      Header(brand),
      MetricsRow(metrics),
      MiddleSpotlight(json),
      BottomRow(sections),
      Footer(),
    ],
  );
}

module.exports = { buildTree, CANVAS_W, CANVAS_H };
