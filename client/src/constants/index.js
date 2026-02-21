import { FileText, Search, Gavel } from "lucide-react";
import { TrendingUp, Brain, BarChart3, Users, Shield } from "lucide-react";

// ── API 地址（保持原有读取方式，兼容云端生产环境）──
export const API_BASE = process.env.REACT_APP_API_URL || "";

// ── 分析步骤定义（3步 Pipeline）──
export const STEPS = [
  { key: "extract", label: "数据提取: 提取评分所需数据", icon: FileText },
  { key: "search", label: "联网取证: 搜索验证 & 行业估值", icon: Search },
  { key: "judge", label: "数据验证: AI校准 & 标准化评分", icon: Gavel },
];

// ── 维度图标映射 ──
export const dimIcons = {
  timing_ceiling: TrendingUp,
  product_moat: Brain,
  business_validation: BarChart3,
  team: Users,
  external_risk: Shield,
};

// ── 维度名称映射 ──
export const dimLabelsMap = {
  timing_ceiling: "时机与天花板",
  product_moat: "产品与壁垒",
  business_validation: "商业验证与效率",
  team: "团队基因",
  external_risk: "外部风险",
};
