import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuthUser } from "../auth/auth.types.js";
import { OrgsService } from "../orgs/orgs.service.js";
import { SupabaseUserFactory } from "../common/supabase-user.factory.js";
import { SupabaseAdminService } from "../common/supabase-admin.service.js";

const RegisterSchema = z.object({
  name: z.string().min(1).max(200),
  facility_id: z.string().uuid().optional().nullable(),
  connector_uid: z.string().min(2).max(128).optional(),
  version: z.string().max(64).optional(),
  protocols: z.array(z.string().min(1).max(32)).max(16).optional(),
});

@Injectable()
export class ConnectorsService {
  constructor(
    private readonly orgs: OrgsService,
    private readonly users: SupabaseUserFactory,
    private readonly admin: SupabaseAdminService,
  ) {}

  async list(user: AuthUser, organisationId: string) {
    await this.orgs.requirePermission(user, organisationId, "connector.read");
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb
      .from("connectors")
      .select(
        "id, name, connector_uid, status, version, protocols, credential_status, last_heartbeat_at, created_at",
      )
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async register(user: AuthUser, organisationId: string, body: unknown) {
    const input = RegisterSchema.parse(body);
    await this.orgs.requirePermission(user, organisationId, "connector.write");
    const sb = this.users.create(user.accessToken);
    const uid = input.connector_uid ?? `conn-${randomUUID()}`;
    const { data, error } = await sb
      .from("connectors")
      .insert({
        organisation_id: organisationId,
        facility_id: input.facility_id ?? null,
        name: input.name,
        connector_uid: uid,
        version: input.version ?? null,
        protocols: input.protocols ?? [],
        status: "registered",
        credential_status: "issued",
      })
      .select(
        "id, name, connector_uid, status, version, protocols, credential_status, created_at",
      )
      .single();
    if (error) throw new BadRequestException(error.message);

    // Issue opaque token via service role audit path — token material is env-bound on the edge.
    const tokenHint = `sgc_${randomUUID().replace(/-/g, "")}`;
    await this.admin.client.from("audit_logs").insert({
      organisation_id: organisationId,
      actor_user_id: user.id,
      action: "connector.register",
      resource_type: "connectors",
      resource_id: data.id,
      details: { connector_uid: uid, credential_status: "issued" },
    });

    return {
      ...data,
      credential: {
        status: "issued",
        // One-time delivery material for local wiring; production should use a secrets vault.
        token_hint: tokenHint,
        note: "Store as SENTINELGRID_CONNECTOR_TOKEN on the edge host; rotate via revoke+reissue.",
      },
    };
  }

  async heartbeat(user: AuthUser, organisationId: string, connectorId: string) {
    await this.orgs.requirePermission(user, organisationId, "connector.write");
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb
      .from("connectors")
      .update({
        last_heartbeat_at: new Date().toISOString(),
        status: "active",
      })
      .eq("id", connectorId)
      .eq("organisation_id", organisationId)
      .neq("status", "revoked")
      .select("id, status, last_heartbeat_at")
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException("Connector not found or revoked");
    return data;
  }

  async revoke(user: AuthUser, organisationId: string, connectorId: string) {
    await this.orgs.requirePermission(user, organisationId, "connector.write");
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb
      .from("connectors")
      .update({
        status: "revoked",
        credential_status: "revoked",
        credential_revoked_at: new Date().toISOString(),
      })
      .eq("id", connectorId)
      .eq("organisation_id", organisationId)
      .select("id, status, credential_status, credential_revoked_at")
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException("Connector not found");
    await this.admin.client.from("audit_logs").insert({
      organisation_id: organisationId,
      actor_user_id: user.id,
      action: "connector.revoke",
      resource_type: "connectors",
      resource_id: connectorId,
      details: {},
    });
    return data;
  }
}
