import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { SupabaseAdminService } from "../common/supabase-admin.service.js";
import type { AuthUser } from "./auth.types.js";

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
    const { data, error } = await this.admin.client.auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedException("Invalid token");
    }
    req.user = {
      id: data.user.id,
      email: data.user.email,
      accessToken: token,
    };
    return true;
  }
}
