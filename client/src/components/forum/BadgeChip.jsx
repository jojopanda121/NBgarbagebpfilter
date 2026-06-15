// BadgeChip — 单枚徽章。优先用美术图(badge.image)，加载失败回退 lucide 线性图标。
import React, { useState } from "react";
import { badgeIcon } from "../../constants/forum";

const IMG_SIZE = { xs: 16, sm: 20, md: 28, lg: 64 };

export default function BadgeChip({ badge, size = "sm", showName = true, title }) {
  const [imgErr, setImgErr] = useState(false);
  if (!badge) return null;
  const Icon = badgeIcon(badge.code);
  const px = IMG_SIZE[size] || IMG_SIZE.sm;
  const tip = title || badge.desc || badge.req || badge.name;

  const emblem = badge.image && !imgErr ? (
    <img src={badge.image} alt={badge.name} width={px} height={px}
      onError={() => setImgErr(true)}
      style={{ width: px, height: px, objectFit: "contain", display: "block" }} />
  ) : (
    <Icon style={{ width: px * 0.9, height: px * 0.9, color: badge.color }} />
  );

  if (!showName) {
    return <span title={tip} className="inline-flex items-center shrink-0">{emblem}</span>;
  }

  const pad = size === "xs" ? "px-1.5 py-0.5 text-[10px] gap-1" : "px-2 py-0.5 text-xs gap-1.5";
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${pad}`}
      style={{ color: badge.color, backgroundColor: `${badge.color}1A` }} title={tip}>
      {emblem}
      {badge.name}
    </span>
  );
}
