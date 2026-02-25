import { FileText, Search, Gavel } from "lucide-react";
import { TrendingUp, Brain, BarChart3, Users, Shield } from "lucide-react";

// ── API 地址（保持原有读取方式，兼容云端生产环境）──
export const API_BASE = process.env.REACT_APP_API_URL || "";

// ── 分析步骤定义（2步 Pipeline）──
export const STEPS = [
  { key: "extract", label: "数据提取: 从BP中提取关键声明与数据", icon: FileText },
  { key: "judge", label: "AI深度研究: MiniMax知识库专家分析 & 评分", icon: Gavel },
];

// ── 维度图标映射 ──
export const dimIcons = {
  timing_ceiling: TrendingUp,
  product_moat: Brain,
  business_validation: BarChart3,
  team: Users,
  external_risk: Shield,
};

// ── 维度名称映射 (v4.0) ──
export const dimLabelsMap = {
  timing_ceiling: "时机与天花板",
  product_moat: "产品与壁垒",
  business_validation: "资本效率与规模效应",
  team: "团队基因",
  external_risk: "外部风险",
};

// ── 维度副标题映射 (v4.0 新增) ──
export const dimSubtitleMap = {
  timing_ceiling: "TAM（百万人民币） + CAGR",
  product_moat: "TRL + 竞品排名",
  business_validation: "行业资本效率 + 行业规模效应",
  team: "创始人赛道经验年数",
  external_risk: "政策风险 + 估值溢价折扣",
};
