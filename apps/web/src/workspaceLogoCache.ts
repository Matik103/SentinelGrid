const STORAGE_PREFIX = "sg.workspace.logo.";

/** Cached logo URL, null when the org has no custom logo, undefined when unknown. */
export function peekCachedWorkspaceLogo(organisationId: string): string | null | undefined {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + organisationId);
    if (raw === null) return undefined;
    return raw === "" ? null : raw;
  } catch {
    return undefined;
  }
}

export function rememberWorkspaceLogo(organisationId: string, logoUrl: string | null): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + organisationId, logoUrl ?? "");
  } catch {
    /* sessionStorage may be unavailable */
  }
}

export function clearCachedWorkspaceLogo(organisationId: string): void {
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + organisationId);
  } catch {
    /* ignore */
  }
}

/** Drop every cached workspace logo (call on sign-out). */
export function clearAllCachedWorkspaceLogos(): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
