import { NavLink, Route, Routes } from "react-router-dom";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { apiConfigured, apiGet, apiPost, authToken, healthCheck, organisationId } from "./api";

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/organisation", label: "Organisation" },
  { to: "/facilities", label: "Facilities" },
  { to: "/zones", label: "Zones" },
  { to: "/assets", label: "Assets" },
  { to: "/devices", label: "Devices" },
  { to: "/connectors", label: "Connectors" },
  { to: "/events", label: "Event ledger" },
  { to: "/evidence", label: "Evidence" },
  { to: "/audit", label: "Audit logs" },
  { to: "/users", label: "Users" },
] as const;

function Page({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children?: ReactNode;
}) {
  return (
    <section>
      <h1 className="page-title">{title}</h1>
      <p className="page-lead">{lead}</p>
      {children}
    </section>
  );
}

function StatusBanner({ error }: { error?: string | null }) {
  if (!error) return null;
  return <div className="empty">{error}</div>;
}

function useOrgResource<T>(pathBuilder: (orgId: string) => string) {
  const [rows, setRows] = useState<T[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    setError(null);
    if (!apiConfigured()) {
      setError("Configure VITE_API_BASE_URL to load live data.");
      setLoading(false);
      return;
    }
    const org = organisationId();
    if (!org) {
      setError("Set VITE_DEV_ORGANISATION_ID or localStorage sg_organisation_id.");
      setLoading(false);
      return;
    }
    if (!authToken()) {
      setError("Set VITE_DEV_ACCESS_TOKEN or localStorage sg_access_token.");
      setLoading(false);
      return;
    }
    const res = await apiGet<T[]>(pathBuilder(org));
    if (res.error) {
      setError(`${res.error.status}: ${res.error.message}`);
      setRows([]);
    } else {
      setRows(res.data ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    void reload();
  }, []);

  return { rows, error, loading, reload, orgId: organisationId() };
}

function DataTable({
  columns,
  rows,
}: {
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
}) {
  if (!rows.length) {
    return (
      <div className="empty">
        No rows returned from the API for this organisation.
        <div className="badge-sim">LIVE API — empty result (not fabricated OT)</div>
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={String(row.id ?? idx)}>
              {columns.map((c) => (
                <td key={c.key} className="mono">
                  {formatCell(row[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function Overview() {
  const [health, setHealth] = useState<string>("checking…");
  const [orgCount, setOrgCount] = useState<string>("—");
  const [facilityCount, setFacilityCount] = useState<string>("—");
  const [eventCount, setEventCount] = useState<string>("—");

  useEffect(() => {
    void healthCheck().then(setHealth);
    const org = organisationId();
    if (!org || !authToken() || !apiConfigured()) return;
    void apiGet<unknown[]>(`/v1/orgs/mine`).then((r) => {
      if (r.data) setOrgCount(String(r.data.length));
    });
    void apiGet<unknown[]>(`/v1/orgs/${org}/facilities`).then((r) => {
      if (r.data) setFacilityCount(String(r.data.length));
    });
    void apiGet<unknown[]>(`/v1/events?organisation_id=${org}&limit=50`).then((r) => {
      if (r.data) setEventCount(String(r.data.length));
    });
  }, []);

  return (
    <Page
      title="Sentinel Command"
      lead="Live organisation, registry, connector, event, and audit workflows against the Phase 0 API."
    >
      <div className="stats">
        <div className="stat">
          <strong>{orgCount}</strong>
          <span>Memberships</span>
        </div>
        <div className="stat">
          <strong>{facilityCount}</strong>
          <span>Facilities</span>
        </div>
        <div className="stat">
          <strong>{eventCount}</strong>
          <span>Recent events</span>
        </div>
        <div className="stat">
          <strong className="mono">{health}</strong>
          <span>API status</span>
        </div>
      </div>
    </Page>
  );
}

function OrganisationPanel() {
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, unknown>[]>([]);
  const [invites, setInvites] = useState<Record<string, unknown>[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("read_only_viewer");
  const [msg, setMsg] = useState<string | null>(null);
  const org = organisationId();

  const reload = async () => {
    setError(null);
    if (!org || !authToken() || !apiConfigured()) {
      setError("Configure API base URL, organisation id, and access token.");
      return;
    }
    const [m, i] = await Promise.all([
      apiGet<Record<string, unknown>[]>(`/v1/orgs/${org}/members`),
      apiGet<Record<string, unknown>[]>(`/v1/orgs/${org}/invites`),
    ]);
    if (m.error) setError(m.error.message);
    else setMembers(m.data ?? []);
    if (i.error) setError(i.error.message);
    else setInvites(i.data ?? []);
  };

  useEffect(() => {
    void reload();
  }, [org]);

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    if (!org) return;
    setMsg(null);
    const res = await apiPost<Record<string, unknown>>(`/v1/orgs/${org}/invites`, {
      email: inviteEmail,
      role_key: inviteRole,
    });
    if (res.error) setMsg(`Invite failed: ${res.error.message}`);
    else {
      setMsg(`Invite queued (${String((res.data as { delivery?: { channel?: string } })?.delivery?.channel ?? "outbox")})`);
      setInviteEmail("");
      void reload();
      const inv = await apiGet<Record<string, unknown>[]>(`/v1/orgs/${org}/invites`);
      if (inv.data) setInvites(inv.data);
    }
  }

  return (
    <Page title="Organisation settings" lead="Tenant membership and invitation workflows.">
      <StatusBanner error={error} />
      <h2 className="section-title">Members</h2>
      <DataTable
        columns={[
          { key: "user_id", label: "User" },
          { key: "status", label: "Status" },
          { key: "roles", label: "Role" },
        ]}
        rows={members}
      />
      <h2 className="section-title">Invitations</h2>
      <DataTable
        columns={[
          { key: "email", label: "Email" },
          { key: "status", label: "Status" },
          { key: "expires_at", label: "Expires" },
          { key: "roles", label: "Role" },
        ]}
        rows={invites}
      />
      <form className="inline-form" onSubmit={onInvite}>
        <input
          type="email"
          required
          placeholder="invitee@example.com"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
        />
        <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
          <option value="read_only_viewer">read_only_viewer</option>
          <option value="operations_manager">operations_manager</option>
          <option value="security_analyst">security_analyst</option>
          <option value="facility_manager">facility_manager</option>
          <option value="organisation_administrator">organisation_administrator</option>
        </select>
        <button type="submit" className="btn">
          Send invite
        </button>
      </form>
      {msg && <p className="page-lead">{msg}</p>}
    </Page>
  );
}

function ResourcePage({
  title,
  lead,
  path,
  columns,
  create,
}: {
  title: string;
  lead: string;
  path: (org: string) => string;
  columns: { key: string; label: string }[];
  create?: {
    label: string;
    build: (org: string, form: FormData) => { path: string; body: unknown } | null;
    fields: ReactNode;
  };
}) {
  const { rows, error, loading, reload, orgId } = useOrgResource<Record<string, unknown>>(path);
  const [msg, setMsg] = useState<string | null>(null);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!orgId || !create) return;
    const form = new FormData(e.currentTarget);
    const built = create.build(orgId, form);
    if (!built) {
      setMsg("Missing required fields");
      return;
    }
    const res = await apiPost(built.path, built.body);
    if (res.error) setMsg(res.error.message);
    else {
      setMsg("Created");
      e.currentTarget.reset();
      void reload();
    }
  }

  return (
    <Page title={title} lead={lead}>
      <StatusBanner error={error} />
      {loading ? <p className="page-lead">Loading…</p> : <DataTable columns={columns} rows={rows} />}
      {create && orgId && (
        <form className="inline-form" onSubmit={onCreate}>
          {create.fields}
          <button type="submit" className="btn">
            {create.label}
          </button>
        </form>
      )}
      {msg && <p className="page-lead">{msg}</p>}
    </Page>
  );
}

export function App() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
  }, [theme]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          Sentinel <span>Command</span>
        </div>
        <nav className="nav" aria-label="Primary">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => (isActive ? "active" : undefined)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="toolbar">
          <button
            type="button"
            className="btn secondary"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/organisation" element={<OrganisationPanel />} />
          <Route
            path="/facilities"
            element={
              <ResourcePage
                title="Facilities"
                lead="Register and review facilities for this organisation."
                path={(org) => `/v1/orgs/${org}/facilities`}
                columns={[
                  { key: "name", label: "Name" },
                  { key: "code", label: "Code" },
                  { key: "status", label: "Status" },
                  { key: "created_at", label: "Created" },
                ]}
                create={{
                  label: "Create facility",
                  fields: (
                    <>
                      <input name="name" required placeholder="Facility name" />
                      <input name="code" placeholder="Code" />
                    </>
                  ),
                  build: (org, form) => ({
                    path: `/v1/orgs/${org}/facilities`,
                    body: {
                      name: String(form.get("name") ?? ""),
                      code: String(form.get("code") ?? "") || undefined,
                    },
                  }),
                }}
              />
            }
          />
          <Route
            path="/zones"
            element={
              <ResourcePage
                title="Zones"
                lead="Facility zones for registry scoping."
                path={(org) => `/v1/orgs/${org}/zones`}
                columns={[
                  { key: "name", label: "Name" },
                  { key: "facility_id", label: "Facility" },
                  { key: "code", label: "Code" },
                  { key: "status", label: "Status" },
                ]}
                create={{
                  label: "Create zone",
                  fields: (
                    <>
                      <input name="facility_id" required placeholder="Facility UUID" />
                      <input name="name" required placeholder="Zone name" />
                      <input name="code" placeholder="Code" />
                    </>
                  ),
                  build: (org, form) => ({
                    path: `/v1/orgs/${org}/zones`,
                    body: {
                      facility_id: String(form.get("facility_id") ?? ""),
                      name: String(form.get("name") ?? ""),
                      code: String(form.get("code") ?? "") || undefined,
                    },
                  }),
                }}
              />
            }
          />
          <Route
            path="/assets"
            element={
              <ResourcePage
                title="Asset registry"
                lead="Assets linked to facilities and zones."
                path={(org) => `/v1/orgs/${org}/assets`}
                columns={[
                  { key: "name", label: "Name" },
                  { key: "facility_id", label: "Facility" },
                  { key: "zone_id", label: "Zone" },
                  { key: "category", label: "Category" },
                  { key: "status", label: "Status" },
                ]}
              />
            }
          />
          <Route
            path="/devices"
            element={
              <ResourcePage
                title="Device registry"
                lead="Devices associated with assets."
                path={(org) => `/v1/orgs/${org}/devices`}
                columns={[
                  { key: "name", label: "Name" },
                  { key: "facility_id", label: "Facility" },
                  { key: "asset_id", label: "Asset" },
                  { key: "status", label: "Status" },
                ]}
              />
            }
          />
          <Route
            path="/connectors"
            element={
              <ResourcePage
                title="Connectors"
                lead="Register, heartbeat, rotate, and revoke edge connectors."
                path={(org) => `/v1/orgs/${org}/connectors`}
                columns={[
                  { key: "name", label: "Name" },
                  { key: "connector_uid", label: "UID" },
                  { key: "status", label: "Status" },
                  { key: "credential_status", label: "Credential" },
                  { key: "last_heartbeat_at", label: "Heartbeat" },
                ]}
                create={{
                  label: "Register connector",
                  fields: <input name="name" required placeholder="Connector name" />,
                  build: (org, form) => ({
                    path: `/v1/orgs/${org}/connectors`,
                    body: { name: String(form.get("name") ?? "") },
                  }),
                }}
              />
            }
          />
          <Route
            path="/events"
            element={
              <ResourcePage
                title="Event ledger"
                lead="Validated telemetry and platform events for the tenant."
                path={(org) => `/v1/events?organisation_id=${org}&limit=100`}
                columns={[
                  { key: "event_type", label: "Type" },
                  { key: "source", label: "Source" },
                  { key: "occurred_at", label: "Occurred" },
                  { key: "classification", label: "Class" },
                  { key: "integrity_status", label: "Integrity" },
                ]}
              />
            }
          />
          <Route
            path="/evidence"
            element={
              <ResourcePage
                title="Evidence chain"
                lead="Event-linked evidence records and integrity status."
                path={(org) => `/v1/orgs/${org}/evidence/records`}
                columns={[
                  { key: "event_id", label: "Event" },
                  { key: "payload_sha256", label: "SHA-256" },
                  { key: "chain_hash", label: "Chain" },
                  { key: "integrity_status", label: "Status" },
                  { key: "created_at", label: "Created" },
                ]}
              />
            }
          />
          <Route
            path="/audit"
            element={
              <ResourcePage
                title="Audit logs"
                lead="Administrative actions for this organisation."
                path={(org) => `/v1/orgs/${org}/audit-logs`}
                columns={[
                  { key: "action", label: "Action" },
                  { key: "resource_type", label: "Resource" },
                  { key: "resource_id", label: "ID" },
                  { key: "created_at", label: "When" },
                ]}
              />
            }
          />
          <Route path="/users" element={<OrganisationPanel />} />
        </Routes>
      </main>
    </div>
  );
}
