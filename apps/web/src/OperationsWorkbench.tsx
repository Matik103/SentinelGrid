import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, organisationId } from "./api";

type Facility = { id: string; name: string; code?: string | null; status?: string };
type Asset = {
  id: string; facility_id: string; zone_id?: string | null; parent_asset_id?: string | null;
  name: string; category: string; status: string; criticality?: string;
  manufacturer?: string | null; model?: string | null; rated_power_kw?: number | null;
  rated_capacity_kva?: number | null; specifications?: Record<string, unknown> | null;
};
type EventRecord = {
  id: string; organisation_id: string; facility_id?: string | null; asset_id?: string | null;
  device_id?: string | null; sensor_id?: string | null; event_type: string; occurred_at: string;
  ingested_at?: string; source: string; classification: "real" | "simulated" | "replayed" | "synthetic";
  integrity_status: string; data_quality?: string; clock_quality?: string;
  normalised?: Record<string, unknown>; metadata?: Record<string, unknown>;
};

function useWorkbenchData() {
  const org = organisationId();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!org) { setError("Select an authenticated organisation to load infrastructure records."); setLoading(false); return; }
    setLoading(true); setError(null);
    void Promise.all([
      apiGet<Asset[]>(`/v1/orgs/${org}/assets`),
      apiGet<Facility[]>(`/v1/orgs/${org}/facilities`),
      apiGet<EventRecord[]>(`/v1/events?organisation_id=${org}&limit=200`),
    ]).then(([a, f, e]) => {
      if (!active) return;
      setAssets(a.data ?? []); setFacilities(f.data ?? []); setEvents(e.data ?? []);
      const failures = [a.error, f.error, e.error].filter(Boolean);
      if (failures.length) setError(failures.map((x) => x?.message).join(" · "));
      setLoading(false);
    }).catch((err) => { if (active) { setError(err instanceof Error ? err.message : String(err)); setLoading(false); } });
    return () => { active = false; };
  }, [org]);
  return { assets, facilities, events, loading, error };
}

function stamp(value?: string) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function facilityLabel(id: string | null | undefined, facilities: Facility[]) {
  return facilities.find((item) => item.id === id)?.name ?? "Facility not linked";
}
function shortId(value?: string | null) { return value ? value.slice(0, 8) : "—"; }
function riskLabel(event: EventRecord) {
  if (event.integrity_status === "failed") return "INTEGRITY FAILURE";
  if (event.data_quality === "poor") return "POOR DATA QUALITY";
  if (/critical|failure|fault|alarm|offline|trip|overheat/i.test(event.event_type)) return "REVIEW";
  return "OBSERVATION";
}
function severityClass(event: EventRecord) {
  return event.integrity_status === "failed" || /critical|failure|trip/i.test(event.event_type) ? "risk-critical" :
    event.data_quality === "poor" || /fault|alarm|offline|overheat/i.test(event.event_type) ? "risk-warning" : "risk-neutral";
}

