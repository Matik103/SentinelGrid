import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { apiGet, apiPost, authToken, getWorkspaceBranding } from "./api";
import { peekCachedWorkspaceLogo, rememberWorkspaceLogo } from "./workspaceLogoCache";

type OrganisationMembership = {
  organisation_id: string;
  status: string;
  organisations?: { id: string; name: string; slug: string } | null;
};

type Organisation = { id: string; name: string; slug: string; logoUrl: string | null };

type Props = {
  activeOrganisationId: string | null;
  onSelect: (organisationId: string | null, name: string) => void;
  refreshKey: number;
};

function makeSlug(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 55).replace(/-$/g, "");
}

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || "SG";
}

function slugDiffersFromName(name: string, slug: string) {
  const normalizedName = makeSlug(name);
  return Boolean(slug) && slug.toLowerCase() !== normalizedName && slug.toLowerCase() !== name.trim().toLowerCase();
}

export function WorkspaceSwitcher({ activeOrganisationId, onSelect, refreshKey }: Props) {
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const active = useMemo(
    () => organisations.find((item) => item.id === activeOrganisationId) ?? null,
    [organisations, activeOrganisationId],
  );

  async function withLogos(rows: Array<{ id: string; name: string; slug: string }>): Promise<Organisation[]> {
    const branded = await Promise.all(rows.map(async (row) => {
      const cached = peekCachedWorkspaceLogo(row.id);
      try {
        const branding = await getWorkspaceBranding(row.id);
        return { ...row, logoUrl: branding.logoUrl };
      } catch {
        if (cached !== undefined) return { ...row, logoUrl: cached };
        rememberWorkspaceLogo(row.id, null);
        return { ...row, logoUrl: null };
      }
    }));
    return branded;
  }

  async function loadOrganisations(preferredId?: string, opts?: { quiet?: boolean }) {
    if (!authToken()) {
      setOrganisations([]);
      setLoading(false);
      setError(null);
      return;
    }
    if (!opts?.quiet) {
      setLoading(true);
      setError(null);
    }
    const result = await apiGet<OrganisationMembership[]>("/v1/orgs/mine");
    if (result.error) {
      if (!opts?.quiet) setError(result.error.message);
    } else {
      const rows = (result.data ?? [])
        .filter((row) => row.status === "active" && row.organisations?.id)
        .map((row) => ({
          id: row.organisations!.id,
          name: row.organisations!.name,
          slug: row.organisations!.slug,
        }));
      setOrganisations(rows.map((row) => ({
        ...row,
        logoUrl: peekCachedWorkspaceLogo(row.id) ?? null,
      })));
      const withBrand = await withLogos(rows);
      setOrganisations(withBrand);
      if (!opts?.quiet) {
        const next = preferredId && withBrand.some((row) => row.id === preferredId)
          ? preferredId
          : withBrand.some((row) => row.id === activeOrganisationId)
            ? activeOrganisationId
            : withBrand[0]?.id;
        if (next) {
          const selected = withBrand.find((row) => row.id === next);
          onSelect(next, selected?.name ?? "Workspace");
        } else {
          onSelect(null, "No workspace selected");
        }
      }
    }
    if (!opts?.quiet) setLoading(false);
  }

  useEffect(() => { void loadOrganisations(); }, [refreshKey]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  async function createOrganisation(event: FormEvent) {
    event.preventDefault();
    const cleanName = name.trim();
    const cleanSlug = makeSlug(slug);
    if (!cleanName || cleanSlug.length < 2) {
      setError("Enter an organisation name and a valid workspace address (at least 2 characters).");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await apiPost<{ organisation_id: string; name: string; slug: string }>(
      "/v1/orgs/bootstrap",
      { name: cleanName, slug: cleanSlug },
    );
    if (result.error || !result.data?.organisation_id) {
      const message = result.error?.message ?? "The workspace could not be created.";
      setError(/duplicate key|unique constraint|already exists/i.test(message)
        ? "That workspace URL is already in use. Choose a different URL."
        : message);
      setSaving(false);
      return;
    }
    const created = result.data;
    setOrganisations((current) => [...current.filter((item) => item.id !== created.organisation_id), {
      id: created.organisation_id, name: created.name, slug: created.slug, logoUrl: null,
    }]);
    onSelect(created.organisation_id, created.name);
    setName("");
    setSlug("");
    setSlugEdited(false);
    setCreating(false);
    setSaving(false);
    setMenuOpen(false);
  }

  return (
    <section className="workspace-picker" aria-label="Workspace selection" ref={menuRef}>
      <div className="workspace-picker-label">CURRENT WORKSPACE</div>
      <button
        type="button"
        className="workspace-picker-control workspace-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        disabled={loading || (!authToken())}
        onClick={() => {
          setMenuOpen((open) => {
            const next = !open;
            if (next) void loadOrganisations(undefined, { quiet: true });
            return next;
          });
        }}
      >
        <span className="workspace-avatar" aria-hidden="true">
          {active?.logoUrl
            ? <img src={active.logoUrl} alt="" />
            : initials(active?.name ?? "SG")}
        </span>
        <span className="workspace-picker-copy">
          <strong>{loading ? "Loading workspaces…" : active?.name ?? (authToken() ? "No workspace selected" : "Sign in to continue")}</strong>
        </span>
        <span className="workspace-chevron" aria-hidden="true">⌄</span>
      </button>
      {menuOpen && organisations.length > 0 && (
        <ul className="workspace-picker-menu" role="listbox" aria-label="Switch workspace">
          {organisations.map((item) => {
            const selected = item.id === activeOrganisationId;
            const showSlug = slugDiffersFromName(item.name, item.slug);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={selected ? "workspace-picker-option active" : "workspace-picker-option"}
                  onClick={() => {
                    onSelect(item.id, item.name);
                    setMenuOpen(false);
                  }}
                >
                  <span className="workspace-avatar" aria-hidden="true">
                    {item.logoUrl ? <img src={item.logoUrl} alt="" /> : initials(item.name)}
                  </span>
                  <span className="workspace-picker-copy">
                    <strong>{item.name}</strong>
                    {showSlug ? <small>{item.slug}</small> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="workspace-picker-error" role="alert">{error}</p>}
      {error && authToken() && !creating && <button className="workspace-retry" type="button" onClick={() => void loadOrganisations()}>Retry workspace list</button>}
      {organisations.length > 1 && <span className="workspace-picker-count">{organisations.length} workspaces available</span>}
      <button className="workspace-create-toggle" type="button" disabled={!authToken()} onClick={() => { setCreating((value) => !value); setError(null); }}>
        <span aria-hidden="true">{creating ? "−" : "+"}</span>{creating ? "Close" : "Create workspace"}
      </button>
      {creating && (
        <form className="workspace-create-form" onSubmit={(event) => void createOrganisation(event)}>
          <label>Workspace name
            <input value={name} onChange={(event) => {
              const value = event.target.value;
              setName(value);
              if (!slugEdited) setSlug(makeSlug(value));
            }} placeholder="e.g. Acme Infrastructure" maxLength={200} required autoFocus />
          </label>
          <label>Workspace slug
            <input value={slug} onChange={(event) => { setSlugEdited(true); setSlug(event.target.value); }}
              placeholder="acme-infrastructure" maxLength={63} pattern="[a-z0-9]+(-[a-z0-9]+)*" required />
          </label>
          <button className="workspace-create-submit" type="submit" disabled={saving || !name.trim() || makeSlug(slug).length < 2}>
            {saving ? "Creating…" : "Create workspace"}
          </button>
        </form>
      )}
      {!authToken() && <p className="workspace-picker-hint">Sign in to see or create your organisations.</p>}
      {!loading && authToken() && organisations.length === 0 && !creating && (
        <p className="workspace-picker-hint">Create your first workspace to start organising your infrastructure.</p>
      )}
    </section>
  );
}
