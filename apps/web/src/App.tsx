import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { apiConfigured, apiGet, apiPost, authToken, healthCheck, organisationId } from "./api";
import { restoreSession } from "./auth";
import { AuthPanel } from "./AuthPanel";
import { AssetRegistryPage } from "./AssetRegistryPage";
import { EnergyDashboard } from "./EnergyDashboard";
import { AssetEnergyProfile } from "./AssetEnergyProfile";
import { TopologyPage, IncidentWorkbenchPage, EventReplayPage, ScenarioWorkbenchPage } from "./OperationsWorkbench";

const NAV_GROUPS = [
  { section: "COMMAND", items: [{ to: "/", label: "Overview", glyph: "◈" }, { to: "/incidents", label: "Incident investigation", glyph: "⌁" }, { to: "/replay", label: "Event replay", glyph: "↶" }] },
  { section: "INFRASTRUCTURE", items: [{ to: "/topology", label: "Infrastructure topology", glyph: "⌗" }, { to: "/facilities", label: "Facilities", glyph: "▦" }, { to: "/zones", label: "Zones", glyph: "⌖" }, { to: "/assets", label: "Assets & equipment", glyph: "◫" }, { to: "/devices", label: "Devices", glyph: "⌘" }, { to: "/sensors", label: "Sensors", glyph: "◉" }, { to: "/energy", label: "Energy intelligence", glyph: "ϟ" }, { to: "/scenarios", label: "Failure scenario lab", glyph: "△" }] },
  { section: "SECURITY & EVIDENCE", items: [{ to: "/connectors", label: "Connectors", glyph: "⌘" }, { to: "/evidence", label: "Evidence chain", glyph: "⟡" }, { to: "/audit", label: "Audit trail", glyph: "≋" }] },
  { section: "WORKSPACE", items: [{ to: "/organisation", label: "Organisation", glyph: "⌂" }, { to: "/users", label: "People & access", glyph: "◎" }] },
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
    <section className="workspace-page">
      <header className="workspace-page-header">
        <div className="eyebrow">SENTINEL COMMAND / WORKSPACE</div>
        <h1 className="page-title">{title}</h1>
        <p className="page-lead">{lead}</p>
      </header>
      {children}
    </section>
  );
}

function StatusBanner({ error }: { error?: string | null }) {
  if (!error) return null;
  return <div className="inline-notice warning">{error}</div>;
}

