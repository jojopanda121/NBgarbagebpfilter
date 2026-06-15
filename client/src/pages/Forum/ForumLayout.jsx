// ForumLayout — 论坛公共布局（含 Header），游客与登录用户共用
import React from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import Header from "../../components/layout/Header";
import useAuthStore from "../../store/useAuthStore";
import { Handshake, UserCircle, Landmark, MessageSquare } from "lucide-react";

export default function ForumLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const token = useAuthStore((s) => s.token);

  const onForumHome = location.pathname === "/forum";

  return (
    <div className="min-h-screen bg-[#F6F7FA]">
      <Header />
      {/* 论坛子导航条 */}
      <div className="border-b border-[#EEF1F7] bg-white">
        <div className="max-w-4xl mx-auto px-4 py-2 flex items-center justify-between">
          <button onClick={() => navigate("/forum")}
            className={`inline-flex items-center gap-1.5 text-sm font-semibold ${onForumHome ? "text-[#1B4FD8]" : "text-[#0D2145]"}`}>
            <Landmark className="w-4 h-4" /> 投资人论坛
          </button>
          {token && (
            <div className="flex items-center gap-1.5">
              <button onClick={() => navigate("/forum/messages")}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-[#4B5A72] hover:bg-[#EEF1F7] rounded-lg">
                <MessageSquare className="w-4 h-4" /> 消息
              </button>
              <button onClick={() => navigate("/forum/me?tab=connections")}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-[#4B5A72] hover:bg-[#EEF1F7] rounded-lg">
                <Handshake className="w-4 h-4" /> 撮合
              </button>
              <button onClick={() => navigate("/forum/me")}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-[#4B5A72] hover:bg-[#EEF1F7] rounded-lg">
                <UserCircle className="w-4 h-4" /> 我的
              </button>
            </div>
          )}
        </div>
      </div>
      <Outlet />
    </div>
  );
}
