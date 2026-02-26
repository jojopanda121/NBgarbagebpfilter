import React from "react";
import { Navigate } from "react-router-dom";
import useAuthStore from "../../store/useAuthStore";

/**
 * 需要登录才能访问的路由
 * 未登录时重定向到登录页
 */
export default function ProtectedRoute({ children }) {
  const token = useAuthStore((s) => s.token);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
