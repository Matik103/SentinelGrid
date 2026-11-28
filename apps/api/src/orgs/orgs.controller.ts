import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { BadRequestException } from "@nestjs/common";
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

  @Post("invites/accept")
  acceptInvite(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.orgs.acceptInvite(user, body);
  }

  @Get("invites/pending-for-me")
  listPendingInvitesForMe(@CurrentUser() user: AuthUser) {
    return this.orgs.listPendingInvitesForMe(user);
  }

  @Post("invites/accept-mine")
  acceptPendingInvitesForMe(@CurrentUser() user: AuthUser) {
    return this.orgs.acceptPendingInvitesForMe(user);
  }

  @Get(":organisationId/membership")
  membership(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") organisationId: string,
  ) {
    this.assertUuid(organisationId);
    return this.orgs.getMembership(user, organisationId);
  }

  @Get(":organisationId/members")
  members(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") organisationId: string,
  ) {
    this.assertUuid(organisationId);
    return this.orgs.listMembers(user, organisationId);
  }

  @Get(":organisationId/invites")
  listInvites(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") organisationId: string,
  ) {
    this.assertUuid(organisationId);
    return this.orgs.listInvites(user, organisationId);
  }

  @Post(":organisationId/permissions/check")
  async checkPermission(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") organisationId: string,
    @Body() body: { permission: string },
  ) {
    this.assertUuid(organisationId);
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
    this.assertUuid(organisationId);
    return this.orgs.invite(user, organisationId, body);
  }

  @Post(":organisationId/invites/:invitationId/revoke")
  revokeInvite(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") organisationId: string,
    @Param("invitationId") invitationId: string,
  ) {
    this.assertUuid(organisationId);
    this.assertUuid(invitationId);
    return this.orgs.revokeInvite(user, organisationId, invitationId);
  }

  private assertUuid(value: string) {
    const parsed = z.string().uuid().safeParse(value);
    if (!parsed.success) throw new BadRequestException("Invalid UUID");
  }
}
