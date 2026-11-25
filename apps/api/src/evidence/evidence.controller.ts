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
import { PayloadStorageService } from "./payload-storage.service.js";
import { EvidenceChainService } from "./evidence-chain.service.js";
import { OrgsService } from "../orgs/orgs.service.js";
import { SupabaseUserFactory } from "../common/supabase-user.factory.js";

const StoreSchema = z.object({
  organisation_id: z.string().uuid(),
  payload: z.unknown(),
  classification: z.enum(["real", "simulated", "replayed", "synthetic"]).optional(),
});

const CheckpointSchema = z.object({
  range_start: z.string().datetime({ offset: true }).or(z.string().min(10)),
  range_end: z.string().datetime({ offset: true }).or(z.string().min(10)),
});

const LinkSchema = z.object({
  event_id: z.string().uuid(),
  payload_object_id: z.string().uuid(),
});

@Controller()
@UseGuards(SupabaseAuthGuard)
export class EvidenceController {
  constructor(
    private readonly payloads: PayloadStorageService,
    private readonly chain: EvidenceChainService,
    private readonly orgs: OrgsService,
    private readonly users: SupabaseUserFactory,
  ) {}

  @Post("evidence/payloads")
  async store(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed = StoreSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const input = parsed.data;
    await this.orgs.requirePermission(user, input.organisation_id, "evidence.write");
    return this.payloads.storeRaw(input.organisation_id, input.payload, {
      classification: input.classification,
    });
  }

  @Get("evidence/:organisationId/payloads")
  async listPayloads(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") organisationId: string,
  ) {
    const id = this.uuid(organisationId);
    await this.orgs.requirePermission(user, id, "evidence.read");
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb
      .from("payload_objects")
      .select("id, object_key, content_sha256, byte_length, storage_backend, classification, created_at")
      .eq("organisation_id", id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  @Get("evidence/:organisationId/payloads/:payloadId")
  async retrieve(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") organisationId: string,
    @Param("payloadId") payloadId: string,
  ) {
    const org = this.uuid(organisationId);
    const object = this.uuid(payloadId);
    await this.orgs.requirePermission(user, org, "evidence.read");
    try {
      const bytes = await this.payloads.readRaw(org, object);
      return { payload: bytes.toString("utf8"), verified: true };
    } catch {
      throw new BadRequestException("Evidence payload unavailable or failed integrity verification");
    }
  }

  @Get("orgs/:organisationId/evidence/records")
  listRecords(@CurrentUser() user: AuthUser, @Param("organisationId") orgId: string) {
    return this.chain.listRecords(user, this.uuid(orgId));
  }

  @Get("orgs/:organisationId/evidence/checkpoints")
  listCheckpoints(@CurrentUser() user: AuthUser, @Param("organisationId") orgId: string) {
    return this.chain.listCheckpoints(user, this.uuid(orgId));
  }

  @Post("orgs/:organisationId/evidence/link")
  async link(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") orgId: string,
    @Body() body: unknown,
  ) {
    const organisationId = this.uuid(orgId);
    await this.orgs.requirePermission(user, organisationId, "evidence.write");
    const parsed = LinkSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.chain.linkEventPayload(
      organisationId,
      parsed.data.event_id,
      parsed.data.payload_object_id,
    );
  }

  @Post("orgs/:organisationId/evidence/checkpoints")
  createCheckpoint(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") orgId: string,
    @Body() body: unknown,
  ) {
    const parsed = CheckpointSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.chain.createCheckpoint(user, this.uuid(orgId), parsed.data);
  }

  @Post("orgs/:organisationId/evidence/verify")
  verify(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") orgId: string,
    @Query("limit") limit?: string,
  ) {
    const n = limit ? Number(limit) : 500;
    return this.chain.verifyChain(user, this.uuid(orgId), Number.isFinite(n) ? n : 500);
  }

  @Get("orgs/:organisationId/evidence/export")
  exportBundle(
    @CurrentUser() user: AuthUser,
    @Param("organisationId") orgId: string,
    @Query("limit") limit?: string,
  ) {
    const n = limit ? Number(limit) : 200;
    return this.chain.exportBundle(user, this.uuid(orgId), {
      limit: Number.isFinite(n) ? n : 200,
    });
  }

  private uuid(value: string) {
    const parsed = z.string().uuid().safeParse(value);
    if (!parsed.success) throw new BadRequestException("Invalid UUID");
    return parsed.data;
  }
}
