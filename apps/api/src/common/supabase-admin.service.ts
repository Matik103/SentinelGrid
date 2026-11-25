import { Injectable } from "@nestjs/common";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only admin client (service role). Never exposed to browsers/frontends.
 * Used for ingestion writes, DLQ, and payload metadata that bypass RLS by design.
 */
@Injectable()
export class SupabaseAdminService {
  readonly client: SupabaseClient;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      // Allow boot for scaffolding/tests without live credentials.
      this.client = createClient("http://127.0.0.1:54321", "service-role-placeholder", {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      return;
    }
    this.client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
}
