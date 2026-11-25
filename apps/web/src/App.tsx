import { NavLink, Route, Routes } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/organisation", label: "Organisation" },
  { to: "/facilities", label: "Facilities" },
  { to: "/assets", label: "Assets" },
  { to: "/devices", label: "Devices" },
  { to: "/connectors", label: "Connectors" },
  { to: "/events", label: "Event ledger" },
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

function Empty({ entity }: { entity: string }) {
  return (
    <div className="empty">
      No {entity} loaded. Connect the API (`VITE_API_BASE_URL`) and sign in to
      populate this view from your organisation.
      <div className="badge-sim">SIMULATED / EMPTY STATE — not live OT</div>
    </div>
  );
}

function Overview() {
  const [health, setHealth] = useState<string>("checking…");
  useEffect(() => {
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
    if (!base) {
      setHealth("API base URL not configured");
      return;
    }
    fetch(`${base.replace(/\/$/, "")}/v1/health`)
      .then((r) => (r.ok ? setHealth("API reachable") : setHealth(`API HTTP ${r.status}`)))
      .catch(() => setHealth("API unreachable"));
  }, []);

  return (
    <Page
      title="Sentinel Command"
      lead="Platform foundation overview for organisations, infrastructure registry, connectors, events, and audit."
    >
      <div className="stats">
        <div className="stat">
          <strong>—</strong>
          <span>Organisations</span>
        </div>
        <div className="stat">
          <strong>—</strong>
          <span>Facilities</span>
        </div>
        <div className="stat">
          <strong>—</strong>
          <span>Events</span>
        </div>
        <div className="stat">
          <strong className="mono">{health}</strong>
          <span>API status</span>
        </div>
      </div>
      <Empty entity="dashboard metrics" />
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
          <Route
            path="/organisation"
            element={
              <Page title="Organisation settings" lead="Tenant profile, membership, and invitations.">
                <Empty entity="organisation settings" />
              </Page>
            }
          />
          <Route
            path="/facilities"
            element={
              <Page title="Facilities" lead="Register and review facilities for this organisation.">
                <Empty entity="facilities" />
              </Page>
            }
          />
          <Route
            path="/assets"
            element={
              <Page title="Asset registry" lead="Assets linked to facilities and zones.">
                <Empty entity="assets" />
              </Page>
            }
          />
          <Route
            path="/devices"
            element={
              <Page title="Device registry" lead="Devices and sensors associated with assets.">
                <Empty entity="devices" />
              </Page>
            }
          />
          <Route
            path="/connectors"
            element={
              <Page title="Connectors" lead="Register, heartbeat, and revoke edge connectors.">
                <Empty entity="connectors" />
              </Page>
            }
          />
          <Route
            path="/events"
            element={
              <Page title="Event ledger" lead="Validated telemetry and platform events for the tenant.">
                <Empty entity="events" />
              </Page>
            }
          />
          <Route
            path="/audit"
            element={
              <Page title="Audit logs" lead="Administrative actions for this organisation.">
                <Empty entity="audit logs" />
              </Page>
            }
          />
          <Route
            path="/users"
            element={
              <Page title="User management" lead="Members and pending invitations with RBAC roles.">
                <Empty entity="users" />
              </Page>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
