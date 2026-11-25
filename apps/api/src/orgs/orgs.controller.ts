import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthUser } from "../auth/auth.types.js";
import { OrgsService } from "./orgs.service.js";

@Controller("orgs")
@UseGuards(SupabaseAuthGuard)
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Post("bootstrap")
  bootstrap(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.orgs.bootstrap(user, body);
  }

  @Get("mine")
  mine(@CurrentUser() user: AuthUser) {
    return this.orgs.listMine(user);
  }

  @Get(":organisationId/membership")
  membership(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") organisationId: string,
  ) {
    return this.orgs.getMembership(user, organisationId);
  }

  @Get(":organisationId/members")
  members(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") organisationId: string,
  ) {
    return this.orgs.listMembers(user, organisationId);
  }

  @Post(":organisationId/permissions/check")
  async checkPermission(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") organisationId: string,
    @Body() body: { permission: string },
  ) {
    const allowed = await this.orgs.checkPermission(
      user,
      organisationId,
      body.permission,
    );
    return { organisation_id: organisationId, permission: body.permission, allowed };
  }

  @Post(":organisationId/invites")
  invite(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") organisationId: string,
    @Body() body: unknown,
  ) {
    return this.orgs.invite(user, organisationId, body);
  }
}
