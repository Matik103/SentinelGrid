import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiGet, listEnergyAnomalies, listEnergyMeasurements, type EnergyAnomaly, type EnergyMeasurement } from "./api";
import { organisationId } from "./api";

type Facility = { id: string; name: string };
type Asset = { id: string; name: string; category: string; manufacturer?: string | null; model?: string | null };

function fmt(value: number | null | undefined, digits = 2) {
  return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: digits });
}
function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function severityClass(severity: string) {
  return severity === "critical" || severity === "high" ? "critical" : severity === "medium" ? "warning" : "neutral";
}

function PowerTrend({ data }: { data: EnergyMeasurement[] }) {
  const values = [...data].filter((item) => item.metric_key === "active_power_kw" && item.quality === "good" && item.classification === "real")
    .sort((a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime()).slice(-40);
  if (values.length < 2) return <div className="chart-empty">
    <span className="chart-empty-mark">⌁</span>
    <strong>Waiting for measured demand data</strong>
    <span>Two or more quality-checked real power readings are needed to draw a trend.</span>
  </div>;
  const max = Math.max(...values.map((item) => Number(item.value)), 0.001);
  const min = Math.min(...values.map((item) => Number(item.value)), 0);
  const range = Math.max(max - min, 0.001);
  const points = values.map((item, index) => {
    const x = 36 + (index / (values.length - 1)) * 704;
    const y = 182 - ((Number(item.value) - min) / range) * 146;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const first = values[0], last = values[values.length - 1];
  return <div className="power-chart">
    <div className="chart-scale"><span>{fmt(max)} kW</span><span>{fmt(min)} kW</span></div>
    <svg viewBox="0 0 760 220" role="img" aria-label="Measured active power trend over the last 24 hours">
      {[36, 72, 108, 144, 180].map((y) => <line key={y} x1="36" x2="740" y1={y} y2={y} className="chart-grid-line" />)}
      <polyline points={points} className="chart-line" />
      <circle cx={Number(points.split(" ").at(-1)?.split(",")[0])} cy={Number(points.split(" ").at(-1)?.split(",")[1])} r="5" className="chart-last-point" />
    </svg>
    <div className="chart-axis"><span>{dateTime(first.measured_at)}</span><span>{dateTime(last.measured_at)}</span></div>
  </div>;
}

function MetricCard({ label, value, unit, detail }: { label: string; value: string; unit?: string; detail: string }) {
  return <div className="energy-metric-card"><span>{label}</span><strong>{value}{unit && <small> {unit}</small>}</strong><em>{detail}</em></div>;
}

export function EnergyDashboard() {
  const org = organisationId();
  const [searchParams, setSearchParams] = useSearchParams();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [measurements, setMeasurements] = useState<EnergyMeasurement[]>([]);
  const [anomalies, setAnomalies] = useState<EnergyAnomaly[]>([]);
  const [selectedFacility, setSelectedFacility] = useState(searchParams.get("facility") ?? "");
  const [selectedAsset, setSelectedAsset] = useState(searchParams.get("asset") ?? "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [telemetryAvailable, setTelemetryAvailable] = useState(true);

  const load = async (facilityId = selectedFacility) => {
    if (!org) { setError("Select an organisation to inspect energy telemetry."); setLoading(false); return; }
    setLoading(true); setError(null);
    const [facilityResult, assetResult] = await Promise.all([
      apiGet<Facility[]>(`/v1/orgs/${org}/facilities`),
      apiGet<Asset[]>(`/v1/orgs/${org}/assets`),
    ]);
    if (facilityResult.data) setFacilities(facilityResult.data);
    if (assetResult.data) setAssets(assetResult.data);
    if (facilityResult.error) setError(facilityResult.error.message);
    try {
      const [rows, findings] = await Promise.all([
        listEnergyMeasurements(org, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), facilityId || undefined),
        listEnergyAnomalies(org, facilityId || undefined),
      ]);
      setMeasurements(rows);
      setAnomalies(findings);
      setTelemetryAvailable(true);
    } catch (err) {
      setMeasurements([]); setAnomalies([]); setTelemetryAvailable(false);
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  };

  useEffect(() => { void load(selectedFacility); }, [org, selectedFacility]);

  const scopedMeasurements = useMemo(() => measurements.filter((item) => !selectedAsset || item.asset_id === selectedAsset), [measurements, selectedAsset]);
  const scopedAnomalies = useMemo(() => anomalies.filter((item) => !selectedAsset || item.asset_id === selectedAsset), [anomalies, selectedAsset]);
  const real = useMemo(() => scopedMeasurements.filter((item) => item.classification === "real"), [scopedMeasurements]);
  const good = useMemo(() => real.filter((item) => item.quality === "good"), [real]);
  const latestPower = useMemo(() => good.filter((item) => item.metric_key === "active_power_kw")
    .sort((a, b) => new Date(b.measured_at).getTime() - new Date(a.measured_at).getTime())[0], [good]);
  const latestEnergy = useMemo(() => good.filter((item) => item.metric_key === "energy_kwh")
    .sort((a, b) => new Date(b.measured_at).getTime() - new Date(a.measured_at).getTime())[0], [good]);
  const affectedAssets = new Set(scopedAnomalies.filter((item) => item.asset_id).map((item) => item.asset_id)).size;
  const assetName = (id: string | null) => id ? assets.find((asset) => asset.id === id)?.name ?? "Unmapped asset" : "Facility-level finding";
  const facilityName = (id: string) => facilities.find((facility) => facility.id === id)?.name ?? "Facility";

  return <section className="energy-experience">
    <div className="page-heading-row">
      <div>
        <div className="eyebrow">ENERGY INTELLIGENCE / OPERATIONAL ASSURANCE</div>
        <h1 className="page-title">Energy intelligence</h1>
        <p className="page-lead">Understand demand, identify equipment abnormalities and investigate energy-related security findings.</p>
      </div>
      <div className="energy-window-control"><span className="live-indicator" /> LAST 24 HOURS</div>
    </div>

    <div className="energy-filter-bar">
      <label>Facility scope
        <select value={selectedFacility} onChange={(event) => { setSelectedFacility(event.target.value); const next = new URLSearchParams(searchParams); if (event.target.value) next.set("facility", event.target.value); else next.delete("facility"); setSearchParams(next); }}>
          <option value="">All accessible facilities</option>
          {facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}
        </select>
      </label>
      <label>Asset scope
        <select value={selectedAsset} onChange={(event) => { setSelectedAsset(event.target.value); const next = new URLSearchParams(searchParams); if (event.target.value) next.set("asset", event.target.value); else next.delete("asset"); setSearchParams(next); }}>
          <option value="">All assets</option>
          {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
        </select>
      </label>
      <span className="data-integrity-note">REAL TELEMETRY ONLY · SIMULATED AND REPLAYED DATA EXCLUDED</span>
    </div>

    {error && <div className="inline-notice warning">{telemetryAvailable ? "Some data could not be loaded: " : "Energy telemetry is not connected yet: "}{error}</div>}

    <div className="energy-metric-grid">
      <MetricCard label="LATEST ACTIVE POWER" value={latestPower ? fmt(Number(latestPower.value)) : "—"} unit={latestPower?.unit ?? "kW"} detail={latestPower ? `Measured ${dateTime(latestPower.measured_at)}` : "No live power reading"} />
      <MetricCard label="LATEST ENERGY READING" value={latestEnergy ? fmt(Number(latestEnergy.value)) : "—"} unit={latestEnergy?.unit ?? "kWh"} detail={latestEnergy ? `Measured ${dateTime(latestEnergy.measured_at)}` : "No energy register reading"} />
      <MetricCard label="QUALITY-CHECKED SAMPLES" value={fmt(good.length, 0)} detail="Real readings with good data quality" />
      <MetricCard label="OPEN FINDINGS" value={fmt(scopedAnomalies.length, 0)} detail={`${affectedAssets} linked assets require review`} />
    </div>

    <div className="energy-main-grid">
      <section className="energy-panel">
        <div className="panel-heading"><div><span className="eyebrow">DEMAND PROFILE</span><h2>Active power trend</h2></div><span className="unit-chip">kW</span></div>
        {loading ? <div className="chart-empty">Loading measured demand…</div> : <PowerTrend data={scopedMeasurements} />}
        <div className="panel-footnote">Trend uses recorded active-power measurements with good quality. The graph remains empty until real telemetry is received.</div>
      </section>
      <section className="energy-panel energy-findings-panel">
        <div className="panel-heading"><div><span className="eyebrow">DETECTION & REVIEW</span><h2>Energy findings</h2></div><span className="finding-count">{scopedAnomalies.length}</span></div>
        {loading ? <div className="profile-empty">Loading findings…</div> : scopedAnomalies.length === 0 ? <div className="chart-empty compact">
          <span className="chart-empty-mark">✓</span><strong>No open findings</strong><span>{telemetryAvailable ? "No active anomaly records for this scope." : "Findings will appear after the energy migration and detection pipeline are connected."}</span>
        </div> : <div className="finding-list">
          {scopedAnomalies.slice(0, 8).map((item) => <article className="finding-row" key={item.id}>
            <span className={`finding-severity ${severityClass(item.severity)}`}>{item.severity}</span>
            <div><strong>{item.title}</strong><p>{item.explanation}</p><small>{assetName(item.asset_id)} · {dateTime(item.detected_at)}</small></div>
          </article>)}
        </div>}
      </section>
    </div>

    <section className="energy-panel telemetry-panel">
      <div className="panel-heading"><div><span className="eyebrow">SOURCE OBSERVATIONS</span><h2>Recent measurements</h2></div><span className="unit-chip">{real.length} RECORDS</span></div>
      {loading ? <div className="profile-empty">Loading measurements…</div> : real.length === 0 ? <div className="empty">
        <strong>No real energy measurements received.</strong>
        <p>Connect approved meters, inverter telemetry, BMS/SCADA data or equipment sensors. The platform will display readings only after they are ingested and tenant-scoped.</p>
        <span className="badge-sim">NO SYNTHETIC LIVE VALUES</span>
      </div> : <div className="table-wrap">
        <table className="data-table"><thead><tr><th>Measured at</th><th>Metric</th><th>Value</th><th>Asset</th><th>Facility</th><th>Source</th><th>Quality</th></tr></thead>
          <tbody>{real.slice(0, 30).map((item) => <tr key={item.id}>
            <td>{dateTime(item.measured_at)}</td><td>{item.metric_key.replaceAll("_", " ")}</td><td className="mono">{fmt(Number(item.value), 4)} {item.unit}</td>
            <td>{item.asset_id ? <Link to={`/assets?asset=${item.asset_id}`}>{assetName(item.asset_id)}</Link> : "—"}</td>
            <td>{facilityName(item.facility_id)}</td><td>{item.source}</td><td><span className={`quality-tag ${item.quality}`}>{item.quality}</span></td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>

    <div className="energy-footer-note">
      <strong>Interpretation boundary</strong>
      <span>SentinelGrid records and correlates measurements. It does not infer meter values, claim energy savings without a measured baseline, or issue control commands to operational equipment.</span>
    </div>
  </section>;
}
