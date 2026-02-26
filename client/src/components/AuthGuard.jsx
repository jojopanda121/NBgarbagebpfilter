import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import useAuthStore from "../store/useAuthStore";

/**
 * AuthGuard - 路由守卫
 * 需要登录才能访问的路由，使用此组件包裹
 */
export default function AuthGuard({ children }) {
  const token = useAuthStore((s) => s.token);
  const location = useLocation();

  if (!token) {
    // 保存原始访问路径，登录后可以跳转回去
    const redirectUrl = location.pathname + (location.search || "");
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirectUrl)}`} replace />;
  }

  return children;
}
