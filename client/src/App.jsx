import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import useAuthStore from "./store/useAuthStore";
import ContactBindingModal from "./components/auth/ContactBindingModal";
import PaymentModal from "./components/auth/PaymentModal";
import AuthGuard from "./components/AuthGuard";
import AppLayout from "./components/AppLayout";

// 页面组件
import LoginPage from "./pages/LoginPage";
import LandingPage from "./pages/LandingPage";
import DashboardPage from "./pages/DashboardPage";
import DemoReportPage from "./pages/DemoReportPage";
import ReportPage from "./pages/ReportPage";
import SettingsPage from "./pages/SettingsPage";
import HistoryPage from "./pages/HistoryPage";

// ── 根组件（路由协调器 + 全局弹层）──
export default function App() {
  const requireContactBinding = useAuthStore((s) => s.requireContactBinding);
  const requirePayment = useAuthStore((s) => s.requirePayment);

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-950 text-gray-100">
        {/* 全局弹层：联系方式绑定 & 支付 */}
        {requireContactBinding && <ContactBindingModal />}
        {requirePayment && <PaymentModal />}

        <Routes>
          {/* ── 公开区 (Public Zone) ── */}
          {/* 首页/营销落地页 */}
          <Route path="/" element={<LandingPage />} />

          {/* 登录页（无 Header） */}
          <Route path="/login" element={<LoginPage />} />

          {/* 示例报告（无需登录） */}
          <Route path="/demo" element={<DemoReportPage />} />

          {/* 报告查看页（无需登录，可分享） */}
          <Route path="/report/:taskId" element={<ReportPage />} />

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
      </div>
    </BrowserRouter>
  );
}
