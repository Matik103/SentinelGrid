import { useEffect, useMemo, useState, type FormEvent } from "react";
import { apiGet, apiPost, authToken } from "./api";

type OrganisationMembership = {
  organisation_id: string;
  status: string;
  organisations?: { id: string; name: string; slug: string } | null;
};

type Organisation = { id: string; name: string; slug: string };

type Props = {
  activeOrganisationId: string | null;
  onSelect: (organisationId: string | null, name: string) => void;
  refreshKey: number;
};

function makeSlug(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 55).replace(/-$/g, "");
}

export function WorkspaceSwitcher({ activeOrganisationId, onSelect, refreshKey }: Props) {
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [saving, setSaving] = useState(false);

  const active = useMemo(
    () => organisations.find((item) => item.id === activeOrganisationId) ?? null,
    [organisations, activeOrganisationId],
  );

  async function loadOrganisations(preferredId?: string) {
    if (!authToken()) {
      setOrganisations([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const result = await apiGet<OrganisationMembership[]>("/v1/orgs/mine");
    if (result.error) {
      // Preserve the last known memberships and selected workspace on transient failures.
      setError(result.error.message);
    } else {
      const rows = (result.data ?? [])
        .filter((row) => row.status === "active" && row.organisations?.id)
        .map((row) => ({
          id: row.organisations!.id,
          name: row.organisations!.name,
          slug: row.organisations!.slug,
        }));
      setOrganisations(rows);
      const next = preferredId && rows.some((row) => row.id === preferredId)
        ? preferredId
        : rows.some((row) => row.id === activeOrganisationId)
          ? activeOrganisationId
          : rows[0]?.id;
      if (next) {
        const selected = rows.find((row) => row.id === next);
        onSelect(next, selected?.name ?? "Workspace");
      } else {
        onSelect(null, "No workspace selected");
      }
    }
    setLoading(false);
  }

  useEffect(() => { void loadOrganisations(); }, [refreshKey]);

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
      id: created.organisation_id, name: created.name, slug: created.slug,
    }]);
    onSelect(created.organisation_id, created.name);
    setName("");
    setSlug("");
    setSlugEdited(false);
    setCreating(false);
    setSaving(false);
  }

  return (
    <section className="workspace-picker" aria-label="Workspace selection">
      <div className="workspace-picker-label">CURRENT WORKSPACE</div>
      <label className="workspace-picker-control">
        <span className="workspace-avatar" aria-hidden="true">{(active?.name ?? "SG").slice(0, 2).toUpperCase()}</span>
        <span className="workspace-picker-copy">
          <strong>{loading ? "Loading workspaces…" : active?.name ?? (authToken() ? "No workspace selected" : "Sign in to continue")}</strong>
          <small>{active ? active.slug : error ? "Workspace list unavailable" : "Organisation environment"}</small>
        </span>
        <select
          aria-label="Switch workspace"
          value={activeOrganisationId ?? ""}
          disabled={loading || organisations.length === 0}
          onChange={(event) => {
            const selected = organisations.find((item) => item.id === event.target.value);
            if (selected) onSelect(selected.id, selected.name);
          }}
        >
          {!activeOrganisationId && <option value="">Select workspace</option>}
          {organisations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <span className="workspace-chevron" aria-hidden="true">⌄</span>
      </label>
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
          <label>Workspace URL
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
