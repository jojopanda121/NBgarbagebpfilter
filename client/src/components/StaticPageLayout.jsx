import React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import LogoE from "./LogoE";

// ── 静态内容页（关于 / 隐私 / 条款）通用骨架 ──
export default function StaticPageLayout({ title, updated, children }) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-[#F6F7FA] text-[#0F1C36]">
      <header className="border-b border-[#D8DCE8] bg-[#F6F7FA]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-[#4B5A72] hover:text-[#0D2145] transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="text-sm">返回首页</span>
          </button>
          <div className="flex items-center gap-2 font-medium text-[#0D2145]">
            <LogoE size={24} />
            BP过滤机
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold text-[#0D2145] mb-2">{title}</h1>
        {updated && (
          <p className="text-sm text-[#8E9BB0] mb-8">最后更新：{updated}</p>
        )}
        <article className="prose-bp space-y-5 leading-relaxed text-[#33415C]">
          {children}
        </article>
      </main>

      <footer className="border-t border-[#D8DCE8] mt-8 py-6 text-center text-[12px] text-[#8E9BB0]">
        © 2026 BP过滤机 · garbagebpfilter.cn · All rights reserved
      </footer>
    </div>
  );
}
