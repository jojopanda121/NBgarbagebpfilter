import React from "react";
import { useSearchParams, Navigate } from "react-router-dom";
import useAuthStore from "../store/useAuthStore";
import SettingsPage from "./SettingsPage";

/**
 * AdminPage — 管理员中心入口
 * 复用 SettingsPage 组件，默认展示管理员功能 tab
 */
export default function AdminPage() {
  const user = useAuthStore((s) => s.user);
  const [searchParams] = useSearchParams();

  // 非管理员重定向到设置页
  if (user?.role !== "admin") {
    return <Navigate to="/settings" replace />;
  }

  // 传递 adminMode 标记，让 SettingsPage 优先展示管理员 tab
  return <SettingsPage adminMode />;
}
