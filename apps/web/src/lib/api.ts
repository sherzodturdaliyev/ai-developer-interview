import type { SessionResponse } from "./types";

/** Error returned by the API in the shape { error: { code, message, details? } }. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Maps VALIDATION_ERROR details to { fieldName: message }. */
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const d of this.details as { path?: unknown; message?: unknown }[]) {
      if (typeof d.path === "string" && typeof d.message === "string" && !(d.path in out)) {
        out[d.path] = d.message;
      }
    }
    return out;
  }
}

// The access token lives only in memory. The refresh token is an httpOnly cookie the
// browser sends automatically to /api/auth; JavaScript never sees it.
let accessToken: string | null = null;
let onSessionExpired: (() => void) | null = null;
let refreshInFlight: Promise<SessionResponse | null> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err =
      typeof data === "object" && data !== null && "error" in data
        ? (data as { error: { code?: string; message?: string; details?: unknown } }).error
        : undefined;
    throw new ApiError(
      res.status,
      err?.code ?? "HTTP_ERROR",
      err?.message ?? `Request failed with status ${res.status}`,
      err?.details,
    );
  }
  return data as T;
}

async function doRefresh(): Promise<SessionResponse | null> {
  const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
  if (!res.ok) {
    accessToken = null;
    return null;
  }
  const session = (await res.json()) as SessionResponse;
  accessToken = session.accessToken;
  return session;
}

/**
 * Refresh tokens rotate on every use and reusing an old one revokes all sessions.
 * Calls are de-duplicated within the tab and serialized across tabs with the Web Locks API,
 * so two tabs never send the same refresh cookie.
 */
export function refreshSession(): Promise<SessionResponse | null> {
  if (refreshInFlight) return refreshInFlight;
  const run = (): Promise<SessionResponse | null> => doRefresh().catch(() => null);
  const locked: Promise<SessionResponse | null> =
    typeof navigator !== "undefined" && navigator.locks
      ? // The lock resolves with the callback's resolved value; DOM typings model it as Promise<Promise<T>>.
        (navigator.locks.request("adi-session-refresh", run) as unknown as Promise<SessionResponse | null>)
      : run();
  const pending = locked.finally(() => {
    refreshInFlight = null;
  });
  refreshInFlight = pending;
  return pending;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Send the access token and retry once after refreshing on 401. Default true. */
  auth?: boolean;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true } = options;
  const send = () => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return fetch(path, {
      method,
      headers,
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };

  let res: Response;
  try {
    res = await send();
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Cannot reach the server. Check your connection and try again.");
  }

  if (res.status === 401 && auth) {
    const session = await refreshSession();
    if (!session) {
      onSessionExpired?.();
      return parseResponse<T>(res);
    }
    res = await send();
  }
  return parseResponse<T>(res);
}
