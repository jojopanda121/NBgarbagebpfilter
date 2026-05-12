// ============================================================
// client/src/services/workspaceStream.js
//
// SSE 客户端:基于 fetch + ReadableStream 解析 text/event-stream。
// 用 fetch 而不是 EventSource,因为后者不支持 POST 和 Authorization 头。
// ============================================================

import useAuthStore from "../store/useAuthStore";
import { API_BASE } from "../constants";

/**
 * 发起一次工作区聊天请求，按事件回调。
 * @param {string} taskId
 * @param {string} content 用户消息
 * @param {(event:string, data:any)=>void} onEvent
 * @param {AbortSignal} [signal]
 * @param {File} [file]
 * @returns {Promise<void>}
 */
export async function streamChatMessage(taskId, content, onEvent, signal, file = null) {
  return _streamSse(`/api/workspace/${taskId}/messages`, content, onEvent, signal, file);
}

/** 项目级聊天(workspace project),共享 SSE 解析 */
export async function streamProjectChatMessage(projectId, content, onEvent, signal) {
  return _streamSse(`/api/workspace-projects/${projectId}/conversation/messages`, content, onEvent, signal);
}

async function _streamSse(urlPath, content, onEvent, signal, file = null) {
  const token = useAuthStore.getState().token;
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let body;
  if (file) {
    body = new FormData();
    body.append("content", content || "");
    body.append("file", file);
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ content });
  }

  const resp = await fetch(`${API_BASE}${urlPath}`, {
    method: "POST",
    headers,
    body,
    signal,
  });

  if (!resp.ok) {
    let msg = `请求失败 (${resp.status})`;
    try {
      const body = await resp.json();
      msg = body.error || msg;
    } catch {}
    throw new Error(msg);
  }
  if (!resp.body) throw new Error("流式响应不可用");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = parseSseChunk(chunk);
      if (event) {
        if (event.event === "error") {
          const message = typeof event.data === "string"
            ? event.data
            : event.data?.message || "服务器错误";
          throw new Error(message);
        }
        onEvent(event.event, event.data);
      }
    }
  }
}

function parseSseChunk(chunk) {
  let event = "message";
  const dataLines = [];
  for (const line of chunk.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join("\n");
  try { return { event, data: JSON.parse(raw) }; }
  catch { return { event, data: raw }; }
}
