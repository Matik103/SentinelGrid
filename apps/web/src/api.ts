import { loadPublicConfig, PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from "./bootstrap";
import { authToken, organisationId } from "./auth";

export { authToken, organisationId };

let apiBase = "";
let apiConfigError: string | null = null;
let configReady: Promise<void> | null = null;

export function ensureConfig(): Promise<void> {
  if (!configReady) {
    configReady = loadPublicConfig().then((cfg) => {
      apiBase = cfg.api_base_url.replace(/\\/$/, "");
      apiConfigError = cfg.api_config_error;
    });
  }
  return configReady;
}

const base = () => apiBase;

export function apiConfigured(): boolean {
  return Boolean(base());
}

export function apiConfigurationError(): string {
  return apiConfigError ?? "The API base URL is not configured.";
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
    return { error: { status: 401, message: "Sign in required (Supabase Auth session or local sg_access_token)" } };
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
  return apiMutate<T>("POST", path, body);
}

export async function apiPatch<T>(
  path: string,
  body: unknown,
): Promise<{ data?: T; error?: ApiError }> {
  return apiMutate<T>("PATCH", path, body);
}

async function apiMutate<T>(
  method: "POST" | "PATCH",
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
      method,
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


export type AssetMediaRecord = {
  id: string;
  organisation_id: string;
  asset_id: string;
  storage_path: string | null;
  external_url: string | null;
  media_kind: string;
  provenance: "customer_upload" | "manufacturer_catalogue" | "representative";
  is_primary: boolean;
  asset_match_verified: boolean;
  original_filename: string | null;
  content_type: string | null;
  attribution: string | null;
  caption: string | null;
  created_at: string;
  display_url?: string;
};

export type EnergyMeasurement = {
  id: string;
  organisation_id: string;
  facility_id: string;
  asset_id: string | null;
  device_id: string | null;
  sensor_id: string | null;
  metric_key: string;
  value: number;
  unit: string;
  measured_at: string;
  source: string;
  quality: "good" | "uncertain" | "poor" | "unknown";
  classification: "real" | "simulated" | "replayed" | "synthetic";
};

export type EnergyAnomaly = {
  id: string;
  facility_id: string;
  asset_id: string | null;
  metric_key: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  status: "open" | "acknowledged" | "resolved" | "false_positive";
  title: string;
  explanation: string;
  observed_value: number | null;
  baseline_value: number | null;
  deviation_pct: number | null;
  rule_key: string;
  detected_at: string;
};

async function supabaseRest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = authToken();
  if (!token) throw new Error("Sign in required to access organisation data.");
  const headers = new Headers(init.headers);
  headers.set("apikey", PUBLIC_SUPABASE_ANON_KEY);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${PUBLIC_SUPABASE_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    const message = (await response.text()).slice(0, 300);
    throw new Error(message || `Supabase request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function signedAssetUrl(storagePath: string): Promise<string> {
  const path = storagePath.split("/").map(encodeURIComponent).join("/");
  const result = await supabaseRest<{ signedURL?: string }>(
    `/storage/v1/object/sign/asset-media/${path}`,
    { method: "POST", body: JSON.stringify({ expiresIn: 3600 }) },
  );
  if (!result.signedURL) throw new Error("Supabase did not return a signed image URL.");
  if (/^https?:\/\//i.test(result.signedURL)) return result.signedURL;
  return `${PUBLIC_SUPABASE_URL}/storage/v1${result.signedURL.startsWith("/") ? result.signedURL : `/${result.signedURL}`}`;
}

export type WorkspaceBranding = { logoUrl: string | null; logoPath: string | null };

export async function getWorkspaceBranding(organisationIdValue: string): Promise<WorkspaceBranding> {
  const query = new URLSearchParams({ select: "settings", id: `eq.${organisationIdValue}`, limit: "1" });
  const rows = await supabaseRest<Array<{ settings?: Record<string, unknown> }>>(`/rest/v1/organisations?${query.toString()}`);
  const path = typeof rows[0]?.settings?.logo_path === "string" ? rows[0].settings.logo_path : null;
  return { logoPath: path, logoUrl: path ? `${PUBLIC_SUPABASE_URL}/storage/v1/object/public/workspace-branding/${path.split("/").map(encodeURIComponent).join("/")}` : null };
}

export async function canManageWorkspaceBranding(organisationIdValue: string): Promise<boolean> {
  const token = authToken();
  if (!token) return false;
  const response = await fetch(`${PUBLIC_SUPABASE_URL}/rest/v1/rpc/has_org_permission`, {
    method: "POST",
    headers: { apikey: PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_organisation_id: organisationIdValue, p_permission: "org.admin" }),
  });
  if (!response.ok) return false;
  return Boolean(await response.json());
}

export async function uploadWorkspaceLogo(organisationIdValue: string, file: File): Promise<WorkspaceBranding> {
  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
  if (!allowed.has(file.type)) throw new Error("Choose a JPEG, PNG, WebP or AVIF logo.");
  if (file.size > 2 * 1024 * 1024) throw new Error("Workspace logos must be 2 MB or smaller.");
  const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" } as Record<string, string>)[file.type];
  const storagePath = `${organisationIdValue}/${crypto.randomUUID()}.${extension}`;
  const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/");
  await supabaseRest<unknown>(`/storage/v1/object/workspace-branding/${encodedPath}`, { method: "POST", headers: { "Content-Type": file.type, "x-upsert": "false" }, body: file });
  try {
    const current = await getWorkspaceBranding(organisationIdValue);
    const token = authToken();
    if (!token) throw new Error("Sign in required.");
    const response = await fetch(`${PUBLIC_SUPABASE_URL}/rest/v1/rpc/set_workspace_logo`, { method: "POST", headers: { apikey: PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_organisation_id: organisationIdValue, p_logo_path: storagePath }) });
    if (!response.ok) throw new Error((await response.text()).slice(0, 300) || "Could not save the workspace logo.");
    if (current.logoPath && current.logoPath !== storagePath) {
      const oldPath = current.logoPath.split("/").map(encodeURIComponent).join("/");
      try { await supabaseRest<unknown>(`/storage/v1/object/workspace-branding/${oldPath}`, { method: "DELETE" }); } catch { /* Best-effort cleanup. */ }
    }
    return { logoPath: storagePath, logoUrl: `${PUBLIC_SUPABASE_URL}/storage/v1/object/public/workspace-branding/${encodedPath}` };
  } catch (error) {
    try { await supabaseRest<unknown>(`/storage/v1/object/workspace-branding/${encodedPath}`, { method: "DELETE" }); } catch { /* Preserve original error. */ }
    throw error;
  }
}

export async function listAssetMedia(organisationIdValue: string): Promise<AssetMediaRecord[]> {
  const query = new URLSearchParams({
    select: "id,organisation_id,asset_id,storage_path,external_url,media_kind,provenance,is_primary,asset_match_verified,original_filename,content_type,attribution,caption,created_at",
    organisation_id: `eq.${organisationIdValue}`,
    order: "is_primary.desc,created_at.desc",
    limit: "500",
  });
  const rows = await supabaseRest<AssetMediaRecord[]>(`/rest/v1/asset_media?${query.toString()}`);
  return Promise.all(rows.map(async (row) => {
    if (row.external_url) return { ...row, display_url: row.external_url };
    if (!row.storage_path) return row;
    try {
      return { ...row, display_url: await signedAssetUrl(row.storage_path) };
    } catch {
      return row;
    }
  }));
}

async function replaceAssetPrimaryMedia(params: {
  organisationId: string;
  assetId: string;
  storagePath?: string | null;
  externalUrl?: string | null;
  provenance: AssetMediaRecord["provenance"];
  verifiedMatch: boolean;
  originalFilename?: string | null;
  contentType?: string | null;
  byteLength?: number | null;
  manufacturerReference?: string | null;
  attribution?: string | null;
  caption?: string | null;
}): Promise<AssetMediaRecord> {
  const token = authToken();
  if (!token) throw new Error("Sign in required.");
  const response = await fetch(`${PUBLIC_SUPABASE_URL}/rest/v1/rpc/replace_asset_primary_media`, {
    method: "POST",
    headers: {
      apikey: PUBLIC_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      p_organisation_id: params.organisationId,
      p_asset_id: params.assetId,
      p_storage_path: params.storagePath ?? null,
      p_external_url: params.externalUrl ?? null,
      p_provenance: params.provenance,
      p_asset_match_verified: params.verifiedMatch,
      p_original_filename: params.originalFilename ?? null,
      p_content_type: params.contentType ?? null,
      p_byte_length: params.byteLength ?? null,
      p_manufacturer_reference: params.manufacturerReference ?? null,
      p_attribution: params.attribution ?? null,
      p_caption: params.caption ?? null,
      p_media_kind: "primary",
    }),
  });
  if (!response.ok) {
    throw new Error((await response.text()).slice(0, 300) || "Could not save asset media metadata.");
  }
  const payload = (await response.json()) as AssetMediaRecord | AssetMediaRecord[];
  const row = Array.isArray(payload) ? payload[0] : payload;
  if (!row) throw new Error("The media record was not returned.");
  return row;
}

export async function uploadAssetImage(
  organisationIdValue: string,
  assetId: string,
  file: File,
  verifiedMatch: boolean,
): Promise<AssetMediaRecord> {
  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
  if (!allowed.has(file.type)) throw new Error("Choose a JPEG, PNG, WebP or AVIF image.");
  if (file.size > 15 * 1024 * 1024) throw new Error("Images must be 15 MB or smaller.");
  const cleanName = file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-100) || "equipment-image";
  const storagePath = `${organisationIdValue}/${assetId}/${crypto.randomUUID()}-${cleanName}`;
  const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/");
  await supabaseRest<unknown>(`/storage/v1/object/asset-media/${encodedPath}`, {
    method: "POST",
    headers: { "Content-Type": file.type, "x-upsert": "false" },
    body: file,
  });

  try {
    const row = await replaceAssetPrimaryMedia({
      organisationId: organisationIdValue,
      assetId,
      storagePath,
      provenance: "customer_upload",
      verifiedMatch,
      originalFilename: file.name,
      contentType: file.type,
      byteLength: file.size,
      caption: "Customer-uploaded equipment photograph",
    });
    try { return { ...row, display_url: await signedAssetUrl(storagePath) }; }
    catch { return row; }
  } catch (error) {
    // Best-effort cleanup keeps the private bucket free of unreferenced uploads.
    try {
      await supabaseRest<unknown>(`/storage/v1/object/asset-media/${encodedPath}`, { method: "DELETE" });
    } catch { /* The database error is the useful failure to surface. */ }
    throw error;
  }
}


export async function addAssetExternalImage(
  organisationIdValue: string,
  assetId: string,
  sourceUrl: string,
  provenance: "manufacturer_catalogue" | "representative",
  attribution: string,
  manufacturerReference: string,
  verifiedMatch: boolean,
): Promise<AssetMediaRecord> {
  let parsed: URL;
  try { parsed = new URL(sourceUrl); }
  catch { throw new Error("Enter a valid image URL."); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("External equipment images must use a secure HTTPS URL.");
  }
  if (!/\.(?:png|jpe?g|webp|avif)(?:$|[?#])/i.test(parsed.pathname + parsed.search)) {
    throw new Error("Use a direct JPEG, PNG, WebP or AVIF image URL.");
  }
  if (verifiedMatch && provenance === "representative") {
    throw new Error("Representative images cannot be marked as an exact asset match.");
  }
  const row = await replaceAssetPrimaryMedia({
    organisationId: organisationIdValue,
    assetId,
    externalUrl: parsed.toString(),
    provenance,
    verifiedMatch,
    manufacturerReference: manufacturerReference.trim() || null,
    attribution: attribution.trim() || null,
    caption: provenance === "manufacturer_catalogue" ? "Manufacturer catalogue image" : "Representative reference image",
  });
  return { ...row, display_url: row.external_url ?? undefined };
}

export async function listEnergyMeasurements(
  organisationIdValue: string,
  since: string,
  facilityId?: string,
): Promise<EnergyMeasurement[]> {
  const query = new URLSearchParams({
    select: "id,organisation_id,facility_id,asset_id,device_id,sensor_id,metric_key,value,unit,measured_at,source,quality,classification",
    organisation_id: `eq.${organisationIdValue}`,
    measured_at: `gte.${since}`,
    order: "measured_at.desc",
    limit: "1000",
  });
  if (facilityId) query.set("facility_id", `eq.${facilityId}`);
  return supabaseRest<EnergyMeasurement[]>(`/rest/v1/energy_measurements?${query.toString()}`);
}

export async function listEnergyAnomalies(
  organisationIdValue: string,
  facilityId?: string,
): Promise<EnergyAnomaly[]> {
  const query = new URLSearchParams({
    select: "id,facility_id,asset_id,metric_key,severity,status,title,explanation,observed_value,baseline_value,deviation_pct,rule_key,detected_at",
    organisation_id: `eq.${organisationIdValue}`,
    status: "in.(open,acknowledged)",
    order: "detected_at.desc",
    limit: "100",
  });
  if (facilityId) query.set("facility_id", `eq.${facilityId}`);
  return supabaseRest<EnergyAnomaly[]>(`/rest/v1/energy_anomalies?${query.toString()}`);
}
