// BadgeChip — 单枚徽章 chip。颜色来自后端 badge.color，图标按 code 映射 lucide。
import React from "react";
import { badgeIcon } from "../../constants/forum";

export default function BadgeChip({ badge, size = "sm", title }) {
  if (!badge) return null;
  const Icon = badgeIcon(badge.code);
  const pad = size === "xs" ? "px-1.5 py-0.5 text-[10px] gap-0.5" : "px-2 py-0.5 text-xs gap-1";
  const iconCls = size === "xs" ? "w-3 h-3" : "w-3.5 h-3.5";
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${pad}`}
      style={{ color: badge.color, backgroundColor: `${badge.color}1A` }}
      title={title || badge.desc || badge.name}
    >
      <Icon className={iconCls} />
      {badge.name}
    </span>
  );
}
