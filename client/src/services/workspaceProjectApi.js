// ============================================================
// client/src/services/workspaceProjectApi.js
// Sprint 2: 项目工作台 API 封装
// ============================================================

import api from "./api";
import useAuthStore from "../store/useAuthStore";
import { API_BASE } from "../constants";

const BASE = "/api/workspace-projects";

async function patch(url, data) {
  const token = useAuthStore.getState().token;
  const resp = await fetch(`${API_BASE}${url}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data || {}),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: "请求失败" }));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

export const workspaceProjectApi = {
  list({ status, industry, includeArchived } = {}) {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (industry) qs.set("industry", industry);
    if (includeArchived) qs.set("includeArchived", "true");
    const q = qs.toString();
    return api.get(`${BASE}${q ? `?${q}` : ""}`);
  },

  getById(id) {
    return api.get(`${BASE}/${id}`);
  },

  update(id, patchBody) {
    return patch(`${BASE}/${id}`, patchBody);
  },

  updateStatus(id, status) {
    return patch(`${BASE}/${id}/status`, { status });
  },

  diffVersions(id, versionA, versionB) {
    return api.get(
      `${BASE}/${id}/versions/diff?versionA=${versionA}&versionB=${versionB}`
    );
  },

  addNote(id, content) {
    return api.post(`${BASE}/${id}/notes`, { content });
  },

  migrateLegacy() {
    return api.post(`${BASE}/migrate-legacy`, {});
  },

  // 合并建议
  listMergeSuggestions() {
    return api.get(`${BASE}/merge-suggestions`);
  },
  acceptMergeSuggestion(id) {
    return api.post(`${BASE}/merge-suggestions/${id}/accept`, {});
  },
  dismissMergeSuggestion(id) {
    return api.post(`${BASE}/merge-suggestions/${id}/dismiss`, {});
  },

  // 项目级聊天(项目页用)
  getConversationMessages(projectId) {
    return api.get(`${BASE}/${projectId}/conversation/messages`);
  },
  getConversationUsage(projectId) {
    return api.get(`${BASE}/${projectId}/conversation/usage`);
  },
  // 注意:发送消息走 SSE,见 services/workspaceStream.js,这里不暴露 post 包装
  conversationStreamPath(projectId) {
    return `${BASE}/${projectId}/conversation/messages`;
  },
};

export default workspaceProjectApi;