export function TopologyPage() {
  const { assets, facilities, loading, error } = useWorkbenchData();
  const [facilityId, setFacilityId] = useState("all");
  const visible = useMemo(() => assets.filter((a) => a.status !== "archived" && (facilityId === "all" || a.facility_id === facilityId)).slice(0, 48), [assets, facilityId]);
  const linked = visible.filter((a) => a.parent_asset_id && visible.some((p) => p.id === a.parent_asset_id)).length;
  const facilityCounts = facilities.map((f) => ({ ...f, count: assets.filter((a) => a.facility_id === f.id && a.status !== "archived").length }));
  const rows = Math.max(1, Math.ceil(visible.length / 4));
  return <section className="workbench-page">
    <header className="workbench-heading"><div><span className="eyebrow">INFRASTRUCTURE / RELATIONSHIP MODEL</span><h1>Infrastructure topology</h1><p>Explore registered equipment, facility boundaries and parent–child relationships recorded in the asset registry.</p></div><div className="workbench-live-state"><i /> TENANT-SCOPED REGISTRY</div></header>
    <div className="workbench-metrics">
      <article><span>REGISTERED ASSETS</span><strong>{loading ? "—" : assets.length}</strong><small>All accessible registry records</small></article>
      <article><span>FACILITIES</span><strong>{loading ? "—" : facilities.length}</strong><small>Accessible locations</small></article>
      <article><span>EXPLICIT LINKS</span><strong>{loading ? "—" : linked}</strong><small>Parent links in returned records</small></article>
      <article><span>UNLINKED ASSETS</span><strong>{loading ? "—" : Math.max(0, visible.length - linked)}</strong><small>Not necessarily a fault</small></article>
    </div>
    {error && <div className="workbench-notice">{error}</div>}
    <div className="workbench-toolbar"><div><span className="eyebrow">REGISTRY VIEW</span><h2>Asset relationship map</h2></div><select value={facilityId} onChange={(e) => setFacilityId(e.target.value)}><option value="all">All facilities</option>{facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
    {loading ? <div className="workbench-empty">Loading organisation-scoped infrastructure…</div> : visible.length === 0 ? <div className="workbench-empty"><strong>No assets in this view</strong><span>Register assets and associate them with a facility to begin building the topology.</span><Link to="/assets">Open asset registry ↗</Link></div> :
      <div className="topology-board" style={{ minHeight: Math.max(250, rows * 148 + 35) }}>
        <svg className="topology-connectors" viewBox={`0 0 1000 ${rows * 148 + 35}`} preserveAspectRatio="none" aria-hidden="true">
          {visible.map((asset, i) => {
            const parentIndex = visible.findIndex((p) => p.id === asset.parent_asset_id);
            if (parentIndex < 0) return null;
            const x1 = 125 + (parentIndex % 4) * 250, y1 = 63 + Math.floor(parentIndex / 4) * 148;
            const x2 = 125 + (i % 4) * 250, y2 = 63 + Math.floor(i / 4) * 148;
            return <path key={asset.id} d={`M ${x1} ${y1} C ${x1} ${(y1+y2)/2}, ${x2} ${(y1+y2)/2}, ${x2} ${y2}`} />;
          })}
        </svg>
        <div className="topology-node-grid">{visible.map((asset) => {
          const parent = visible.find((p) => p.id === asset.parent_asset_id);
          const eventsForAsset = 0;
          return <article className="topology-asset-node" key={asset.id}>
            <div className="topology-node-top"><span>{asset.category.replace(/_/g, " ").toUpperCase()}</span><span className={`asset-state state-${asset.status}`}>{asset.status}</span></div>
            <strong>{asset.name}</strong><small>{facilityLabel(asset.facility_id, facilities)}</small>
            <div className="topology-node-bottom"><span>{asset.criticality ? `CRITICALITY · ${asset.criticality.toUpperCase()}` : "CRITICALITY NOT SET"}</span><span>{parent ? `PARENT · ${parent.name}` : "NO PARENT LINK"}</span></div>
            <Link to={`/assets?asset=${asset.id}`}>Inspect asset ↗</Link>
          </article>;
        })}</div>
      </div>}
    <section className="workbench-panel"><div className="workbench-panel-heading"><div><span className="eyebrow">FACILITY COVERAGE</span><h2>Asset distribution</h2></div><Link to="/facilities">Manage facilities ↗</Link></div>
      <div className="facility-coverage">{facilityCounts.map((f) => <div key={f.id}><span>{f.name}</span><div><i style={{ width: `${assets.length ? Math.max(3, f.count / Math.max(1, assets.length) * 100) : 0}%` }} /></div><strong>{f.count}</strong></div>)}</div>
      <p className="workbench-footnote">Relationship lines are shown only for explicit parent_asset_id links returned by the API. Missing links are not inferred from category, location or proximity.</p>
    </section>
  </section>;
}

export function IncidentWorkbenchPage() {
  const { assets, facilities, events, loading, error } = useWorkbenchData();
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const triaged = useMemo(() => events.filter((e) => riskLabel(e) !== "OBSERVATION").sort((a,b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()), [events]);
  const rows = filter === "all" ? triaged : triaged.filter((e) => filter === "integrity" ? e.integrity_status === "failed" : filter === "quality" ? e.data_quality === "poor" : /critical|failure|fault|alarm|offline|trip|overheat/i.test(e.event_type));
  const selected = rows.find((e) => e.id === selectedId) ?? rows[0];
  const related = selected ? events.filter((e) => e.id !== selected.id && ((selected.asset_id && e.asset_id === selected.asset_id) || (selected.facility_id && e.facility_id === selected.facility_id))).sort((a,b) => Math.abs(new Date(a.occurred_at).getTime()-new Date(selected.occurred_at).getTime()) - Math.abs(new Date(b.occurred_at).getTime()-new Date(selected.occurred_at).getTime())).slice(0,8) : [];
  const asset = selected ? assets.find((a) => a.id === selected.asset_id) : undefined;
  return <section className="workbench-page">
    <header className="workbench-heading"><div><span className="eyebrow">SECURITY & OPERATIONS / INVESTIGATION</span><h1>Incident investigation</h1><p>Prioritise recorded signals, inspect their provenance and correlate nearby events across the same asset or facility.</p></div><div className="workbench-live-state"><i /> RULE-BASED TRIAGE</div></header>
    <div className="workbench-metrics">
      <article><span>EVENTS REVIEWED</span><strong>{loading ? "—" : events.length}</strong><small>Latest API event window</small></article>
      <article><span>NEEDS REVIEW</span><strong>{loading ? "—" : triaged.length}</strong><small>Rule-matched records</small></article>
      <article><span>INTEGRITY FAILURES</span><strong>{loading ? "—" : events.filter((e) => e.integrity_status === "failed").length}</strong><small>Source integrity status</small></article>
      <article><span>POOR QUALITY</span><strong>{loading ? "—" : events.filter((e) => e.data_quality === "poor").length}</strong><small>Reported quality metadata</small></article>
    </div>
    {error && <div className="workbench-notice">{error}</div>}
    <div className="workbench-toolbar"><div><span className="eyebrow">INVESTIGATION QUEUE</span><h2>Signals requiring attention</h2></div><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All review signals</option><option value="integrity">Integrity failures</option><option value="quality">Poor data quality</option><option value="operational">Operational keywords</option></select></div>
    <div className="investigation-layout"><div className="investigation-queue">
      {loading ? <div className="workbench-empty">Loading recorded events…</div> : rows.length ? rows.map((event) => <button type="button" key={event.id} className={`investigation-event ${selected?.id === event.id ? "selected" : ""}`} onClick={() => setSelectedId(event.id)}>
        <span className={`risk-indicator ${severityClass(event)}`} /><span className="investigation-event-main"><strong>{event.event_type}</strong><small>{facilityLabel(event.facility_id, facilities)} · {stamp(event.occurred_at)}</small></span><span className="investigation-tag">{riskLabel(event)}</span>
      </button>) : <div className="workbench-empty"><strong>No review signals in this window</strong><span>All other events remain accessible in the event ledger.</span><Link to="/events">Open event ledger ↗</Link></div>}
    </div>
    <div className="workbench-panel investigation-detail">{selected ? <>
      <div className="workbench-panel-heading"><div><span className="eyebrow">SELECTED EVENT / {shortId(selected.id)}</span><h2>{selected.event_type}</h2></div><span className={`investigation-tag ${severityClass(selected)}`}>{riskLabel(selected)}</span></div>
      <p className="investigation-summary">This is a rule-based review cue derived from recorded event metadata. It is not an automated diagnosis or confirmed incident.</p>
      <div className="investigation-facts"><div><span>OCCURRED</span><strong>{stamp(selected.occurred_at)}</strong></div><div><span>SOURCE</span><strong>{selected.source}</strong></div><div><span>FACILITY</span><strong>{facilityLabel(selected.facility_id, facilities)}</strong></div><div><span>ASSET</span><strong>{asset?.name ?? shortId(selected.asset_id)}</strong></div><div><span>CLASSIFICATION</span><strong>{selected.classification}</strong></div><div><span>INTEGRITY</span><strong>{selected.integrity_status}</strong></div><div><span>DATA QUALITY</span><strong>{selected.data_quality ?? "Not reported"}</strong></div><div><span>CLOCK QUALITY</span><strong>{selected.clock_quality ?? "Not reported"}</strong></div></div>
      <h3>Correlated records</h3><div className="correlated-events">{related.length ? related.map((e) => <div key={e.id}><i /><span><strong>{e.event_type}</strong><small>{stamp(e.occurred_at)} · {e.source}</small></span><b>{e.classification}</b></div>) : <p>No related records in the currently loaded event window.</p>}</div>
      <div className="investigation-actions"><Link to={selected.asset_id ? `/assets?asset=${selected.asset_id}` : "/assets"}>Open asset profile ↗</Link><Link to="/replay">Review event timeline ↗</Link></div>
    </> : <div className="workbench-empty">Select an event to inspect its context.</div>}</div></div>
  </section>;
}

export function EventReplayPage() {
  const { facilities, events, loading, error } = useWorkbenchData();
  const ordered = useMemo(() => [...events].sort((a,b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()), [events]);
  const [index, setIndex] = useState(0);
  useEffect(() => { setIndex((current) => Math.min(current, Math.max(0, ordered.length - 1))); }, [ordered.length]);
  const selected = ordered[index];
  return <section className="workbench-page">
    <header className="workbench-heading"><div><span className="eyebrow">EVENT INTELLIGENCE / TEMPORAL REVIEW</span><h1>Event replay</h1><p>Step through the recorded event window in timestamp order. This is a historical review tool, not a live simulation or data re-ingestion process.</p></div><div className="workbench-live-state"><i /> READ-ONLY HISTORY</div></header>
    <div className="workbench-panel replay-panel">
      <div className="workbench-panel-heading"><div><span className="eyebrow">RECORDED EVENT WINDOW</span><h2>{loading ? "Loading event history" : `${ordered.length} events available`}</h2></div><span className="model-status">HISTORICAL DATA</span></div>
      {error && <div className="workbench-notice">{error}</div>}
      {selected ? <>
        <div className="replay-time">{stamp(selected.occurred_at)}</div><div className="replay-event-name">{selected.event_type}</div><p className="replay-event-subtitle">{facilityLabel(selected.facility_id, facilities)} · {selected.source}</p>
        <input className="replay-slider" type="range" min={0} max={Math.max(0, ordered.length - 1)} value={index} onChange={(e) => setIndex(Number(e.target.value))} />
        <div className="replay-controls"><button type="button" className="btn secondary" disabled={index === 0} onClick={() => setIndex((v) => Math.max(0,v-1))}>← Previous</button><span>EVENT {index + 1} / {ordered.length}</span><button type="button" className="btn" disabled={index >= ordered.length - 1} onClick={() => setIndex((v) => Math.min(ordered.length - 1,v+1))}>Next →</button></div>
        <div className="replay-event-facts"><div><span>CLASSIFICATION</span><strong>{selected.classification}</strong></div><div><span>INTEGRITY</span><strong>{selected.integrity_status}</strong></div><div><span>DATA QUALITY</span><strong>{selected.data_quality ?? "Not reported"}</strong></div><div><span>INGESTED</span><strong>{stamp(selected.ingested_at)}</strong></div></div>
        <div className="replay-timeline">{ordered.map((event,i) => <button type="button" key={event.id} aria-label={`Select event ${i+1}: ${event.event_type}`} className={`replay-tick ${i === index ? "active" : ""} ${event.integrity_status === "failed" ? "failed" : ""}`} onClick={() => setIndex(i)} />)}</div>
      </> : <div className="workbench-empty"><strong>No event history available</strong><span>Once authenticated sources report events, their timeline will appear here.</span></div>}
    </div>
    <div className="workbench-panel"><div className="workbench-panel-heading"><div><span className="eyebrow">REPLAY GUARDRAILS</span><h2>Historical review only</h2></div></div><ul className="guardrail-list"><li>Events are read from the organisation-scoped event API.</li><li>Stepping through the timeline does not write, replay, or re-ingest data.</li><li>Classification and integrity labels are preserved exactly as recorded.</li><li>Missing timestamps and missing source metadata are never fabricated.</li></ul></div>
  </section>;
}

export function ScenarioWorkbenchPage() {
  const { assets, facilities, events, loading, error } = useWorkbenchData();
  const [assetId, setAssetId] = useState("");
  const [scenario, setScenario] = useState("unavailable");
  const [ran, setRan] = useState(false);
  const selected = assets.find((a) => a.id === assetId);
  const affected = useMemo(() => {
    if (!selected) return [];
    const descendants = new Set<string>([selected.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const asset of assets) if (asset.parent_asset_id && descendants.has(asset.parent_asset_id) && !descendants.has(asset.id)) { descendants.add(asset.id); changed = true; }
    }
    return assets.filter((a) => descendants.has(a.id));
  }, [assets, selected]);
  const measured = selected ? events.filter((e) => e.asset_id === selected.id) : [];
  const ratedKw = affected.reduce((sum,a) => sum + (Number(a.rated_power_kw) || 0), 0);
  return <section className="workbench-page">
    <header className="workbench-heading"><div><span className="eyebrow">RESILIENCE / WHAT-IF ANALYSIS</span><h1>Failure scenario lab</h1><p>Explore the registry impact of a hypothetical equipment outage using only explicitly recorded parent–child links and rated values.</p></div><div className="workbench-live-state scenario-state"><i /> NON-ACTUATING MODEL</div></header>
    <div className="scenario-warning"><strong>Decision-support boundary</strong><span>This is a deterministic registry what-if, not an engineering simulation, fault prediction or control command. It does not operate equipment or change live systems.</span></div>
    {error && <div className="workbench-notice">{error}</div>}
    <div className="workbench-panel scenario-builder">
      <div><span className="eyebrow">SCENARIO INPUT</span><h2>Assume one asset becomes unavailable</h2><p>Select an asset to calculate the explicitly linked descendants in the current registry.</p></div>
      <label>ASSET TO REMOVE FROM SERVICE<select value={assetId} onChange={(e) => { setAssetId(e.target.value); setRan(false); }}><option value="">Choose a registered asset</option>{assets.filter((a) => a.status !== "archived").map((a) => <option key={a.id} value={a.id}>{a.name} · {facilityLabel(a.facility_id, facilities)}</option>)}</select></label>
      <label>SCENARIO CONDITION<select value={scenario} onChange={(e) => { setScenario(e.target.value); setRan(false); }}><option value="unavailable">Asset unavailable</option><option value="maintenance">Planned maintenance window</option><option value="power_loss">Power source unavailable</option></select></label>
      <button type="button" className="btn" disabled={!assetId || loading} onClick={() => setRan(true)}>Run registry impact analysis ↗</button>
    </div>
    {ran && selected ? <div className="scenario-results">
      <div className="workbench-metrics"><article><span>ASSETS IN LINKED BRANCH</span><strong>{affected.length}</strong><small>Includes selected asset</small></article><article><span>DESCENDANT ASSETS</span><strong>{Math.max(0,affected.length-1)}</strong><small>Explicit parent links only</small></article><article><span>SUM OF RATED POWER</span><strong>{ratedKw ? `${ratedKw.toLocaleString()} kW` : "Not available"}</strong><small>Recorded ratings; not actual demand</small></article><article><span>EVENTS ON SELECTED ASSET</span><strong>{measured.length}</strong><small>Events in loaded history window</small></article></div>
      <div className="workbench-panel"><div className="workbench-panel-heading"><div><span className="eyebrow">SCENARIO OUTPUT / {scenario.replace(/_/g," ").toUpperCase()}</span><h2>Potential registry exposure</h2></div><span className="model-status">DETERMINISTIC</span></div>
        <div className="scenario-root"><span>SELECTED ASSET</span><strong>{selected.name}</strong><small>{facilityLabel(selected.facility_id, facilities)} · {selected.category}</small></div>
        <div className="scenario-branch">{affected.filter((a) => a.id !== selected.id).map((a) => <div key={a.id}><i /><span><strong>{a.name}</strong><small>{a.category} · {a.status}</small></span><b>{a.criticality ?? "Criticality unknown"}</b></div>)}
          {affected.length === 1 && <p>No explicit child assets are linked to this asset in the loaded registry.</p>}
        </div>
        <p className="workbench-footnote">The rated-power sum is nameplate capacity across the linked branch, not measured load, outage probability, service impact or recoverable capacity. No automatic action is taken.</p>
      </div>
    </div> : <div className="workbench-empty"><strong>Scenario not run</strong><span>Choose an asset to inspect the possible registry branch affected by a hypothetical outage.</span></div>}
  </section>;
}
