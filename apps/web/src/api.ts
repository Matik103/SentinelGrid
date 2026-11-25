import { loadPublicConfig } from "./bootstrap";

let apiBase = "";
let configReady: Promise<void> | null = null;

export function ensureConfig(): Promise<void> {
  if (!configReady) {
    configReady = loadPublicConfig().then((cfg) => {
      apiBase = (cfg.api_base_url || "").replace(/\/$/, "");
    });
  }
  return configReady;
}

const base = () => apiBase;

export function apiConfigured(): boolean {
  return Boolean(base());
}

export function authToken(): string | null {
  return (
    (import.meta.env.VITE_DEV_ACCESS_TOKEN as string | undefined) ||
    localStorage.getItem("sg_access_token") ||
    null
  );
}

export function organisationId(): string | null {
  return (
    (import.meta.env.VITE_DEV_ORGANISATION_ID as string | undefined) ||
    localStorage.getItem("sg_organisation_id") ||
    null
  );
}

export type ApiError = { status: number; message: string };

export async function apiGet<T>(path: string): Promise<{ data?: T; error?: ApiError }> {
  await ensureConfig();
  const root = base();
  if (!root) {
    return {
      error: {
        status: 0,
        message: "API base URL not set in app_public_config (and no VITE_API_BASE_URL override)",
      },
    };
  }
  const token = authToken();
  if (!token) {
    return { error: { status: 401, message: "Sign in required (set VITE_DEV_ACCESS_TOKEN or sg_access_token)" } };
  }
  try {
    const res = await fetch(`${root}${path.startsWith("/") ? path : `/${path}`}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text();
      return { error: { status: res.status, message: text.slice(0, 300) || res.statusText } };
    }
    return { data: (await res.json()) as T };
  } catch (err) {
    return { error: { status: 0, message: err instanceof Error ? err.message : String(err) } };
  }
}

export async function apiPost<T>(
  path: string,
  body: unknown,
): Promise<{ data?: T; error?: ApiError }> {
  await ensureConfig();
  const root = base();
  if (!root) {
    return {
      error: {
        status: 0,
        message: "API base URL not set in app_public_config (and no VITE_API_BASE_URL override)",
      },
    };
  }
  const token = authToken();
  if (!token) return { error: { status: 401, message: "Sign in required" } };
  try {
    const res = await fetch(`${root}${path.startsWith("/") ? path : `/${path}`}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      return { error: { status: res.status, message: text.slice(0, 300) || res.statusText } };
    }
    return { data: (await res.json()) as T };
  } catch (err) {
    return { error: { status: 0, message: err instanceof Error ? err.message : String(err) } };
  }
}

export async function healthCheck(): Promise<string> {
  await ensureConfig();
  const root = base();
  if (!root) return "API base URL not configured (DB app_public_config)";
  try {
    const res = await fetch(`${root}/v1/health`);
    return res.ok ? "API reachable" : `API HTTP ${res.status}`;
  } catch {
    return "API unreachable";
  }
}
