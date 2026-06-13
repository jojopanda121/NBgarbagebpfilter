// UserTypeBadge — 身份标签 chip（投资人/项目方/FA）
import React from "react";
import { BadgeCheck } from "lucide-react";
import { userTypeMeta } from "../../constants/forum";

export default function UserTypeBadge({ type, verified = false, size = "sm" }) {
  const meta = userTypeMeta(type);
  if (type === "unset") return null;
  const pad = size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded ${pad} font-medium`}
      style={{ color: meta.color, backgroundColor: meta.bg }}
    >
      {meta.label}
      {verified && <BadgeCheck className="w-3 h-3" aria-label="已认证" />}
    </span>
  );
}
