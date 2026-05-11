import React from "react";
import { Outlet } from "react-router-dom";
import Header from "./layout/Header";
import AnnouncementBanner from "./AnnouncementBanner";

/**
 * AppLayout - 核心区域布局
 * 包含 Header、公告 Banner 和 Footer，适用于需要登录的页面
 */
export default function AppLayout() {
  return (
    <div className="app-shell min-h-screen">
      <Header />
      <AnnouncementBanner />
      <Outlet />
      <footer className="border-t border-[#D8DCE8] bg-white mt-16 py-6 text-center text-[12px] text-[#8E9BB0] font-mono-fin tracking-wide">
        <p>BP过滤机 · AI Workspace for VC &amp; PE · 5 维量化评分 · 多模型按需切换</p>
        <p className="mt-1">© 2026 garbagebpfilter.cn · All rights reserved</p>
      </footer>
    </div>
  );
}
