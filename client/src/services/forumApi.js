// ============================================================
// client/src/services/forumApi.js — 论坛 API 封装
// 复用统一请求层 api（自动带 token / 401 拦截）。
// 浏览类接口游客也可调（后端 optionalAuth 软墙）。
// ============================================================

import api from "./api";

const forumApi = {
  // 免责声明
  getDisclaimer: () => api.get("/api/forum/disclaimer"),

  // 列表 / 详情
  listPosts: ({ category, sort = "latest", page = 1 } = {}) => {
    const qs = new URLSearchParams();
    if (category) qs.set("category", category);
    if (sort) qs.set("sort", sort);
    if (page) qs.set("page", String(page));
    return api.get(`/api/forum/posts?${qs.toString()}`);
  },
  getPost: (id) => api.get(`/api/forum/posts/${id}`),

  // 发帖
  previewSnapshot: ({ taskId, showProjectName, showCompanyName }) =>
    api.post("/api/forum/preview-snapshot", {
      task_id: taskId,
      show_project_name: showProjectName,
      show_company_name: showCompanyName,
    }),
  createPost: (payload) => api.post("/api/forum/posts", payload),
  deletePost: (id) => api.delete(`/api/forum/posts/${id}`),

  // 评论
  addComment: (postId, { body, parentId } = {}) =>
    api.post(`/api/forum/posts/${postId}/comments`, { body, parent_id: parentId }),
  deleteComment: (id) => api.delete(`/api/forum/comments/${id}`),

  // 互动
  toggleLike: (targetType, targetId) =>
    api.post("/api/forum/like", { target_type: targetType, target_id: targetId }),
  toggleBookmark: (postId) => api.post(`/api/forum/posts/${postId}/bookmark`),
  report: (targetType, targetId, reason) =>
    api.post("/api/forum/report", { target_type: targetType, target_id: targetId, reason }),

  // 撮合
  expressInterest: (postId, message) =>
    api.post(`/api/forum/posts/${postId}/interest`, { message }),
  respondInterest: (connectionId, accept) =>
    api.post(`/api/forum/connections/${connectionId}/respond`, { accept }),
  listConnections: () => api.get("/api/forum/connections"),

  // 资料
  getMyProfile: () => api.get("/api/forum/profile"),
  updateMyProfile: (payload) => api.put("/api/forum/profile", payload),
  getPublicProfile: (id) => api.get(`/api/forum/users/${id}`),
  // 头像（复用账号体系的上传端点）
  uploadAvatar: (file) => {
    const fd = new FormData();
    fd.append("avatar", file);
    return api.post("/api/user/avatar", fd, { headers: { "Content-Type": "multipart/form-data" } });
  },

  // 徽章
  getMyBadges: () => api.get("/api/forum/badges/me"),
  setBadgeDisplay: (badgeCode, displayed) =>
    api.put("/api/forum/badges/display", { badge_code: badgeCode, displayed }),

  // 站内信（轻量私信）
  listConversations: () => api.get("/api/forum/conversations"),
  getMessages: (conversationId) => api.get(`/api/forum/conversations/${conversationId}/messages`),
  startConversation: (recipientId, body) =>
    api.post("/api/forum/conversations", { recipient_id: recipientId, body }),
  sendMessage: (conversationId, body) =>
    api.post(`/api/forum/conversations/${conversationId}/messages`, { body }),
};

export default forumApi;
