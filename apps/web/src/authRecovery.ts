/** Pure recovery helpers (no DOM / Supabase) — unit-tested. */

export const RECOVERY_FLAG = "sg_pending_password_recovery";

export function amrIncludesRecovery(amr: unknown): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some((entry) => {
    const method = typeof entry === "string" ? entry : (entry as { method?: string } | null)?.method;
    return method === "recovery";
  });
}

/** Decode JWT payload without verifying signature (client-side hint only). */
export function accessTokenHasRecoveryAmr(accessToken: string): boolean {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return false;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { amr?: unknown };
    return amrIncludesRecovery(json.amr);
  } catch {
    return false;
  }
}

export function urlIndicatesPasswordRecovery(hash: string, search: string): boolean {
  const hashParams = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return hashParams.get("type") === "recovery"
    || query.get("type") === "recovery"
    || query.get("reset") === "1";
}
