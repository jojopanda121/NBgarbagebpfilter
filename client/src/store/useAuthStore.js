// ============================================================
// client/src/store/useAuthStore.js — 认证状态管理
// ============================================================

import { create } from "zustand";

const TOKEN_KEY = "bp_token";
const USER_KEY = "bp_user";
const PENDING_TASK_KEY = "bp_pending_task";
const API_BASE = process.env.REACT_APP_API_URL || "";

const useAuthStore = create((set, get) => ({
  // 状态
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: JSON.parse(localStorage.getItem(USER_KEY) || "null"),
  quota: null,
  initialized: false, // 标记是否已完成启动时的 token 验证

  // UI 状态
  requireContactBinding: false,
  requirePayment: false,

  // 是否已登录
  get isLoggedIn() {
    return !!get().token;
  },

  // 启动时验证 token 并恢复完整会话
  initAuth: async () => {
    const token = get().token;
    if (!token) {
      console.log("[Auth] initAuth: 无本地 token，跳过验证");
      set({ initialized: true });
      return;
    }
    console.log("[Auth] initAuth: 发现本地 token，正在验证...");
    try {
      const resp = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        console.warn(`[Auth] initAuth: /api/auth/me 返回 ${resp.status}，清除登录状态`);
        // token 无效或过期，清除登录状态
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(PENDING_TASK_KEY);
        set({ token: null, user: null, quota: null, initialized: true });
        return;
      }
      const data = await resp.json();
      console.log("[Auth] initAuth: token 验证成功，用户:", data.user?.username || data.user?.id);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      set({ user: data.user, quota: data.quota, initialized: true });
    } catch (err) {
      // 网络错误时保留本地状态，不强制登出
      console.warn("[Auth] initAuth: 网络错误，保留本地登录状态:", err.message);
      set({ initialized: true });
    }
  },

  // 登录成功
  setAuth: (token, user, quota) => {
    // 切换账号时清理旧账号的 pending task
    const oldUser = get().user;
    if (oldUser && oldUser.id !== user.id) {
      localStorage.removeItem(PENDING_TASK_KEY);
    }
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ token, user, quota, initialized: true });
  },

  // 更新额度
  setQuota: (quota) => set({ quota }),

  // 更新用户信息
  setUser: (user) => {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ user });
  },

  // 登出
  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(PENDING_TASK_KEY);
    set({ token: null, user: null, quota: null });
  },

  // 业务拦截状态
  setRequireContactBinding: (v) => set({ requireContactBinding: v }),
  setRequirePayment: (v) => set({ requirePayment: v }),
}));

export default useAuthStore;
