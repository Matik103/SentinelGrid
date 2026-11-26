import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { SupabaseAdminService } from "../common/supabase-admin.service.js";
import { PayloadStorageService } from "./payload-storage.service.js";
import type { AuthUser } from "../auth/auth.types.js";
import { OrgsService } from "../orgs/orgs.service.js";
import { SupabaseUserFactory } from "../common/supabase-user.factory.js";

export type LinkResult = {
  evidence_id: string;
  event_id: string;
  payload_sha256: string;
  previous_hash: string | null;
  chain_hash: string;
};

@Injectable()
export class EvidenceChainService {
  private readonly log = new Logger(EvidenceChainService.name);

  constructor(
    private readonly admin: SupabaseAdminService,
    private readonly payloads: PayloadStorageService,
    private readonly orgs: OrgsService,
    private readonly users: SupabaseUserFactory,
  ) {}

  /**
   * Append an evidence record linking an event to a stored payload object.
   * Chain hash = sha256(previous_hash|payload_sha256|event_id).
   */
  async linkEventPayload(organisationId: string, eventId: string, payloadObjectId: string): Promise<LinkResult> {
    const { data, error } = await this.admin.client.rpc("append_evidence_record", {
      p_organisation_id: organisationId, p_event_id: eventId, p_payload_object_id: payloadObjectId,
    });
    if (error || !data) throw new BadRequestException("Atomic evidence append failed: " + (error?.message ?? "empty response"));
    return data as LinkResult;
  }
  async createCheckpoint(
    user: AuthUser,
    organisationId: string,
    body: { range_start: string; range_end: string },
  ) {
    await this.orgs.requirePermission(user, organisationId, "evidence.write");
    const rangeStart = new Date(body.range_start);
    const rangeEnd = new Date(body.range_end);
    if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime()) || rangeEnd < rangeStart) {
      throw new BadRequestException("Invalid checkpoint range");
    }

    const { data: records, error } = await this.admin.client
      .from("evidence_records")
      .select("id, chain_hash, created_at")
      .eq("organisation_id", organisationId)
      .gte("created_at", rangeStart.toISOString())
      .lte("created_at", rangeEnd.toISOString())
      .order("created_at", { ascending: true })
      .limit(10_000);
    if (error) throw new BadRequestException(error.message);

    const material = (records ?? [])
      .map((r) => `${r.id}:${r.chain_hash}`)
      .join("\n");
    const checkpointHash = createHash("sha256")
      .update(material || `empty|${organisationId}|${rangeStart.toISOString()}|${rangeEnd.toISOString()}`, "utf8")
      .digest("hex");

    const { data, error: insertError } = await this.admin.client
      .from("evidence_checkpoints")
      .insert({
        organisation_id: organisationId,
        checkpoint_hash: checkpointHash,
        range_start: rangeStart.toISOString(),
        range_end: rangeEnd.toISOString(),
        metadata: { record_count: (records ?? []).length },
      })
      .select("id, checkpoint_hash, range_start, range_end, created_at, metadata")
      .single();
    if (insertError || !data) {
      throw new BadRequestException(insertError?.message ?? "checkpoint insert failed");
    }

    await this.admin.client.from("audit_logs").insert({
      organisation_id: organisationId,
      actor_user_id: user.id,
      action: "evidence.checkpoint.create",
      resource_type: "evidence_checkpoints",
      resource_id: data.id,
      details: { record_count: (records ?? []).length, checkpoint_hash: checkpointHash },
    });

    return data;
  }

  async verifyChain(user: AuthUser, organisationId: string, limit = 500) {
    await this.orgs.requirePermission(user, organisationId, "evidence.read");
    const { data: records, error } = await this.admin.client
      .from("evidence_records")
      .select("id, event_id, payload_sha256, previous_hash, chain_hash, payload_ref, integrity_status, created_at")
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: true })
      .limit(Math.min(Math.max(limit, 1), 5000));
    if (error) throw new BadRequestException(error.message);

    let previous: string | null = null;
    let brokenAt: string | null = null;
    let checked = 0;
    for (const row of records ?? []) {
      checked += 1;
      const expectedPrev = previous;
      if ((row.previous_hash ?? null) !== expectedPrev) {
        brokenAt = row.id as string;
        break;
      }
      const expected = createHash("sha256")
        .update(`${row.previous_hash ?? ""}|${row.payload_sha256}|${row.event_id}`, "utf8")
        .digest("hex");
      if (expected !== row.chain_hash) {
        brokenAt = row.id as string;
        break;
      }
      previous = row.chain_hash as string;
    }

    const status = brokenAt ? "failed" : "verified";
    if (brokenAt) {
      await this.admin.client
        .from("evidence_records")
        .update({ integrity_status: "failed" })
        .eq("id", brokenAt)
        .eq("organisation_id", organisationId);
    }

    return {
      organisation_id: organisationId,
      status,
      checked,
      broken_at: brokenAt,
      tip_hash: previous,
    };
  }

  async exportBundle(user: AuthUser, organisationId: string, opts?: { limit?: number }) {
    await this.orgs.requirePermission(user, organisationId, "evidence.read");
    const limit = Math.min(Math.max(opts?.limit ?? 200, 1), 2000);
    const sb = this.users.create(user.accessToken);
    const { data: records, error } = await sb
      .from("evidence_records")
      .select(
        "id, event_id, payload_sha256, payload_ref, previous_hash, chain_hash, integrity_status, metadata, created_at",
      )
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw new BadRequestException(error.message);

    const { data: checkpoints, error: cpError } = await sb
      .from("evidence_checkpoints")
      .select("id, checkpoint_hash, range_start, range_end, storage_ref, metadata, created_at")
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (cpError) throw new BadRequestException(cpError.message);

    const verify = await this.verifyChain(user, organisationId, limit);

    return {
      organisation_id: organisationId,
      exported_at: new Date().toISOString(),
      verification: verify,
      evidence_records: records ?? [],
      checkpoints: checkpoints ?? [],
    };
  }

  async listRecords(user: AuthUser, organisationId: string) {
    await this.orgs.requirePermission(user, organisationId, "evidence.read");
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb
      .from("evidence_records")
      .select(
        "id, event_id, payload_sha256, payload_ref, previous_hash, chain_hash, integrity_status, created_at",
      )
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async listCheckpoints(user: AuthUser, organisationId: string) {
    await this.orgs.requirePermission(user, organisationId, "evidence.read");
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb
      .from("evidence_checkpoints")
      .select("id, checkpoint_hash, range_start, range_end, metadata, created_at")
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  private async latestChainHash(organisationId: string): Promise<string | null> {
    const { data, error } = await this.admin.client
      .from("evidence_records")
      .select("chain_hash")
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      this.log.warn(`latest chain hash lookup failed: ${error.message}`);
      return null;
    }
    return (data?.chain_hash as string | undefined) ?? null;
  }
}
