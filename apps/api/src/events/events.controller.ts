import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthUser } from "../auth/auth.types.js";
import { IngestionService } from "./ingestion.service.js";
import { OrgsService } from "../orgs/orgs.service.js";
import { SupabaseUserFactory } from "../common/supabase-user.factory.js";

const OrganisationIdSchema = z.string().uuid();

@Controller("events")
@UseGuards(SupabaseAuthGuard)
export class EventsController {
  constructor(
    private readonly ingestion: IngestionService,
    private readonly orgs: OrgsService,
    private readonly users: SupabaseUserFactory,
  ) {}

  @Post("ingest")
  async ingest(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Event body must be a JSON object");
    }
    const orgResult = OrganisationIdSchema.safeParse(
      (body as Record<string, unknown>).organisation_id,
    );
    if (!orgResult.success) {
      throw new BadRequestException("A valid organisation_id is required");
    }
    const organisationId = orgResult.data;
    await this.orgs.requirePermission(user, organisationId, "event.ingest");
    return this.ingestion.ingest(body, { authorisedOrganisationId: organisationId });
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query("organisation_id") organisationIdRaw: string,
    @Query("event_type") eventType?: string,
    @Query("classification") classification?: string,
    @Query("limit") limitRaw?: string,
  ) {
    const organisationId = OrganisationIdSchema.parse(organisationIdRaw);
    await this.orgs.requirePermission(user, organisationId, "event.read");
    const limit = Math.min(Math.max(Number(limitRaw ?? 50) || 50, 1), 200);
    const sb = this.users.create(user.accessToken);
    let q = sb
      .from("events")
      .select(
        "id, organisation_id, facility_id, asset_id, event_type, occurred_at, ingested_at, source, source_event_id, classification, schema_version, created_at",
      )
      .eq("organisation_id", organisationId)
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (eventType) q = q.eq("event_type", eventType);
    if (classification) q = q.eq("classification", classification);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  @Post("dlq/:dlqId/replay")
  async replay(
    @CurrentUser() user: AuthUser,
    @Param("dlqId") dlqId: string,
    @Body() body: { organisation_id?: string },
  ) {
    const orgResult = OrganisationIdSchema.safeParse(body?.organisation_id);
    if (!orgResult.success) throw new BadRequestException("A valid organisation_id is required");
    const organisationId = orgResult.data;
    await this.orgs.requirePermission(user, organisationId, "event.ingest");
    return this.ingestion.replayFromDlq(dlqId, organisationId);
  }
}
