import { Injectable } from "@nestjs/common";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Builds a user-scoped Supabase client from a JWT (RLS enforced; no service role). */
@Injectable()
export class SupabaseUserFactory {
  create(accessToken: string): SupabaseClient {
    const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
    const anon = process.env.SUPABASE_ANON_KEY ?? "anon-placeholder";
    return createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
}
