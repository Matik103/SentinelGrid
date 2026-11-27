import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { SupabaseAdminService } from "./common/supabase-admin.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly admin: SupabaseAdminService) {}

  @Get()
  async get() {
    const started = Number(process.env.SG_PROCESS_STARTED_AT_MS ?? Date.now());
    const production = process.env.NODE_ENV === "production";
    const emailTransport = process.env.SG_EMAIL_TRANSPORT ?? (production ? "none" : "local_log");
    const emailSecretsConfigured = Boolean(process.env.RESEND_API_KEY && process.env.SG_EMAIL_FROM);
    const emailWorkerEnabled =
      process.env.SG_EMAIL_WORKER_ENABLED === "true" &&
      emailTransport === "resend" &&
      emailSecretsConfigured;

    // This is a readiness check, not just a process liveness response.
    // Do not disclose database errors, project identifiers, or secret values.
    const { error } = await this.admin.client
      .from("app_public_config")
      .select("key")
      .eq("key", "api_base_url")
      .maybeSingle();
    if (error) {
      throw new ServiceUnavailableException({
        status: "not_ready",
        dependency: "supabase",
        message: "The API cannot reach the required Supabase configuration table.",
      });
    }

    return {
      status: "ok",
      phase: "0",
      ot_default: "read_only",
      service_role_in_frontend: false,
      dependencies: { supabase: "ok" },
      monitoring: {
        uptime_ms: Date.now() - started,
        node_env: process.env.NODE_ENV ?? "development",
        payload_backend: process.env.PAYLOAD_STORAGE_BACKEND ?? "local_dev",
        rate_limit_backend: process.env.RATE_LIMIT_REDIS_URL ? "redis" : "memory",
        email_transport: emailTransport,
        email_worker_enabled: emailWorkerEnabled,
        email_resend_configured: emailSecretsConfigured,
        build_sha: process.env.GIT_SHA ?? process.env.GITHUB_SHA ?? null,
      },
    };
  }
}
