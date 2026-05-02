import { FileText, Gavel } from "lucide-react";
import { TrendingUp, Brain, BarChart3, Users, Shield, DollarSign, AlertTriangle } from "lucide-react";

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
  external_risk: "BP诚信度",
};

// ── 维度副标题映射 (v4.0 新增) ──
export const dimSubtitleMap = {
  timing_ceiling: "TAM（百万人民币） + CAGR",
  product_moat: "TRL + 竞品排名",
  business_validation: "行业资本效率 + 行业规模效应",
  team: "创始人赛道经验年数",
  external_risk: "声明核查结果",
};

// ── Multiagent 定义（Sprint 1）──
export const AGENT_DEFS = [
  { key: "project_summary", label: "项目摘要",   icon: FileText,       color: "blue" },
  { key: "founder",         label: "创始人调查", icon: Users,          color: "purple" },
  { key: "financial",       label: "财务核查",   icon: BarChart3,      color: "emerald" },
  { key: "competitor",      label: "竞品分析",   icon: TrendingUp,     color: "orange" },
  { key: "red_flag",        label: "红旗扫描",   icon: AlertTriangle,  color: "red" },
  { key: "valuation",       label: "估值合理性", icon: DollarSign,     color: "yellow" },
];
