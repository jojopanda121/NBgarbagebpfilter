import React, { Suspense, lazy, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import useAuthStore from "./store/useAuthStore";
import ContactBindingModal from "./components/auth/ContactBindingModal";
import PaymentModal from "./components/auth/PaymentModal";
import AuthGuard from "./components/AuthGuard";
import AppLayout from "./components/AppLayout";
import ErrorBoundary from "./components/ErrorBoundary";

// 懒加载页面组件（代码分割）
const LoginPage = lazy(() => import("./pages/LoginPage"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const DemoReportPage = lazy(() => import("./pages/DemoReportPage"));
const ReportPage = lazy(() => import("./pages/ReportPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const HistoryPage = lazy(() => import("./pages/HistoryPage"));

// 加载中组件
function LoadingFallback() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <p className="mt-4 text-gray-400">加载中...</p>
      </div>
    </div>
  );
}

// ── 根组件（路由协调器 + 全局弹层）──
export default function App() {
  const requireContactBinding = useAuthStore((s) => s.requireContactBinding);
  const requirePayment = useAuthStore((s) => s.requirePayment);
  const initialized = useAuthStore((s) => s.initialized);
  const initAuth = useAuthStore((s) => s.initAuth);

  // 启动时验证 token 并恢复会话
  useEffect(() => {
    initAuth();
  }, [initAuth]);

  // 等待 token 验证完成再渲染路由，避免闪烁到登录页
  if (!initialized) {
    return <LoadingFallback />;
  }

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <div className="min-h-screen bg-gray-950 text-gray-100">
          {/* 全局弹层：联系方式绑定 & 支付 */}
          {requireContactBinding && <ContactBindingModal />}
          {requirePayment && <PaymentModal />}

          <Suspense fallback={<LoadingFallback />}>
            <Routes>
              {/* ── 公开区 (Public Zone) ── */}
              {/* 首页/营销落地页 */}
              <Route path="/" element={<LandingPage />} />

              {/* 登录页（无 Header） */}
              <Route path="/login" element={<LoginPage />} />

              {/* 示例报告（无需登录） */}
              <Route path="/demo" element={<DemoReportPage />} />

              {/* 报告查看页（需登录，owner 或 admin） */}
              <Route path="/report/:taskId" element={<ReportPage />} />

              {/* 分享报告页（公开，通过 shareToken 访问） */}
              <Route path="/report/s/:shareToken" element={<ReportPage />} />

              {/* ── 核心区 (Protected Zone) - 需要登录 ── */}
              <Route
                element={
                  <AuthGuard>
                    <AppLayout />
                  </AuthGuard>
                }
              >
                {/* 工作台首页 */}
                <Route path="/app" element={<Navigate to="/app/dashboard" replace />} />
                <Route path="/app/dashboard" element={<DashboardPage />} />

                {/* 历史报告 */}
                <Route path="/app/history" element={<HistoryPage />} />

                {/* 用户中心 */}
                <Route path="/settings" element={<SettingsPage />} />
              </Route>

              {/* 404 重定向到首页 */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
