import {
  BadRequestException,
  ForbiddenException,
  Injectable,
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

@Injectable()
export class OrgsService {
  constructor(private readonly users: SupabaseUserFactory) {}

  async bootstrap(user: AuthUser, body: unknown) {
    const input = BootstrapSchema.parse(body);
    const sb = this.users.create(user.accessToken);
    // Tenant id comes from RPC return — never from client claim alone for authorization.
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
   * Invite is Phase 0 scaffolding: validates RBAC and role catalogue.
   * Does not invent auth users or fabricate memberships for unknown accounts.
   */
  async invite(user: AuthUser, organisationId: string, body: unknown) {
    const input = InviteSchema.parse(body);
    await this.requirePermission(user, organisationId, "user.manage");
    const sb = this.users.create(user.accessToken);

    const { data: role, error: roleErr } = await sb
      .from("roles")
      .select("id, key")
      .eq("key", input.role_key)
      .maybeSingle();
    if (roleErr || !role) throw new BadRequestException("Unknown role");

    return {
      status: "pending_invite",
      organisation_id: organisationId,
      email: input.email,
      role_key: input.role_key,
      role_id: role.id,
      note: "Complete invite acceptance via Auth after user signup; no fabricated membership written.",
    };
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
}
