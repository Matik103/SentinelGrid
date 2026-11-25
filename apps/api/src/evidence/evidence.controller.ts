import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthUser } from "../auth/auth.types.js";
import { PayloadStorageService } from "./payload-storage.service.js";
import { OrgsService } from "../orgs/orgs.service.js";
import { SupabaseUserFactory } from "../common/supabase-user.factory.js";
import { BadRequestException } from "@nestjs/common";

@Controller("evidence")
@UseGuards(SupabaseAuthGuard)
export class EvidenceController {
  constructor(
    private readonly payloads: PayloadStorageService,
    private readonly orgs: OrgsService,
    private readonly users: SupabaseUserFactory,
  ) {}

  @Post("payloads")
  async store(
    @CurrentUser() user: AuthUser,
    @Body() body: { organisation_id: string; payload: unknown; classification?: string },
  ) {
    await this.orgs.requirePermission(user, body.organisation_id, "evidence.write");
    return this.payloads.storeRaw(body.organisation_id, body.payload, {
      classification: body.classification,
    });
  }

  @Get(":organisationId/payloads")
  async list(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") organisationId: string,
  ) {
    await this.orgs.requirePermission(user, organisationId, "evidence.read");
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb
      .from("payload_objects")
      .select("id, object_key, content_sha256, byte_length, storage_backend, classification, created_at")
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }
}
