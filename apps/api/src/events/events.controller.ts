import { BadRequestException, Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthUser } from "../auth/auth.types.js";
import { IngestionService } from "./ingestion.service.js";
import { OrgsService } from "../orgs/orgs.service.js";

const OrganisationIdSchema = z.string().uuid();

@Controller("events")
@UseGuards(SupabaseAuthGuard)
export class EventsController {
  constructor(
    private readonly ingestion: IngestionService,
    private readonly orgs: OrgsService,
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
