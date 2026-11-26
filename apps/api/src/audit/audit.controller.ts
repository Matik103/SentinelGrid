import { BadRequestException, Controller, Get, Param, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthUser } from "../auth/auth.types.js";
import { OrgsService } from "../orgs/orgs.service.js";
import { SupabaseUserFactory } from "../common/supabase-user.factory.js";

@Controller("orgs/:organisationId/audit-logs")
@UseGuards(SupabaseAuthGuard)
export class AuditController {
  constructor(
    private readonly orgs: OrgsService,
    private readonly users: SupabaseUserFactory,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Param("organisationId") orgId: string) {
    const organisationId = z.string().uuid().parse(orgId);
    await this.orgs.requirePermission(user, organisationId, "audit.read");
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb
      .from("audit_logs")
      .select("id, actor_user_id, action, resource_type, resource_id, details, created_at")
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }
}
