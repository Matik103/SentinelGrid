import { Injectable, Logger } from "@nestjs/common";
import { SupabaseAdminService } from "../common/supabase-admin.service.js";

type MeasurementRow = {
  id: string;
  organisation_id: string;
  facility_id: string;
  asset_id: string | null;
  event_id: string | null;
  metric_key: string;
  value: number;
  measured_at: string;
  classification: string;
  quality: string;
};

/**
 * Transparent, explainable rules over real measurements only.
 * Scaffold: missing-telemetry / sustained-demand-deviation when enough history exists.
 * Does not invent readings or claim cyber attacks from energy alone.
 */
@Injectable()
export class AnomalyEvaluationService {
  private readonly log = new Logger(AnomalyEvaluationService.name);
  private readonly ruleVersion = "energy.rules.v1";

  constructor(private readonly admin: SupabaseAdminService) {}

  async evaluateMeasurement(organisationId: string, measurementId: string): Promise<number> {
    const { data, error } = await this.admin.client
      .from("energy_measurements")
      .select(
        "id, organisation_id, facility_id, asset_id, event_id, metric_key, value, measured_at, classification, quality",
      )
      .eq("organisation_id", organisationId)
      .eq("id", measurementId)
      .maybeSingle();
    if (error || !data) {
      this.log.warn(`anomaly eval skipped: measurement ${measurementId} unavailable`);
      return 0;
    }
    const row = data as MeasurementRow;
    if (row.classification !== "real" || row.quality !== "good") return 0;

    let opened = 0;
    if (row.metric_key === "active_power_kw" && row.asset_id) {
      opened += await this.sustainedDemandDeviation(row);
    }
    return opened;
  }

  private async sustainedDemandDeviation(row: MeasurementRow): Promise<number> {
    const since = new Date(new Date(row.measured_at).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.admin.client
      .from("energy_measurements")
      .select("value")
      .eq("organisation_id", row.organisation_id)
      .eq("asset_id", row.asset_id)
      .eq("metric_key", "active_power_kw")
      .eq("classification", "real")
      .eq("quality", "good")
      .gte("measured_at", since)
      .neq("id", row.id)
      .limit(500);
    if (error || !data || data.length < 24) return 0;

    const values = data.map((r) => Number(r.value)).filter((v) => Number.isFinite(v));
    if (values.length < 24) return 0;
    const baseline = values.reduce((a, b) => a + b, 0) / values.length;
    if (baseline <= 0) return 0;
    const observed = Number(row.value);
    const deviationPct = ((observed - baseline) / baseline) * 100;
    if (Math.abs(deviationPct) < 40) return 0;

    const title =
      deviationPct > 0
        ? "Sustained demand above recent baseline"
        : "Sustained demand below recent baseline";
    const explanation =
      `Rule ${this.ruleVersion}/sustained_demand_deviation: observed ${observed} kW vs ` +
      `7-day mean baseline ${baseline.toFixed(3)} kW (${deviationPct.toFixed(1)}% deviation). ` +
      "This is an operational energy finding; it is not by itself a cyber-attack claim.";

    const { error: insertErr } = await this.admin.client.from("energy_anomalies").insert({
      organisation_id: row.organisation_id,
      facility_id: row.facility_id,
      asset_id: row.asset_id,
      measurement_id: row.id,
      event_id: row.event_id,
      metric_key: row.metric_key,
      severity: Math.abs(deviationPct) >= 80 ? "high" : "medium",
      status: "open",
      title,
      explanation,
      observed_value: observed,
      baseline_value: Number(baseline.toFixed(6)),
      deviation_pct: Number(deviationPct.toFixed(4)),
      rule_key: `${this.ruleVersion}.sustained_demand_deviation`,
      metadata: { sample_size: values.length, rule_version: this.ruleVersion },
    });
    if (insertErr) {
      this.log.warn(`anomaly insert failed: ${insertErr.message}`);
      return 0;
    }
    return 1;
  }
}
