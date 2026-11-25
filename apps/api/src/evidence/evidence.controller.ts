import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthUser } from "../auth/auth.types.js";
import { PayloadStorageService } from "./payload-storage.service.js";
import { OrgsService } from "../orgs/orgs.service.js";
import { SupabaseUserFactory } from "../common/supabase-user.factory.js";

const StoreSchema = z.object({
  organisation_id: z.string().uuid(),
  payload: z.unknown(),
  classification: z.enum(["real", "simulated", "replayed", "synthetic"]).optional(),
});

@Controller("evidence")
@UseGuards(SupabaseAuthGuard)
export class EvidenceController {
  constructor(
    private readonly payloads: PayloadStorageService,
    private readonly orgs: OrgsService,
    private readonly users: SupabaseUserFactory,
  ) {}

  @Post("payloads")
  async store(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed = StoreSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const input = parsed.data;
    await this.orgs.requirePermission(user, input.organisation_id, "evidence.write");
    return this.payloads.storeRaw(input.organisation_id, input.payload, {
      classification: input.classification,
    });
  }

  @Get(":organisationId/payloads")
  async list(@CurrentUser() user: AuthUser, @Param("organisationId") organisationId: string) {
    const id = z.string().uuid().safeParse(organisationId);
    if (!id.success) throw new BadRequestException("Invalid organisation ID");
    await this.orgs.requirePermission(user, id.data, "evidence.read");
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb
      .from("payload_objects")
      .select("id, object_key, content_sha256, byte_length, storage_backend, classification, created_at")
      .eq("organisation_id", id.data)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  @Get(":organisationId/payloads/:payloadId")
  async retrieve(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") organisationId: string,
    @Param("payloadId") payloadId: string,
  ) {
    const org = z.string().uuid().safeParse(organisationId);
    const object = z.string().uuid().safeParse(payloadId);
    if (!org.success || !object.success) throw new BadRequestException("Invalid evidence identifier");
    await this.orgs.requirePermission(user, org.data, "evidence.read");
    try {
      const bytes = await this.payloads.readRaw(org.data, object.data);
      return { payload: bytes.toString("utf8"), verified: true };
    } catch {
      throw new BadRequestException("Evidence payload unavailable or failed integrity verification");
    }
  }
}
