import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import useAuthStore from "./store/useAuthStore";
import Header from "./components/layout/Header";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ContactBindingModal from "./components/auth/ContactBindingModal";
import PaymentModal from "./components/auth/PaymentModal";

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
          {/* 登录页（无 Header） */}
          <Route path="/login" element={<LoginPage />} />

          {/* 主应用（带 Header + Footer） */}
          <Route
            path="*"
            element={
              <>
                <Header />
                <DashboardPage />
                <footer className="border-t border-gray-800 mt-16 py-6 text-center text-sm text-gray-600">
                  <p>垃圾BP过滤机 v4.0 · MiniMax 知识库深度研究引擎 · 五维定量评分</p>
                  <p className="mt-1">Powered by MiniMax M2.5 DeepThink</p>
                </footer>
              </>
            }
          />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
