import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { SupabaseAdminService } from "../common/supabase-admin.service.js";
import type { AuthUser } from "./auth.types.js";

type VerifiedJwtClaims = {
  sub?: string;
  aal?: string;
};

function readVerifiedClaims(token: string): VerifiedJwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as VerifiedJwtClaims;
    return claims && typeof claims === "object" ? claims : null;
  } catch {
    return null;
  }
}

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private readonly admin: SupabaseAdminService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: AuthUser;
    }>();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing Bearer token");
    }
    const token = header.slice("Bearer ".length).trim();
    if (!token) throw new UnauthorizedException("Missing Bearer token");

    // This call validates the token with Supabase Auth before any claim is trusted.
    const { data, error } = await this.admin.client.auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedException("Invalid token");
    }

    const claims = readVerifiedClaims(token);
    if (!claims || claims.sub !== data.user.id) {
      throw new UnauthorizedException("Invalid token claims");
    }
    if (claims.aal !== "aal2") {
      throw new ForbiddenException({
        code: "MFA_REQUIRED",
        message: "Multi-factor authentication is required to access SentinelGrid.",
      });
    }

    req.user = {
      id: data.user.id,
      email: data.user.email,
      accessToken: token,
    };
    return true;
  }
}
