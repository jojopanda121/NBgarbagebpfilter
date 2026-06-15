// ============================================================
// client/src/constants/forum.js — 论坛常量：身份标签 / 板块 / 颜色
// 图标统一用 lucide 线性图标，与全站视觉语言一致（不用 emoji）。
// ============================================================

import { Award, MessageSquare, Handshake, Trophy, BarChart3, Flame, MapPin } from "lucide-react";

// 徽章 code → lucide 图标（前端统一线性图标，不用后端返回的 emoji）
export const BADGE_ICONS = {
  high_score: Trophy,
  volume: BarChart3,
  active: Flame,
  region: MapPin,
};

export function badgeIcon(code) {
  return BADGE_ICONS[code] || Award;
}

// 用户身份（社区身份，与权限 role 无关）
export const USER_TYPES = {
  investor: { label: "投资人", color: "#1B4FD8", bg: "#EEF1F7" },
  founder: { label: "项目方", color: "#0F8A5F", bg: "#E7F6EF" },
  fa: { label: "FA", color: "#B45309", bg: "#FBF1E3" },
  unset: { label: "未设置", color: "#8E9BB0", bg: "#EEF1F7" },
};

export const USER_TYPE_OPTIONS = [
  { value: "investor", label: "投资人", desc: "看项目、找标的、撮合 deal" },
  { value: "founder", label: "项目方", desc: "发布高分项目、寻求投资人联系" },
  { value: "fa", label: "FA / 财务顾问", desc: "两端撮合、对接资源" },
];

// 板块（Icon 为 lucide 组件）
export const FORUM_CATEGORIES = [
  { key: "project", label: "优质项目", desc: "带平台实测评分的项目，可被撮合", Icon: Award },
  { key: "discussion", label: "行业讨论", desc: "赛道观点、投资逻辑", Icon: MessageSquare },
  { key: "market", label: "找钱 / 找项目", desc: "供需广场", Icon: Handshake },
];

export const SORT_OPTIONS = [
  { key: "latest", label: "最新" },
  { key: "score", label: "评分最高" },
  { key: "hot", label: "热门" },
];

export function userTypeMeta(type) {
  return USER_TYPES[type] || USER_TYPES.unset;
}

export function categoryMeta(key) {
  return FORUM_CATEGORIES.find((c) => c.key === key) || FORUM_CATEGORIES[0];
}

// 评级配色（与报告侧 verdict 一致的语义）
export function gradeColorClass(grade) {
  const g = (grade || "").toUpperCase();
  if (g.startsWith("A")) return "text-[#0F8A5F]";
  if (g.startsWith("B")) return "text-[#1B4FD8]";
  if (g.startsWith("C")) return "text-[#B45309]";
  return "text-[#B91C1C]";
}
