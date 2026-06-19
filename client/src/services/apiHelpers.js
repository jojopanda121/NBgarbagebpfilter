import useAuthStore from "../store/useAuthStore";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

export function buildAuthHeaders(extraHeaders = {}) {
  const token = useAuthStore.getState().token;
  return token
    ? { ...extraHeaders, Authorization: `Bearer ${token}` }
    : { ...extraHeaders };
}

export function shouldSendJson(body) {
  return body && !(body instanceof FormData);
}

export async function readJsonSafely(resp) {
  return resp.json().catch(() => ({}));
}

export async function handleAuthStatus(resp) {
  if (resp.status === 401) {
    const body = await readJsonSafely(resp);
    useAuthStore.getState().logout();
    throw new ApiError(body.error || "登录已过期，请重新登录", 401);
  }

  if (resp.status !== 403) return;

  const body = await readJsonSafely(resp);
  if (body.code === 4031) {
    useAuthStore.getState().setRequireContactBinding(true);
    throw new ApiError(body.error || "请先绑定邮箱", 4031);
  }
  if (body.code === 4032) {
    throw new ApiError(body.error || "额度不足，请联系客服购买兑换码", 4032);
  }

  throw new ApiError(body.error || "权限不足", 403);
}

export async function assertOkResponse(resp, fallbackMessage) {
  await handleAuthStatus(resp);
  if (resp.ok) return;

  const body = await readJsonSafely(resp);
  throw new ApiError(body.error || `${fallbackMessage} (${resp.status})`, resp.status);
}

export function filenameFromDisposition(contentDisposition, fallbackFilename) {
  const match = (contentDisposition || "").match(/filename\*=UTF-8''([^;]+)/i);
  if (!match?.[1]) return fallbackFilename;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return fallbackFilename;
  }
}
