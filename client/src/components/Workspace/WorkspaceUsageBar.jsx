import React from "react";

export default function WorkspaceUsageBar({ usage }) {
  if (!usage) return null;

  if (usage.is_admin) {
    return (
      <div className="px-4 py-2 border-b border-[#EEF1F7] bg-[#F6F7FA] text-xs text-[#4B5A72] flex items-center justify-between">
        <span>管理员账号 · 不限对话次数</span>
        <span className="text-[#8E9BB0]">今日已对话 {usage.used_today} 轮</span>
      </div>
    );
  }

  if (usage.unlimited) {
    return (
      <div className="px-4 py-2 border-b border-amber-200 bg-amber-50 text-xs flex items-center justify-between">
        <span className="text-amber-700 font-medium">VIP 会员 · 无限对话</span>
        <span className="text-amber-600">今日已对话 {usage.used_today} 轮</span>
      </div>
    );
  }

  const limit = usage.daily_limit;
  const used = usage.used_today;
  const remaining = usage.remaining ?? 0;
  const pct = Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  const low = remaining <= Math.max(1, Math.floor(limit * 0.34));
  const barColor = remaining === 0 ? "bg-rose-500" : low ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="px-4 py-2 border-b border-[#EEF1F7] bg-[#F6F7FA] text-xs">
      <div className="flex items-center justify-between text-[#4B5A72] mb-1.5">
        <span>
          今日对话剩余{" "}
          <strong className={remaining === 0 ? "text-rose-600" : low ? "text-amber-600" : "text-emerald-600"}>
            {remaining}
          </strong>{" "}
          / {limit} 轮
        </span>
        <span className="text-[#8E9BB0]">
          免费用户每日 {limit} 轮 · <span className="text-amber-600 font-medium">VIP 无限</span>
        </span>
      </div>
      <div className="h-1 bg-[#EEF1F7] rounded-full overflow-hidden">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
