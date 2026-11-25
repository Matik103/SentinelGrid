import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import { SupabaseUserFactory } from "../common/supabase-user.factory.js";
import type { AuthUser } from "../auth/auth.types.js";

const BootstrapSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase kebab-case"),
});

const InviteSchema = z.object({
  email: z.string().email(),
  role_key: z.enum([
    "organisation_administrator",
    "facility_manager",
    "security_analyst",
    "operations_manager",
    "read_only_viewer",
  ]),
});

const AcceptInviteSchema = z.object({
  token: z.string().min(16).max(256),
});

@Injectable()
export class OrgsService {
  private readonly log = new Logger(OrgsService.name);

  constructor(private readonly users: SupabaseUserFactory) {}

  async bootstrap(user: AuthUser, body: unknown) {
    const input = BootstrapSchema.parse(body);
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb.rpc("bootstrap_organisation", {
      p_name: input.name,
      p_slug: input.slug,
    });
    if (error) {
      throw new BadRequestException(error.message);
    }
    return { organisation_id: data as string, name: input.name, slug: input.slug };
  }

  async listMine(user: AuthUser) {
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb
      .from("memberships")
      .select("organisation_id, role_id, status, organisations(id, name, slug)")
      .eq("user_id", user.id)
      .eq("status", "active");
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async getMembership(user: AuthUser, organisationId: string) {
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb
      .from("memberships")
      .select("organisation_id, role_id, status, roles(key, name)")
      .eq("organisation_id", organisationId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException("Not a member of this organisation");
    return data;
  }

  async checkPermission(user: AuthUser, organisationId: string, permission: string) {
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb.rpc("has_org_permission", {
      p_organisation_id: organisationId,
      p_permission: permission,
    });
    if (error) throw new BadRequestException(error.message);
    return Boolean(data);
  }

  async requirePermission(user: AuthUser, organisationId: string, permission: string) {
    const ok = await this.checkPermission(user, organisationId, permission);
    if (!ok) throw new ForbiddenException(`Missing permission: ${permission}`);
  }

  /**
   * Create invitation via RPC — writes organisation_invitations and seeds membership when user exists.
   * Email delivery is stubbed/logged in local_dev; token returned once for the delivery path.
   */
  async invite(user: AuthUser, organisationId: string, body: unknown) {
    const input = InviteSchema.parse(body);
    await this.requirePermission(user, organisationId, "user.manage");
    const sb = this.users.create(user.accessToken);

    const { data, error } = await sb.rpc("create_organisation_invitation", {
      p_organisation_id: organisationId,
      p_email: input.email,
      p_role_key: input.role_key,
    });
    if (error) throw new BadRequestException(error.message);

    const result = data as {
      id: string;
      organisation_id: string;
      email: string;
      role_key: string;
      role_id: string;
      status: string;
      token: string;
    };

    this.deliverInviteEmail(result.email, result.token, organisationId);

    return {
      status: result.status,
      invitation_id: result.id,
      organisation_id: result.organisation_id,
      email: result.email,
      role_key: result.role_key,
      role_id: result.role_id,
      // Token exposed once so local_dev/stub mailer can deliver; production mailer should not log it.
      delivery: {
        channel: process.env.NODE_ENV === "production" ? "queued" : "local_dev_log",
        token_included: process.env.NODE_ENV !== "production",
        ...(process.env.NODE_ENV !== "production" ? { token: result.token } : {}),
      },
    };
  }

  async acceptInvite(user: AuthUser, body: unknown) {
    const input = AcceptInviteSchema.parse(body);
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb.rpc("accept_organisation_invitation", {
      p_token: input.token,
    });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async revokeInvite(user: AuthUser, organisationId: string, invitationId: string) {
    await this.requirePermission(user, organisationId, "user.manage");
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb.rpc("revoke_organisation_invitation", {
      p_invitation_id: invitationId,
    });
    if (error) throw new BadRequestException(error.message);
    const result = data as { organisation_id?: string };
    if (result?.organisation_id && result.organisation_id !== organisationId) {
      throw new ForbiddenException("Invitation does not belong to this organisation");
    }
    return data;
  }

  async listInvites(user: AuthUser, organisationId: string) {
    await this.requirePermission(user, organisationId, "user.manage");
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb
      .from("organisation_invitations")
      .select("id, email, role_id, status, expires_at, created_at, accepted_at, revoked_at, roles(key, name)")
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async listMembers(user: AuthUser, organisationId: string) {
    await this.requirePermission(user, organisationId, "org.read");
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb
      .from("memberships")
      .select("user_id, role_id, status, roles(key, name)")
      .eq("organisation_id", organisationId);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  private deliverInviteEmail(email: string, token: string, organisationId: string) {
    // Real path: enqueue mailer. Phase 0 local_dev stubs by logging (never in production logs with token).
    if (process.env.NODE_ENV === "production") {
      this.log.log(`invite queued organisation=${organisationId} email=${email}`);
      return;
    }
    this.log.log(
      `[local_dev] invite email → ${email} org=${organisationId} accept_token=${token}`,
    );
  }
}
