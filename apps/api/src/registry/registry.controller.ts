import { BadRequestException, Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthUser } from "../auth/auth.types.js";
import { RegistryService } from "./registry.service.js";

@Controller("orgs/:organisationId")
@UseGuards(SupabaseAuthGuard)
export class RegistryController {
  constructor(private readonly registry: RegistryService) {}

  @Get("facility-assignments")
  listFacilityAssignments(@CurrentUser() user: AuthUser, @Param("organisationId") orgId: string) {
    return this.registry.listFacilityAssignments(user, this.uuid(orgId));
  }

  @Post("facility-assignments")
  assignFacility(@CurrentUser() user: AuthUser, @Param("organisationId") orgId: string, @Body() body: unknown) {
    return this.registry.assignFacility(user, this.uuid(orgId), body);
  }

  @Post("facilities/:facilityId/assignments/:userId/revoke")
  unassignFacility(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") orgId: string,
    @Param("facilityId") facilityId: string,
    @Param("userId") memberId: string,
  ) {
    return this.registry.unassignFacility(user, this.uuid(orgId), this.uuid(facilityId), this.uuid(memberId));
  }

  @Get("facilities")
  listFacilities(@CurrentUser() user: AuthUser, @Param("organisationId") orgId: string) {
    return this.registry.listFacilities(user, this.uuid(orgId));
  }

  @Post("facilities")
  createFacility(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") orgId: string,
    @Body() body: unknown,
  ) {
    return this.registry.createFacility(user, this.uuid(orgId), body);
  }

  @Post("facilities/:facilityId/archive")
  archiveFacility(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") orgId: string,
    @Param("facilityId") facilityId: string,
  ) {
    return this.registry.archiveFacility(user, this.uuid(orgId), this.uuid(facilityId));
  }

  @Get("zones")
  listZones(@CurrentUser() user: AuthUser, @Param("organisationId") orgId: string) {
    return this.registry.listZones(user, this.uuid(orgId));
  }

  @Post("zones")
  createZone(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") orgId: string,
    @Body() body: unknown,
  ) {
    return this.registry.createZone(user, this.uuid(orgId), body);
  }

  @Post("zones/:zoneId/archive")
  archiveZone(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") orgId: string,
    @Param("zoneId") zoneId: string,
  ) {
    return this.registry.archiveZone(user, this.uuid(orgId), this.uuid(zoneId));
  }

  @Get("assets")
  listAssets(@CurrentUser() user: AuthUser, @Param("organisationId") orgId: string) {
    return this.registry.listAssets(user, this.uuid(orgId));
  }

  @Post("assets")
  createAsset(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") orgId: string,
    @Body() body: unknown,
  ) {
    return this.registry.createAsset(user, this.uuid(orgId), body);
  }

  @Patch("assets/:assetId")
  updateAsset(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") orgId: string,
    @Param("assetId") assetId: string,
    @Body() body: unknown,
  ) {
    return this.registry.updateAsset(user, this.uuid(orgId), this.uuid(assetId), body);
  }

  @Get("devices")
  listDevices(@CurrentUser() user: AuthUser, @Param("organisationId") orgId: string) {
    return this.registry.listDevices(user, this.uuid(orgId));
  }

  @Post("devices")
  createDevice(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") orgId: string,
    @Body() body: unknown,
  ) {
    return this.registry.createDevice(user, this.uuid(orgId), body);
  }

  @Get("sensors")
  listSensors(@CurrentUser() user: AuthUser, @Param("organisationId") orgId: string) {
    return this.registry.listSensors(user, this.uuid(orgId));
  }

  @Post("sensors")
  createSensor(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") orgId: string,
    @Body() body: unknown,
  ) {
    return this.registry.createSensor(user, this.uuid(orgId), body);
  }

  private uuid(value: string) {
    const parsed = z.string().uuid().safeParse(value);
    if (!parsed.success) throw new BadRequestException("Invalid organisation ID");
    return parsed.data;
  }
}
