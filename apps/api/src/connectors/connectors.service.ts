import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
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

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function issueToken(): string {
  return `sgc_${randomBytes(24).toString("hex")}`;
}

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
        "id, name, connector_uid, status, version, protocols, credential_status, credential_rotated_at, last_heartbeat_at, created_at",
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
    const token = issueToken();
    const tokenHash = hashToken(token);

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
        credential_token_hash: tokenHash,
      })
      .select(
        "id, name, connector_uid, status, version, protocols, credential_status, created_at",
      )
      .single();
    if (error) throw new BadRequestException(error.message);

    await this.admin.client.from("audit_logs").insert({
      organisation_id: organisationId,
      actor_user_id: user.id,
      action: "connector.register",
      resource_type: "connectors",
      resource_id: data.id,
      details: { connector_uid: uid, credential_status: "issued", token_hash_prefix: tokenHash.slice(0, 8) },
    });

    return {
      ...data,
      credential: {
        status: "issued",
        // One-time plaintext delivery; only the SHA-256 hash is retained server-side.
        token,
        token_hash: tokenHash,
        note: "Store as SENTINELGRID_CONNECTOR_TOKEN on the edge host; rotate via POST …/rotate.",
      },
    };
  }

  async rotate(user: AuthUser, organisationId: string, connectorId: string) {
    await this.orgs.requirePermission(user, organisationId, "connector.write");
    const token = issueToken();
    const tokenHash = hashToken(token);
    const now = new Date().toISOString();
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb
      .from("connectors")
      .update({
        credential_status: "rotated",
        credential_token_hash: tokenHash,
        credential_rotated_at: now,
        credential_revoked_at: null,
        status: "registered",
      })
      .eq("id", connectorId)
      .eq("organisation_id", organisationId)
      .neq("status", "revoked")
      .select("id, status, credential_status, credential_rotated_at")
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException("Connector not found or revoked");

    await this.admin.client.from("audit_logs").insert({
      organisation_id: organisationId,
      actor_user_id: user.id,
      action: "connector.rotate",
      resource_type: "connectors",
      resource_id: connectorId,
      details: { credential_status: "rotated", token_hash_prefix: tokenHash.slice(0, 8) },
    });

    return {
      ...data,
      credential: {
        status: "rotated",
        token,
        token_hash: tokenHash,
        note: "Previous token is invalid; update SENTINELGRID_CONNECTOR_TOKEN on the edge host.",
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
        credential_token_hash: null,
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

  /**
   * Auth guard for connector-presented bearer tokens.
   * Compares SHA-256 of the presented token to the stored hash (constant-time).
   */
  async authorizeConnectorToken(
    organisationId: string,
    connectorId: string,
    presentedToken: string,
  ): Promise<boolean> {
    if (!presentedToken) return false;
    const { data, error } = await this.admin.client
      .from("connectors")
      .select("id, credential_status, credential_token_hash, status")
      .eq("id", connectorId)
      .eq("organisation_id", organisationId)
      .maybeSingle();
    if (error || !data) return false;
    if (data.status === "revoked" || data.credential_status === "revoked") return false;
    const stored = data.credential_token_hash as string | null;
    if (!stored) return false;
    const presentedHash = hashToken(presentedToken);
    try {
      const a = Buffer.from(stored, "hex");
      const b = Buffer.from(presentedHash, "hex");
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  async assertConnectorAuthorized(
    organisationId: string,
    connectorId: string,
    presentedToken: string,
  ): Promise<void> {
    const ok = await this.authorizeConnectorToken(organisationId, connectorId, presentedToken);
    if (!ok) throw new UnauthorizedException("Connector credential rejected");
  }
}
