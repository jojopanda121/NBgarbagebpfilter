// ============================================================
// client/src/services/skillsApi.js — Skill 调用 + Teaser 分享管理
// ============================================================

import api from "./api";

const BASE = "/api/skills";

export const skillsApi = {
  list() {
    return api.get(BASE);
  },
  /** 调用 skill;返回 { ok, runId, artifact?, error? } */
  run(skillId, { projectId, params } = {}) {
    return api.post(`${BASE}/${encodeURIComponent(skillId)}/run`, {
      project_id: projectId,
      params: params || {},
    });
  },
  listRuns({ projectId, limit } = {}) {
    const qs = new URLSearchParams();
    if (projectId) qs.set("project_id", projectId);
    if (limit) qs.set("limit", String(limit));
    return api.get(`${BASE}/runs${qs.toString() ? "?" + qs.toString() : ""}`);
  },
  getRun(runId) {
    return api.get(`${BASE}/runs/${encodeURIComponent(runId)}`);
  },
  // ── Teaser 分享 ──
  listTeaserShares(projectId) {
    return api.get(`${BASE}/teaser/shares?project_id=${encodeURIComponent(projectId)}`);
  },
  revokeTeaserShare(token) {
    return api.post(`${BASE}/teaser/shares/${encodeURIComponent(token)}/revoke`);
  },
  teaserAccessLog(token) {
    return api.get(`${BASE}/teaser/shares/${encodeURIComponent(token)}/access-log`);
  },
};

export default skillsApi;
