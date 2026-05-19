import React, { useEffect } from "react";
import { BrowserRouter } from "react-router-dom";
import useAuthStore from "./store/useAuthStore";
import ContactBindingModal from "./components/auth/ContactBindingModal";
import ErrorBoundary from "./components/ErrorBoundary";
import LoadingFallback from "./components/LoadingFallback";
import AppRoutes from "./routes/AppRoutes";

// ── 根组件（路由协调器 + 全局弹层）──
export default function App() {
  const requireContactBinding = useAuthStore((s) => s.requireContactBinding);
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
        <div className="min-h-screen bg-[#F6F7FA] text-[#0F1C36]">
          {/* 全局弹层：联系方式绑定 */}
          {requireContactBinding && <ContactBindingModal />}
          <AppRoutes />
        </div>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
