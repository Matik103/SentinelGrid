import { createClient, type AuthChangeEvent, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from "./bootstrap";
import {
  RECOVERY_FLAG,
  accessTokenHasRecoveryAmr,
  amrIncludesRecovery,
  urlIndicatesPasswordRecovery,
} from "./authRecovery";
import { clearAllCachedWorkspaceLogos } from "./workspaceLogoCache";

const TOKEN_KEY = "sg_access_token";
const ORG_KEY = "sg_organisation_id";
let client: SupabaseClient | null = null;
let sessionListeners: Array<(event: AuthChangeEvent, session: Session | null) => void> = [];

function isDevBuild(): boolean { return Boolean(import.meta.env.DEV); }
function authRedirectUrl(kind?: "reset"): string {
  const url = new URL(window.location.origin);
  const invite = new URLSearchParams(window.location.search).get("invite");
  if (kind === "reset") url.searchParams.set("reset", "1");
  if (invite) url.searchParams.set("invite", invite);
  return kind === "reset" || invite ? url.toString() : window.location.origin;
}

/** Persist recovery intent before Supabase strips `#type=recovery` from the URL. */
export function capturePasswordRecoveryIntent(): void {
  try {
    if (urlIndicatesPasswordRecovery(window.location.hash, window.location.search)) {
      sessionStorage.setItem(RECOVERY_FLAG, "1");
    }
  } catch {
    /* sessionStorage unavailable */
  }
}

export function markPasswordRecoveryPending(): void {
  try { sessionStorage.setItem(RECOVERY_FLAG, "1"); } catch { /* ignore */ }
}

export function isPasswordRecoveryPending(): boolean {
  try { return sessionStorage.getItem(RECOVERY_FLAG) === "1"; } catch { return false; }
}

export function clearPasswordRecoveryPending(): void {
  try { sessionStorage.removeItem(RECOVERY_FLAG); } catch { /* ignore */ }
}

/** True when the JWT/session AMR shows this is a recovery (password-reset) session. */
export function sessionIsRecovery(session: Session | null | undefined): boolean {
  if (!session) return false;
  const direct = (session as Session & { amr?: unknown }).amr;
  if (amrIncludesRecovery(direct)) return true;
  return accessTokenHasRecoveryAmr(session.access_token);
}

export function noteRecoveryFromSession(session: Session | null | undefined): void {
  if (sessionIsRecovery(session)) markPasswordRecoveryPending();
}

export function getSupabase(): SupabaseClient {
  if (!client) {
    capturePasswordRecoveryIntent();
    client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "sg-command-auth" },
    });
    client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || sessionIsRecovery(session)) markPasswordRecoveryPending();
      if (session?.access_token) localStorage.setItem(TOKEN_KEY, session.access_token);
      else if (!isDevBuild() || !import.meta.env.VITE_DEV_ACCESS_TOKEN) localStorage.removeItem(TOKEN_KEY);
      for (const listener of sessionListeners) listener(event, session);
    });
  }
  return client;
}

/** Production uses verified Supabase Auth sessions. The dev-token fallback is local-build only. */
export function authToken(): string | null {
  const fromStorage = localStorage.getItem(TOKEN_KEY);
  if (fromStorage) return fromStorage;
  if (isDevBuild()) return (import.meta.env.VITE_DEV_ACCESS_TOKEN as string | undefined) || null;
  return null;
}
export function organisationId(): string | null {
  return localStorage.getItem(ORG_KEY) ||
    (isDevBuild() ? (import.meta.env.VITE_DEV_ORGANISATION_ID as string | undefined) : undefined) || null;
}
export function setOrganisationId(id: string | null) {
  if (id) localStorage.setItem(ORG_KEY, id);
  else localStorage.removeItem(ORG_KEY);
}
async function ensureUserProfile(session: Session): Promise<void> {
  const user = session.user;
  const displayName = typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name.trim() : "";
  // Must use ensure_own_profile (SECURITY DEFINER). Direct profiles upsert is blocked at AAL1 by
  // restrictive require_aal2_* RLS and must not be used as a fallback before MFA.
  const { error: rpcError } = await getSupabase().rpc("ensure_own_profile", {
    p_display_name: displayName || null,
  });
  if (rpcError) {
    console.warn("SentinelGrid profile initialisation deferred:", rpcError.message);
  }
}
/** Persist the current Supabase access token for Nest Authorization headers. */
export function syncAccessToken(session: Session | null): void {
  if (session?.access_token) localStorage.setItem(TOKEN_KEY, session.access_token);
  else if (!isDevBuild() || !import.meta.env.VITE_DEV_ACCESS_TOKEN) localStorage.removeItem(TOKEN_KEY);
}

export async function restoreSession(): Promise<Session | null> {
  capturePasswordRecoveryIntent();
  const { data, error } = await getSupabase().auth.getSession();
  if (error || !data.session) {
    syncAccessToken(null);
    return null;
  }
  syncAccessToken(data.session);
  noteRecoveryFromSession(data.session);
  await ensureUserProfile(data.session);
  return data.session;
}
export async function signInWithPassword(email: string, password: string): Promise<Session> {
  const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(error?.message ?? "Sign-in failed. Check your credentials and try again.");
  localStorage.setItem(TOKEN_KEY, data.session.access_token);
  await ensureUserProfile(data.session);
  return data.session;
}
export async function signUpWithPassword(email: string, password: string, displayName: string): Promise<{ session: Session | null; email: string }> {
  const { data, error } = await getSupabase().auth.signUp({
    email, password,
    options: { data: { display_name: displayName.trim() }, emailRedirectTo: authRedirectUrl() },
  });
  if (error) throw new Error(error.message);
  if (data.session?.access_token) {
    localStorage.setItem(TOKEN_KEY, data.session.access_token);
    await ensureUserProfile(data.session);
  }
  return { session: data.session, email: data.user?.email ?? email };
}
export async function resendSignupConfirmation(email: string): Promise<void> {
  const { error } = await getSupabase().auth.resend({ type: "signup", email, options: { emailRedirectTo: authRedirectUrl() } });
  if (error) throw new Error(error.message);
}
export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await getSupabase().auth.resetPasswordForEmail(email, { redirectTo: authRedirectUrl("reset") });
  if (error) throw new Error(error.message);
}
export async function updatePassword(password: string): Promise<void> {
  const { error } = await getSupabase().auth.updateUser({ password });
  if (error) throw new Error(error.message);
}
export async function signOut(): Promise<void> {
  const { error } = await getSupabase().auth.signOut();
  if (error) throw new Error(error.message);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ORG_KEY);
  clearPasswordRecoveryPending();
  clearAllCachedWorkspaceLogos();
}
/**
 * Subscribe to Supabase auth lifecycle events.
 * Callers should ignore TOKEN_REFRESHED / INITIAL_SESSION when the shell is already ready —
 * those fire on tab focus and would otherwise remount the whole workspace.
 */
export function onAuthSession(listener: (event: AuthChangeEvent, session: Session | null) => void): () => void {
  sessionListeners.push(listener);
  return () => { sessionListeners = sessionListeners.filter((item) => item !== listener); };
}
export function authModeLabel(): string {
  if (localStorage.getItem(TOKEN_KEY) && !isDevBuild()) return "Supabase session";
  if (isDevBuild() && import.meta.env.VITE_DEV_ACCESS_TOKEN && !localStorage.getItem(TOKEN_KEY)) return "Dev token (local only)";
  if (localStorage.getItem(TOKEN_KEY)) return "Signed in";
  return "Signed out";
}
