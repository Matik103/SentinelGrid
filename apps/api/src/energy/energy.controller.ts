import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthUser } from "../auth/auth.types.js";
import { OrgsService } from "../orgs/orgs.service.js";
import { SupabaseUserFactory } from "../common/supabase-user.factory.js";
import { ConnectorsService } from "../connectors/connectors.service.js";
import { EnergyIngestionService } from "./energy-ingestion.service.js";

const Uuid = z.string().uuid();

@Controller()
export class EnergyController {
  constructor(
    private readonly energy: EnergyIngestionService,
    private readonly connectors: ConnectorsService,
    private readonly orgs: OrgsService,
    private readonly users: SupabaseUserFactory,
  ) {}

  /** Connector path: organisation derived from credentialed connector only. */
  @Post("connectors/energy/measurements")
  async connectorIngest(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const match = /^Bearer (.+)$/i.exec(authorization ?? "");
    if (!match) throw new UnauthorizedException("Connector bearer token required");
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Body must be a JSON object");
    }
    const connectorId = Uuid.safeParse((body as { connector_id?: unknown }).connector_id);
    if (!connectorId.success) throw new BadRequestException("connector_id must be a UUID");
    const connector = await this.connectors.authenticateConnector(connectorId.data, match[1]);
    return this.energy.ingestFromConnector(connector.organisation_id, connector.id, body);
  }

  @Get("orgs/:organisationId/energy/measurements")
  @UseGuards(SupabaseAuthGuard)
  async listMeasurements(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") orgIdRaw: string,
    @Query("facility_id") facilityId?: string,
    @Query("asset_id") assetId?: string,
    @Query("since") since?: string,
    @Query("limit") limitRaw?: string,
  ) {
    const organisationId = Uuid.parse(orgIdRaw);
    await this.orgs.requirePermission(user, organisationId, "energy.read");
    const limit = Math.min(Math.max(Number(limitRaw ?? 200) || 200, 1), 1000);
    const sb = this.users.create(user.accessToken);
    let q = sb
      .from("energy_measurements")
      .select(
        "id, organisation_id, facility_id, asset_id, device_id, sensor_id, metric_key, value, unit, measured_at, source, quality, classification, created_at",
      )
      .eq("organisation_id", organisationId)
      .order("measured_at", { ascending: false })
      .limit(limit);
    if (facilityId) q = q.eq("facility_id", Uuid.parse(facilityId));
    if (assetId) q = q.eq("asset_id", Uuid.parse(assetId));
    if (since) q = q.gte("measured_at", since);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  @Get("orgs/:organisationId/energy/anomalies")
  @UseGuards(SupabaseAuthGuard)
  async listAnomalies(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") orgIdRaw: string,
    @Query("facility_id") facilityId?: string,
    @Query("status") status?: string,
    @Query("limit") limitRaw?: string,
  ) {
    const organisationId = Uuid.parse(orgIdRaw);
    await this.orgs.requirePermission(user, organisationId, "energy.read");
    const limit = Math.min(Math.max(Number(limitRaw ?? 100) || 100, 1), 500);
    const sb = this.users.create(user.accessToken);
    let q = sb
      .from("energy_anomalies")
      .select(
        "id, facility_id, asset_id, metric_key, severity, status, title, explanation, observed_value, baseline_value, deviation_pct, rule_key, detected_at",
      )
      .eq("organisation_id", organisationId)
      .order("detected_at", { ascending: false })
      .limit(limit);
    if (facilityId) q = q.eq("facility_id", Uuid.parse(facilityId));
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }
}
