// ============================================================
// client/src/store/useAuthStore.js — 认证状态管理
// ============================================================

import { create } from "zustand";

const TOKEN_KEY = "bp_token";
const USER_KEY = "bp_user";

const useAuthStore = create((set, get) => ({
  // 状态
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: JSON.parse(localStorage.getItem(USER_KEY) || "null"),
  quota: null,

  // UI 状态
  requireContactBinding: false,
  requirePayment: false,

  // 是否已登录
  get isLoggedIn() {
    return !!get().token;
  },

  // 登录成功
  setAuth: (token, user, quota) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ token, user, quota });
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
    set({ token: null, user: null, quota: null });
  },

  // 业务拦截状态
  setRequireContactBinding: (v) => set({ requireContactBinding: v }),
  setRequirePayment: (v) => set({ requirePayment: v }),
}));

export default useAuthStore;
