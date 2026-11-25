const base = () => (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

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
  const root = base();
  if (!root) return { error: { status: 0, message: "VITE_API_BASE_URL not configured" } };
  const token = authToken();
  if (!token) return { error: { status: 401, message: "Sign in required (set VITE_DEV_ACCESS_TOKEN or sg_access_token)" } };
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
  const root = base();
  if (!root) return { error: { status: 0, message: "VITE_API_BASE_URL not configured" } };
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
  const root = base();
  if (!root) return "API base URL not configured";
  try {
    const res = await fetch(`${root}/v1/health`);
    return res.ok ? "API reachable" : `API HTTP ${res.status}`;
  } catch {
    return "API unreachable";
  }
}
