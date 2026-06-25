import {
  BarChart3,
  Edit,
  FileText,
  Gift,
  Megaphone,
  MessageSquare,
  Package,
  Settings as SettingsIcon,
  Shield,
  TrendingUp,
  User,
  Users,
  Wallet,
} from "lucide-react";

export const USER_SETTINGS_TABS = [
  { key: "mystats", label: "我的数据", icon: BarChart3 },
  { key: "account", label: "账户安全", icon: User },
  { key: "forum", label: "论坛资料", icon: Users },
  { key: "billing", label: "财务与额度", icon: Wallet },
  { key: "token", label: "兑换额度", icon: Gift },
  { key: "feedback", label: "意见反馈", icon: MessageSquare },
];

export const ADMIN_SETTINGS_TABS = [
  { key: "users", label: "用户管理", icon: Users },
  { key: "tasks", label: "分析记录", icon: FileText },
  { key: "forum_admin", label: "论坛管理", icon: MessageSquare },
  { key: "stats", label: "数据统计", icon: BarChart3 },
  { key: "feature_usage", label: "功能使用", icon: TrendingUp },
  { key: "admin_feedback", label: "反馈管理", icon: MessageSquare },
  { key: "announcements", label: "公告管理", icon: Megaphone },
  { key: "packages", label: "套餐配置", icon: Package },
  { key: "site_content", label: "内容管理", icon: Edit },
  { key: "settings", label: "系统设置", icon: SettingsIcon },
  { key: "admin", label: "兑换码管理", icon: Shield },
];
