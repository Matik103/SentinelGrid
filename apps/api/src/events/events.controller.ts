import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthUser } from "../auth/auth.types.js";
import { IngestionService } from "./ingestion.service.js";
import { OrgsService } from "../orgs/orgs.service.js";

@Controller("events")
@UseGuards(SupabaseAuthGuard)
export class EventsController {
  constructor(
    private readonly ingestion: IngestionService,
    private readonly orgs: OrgsService,
  ) {}

  @Post("ingest")
  async ingest(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const orgId =
      body && typeof body === "object" && "organisation_id" in body
        ? String((body as { organisation_id: string }).organisation_id)
        : "";
    if (orgId) {
      await this.orgs.requirePermission(user, orgId, "event.ingest");
    }
    // organisation_id is validated against membership/RBAC above; never trusted alone.
    return this.ingestion.ingest(body);
  }

  @Post("dlq/:dlqId/replay")
  async replay(
    @CurrentUser() user: AuthUser,
    @Param("dlqId") dlqId: string,
    @Body() body: { organisation_id: string },
  ) {
    await this.orgs.requirePermission(user, body.organisation_id, "event.ingest");
    return this.ingestion.replayFromDlq(dlqId);
  }
}
