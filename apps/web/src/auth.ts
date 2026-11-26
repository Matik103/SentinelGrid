import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from "./bootstrap";

const TOKEN_KEY = "sg_access_token";
const ORG_KEY = "sg_organisation_id";

let client: SupabaseClient | null = null;
let sessionListeners: Array<(session: Session | null) => void> = [];

function isDevBuild(): boolean {
  return Boolean(import.meta.env.DEV);
}

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "sg-command-auth",
      },
    });
    client.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        localStorage.setItem(TOKEN_KEY, session.access_token);
      } else if (!isDevBuild() || !import.meta.env.VITE_DEV_ACCESS_TOKEN) {
        localStorage.removeItem(TOKEN_KEY);
      }
      for (const listener of sessionListeners) listener(session);
    });
  }
  return client;
}

/** Production path: Supabase Auth session. Dev-only fallback: VITE_DEV_ACCESS_TOKEN. */
export function authToken(): string | null {
  const fromStorage = localStorage.getItem(TOKEN_KEY);
  if (fromStorage) return fromStorage;
  if (isDevBuild()) {
    return (import.meta.env.VITE_DEV_ACCESS_TOKEN as string | undefined) || null;
  }
  return null;
}

export function organisationId(): string | null {
  return (
    localStorage.getItem(ORG_KEY) ||
    (isDevBuild() ? (import.meta.env.VITE_DEV_ORGANISATION_ID as string | undefined) : undefined) ||
    null
  );
}

export function setOrganisationId(id: string | null) {
  if (id) localStorage.setItem(ORG_KEY, id);
  else localStorage.removeItem(ORG_KEY);
}

export async function restoreSession(): Promise<Session | null> {
  const { data, error } = await getSupabase().auth.getSession();
  if (error) return null;
  if (data.session?.access_token) {
    localStorage.setItem(TOKEN_KEY, data.session.access_token);
  }
  return data.session;
}

export async function signInWithPassword(email: string, password: string): Promise<Session> {
  const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(error?.message ?? "Sign-in failed");
  localStorage.setItem(TOKEN_KEY, data.session.access_token);
  return data.session;
}

export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut();
  localStorage.removeItem(TOKEN_KEY);
}

export function onAuthSession(listener: (session: Session | null) => void): () => void {
  sessionListeners.push(listener);
  return () => {
    sessionListeners = sessionListeners.filter((item) => item !== listener);
  };
}

export function authModeLabel(): string {
  if (localStorage.getItem(TOKEN_KEY) && !isDevBuild()) return "Supabase session";
  if (isDevBuild() && import.meta.env.VITE_DEV_ACCESS_TOKEN && !localStorage.getItem(TOKEN_KEY)) {
    return "Dev token (local only)";
  }
  if (localStorage.getItem(TOKEN_KEY)) return "Signed in";
  return "Signed out";
}
