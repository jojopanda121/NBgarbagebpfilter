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
    <>
      <Header />
      <AnnouncementBanner />
      <Outlet />
      <footer className="border-t border-gray-800 mt-16 py-6 text-center text-sm text-gray-600">
        <p>垃圾BP过滤机 v4.0 · MiniMax 知识库深度研究引擎 · 五维定量评分</p>
        <p className="mt-1">Powered by MiniMax M2.5 DeepThink</p>
      </footer>
    </>
  );
}
