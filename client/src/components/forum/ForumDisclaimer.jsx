// ForumDisclaimer — 论坛免责声明（文案来自后端 site_content: forum_disclaimer）
import React, { useEffect, useState } from "react";
import { Info } from "lucide-react";
import forumApi from "../../services/forumApi";

export default function ForumDisclaimer({ variant = "footer" }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    forumApi.getDisclaimer().then((d) => { if (alive) setData(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!data?.body) return null;

  if (variant === "inline") {
    // 发帖/建立联系时的简短提示
    return (
      <div className="flex gap-2 text-[11px] text-[#8E9BB0] bg-[#F6F7FA] border border-[#EEF1F7] rounded px-2.5 py-2">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span className="leading-relaxed">
          平台仅提供信息撮合，不对项目真实性或投资结果负责；联系方式自愿公开、风险自担。
        </span>
      </div>
    );
  }

  return (
    <div className="mt-8 border-t border-[#EEF1F7] pt-4">
      <details className="text-xs text-[#8E9BB0]">
        <summary className="cursor-pointer font-medium text-[#4B5A72] flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5" /> {data.title || "论坛免责声明"}
        </summary>
        <div className="mt-2 leading-relaxed whitespace-pre-line">{data.body}</div>
      </details>
    </div>
  );
}
