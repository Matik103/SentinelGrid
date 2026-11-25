import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthUser } from "../auth/auth.types.js";
import { ConnectorsService } from "./connectors.service.js";

@Controller("orgs/:organisationId/connectors")
@UseGuards(SupabaseAuthGuard)
export class ConnectorsController {
  constructor(private readonly connectors: ConnectorsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param("organisationId") orgId: string) {
    return this.connectors.list(user, this.uuid(orgId));
  }

  @Post()
  register(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") orgId: string,
    @Body() body: unknown,
  ) {
    return this.connectors.register(user, this.uuid(orgId), body);
  }

  @Post(":connectorId/heartbeat")
  heartbeat(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") orgId: string,
    @Param("connectorId") connectorId: string,
  ) {
    return this.connectors.heartbeat(user, this.uuid(orgId), this.uuid(connectorId));
  }

  @Post(":connectorId/revoke")
  revoke(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") orgId: string,
    @Param("connectorId") connectorId: string,
  ) {
    return this.connectors.revoke(user, this.uuid(orgId), this.uuid(connectorId));
  }

  private uuid(value: string) {
    const parsed = z.string().uuid().safeParse(value);
    if (!parsed.success) throw new BadRequestException("Invalid UUID");
    return parsed.data;
  }
}
