// BadgeList — 一排徽章（紧凑展示）。max 控制最多显示几枚，多余折叠为 +N。
// showName=false 时只显示徽章图标（用于帖子作者行省空间）。
import React from "react";
import BadgeChip from "./BadgeChip";

export default function BadgeList({ badges, size = "xs", max = 3, showName = false, className = "" }) {
  if (!Array.isArray(badges) || badges.length === 0) return null;
  const shown = max ? badges.slice(0, max) : badges;
  const rest = badges.length - shown.length;
  return (
    <span className={`inline-flex items-center gap-1 flex-wrap ${className}`}>
      {shown.map((b) => (
        <BadgeChip key={b.code + "_" + b.tier} badge={b} size={size} showName={showName} />
      ))}
      {rest > 0 && <span className="text-[10px] text-[#8E9BB0]">+{rest}</span>}
    </span>
  );
}
