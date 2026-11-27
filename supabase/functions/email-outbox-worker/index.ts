/**
 * Durable email outbox worker (Supabase Edge Function).
 *
 * Uses Edge Function secrets already configured on the project:
 *   - RESEND_API_KEY (required)
 *   - SG_EMAIL_FROM (required; verified Resend sender, e.g. SentinelGrid <noreply@domain>)
 *
 * Platform-injected:
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *
 * Auth: require Authorization Bearer matching the service role (or cron invoke with service role).
 * Lease RPCs + Resend Idempotency-Key (= outbox id) keep dual Nest/Edge workers safe.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type ClaimedEmail = {
  id: string;
  lease_token: string;
  to_email: string;
  subject: string;
  body_text: string;
  body_html: string | null;
  template_key: string;
  attempts: number;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const from = Deno.env.get("SG_EMAIL_FROM") ?? "";

  if (!supabaseUrl || !serviceRole) {
    return json({ error: "supabase_env_missing" }, 500);
  }
  if (!resendKey || !from) {
    return json({
      error: "email_secrets_missing",
      resend_configured: Boolean(resendKey),
      from_configured: Boolean(from),
      hint: "Set RESEND_API_KEY and SG_EMAIL_FROM in Edge Function secrets (Production).",
    }, 503);
  }

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== serviceRole) {
    return json({ error: "unauthorized" }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.rpc("claim_email_outbox", {
    p_limit: 10,
    p_lease_seconds: 120,
  });
  if (error) {
    return json({ error: "claim_failed", message: error.message }, 500);
  }

  const claimed = (data ?? []) as ClaimedEmail[];
  const results: Array<{ id: string; ok: boolean; provider_message_id?: string; error?: string }> = [];

  for (const row of claimed) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": row.id,
        },
        body: JSON.stringify({
          from,
          to: [row.to_email],
          subject: row.subject,
          text: row.body_text,
          ...(row.body_html ? { html: row.body_html } : {}),
          tags: [{ name: "sentinelgrid_template", value: row.template_key.slice(0, 50) }],
        }),
      });
      const payload = await response.json().catch(() => ({})) as { id?: string; message?: string };
      if (!response.ok || !payload.id) {
        throw new Error(`Resend HTTP ${response.status}: ${payload.message ?? "message ID missing"}`);
      }
      const finish = await admin.rpc("finish_email_outbox", {
        p_id: row.id,
        p_lease_token: row.lease_token,
        p_success: true,
        p_provider_message_id: payload.id,
        p_error: null,
        p_max_attempts: 8,
      });
      if (finish.error) throw new Error(finish.error.message);
      results.push({ id: row.id, ok: true, provider_message_id: payload.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await admin.rpc("finish_email_outbox", {
        p_id: row.id,
        p_lease_token: row.lease_token,
        p_success: false,
        p_provider_message_id: null,
        p_error: message,
        p_max_attempts: 8,
      });
      results.push({ id: row.id, ok: false, error: message });
    }
  }

  return json({
    status: "ok",
    claimed: claimed.length,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
