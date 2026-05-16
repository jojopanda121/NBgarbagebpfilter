// ============================================================
// client/src/services/api.js — 统一 API 请求层
//
// 功能：
//   1. Token 自动携带（Authorization: Bearer xxx）
//   2. 全局状态码拦截（4031 → 弹出绑定框，401 → 跳转登录）
//   3. 错误统一处理
// ============================================================

import useAuthStore from "../store/useAuthStore";
import { API_BASE } from "../constants";
import { triggerBlobDownload } from "../utils/downloadFile";

class ApiService {
  /**
   * 通用请求方法
   */
  async request(url, options = {}) {
    const token = useAuthStore.getState().token;
    const headers = { ...options.headers };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // 非 FormData 请求自动加 Content-Type
    if (options.body && !(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }

    const resp = await fetch(`${API_BASE}${url}`, { ...options, headers });

    // 全局状态码拦截
    if (resp.status === 401) {
      // Token 过期或无效
      useAuthStore.getState().logout();
      throw new ApiError("登录已过期，请重新登录", 401);
    }

    if (resp.status === 403) {
      const body = await resp.json().catch(() => ({}));

      // 4031: 需要绑定联系方式
      if (body.code === 4031) {
        useAuthStore.getState().setRequireContactBinding(true);
        throw new ApiError(body.error || "请先绑定邮箱", 4031);
      }

      // 4032: 额度不足 — 提示用户线下购买兑换码
      if (body.code === 4032) {
        throw new ApiError(body.error || "额度不足，请联系客服购买兑换码", 4032);
      }

      throw new ApiError(body.error || "权限不足", 403);
    }

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new ApiError(body.error || `请求失败 (${resp.status})`, resp.status);
    }

    return resp.json();
  }

  get(url) {
    return this.request(url);
  }

  post(url, data) {
    return this.request(url, {
      method: "POST",
      body: data instanceof FormData ? data : JSON.stringify(data),
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

  /** 上传文件（带进度） */
  async uploadFile(file) {
    const formData = new FormData();
    formData.append("file", file);
    return this.request("/api/analyze", {
      method: "POST",
      body: formData,
    });
  }

  /** 轮询任务状态 */
  async pollTask(taskId) {
    return this.request(`/api/task/${taskId}`);
  }

  /** 下载二进制文件并触发浏览器另存为 */
  async downloadBlob(url, fallbackFilename = "download") {
    const token = useAuthStore.getState().token;
    const headers = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const resp = await fetch(`${API_BASE}${url}`, { headers });
    if (!resp.ok) {
      let msg = `下载失败 (${resp.status})`;
      try {
        const body = await resp.json();
        if (body?.error) msg = body.error;
      } catch {}
      throw new ApiError(msg, resp.status);
    }

    // 解析 Content-Disposition 中的 filename*=UTF-8''...
    let filename = fallbackFilename;
    const cd = resp.headers.get("Content-Disposition") || "";
    const m = cd.match(/filename\*=UTF-8''([^;]+)/i);
    if (m && m[1]) {
      try { filename = decodeURIComponent(m[1]); } catch {}
    }

    const blob = await resp.blob();
    triggerBlobDownload(blob, filename);
  }
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

const api = new ApiService();
export default api;
export { ApiError };
