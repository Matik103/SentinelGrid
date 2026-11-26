import { Injectable } from "@nestjs/common";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Builds a user-scoped Supabase client from a JWT; RLS remains enforced. */
@Injectable()
export class SupabaseUserFactory {
  create(accessToken: string): SupabaseClient {
    const url = process.env.SUPABASE_URL;
    const anon = process.env.SUPABASE_ANON_KEY;
    if (!url || !anon) {
      throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required for user-scoped database access");
    }
    if (process.env.NODE_ENV === "production" && !/^https:\/\//i.test(url)) {
      throw new Error("SUPABASE_URL must use HTTPS in production");
    }
    if (!accessToken.trim()) throw new Error("A user access token is required");
    return createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
}