function useOrgResource<T>(pathBuilder: (orgId: string) => string) {
  const [rows, setRows] = useState<T[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    setError(null);
    if (!apiConfigured()) {
      setError("API base URL missing in Supabase app_public_config (or VITE_API_BASE_URL for local).");
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

type OverviewFacility = { id: string; name: string; code?: string | null; status?: string | null };
type OverviewAsset = { id: string; name: string; category?: string | null; status?: string | null; facility_id?: string | null };
type OverviewEvent = { id?: string; event_type?: string; source?: string; occurred_at?: string; classification?: string; integrity_status?: string; data_quality?: string };

function dashboardTime(value?: string) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Overview() {
  const [health, setHealth] = useState("Checking");
  const [facilities, setFacilities] = useState<OverviewFacility[]>([]);
  const [assets, setAssets] = useState<OverviewAsset[]>([]);
  const [devices, setDevices] = useState<Record<string, unknown>[]>([]);
  const [events, setEvents] = useState<OverviewEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const configured = apiConfigured() && Boolean(organisationId()) && Boolean(authToken());

  useEffect(() => {
    let active = true;
    void healthCheck().then((value) => { if (active) setHealth(value); }).catch(() => { if (active) setHealth("Unavailable"); });
    const org = organisationId();
    if (!apiConfigured() || !org || !authToken()) {
      setLoading(false);
      setError("Connect an organisation and authenticated session to populate this command view. No sample telemetry is displayed.");
      return () => { active = false; };
    }
    void Promise.all([
      apiGet<OverviewFacility[]>(`/v1/orgs/${org}/facilities`),
      apiGet<OverviewAsset[]>(`/v1/orgs/${org}/assets`),
      apiGet<Record<string, unknown>[]>(`/v1/orgs/${org}/devices`),
      apiGet<OverviewEvent[]>(`/v1/events?organisation_id=${org}&limit=8`),
    ]).then(([facilityResult, assetResult, deviceResult, eventResult]) => {
      if (!active) return;
      setFacilities(facilityResult.data ?? []);
      setAssets(assetResult.data ?? []);
      setDevices(deviceResult.data ?? []);
      setEvents(eventResult.data ?? []);
      const failures = [facilityResult, assetResult, deviceResult, eventResult].filter((result) => result.error);
      if (failures.length) setError("Some workspace data could not be loaded. Open the relevant section to inspect its source response.");
      setLoading(false);
    }).catch(() => {
      if (active) { setError("The command view could not retrieve workspace data."); setLoading(false); }
    });
    return () => { active = false; };
  }, []);

  const criticalEvents = events.filter((event) => event.integrity_status === "failed" || event.data_quality === "poor" || /critical|failure|fault|alarm|offline|trip|overheat/i.test(String(event.event_type ?? ""))).length;
  const stats = [
    { label: "REGISTERED FACILITIES", value: loading ? "—" : String(facilities.length), detail: "Accessible locations", glyph: "▦", tone: "teal" },
    { label: "TRACKED ASSETS", value: loading ? "—" : String(assets.length), detail: "Equipment registry", glyph: "◫", tone: "blue" },
    { label: "CONNECTED DEVICES", value: loading ? "—" : String(devices.length), detail: "Registered endpoints", glyph: "⌘", tone: "violet" },
    { label: "RECENT REVIEW SIGNALS", value: loading ? "—" : String(criticalEvents), detail: "Rule-based event metadata cues", glyph: "△", tone: "amber" },
  ];

  return (
    <section className="command-overview">
      <div className="command-hero">
        <div className="command-hero-copy">
          <div className="eyebrow"><span className="eyebrow-pulse" /> OPERATIONS / COMMAND OVERVIEW</div>
          <h1 className="command-title">See the whole system.<br /><span>Understand what matters.</span></h1>
          <p className="command-intro">A clear operational picture of your facilities, equipment, energy signals and recorded events — grounded in the data your organisation has connected.</p>
          <div className="command-actions">
            <NavLink className="command-primary-action" to="/facilities">Explore facilities <span>↗</span></NavLink>
            <NavLink className="command-secondary-action" to="/assets">Open asset registry</NavLink>
          </div>
        </div>
        <div className="command-hero-visual" aria-label="Infrastructure network illustration">
          <div className="orbital orbital-one" /><div className="orbital orbital-two" />
          <div className="hero-core"><span className="core-cross">+</span><strong>SG</strong><small>COMMAND</small></div>
          <span className="orbit-node node-a">POWER</span><span className="orbit-node node-b">ASSETS</span><span className="orbit-node node-c">SENSORS</span><span className="orbit-node node-d">EVIDENCE</span>
          <div className="visual-caption">CONNECTED INFRASTRUCTURE<br /><span>Operational context layer</span></div>
        </div>
      </div>

      <div className="command-section-heading">
        <div><span className="eyebrow">WORKSPACE SNAPSHOT</span><h2>Operational footprint</h2></div>
        <span className="snapshot-note">Values reflect accessible organisation records</span>
      </div>
      <div className="command-stat-grid">
        {stats.map((item) => <article className="command-stat-card" key={item.label}>
          <div className={`command-stat-icon ${item.tone}`}>{item.glyph}</div>
          <div className="command-stat-label">{item.label}</div>
          <strong>{item.value}</strong>
          <span>{item.detail}</span>
        </article>)}
      </div>

      {error && <div className="command-notice"><span>i</span><p>{error}</p></div>}

      <div className="command-content-grid">
        <section className="command-panel facilities-panel">
          <div className="command-panel-heading"><div><span className="eyebrow">LOCATIONS / REGISTRY</span><h2>Facility overview</h2></div><NavLink to="/facilities">View all <span>↗</span></NavLink></div>
          {loading ? <div className="command-empty">Loading accessible facilities…</div> : facilities.length ? <div className="facility-list">
            {facilities.slice(0, 5).map((facility, index) => <article className="facility-row" key={facility.id}>
              <div className="facility-index">{String(index + 1).padStart(2, "0")}</div>
              <div className="facility-symbol">⌂</div>
              <div className="facility-details"><strong>{facility.name}</strong><span>{facility.code || "Facility registry"} · {facility.status || "Status not reported"}</span></div>
              <span className="facility-arrow">↗</span>
            </article>)}
          </div> : <div className="command-empty"><strong>No facilities registered yet</strong><span>Create your first facility to begin mapping its infrastructure.</span><NavLink to="/facilities">Register a facility ↗</NavLink></div>}
        </section>

        <section className="command-panel activity-panel">
          <div className="command-panel-heading"><div><span className="eyebrow">EVENT LEDGER / LATEST RECORDS</span><h2>Recent activity</h2></div><NavLink to="/events">Open ledger <span>↗</span></NavLink></div>
          {loading ? <div className="command-empty">Loading recorded events…</div> : events.length ? <div className="activity-list">
            {events.slice(0, 6).map((event, index) => <article className="activity-row" key={event.id ?? `${event.event_type}-${index}`}>
              <span className="activity-marker" />
              <div className="activity-copy"><strong>{event.event_type || "Recorded event"}</strong><span>{event.source || "Source not specified"} · {dashboardTime(event.occurred_at)}</span></div>
              <span className="activity-classification">{event.classification || "UNCLASSIFIED"}</span>
            </article>)}
          </div> : <div className="command-empty"><strong>No events recorded</strong><span>Validated source events will appear here when connectors begin reporting.</span></div>}
        </section>

        <section className="command-panel topology-panel">
          <div className="command-panel-heading"><div><span className="eyebrow">SYSTEM MODEL / RELATIONSHIPS</span><h2>Infrastructure context</h2></div><span className="model-status">MODEL PREVIEW</span></div>
          <div className="topology-canvas">
            <svg viewBox="0 0 620 190" role="img" aria-label="Conceptual infrastructure relationship model">
              <defs><linearGradient id="topologyLine" x1="0" x2="1"><stop offset="0" stopColor="#54d6c5" stopOpacity=".18"/><stop offset="1" stopColor="#54d6c5" stopOpacity=".8"/></linearGradient></defs>
              <path d="M310 94 L140 42 M310 94 L480 42 M310 94 L140 148 M310 94 L480 148" stroke="url(#topologyLine)" strokeWidth="1.5" fill="none" strokeDasharray="5 6"/>
              <rect x="250" y="66" width="120" height="56" rx="10" className="topology-hub"/>
              <text x="310" y="89" textAnchor="middle" className="topology-label">FACILITY</text><text x="310" y="105" textAnchor="middle" className="topology-sub">CONTEXT</text>
              {[[140,42,"POWER"],[480,42,"EQUIPMENT"],[140,148,"SENSORS"],[480,148,"EVIDENCE"]].map(([x,y,label]) => <g key={String(label)}><rect x={Number(x)-55} y={Number(y)-18} width="110" height="36" rx="8" className="topology-node"/><text x={x} y={Number(y)+4} textAnchor="middle" className="topology-label">{label}</text></g>)}
            </svg>
          </div>
          <div className="topology-footnote"><span className="topology-dot" /> Conceptual model — live dependency links appear when asset relationships are registered.</div>
        </section>

        <section className="command-panel quick-access-panel">
          <div className="command-panel-heading"><div><span className="eyebrow">WORKSPACES</span><h2>Go deeper</h2></div></div>
          <div className="quick-access-grid">
            <NavLink to="/topology"><span>⌗</span><strong>Infrastructure topology</strong><small>Registered assets and relationships</small><b>↗</b></NavLink>
            <NavLink to="/incidents"><span>⌁</span><strong>Incident investigation</strong><small>Recorded signals and event context</small><b>↗</b></NavLink>
            <NavLink to="/energy"><span>ϟ</span><strong>Energy intelligence</strong><small>Measured demand and findings</small><b>↗</b></NavLink>
            <NavLink to="/assets"><span>◫</span><strong>Asset explorer</strong><small>Equipment profiles and media</small><b>↗</b></NavLink>
            <NavLink to="/connectors"><span>⌘</span><strong>Data connections</strong><small>Connector status and access</small><b>↗</b></NavLink>
            <NavLink to="/evidence"><span>⟡</span><strong>Evidence explorer</strong><small>Integrity and event provenance</small><b>↗</b></NavLink>
            <NavLink to="/replay"><span>↶</span><strong>Event replay</strong><small>Historical event timeline</small><b>↗</b></NavLink>
            <NavLink to="/scenarios"><span>△</span><strong>Failure scenario lab</strong><small>Non-actuating registry analysis</small><b>↗</b></NavLink>
          </div>
        </section>
      </div>
      <div className="command-footer"><span>SENTINEL COMMAND / INFRASTRUCTURE INTELLIGENCE</span><span>API HEALTH: {health.toUpperCase()} · {configured ? "AUTHENTICATED WORKSPACE" : "AWAITING WORKSPACE CONNECTION"} · READ-ONLY BY DEFAULT</span></div>
    </section>
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
  const location = useLocation();
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
  }, [theme]);
  useEffect(() => {
    void restoreSession();
  }, []);
  const currentPage = NAV_GROUPS.map((group) => group.items.find((item) => item.to === location.pathname)).find((item) => item !== undefined)?.label ?? "Command workspace";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img
            className="brand-logo"
            src="/assets/sentinelgrid-logo.png"
            alt="SentinelGrid"
            width={40}
            height={40}
          />
          <div className="brand-text">
            Sentinel <span>Command</span>
          </div>
        </div>
        <div className="workspace-switcher"><span className="workspace-avatar">SG</span><div><strong>Operations workspace</strong><small>Organisation environment</small></div><span className="workspace-chevron">⌄</span></div>
        <nav className="nav" aria-label="Primary">
          {NAV_GROUPS.map((group) => <div className="nav-group" key={group.section}>
            <div className="nav-section-label">{group.section}</div>
            {group.items.map((item) => <NavLink key={item.to} to={item.to} end={item.to === "/"} className={({ isActive }) => isActive ? "active" : undefined}>
              <span className="nav-glyph" aria-hidden="true">{item.glyph}</span><span>{item.label}</span>
            </NavLink>)}
          </div>)}
        </nav>
        <AuthPanel />
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
        <header className="topbar"><div className="topbar-context"><span>WORKSPACE</span><b>/</b><strong>{currentPage}</strong></div><div className="topbar-tools"><span className={apiConfigured() ? "connection-state connected" : "connection-state"}><i />{apiConfigured() ? "API CONFIGURED" : "API NOT CONFIGURED"}</span><span className="topbar-divider" /><span className="topbar-date">{new Date().toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</span><div className="user-orb">SG</div></div></header>
        <div className="main-content">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/topology" element={<TopologyPage />} />
          <Route path="/incidents" element={<IncidentWorkbenchPage />} />
          <Route path="/replay" element={<EventReplayPage />} />
          <Route path="/scenarios" element={<ScenarioWorkbenchPage />} />
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
          <Route path="/assets" element={<AssetRegistryPage />} />
          <Route path="/energy" element={<EnergyDashboard />} />
          <Route path="/energy/assets/:assetId" element={<AssetEnergyProfile />} />
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
                create={{
                  label: "Register device",
                  fields: <><input name="facility_id" required placeholder="Facility UUID" /><input name="asset_id" placeholder="Asset UUID (optional)" /><input name="name" required placeholder="Device name" /><select name="category" defaultValue="network"><option value="electrical">Electrical</option><option value="generators">Generator</option><option value="solar">Solar</option><option value="battery">Battery</option><option value="hvac">HVAC</option><option value="refrigeration">Refrigeration</option><option value="pumps_motors">Pumps & motors</option><option value="industrial">Industrial</option><option value="network">Network</option><option value="bms">Building systems</option><option value="data_center">Data centre</option><option value="transformers">Transformers</option><option value="ups">UPS</option><option value="cooling">Cooling plant</option><option value="other">Other</option></select></>,
                  build: (org, form) => ({ path: `/v1/orgs/${org}/devices`, body: { facility_id: String(form.get("facility_id") ?? ""), asset_id: String(form.get("asset_id") ?? "") || null, name: String(form.get("name") ?? ""), category: String(form.get("category") ?? "network") } }),
                }}
              />
            }
          />
          <Route
            path="/sensors"
            element={
              <ResourcePage
                title="Sensor registry"
                lead="Registered sensors and their equipment, device and facility associations."
                path={(org) => `/v1/orgs/${org}/sensors`}
                columns={[
                  { key: "name", label: "Sensor" }, { key: "sensor_type", label: "Type" }, { key: "unit", label: "Unit" },
                  { key: "facility_id", label: "Facility" }, { key: "asset_id", label: "Asset" }, { key: "device_id", label: "Device" }, { key: "status", label: "Status" },
                ]}
                create={{
                  label: "Register sensor",
                  fields: <><input name="facility_id" required placeholder="Facility UUID" /><input name="asset_id" placeholder="Asset UUID (optional)" /><input name="device_id" placeholder="Device UUID (optional)" /><input name="name" required placeholder="Sensor name" /><input name="sensor_type" required placeholder="Sensor type (e.g. temperature)" /><input name="unit" placeholder="Unit (e.g. °C, kWh)" /></>,
                  build: (org, form) => ({ path: `/v1/orgs/${org}/sensors`, body: { facility_id: String(form.get("facility_id") ?? ""), asset_id: String(form.get("asset_id") ?? "") || null, device_id: String(form.get("device_id") ?? "") || null, name: String(form.get("name") ?? ""), sensor_type: String(form.get("sensor_type") ?? ""), unit: String(form.get("unit") ?? "") || undefined } }),
                }}
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
        </div>
      </main>
    </div>
  );
}
