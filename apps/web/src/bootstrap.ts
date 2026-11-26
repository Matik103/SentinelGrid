/**
 * Public browser bootstrap for Sentinel Command.
 *
 * The Supabase URL and anon key are public client credentials protected by RLS.
 * Never place a service-role key or other server secret in this module or a VITE_ variable.
 *
 * API origin precedence:
 *   1. VITE_API_BASE_URL (Vercel build-time override; useful during backend rollout)
 *   2. public.app_public_config.api_base_url (Supabase runtime configuration)
 */
export const PUBLIC_SUPABASE_URL = "https://abaeizgfsskvjklfslrh.supabase.co";
export const PUBLIC_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiYWVpemdmc3NrdmprbGZzbHJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU2MDkxMjksImV4cCI6MjExMTE4NTEyOX0.DGiWBwwYFgBwR-8xGghs-vlSC1_giAr546zKCktRYZ0".replace(/\s/g, "");

export type ApiConfigSource = "vercel_environment" | "supabase" | "missing";

export type PublicConfig = {
  api_base_url: string;
  command_title: string;
  api_config_source: ApiConfigSource;
  api_config_error: string | null;
};

const defaults: PublicConfig = {
  api_base_url: "",
  command_title: "Sentinel Command",
  api_config_source: "missing",
  api_config_error: null,
};

let cached: PublicConfig | null = null;

function normalizeApiBaseUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const candidate = value.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("The configured API URL is not a valid absolute URL.");
  }
  if (parsed.protocol !== "https:" && !(import.meta.env.DEV && parsed.protocol === "http:")) {
    throw new Error("The API URL must use HTTPS (HTTP is allowed only for local development).");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("The API URL must not contain credentials, query parameters or a fragment.");
  }
  return candidate;
}

function configValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "url" in value) {
    const url = (value as { url?: unknown }).url;
    return typeof url === "string" ? url : "";
  }
  return "";
}

export async function loadPublicConfig(): Promise<PublicConfig> {
  if (cached) return cached;

  const viteApi = import.meta.env.VITE_API_BASE_URL as string | undefined;
  let databaseConfig: PublicConfig = { ...defaults };
  let databaseError: string | null = null;

  try {
    const endpoint = `${PUBLIC_SUPABASE_URL}/rest/v1/app_public_config?select=key,value`;
    const res = await fetch(endpoint, {
      headers: {
        apikey: PUBLIC_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${PUBLIC_SUPABASE_ANON_KEY}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      databaseError = `Supabase public configuration request failed (HTTP ${res.status}). Check the app_public_config table, its anon SELECT grant and RLS policy.`;
    } else {
      const rows = (await res.json()) as Array<{ key: string; value: unknown }>;
      for (const row of rows) {
        if (row.key === "api_base_url") databaseConfig.api_base_url = configValue(row.value);
        if (row.key === "command_title") {
          const title = row.value && typeof row.value === "object" && "title" in row.value
            ? (row.value as { title?: unknown }).title
            : row.value;
          if (typeof title === "string" && title.trim()) databaseConfig.command_title = title.trim();
        }
      }
    }
  } catch (error) {
    databaseError = error instanceof Error
      ? `Could not load Supabase public configuration: ${error.message}`
      : "Could not load Supabase public configuration.";
  }

  try {
    const override = normalizeApiBaseUrl(viteApi);
    if (override) {
      cached = {
        ...databaseConfig,
        api_base_url: override,
        api_config_source: "vercel_environment",
        api_config_error: null,
      };
      return cached;
    }

    const databaseUrl = normalizeApiBaseUrl(databaseConfig.api_base_url);
    if (databaseUrl) {
      cached = {
        ...databaseConfig,
        api_base_url: databaseUrl,
        api_config_source: "supabase",
        api_config_error: null,
      };
      return cached;
    }

    cached = {
      ...databaseConfig,
      api_base_url: "",
      api_config_source: "missing",
      api_config_error: databaseError ?? "The api_base_url setting exists but is empty in public.app_public_config. Set it to the deployed NestJS API origin.",
    };
    return cached;
  } catch (error) {
    cached = {
      ...databaseConfig,
      api_base_url: "",
      api_config_source: "missing",
      api_config_error: error instanceof Error ? error.message : "The API URL configuration is invalid.",
    };
    return cached;
  }
}

export function resetPublicConfigForTests(): void {
  cached = null;
}
