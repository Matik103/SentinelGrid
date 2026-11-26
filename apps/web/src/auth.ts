import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from "./bootstrap";

const TOKEN_KEY = "sg_access_token";
const ORG_KEY = "sg_organisation_id";
let client: SupabaseClient | null = null;
let sessionListeners: Array<(session: Session | null) => void> = [];

function isDevBuild(): boolean { return Boolean(import.meta.env.DEV); }
function authRedirectUrl(): string {
  const invite = new URLSearchParams(window.location.search).get("invite");
  return invite ? `${window.location.origin}/?invite=${encodeURIComponent(invite)}` : window.location.origin;
}

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "sg-command-auth" },
    });
    client.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) localStorage.setItem(TOKEN_KEY, session.access_token);
      else if (!isDevBuild() || !import.meta.env.VITE_DEV_ACCESS_TOKEN) localStorage.removeItem(TOKEN_KEY);
      for (const listener of sessionListeners) listener(session);
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
  const { error: rpcError } = await getSupabase().rpc("ensure_own_profile", {
    p_display_name: displayName || null,
  });
  if (!rpcError) return;
  // Fallback path for environments that have table grants but not the RPC yet.
  const profile: { user_id: string; email: string | null; display_name?: string } = {
    user_id: user.id,
    email: user.email ?? null,
  };
  if (displayName) profile.display_name = displayName;
  const { error } = await getSupabase().from("profiles").upsert(profile, { onConflict: "user_id" });
  if (error) console.warn("SentinelGrid profile initialisation deferred:", error.message);
}
export async function restoreSession(): Promise<Session | null> {
  const { data, error } = await getSupabase().auth.getSession();
  if (error || !data.session) {
    if (!isDevBuild() || !import.meta.env.VITE_DEV_ACCESS_TOKEN) localStorage.removeItem(TOKEN_KEY);
    return null;
  }
  if (data.session?.access_token) {
    localStorage.setItem(TOKEN_KEY, data.session.access_token);
    await ensureUserProfile(data.session);
  }
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
  const { error } = await getSupabase().auth.resetPasswordForEmail(email, { redirectTo: authRedirectUrl() });
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
}
export function onAuthSession(listener: (session: Session | null) => void): () => void {
  sessionListeners.push(listener);
  return () => { sessionListeners = sessionListeners.filter((item) => item !== listener); };
}
export function authModeLabel(): string {
  if (localStorage.getItem(TOKEN_KEY) && !isDevBuild()) return "Supabase session";
  if (isDevBuild() && import.meta.env.VITE_DEV_ACCESS_TOKEN && !localStorage.getItem(TOKEN_KEY)) return "Dev token (local only)";
  if (localStorage.getItem(TOKEN_KEY)) return "Signed in";
  return "Signed out";
}
