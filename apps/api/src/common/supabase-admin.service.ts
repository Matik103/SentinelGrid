import { Injectable } from "@nestjs/common";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Server-only service-role client. Never expose this client to browsers. */
@Injectable()
export class SupabaseAdminService {
  readonly client: SupabaseClient;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the API");
    }
    if (!/^https:\/\//i.test(url) && process.env.NODE_ENV === "production") {
      throw new Error("SUPABASE_URL must use HTTPS in production");
    }
    if (!key || key === "service-role-placeholder") {
      throw new Error("A real Supabase service-role key is required");
    }
    this.client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "X-Client-Info": "sentinelgrid-api" } },
    });
  }
}
