import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import { SupabaseUserFactory } from "../common/supabase-user.factory.js";
import { EmailOutboxService } from "../common/email-outbox.service.js";
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

  constructor(
    private readonly users: SupabaseUserFactory,
    private readonly outbox: EmailOutboxService,
  ) {}

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

    // Expire stale pending invites for this org inside the same request window.
    await sb.rpc("expire_organisation_invitations", {
      p_organisation_id: organisationId,
    });

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

    const delivery = await this.deliverInviteEmail(result.email, result.token, organisationId);

    return {
      status: result.status,
      invitation_id: result.id,
      organisation_id: result.organisation_id,
      email: result.email,
      role_key: result.role_key,
      role_id: result.role_id,
      delivery: {
        ...delivery,
        // Token exposed once for local_dev accept flows; production relies on outbox/email.
        token_included: process.env.NODE_ENV !== "production",
        ...(process.env.NODE_ENV !== "production" ? { token: result.token } : {}),
      },
    };
  }

  async acceptInvite(user: AuthUser, body: unknown) {
    const input = AcceptInviteSchema.parse(body);
    const sb = this.users.create(user.accessToken);
    // Expiry is enforced transactionally inside the RPC (marks expired then raises).
    const { data, error } = await sb.rpc("accept_organisation_invitation", {
      p_token: input.token,
    });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async expireInvites(user: AuthUser, organisationId: string) {
    await this.requirePermission(user, organisationId, "user.manage");
    const sb = this.users.create(user.accessToken);
    const { data, error } = await sb.rpc("expire_organisation_invitations", {
      p_organisation_id: organisationId,
    });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async revokeInvite(user: AuthUser, organisationId: string, invitationId: string) {
    await this.requirePermission(user, organisationId, "user.manage");
    const sb = this.users.create(user.accessToken);
    // Scope the mutation itself to the authorised organisation. Checking the
    // returned organisation after an unscoped RPC is too late: the other tenant's
    // invitation may already have been revoked.
    const { data, error } = await sb
      .from("organisation_invitations")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", invitationId)
      .eq("organisation_id", organisationId)
      .eq("status", "pending")
      .select("id, organisation_id, status, revoked_at")
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException("Pending invitation not found for this organisation");
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

  private async deliverInviteEmail(
    email: string,
    token: string,
    organisationId: string,
  ): Promise<{ channel: string; outbox_id?: string; status: string }> {
    const acceptPath = process.env.SG_INVITE_ACCEPT_URL ?? "/accept-invite";
    const bodyText = [
      "You have been invited to a SentinelGrid organisation.",
      `Accept path: ${acceptPath}`,
      `Token: ${token}`,
      "",
      "If you did not expect this email, ignore it.",
    ].join("\n");

    try {
      const row = await this.outbox.enqueue({
        organisationId,
        templateKey: "organisation.invite",
        toEmail: email,
        subject: "SentinelGrid organisation invitation",
        bodyText,
        payload: { organisation_id: organisationId, accept_path: acceptPath },
      });
      const channel =
        process.env.NODE_ENV === "production" && (process.env.SG_EMAIL_TRANSPORT ?? "none") === "none"
          ? "outbox_pending"
          : "outbox";
      return { channel, outbox_id: row.id, status: row.status };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(`invite outbox failed organisation=${organisationId}: ${message}`);
      // Invitation row already exists; surface delivery failure without rolling back RPC.
      return { channel: "outbox_failed", status: "failed" };
    }
  }
}
