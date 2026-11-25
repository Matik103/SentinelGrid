/**
 * Irreducible public client bootstrap for Sentinel Command on Vercel.
 * - Supabase project URL and anon key are public-by-design (RLS enforces access).
 * - Service-role and other secrets MUST NEVER appear here or in Vercel env for the SPA.
 * - After anon connect, runtime settings are loaded from public.app_public_config in Postgres.
 */
export const PUBLIC_SUPABASE_URL = "https://abaeizgfsskvjklfslrh.supabase.co";
export const PUBLIC_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiYWVpemdmc3NrdmprbGZzbHJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU2MDkxMjksImV4cCI6MjExMTE4NTEyOX0.DGiWBwwYFgBwR-8xGghs-vlSC1_giAr546zKCktRYZ0";

export type PublicConfig = {
  api_base_url: string;
  command_title: string;
};

const defaults: PublicConfig = {
  api_base_url: "",
  command_title: "Sentinel Command",
};

let cached: PublicConfig | null = null;

export async function loadPublicConfig(): Promise<PublicConfig> {
  if (cached) return cached;
  const url = `${PUBLIC_SUPABASE_URL}/rest/v1/app_public_config?select=key,value`;
  try {
    const res = await fetch(url, {
      headers: {
        apikey: PUBLIC_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${PUBLIC_SUPABASE_ANON_KEY}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`config HTTP ${res.status}`);
    const rows = (await res.json()) as Array<{ key: string; value: unknown }>;
    const next = { ...defaults };
    for (const row of rows) {
      if (row.key === "api_base_url" && typeof row.value === "string") next.api_base_url = row.value;
      if (
        row.key === "api_base_url" &&
        row.value &&
        typeof row.value === "object" &&
        "url" in (row.value as object)
      ) {
        next.api_base_url = String((row.value as { url: string }).url ?? "");
      }
      if (row.key === "command_title") {
        const v = row.value;
        next.command_title =
          typeof v === "string" ? v : String((v as { title?: string })?.title ?? next.command_title);
      }
    }
    const viteApi = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (viteApi) next.api_base_url = viteApi.replace(/\/$/, "");
    cached = next;
    return next;
  } catch {
    const viteApi = import.meta.env.VITE_API_BASE_URL as string | undefined;
    cached = {
      ...defaults,
      api_base_url: viteApi?.replace(/\/$/, "") ?? "",
    };
    return cached;
  }
}
