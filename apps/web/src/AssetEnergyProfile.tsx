import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  apiGet,
  listEnergyAnomalies,
  listEnergyMeasurements,
  organisationId,
  type EnergyAnomaly,
  type EnergyMeasurement,
} from "./api";

const METRICS = [
  "active_power_kw",
  "energy_kwh",
  "voltage_v",
  "current_a",
  "power_factor",
  "temperature_c",
  "battery_soc_pct",
  "fuel_level_pct",
  "pue",
] as const;

type Asset = {
  id: string;
  name: string;
  category: string;
  facility_id: string;
  manufacturer?: string | null;
  model?: string | null;
};

function fmt(value: number | null | undefined, digits = 3) {
  return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function freshness(measuredAt: string): "fresh" | "aging" | "stale" | "unknown" {
  const age = Date.now() - new Date(measuredAt).getTime();
  if (!Number.isFinite(age) || age < 0) return "unknown";
  if (age <= 5 * 60 * 1000) return "fresh";
  if (age <= 60 * 60 * 1000) return "aging";
  return "stale";
}

function gapLabel(rows: EnergyMeasurement[]): string {
  if (!rows.length) return "No readings in selected window";
  const real = rows.filter((r) => r.classification === "real");
  if (!real.length) return "No real classifications in window (simulated/replayed excluded from live view)";
  const good = real.filter((r) => r.quality === "good");
  if (!good.length) return "Only poor/uncertain/unknown quality readings present";
  const latest = [...good].sort((a, b) => +new Date(b.measured_at) - +new Date(a.measured_at))[0];
  const state = freshness(latest.measured_at);
  if (state === "stale") return "Latest good reading is stale (>1h)";
  return "Readings available";
}

function exportCsv(rows: EnergyMeasurement[], assetName: string) {
  const header = ["measured_at", "metric_key", "value", "unit", "source", "quality", "classification"];
  const lines = [header.join(",")].concat(
    rows.map((row) =>
      [row.measured_at, row.metric_key, row.value, row.unit, row.source, row.quality, row.classification]
        .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
        .join(","),
    ),
  );
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${assetName.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "asset"}-energy.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function AssetEnergyProfile() {
  const org = organisationId();
  const { assetId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [asset, setAsset] = useState<Asset | null>(null);
  const [rows, setRows] = useState<EnergyMeasurement[]>([]);
  const [findings, setFindings] = useState<EnergyAnomaly[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const metric = (searchParams.get("metric") as (typeof METRICS)[number] | null) ?? "active_power_kw";
  const rangeHours = Number(searchParams.get("hours") ?? "24") || 24;

  useEffect(() => {
    const load = async () => {
      if (!org || !assetId) {
        setError("Organisation and asset are required.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      const assets = await apiGet<Asset[]>(`/v1/orgs/${org}/assets`);
      if (assets.error) {
        setError(assets.error.message);
        setLoading(false);
        return;
      }
      const found = (assets.data ?? []).find((item) => item.id === assetId) ?? null;
      setAsset(found);
      if (!found) {
        setError("Asset not found in this organisation.");
        setLoading(false);
        return;
      }
      try {
        const since = new Date(Date.now() - rangeHours * 60 * 60 * 1000).toISOString();
        const [measurements, anomalies] = await Promise.all([
          listEnergyMeasurements(org, since, found.facility_id),
          listEnergyAnomalies(org, found.facility_id),
        ]);
        setRows(measurements.filter((item) => item.asset_id === assetId));
        setFindings(anomalies.filter((item) => item.asset_id === assetId));
      } catch (err) {
        setRows([]);
        setFindings([]);
        setError(err instanceof Error ? err.message : String(err));
      }
      setLoading(false);
    };
    void load();
  }, [org, assetId, rangeHours]);

  const filtered = useMemo(
    () =>
      rows
        .filter((item) => item.metric_key === metric && item.classification === "real")
        .sort((a, b) => +new Date(b.measured_at) - +new Date(a.measured_at)),
    [rows, metric],
  );
  const latest = filtered[0];
  const compare = filtered[1];

  return (
    <section className="energy-experience">
      <div className="page-heading-row">
        <div>
          <div className="eyebrow">ASSET ENERGY PROFILE</div>
          <h1 className="page-title">{asset?.name ?? "Asset energy"}</h1>
          <p className="page-lead">
            Metric selectors, date window, comparison and CSV export for real telemetry only.
            {asset ? ` ${[asset.manufacturer, asset.model].filter(Boolean).join(" · ")}` : ""}
          </p>
        </div>
        <Link className="btn secondary" to={`/assets?asset=${assetId}`}>
          Back to asset
        </Link>
      </div>

      <div className="energy-filter-bar">
        <label>
          Metric
          <select
            value={metric}
            onChange={(event) => {
              const next = new URLSearchParams(searchParams);
              next.set("metric", event.target.value);
              setSearchParams(next);
            }}
          >
            {METRICS.map((key) => (
              <option key={key} value={key}>
                {key.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Window
          <select
            value={String(rangeHours)}
            onChange={(event) => {
              const next = new URLSearchParams(searchParams);
              next.set("hours", event.target.value);
              setSearchParams(next);
            }}
          >
            <option value="6">Last 6 hours</option>
            <option value="24">Last 24 hours</option>
            <option value="168">Last 7 days</option>
          </select>
        </label>
        <button
          type="button"
          className="btn secondary"
          disabled={!filtered.length}
          onClick={() => exportCsv(filtered, asset?.name ?? "asset")}
        >
          Export CSV
        </button>
      </div>

      {error && <div className="inline-notice warning">{error}</div>}
      <div className="inline-notice">{gapLabel(filtered)}</div>

      <div className="energy-metric-grid">
        <div className="energy-metric-card">
          <span>LATEST {metric.replaceAll("_", " ").toUpperCase()}</span>
          <strong>
            {latest ? fmt(Number(latest.value)) : "—"}
            {latest && <small> {latest.unit}</small>}
          </strong>
          <em>{latest ? dateTime(latest.measured_at) : "No reading"}</em>
          <small className="metric-meta">
            {latest
              ? `${freshness(latest.measured_at)} · ${latest.source} · ${latest.quality} · ${latest.classification}`
              : "not configured / no readings"}
          </small>
        </div>
        <div className="energy-metric-card">
          <span>PREVIOUS SAMPLE</span>
          <strong>
            {compare ? fmt(Number(compare.value)) : "—"}
            {compare && <small> {compare.unit}</small>}
          </strong>
          <em>{compare ? dateTime(compare.measured_at) : "Need two samples to compare"}</em>
          <small className="metric-meta">
            {latest && compare
              ? `Δ ${fmt(Number(latest.value) - Number(compare.value))} ${latest.unit}`
              : "comparison unavailable"}
          </small>
        </div>
        <div className="energy-metric-card">
          <span>SAMPLES IN WINDOW</span>
          <strong>{filtered.length}</strong>
          <em>Real classification only</em>
        </div>
        <div className="energy-metric-card">
          <span>OPEN FINDINGS</span>
          <strong>{findings.length}</strong>
          <em>Asset-scoped review queue</em>
        </div>
      </div>

      <section className="energy-panel telemetry-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">SERIES</span>
            <h2>{metric.replaceAll("_", " ")}</h2>
          </div>
        </div>
        {loading ? (
          <div className="profile-empty">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <strong>No real measurements for this metric in the selected window.</strong>
            <p>Connect approved meters or connectors. Values appear only after authenticated ingestion.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Measured at</th>
                  <th>Value</th>
                  <th>Unit</th>
                  <th>Source</th>
                  <th>Quality</th>
                  <th>Class</th>
                  <th>Freshness</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map((item) => (
                  <tr key={item.id}>
                    <td>{dateTime(item.measured_at)}</td>
                    <td className="mono">{fmt(Number(item.value), 4)}</td>
                    <td>{item.unit}</td>
                    <td>{item.source}</td>
                    <td>
                      <span className={`quality-tag ${item.quality}`}>{item.quality}</span>
                    </td>
                    <td>{item.classification}</td>
                    <td>{freshness(item.measured_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="energy-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">FINDINGS</span>
            <h2>Open anomalies</h2>
          </div>
        </div>
        {findings.length === 0 ? (
          <div className="profile-empty">No open findings for this asset.</div>
        ) : (
          <div className="finding-list">
            {findings.map((item) => (
              <article className="finding-row" key={item.id}>
                <span className={`finding-severity ${item.severity}`}>{item.severity}</span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.explanation}</p>
                  <small>
                    {item.rule_key} · {dateTime(item.detected_at)}
                  </small>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
