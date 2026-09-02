// ============================================================
// client/src/services/api.js — 统一 API 请求层
//
// 功能：
//   1. Token 自动携带（Authorization: Bearer xxx）
//   2. 全局状态码拦截（4031 → 弹出绑定框，401 → 跳转登录）
//   3. 错误统一处理
// ============================================================

import { API_BASE } from "../constants";
import { triggerBlobDownload } from "../utils/downloadFile";
import {
  ApiError,
  assertOkResponse,
  bodyFromPayload,
  filenameFromDisposition,
  prepareRequestOptions,
} from "./apiHelpers";

class ApiService {
  async request(url, options = {}) {
    const resp = await fetch(`${API_BASE}${url}`, prepareRequestOptions(options));
    await assertOkResponse(resp, "请求失败");
    return resp.json();
  }

  get(url) {
    return this.request(url);
  }

  post(url, data) {
    return this.request(url, {
      method: "POST",
      body: bodyFromPayload(data),
    });
  }

  put(url, data) {
    return this.request(url, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  patch(url, data) {
    return this.request(url, {
      method: "PATCH",
      body: JSON.stringify(data || {}),
    });
  }

  delete(url, data) {
    const options = { method: "DELETE" };
    if (data) options.body = JSON.stringify(data);
    return this.request(url, options);
  }

  /** 通用文件上传（FormData） */
  upload(url, formData) {
    return this.request(url, { method: "POST", body: formData });
  }

  /**
   * 上传文件发起分析
   * @param {File} file
   * @param {object} [opts]
   * @param {boolean} [opts.useOwnModel] 使用用户自己保存的模型 API Key（不消耗平台额度）
   */
  async uploadFile(file, opts = {}) {
    const formData = new FormData();
    formData.append("file", file);
    if (opts.useOwnModel) formData.append("use_own_model", "1");
    return this.request("/api/analyze", {
      method: "POST",
      body: formData,
    });
  }

  // ── 自带模型（BYOK）────────────────────────────────────
  getLlmProviders() {
    return this.request("/api/llm/providers");
  }

  getLlmCredential() {
    return this.request("/api/llm/credentials");
  }

  /** 只测试连通性，不保存 */
  validateLlmCredential(payload) {
    return this.post("/api/llm/validate", payload);
  }

  /** 校验通过后保存 */
  saveLlmCredential(payload) {
    return this.post("/api/llm/credentials", payload);
  }

  deleteLlmCredential() {
    return this.delete("/api/llm/credentials");
  }

  /** 轮询任务状态 */
  async pollTask(taskId) {
    return this.request(`/api/task/${taskId}`);
  }

  /** 下载二进制文件并触发浏览器另存为 */
  async downloadBlob(url, fallbackFilename = "download") {
    const resp = await this.fetchBlobResponse(url, "下载失败");

    const filename = filenameFromDisposition(
      resp.headers.get("Content-Disposition"),
      fallbackFilename
    );

    const blob = await resp.blob();
    triggerBlobDownload(blob, filename);
  }

  /** 获取二进制文件 Blob，供图片预览等组件使用 */
  async getBlob(url) {
    const resp = await this.fetchBlobResponse(url, "文件获取失败");
    return resp.blob();
  }

  async fetchBlobResponse(url, fallbackMessage) {
    const resp = await fetch(`${API_BASE}${url}`, prepareRequestOptions());
    await assertOkResponse(resp, fallbackMessage);
    return resp;
  }
}

const api = new ApiService();
export default api;
export { ApiError };
