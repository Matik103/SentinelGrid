import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { SupabaseAdminService } from "./common/supabase-admin.service.js";
import { EmailWorkerService } from "./common/email-worker.service.js";
import { PayloadStorageService } from "./evidence/payload-storage.service.js";

@Controller("health")
export class HealthController {
  constructor(
    private readonly admin: SupabaseAdminService,
    private readonly emailWorker: EmailWorkerService,
    private readonly payloads: PayloadStorageService,
  ) {}

  @Get()
  async get() {
    const started = Number(process.env.SG_PROCESS_STARTED_AT_MS ?? Date.now());
    const production = process.env.NODE_ENV === "production";
    const emailTransport = process.env.SG_EMAIL_TRANSPORT ?? (production ? "none" : "local_log");
    const emailSecretsConfigured = Boolean(process.env.RESEND_API_KEY && process.env.SG_EMAIL_FROM);
    const emailWorkerEnabled = this.emailWorker.isActive();

    // This is a readiness check, not just a process liveness response.
    // Do not disclose database errors, project identifiers, or secret values.
    const { data, error } = await this.admin.client
      .from("app_public_config")
      .select("value")
      .eq("key", "api_base_url")
      .maybeSingle();
    if (error) {
      throw new ServiceUnavailableException({
        status: "not_ready",
        dependency: "supabase",
        message: "The API cannot reach the required Supabase configuration table.",
      });
    }

    const apiConfigValue = (data?.value ?? null) as { url?: unknown } | null;
    const publicApiOriginConfigured = typeof apiConfigValue?.url === "string" && apiConfigValue.url.startsWith("https://");

    return {
      status: "ok",
      phase: "0",
      ot_default: "read_only",
      service_role_in_frontend: false,
      dependencies: { supabase: "ok" },
      public_api_origin_configured: publicApiOriginConfigured,
      monitoring: {
        uptime_ms: Date.now() - started,
        node_env: process.env.NODE_ENV ?? "development",
        payload_backend: this.payloads.getActiveBackend(),
        rate_limit_backend:
          process.env.REDIS_URL || process.env.RATE_LIMIT_REDIS_URL
            ? "redis"
            : "memory",
        email_transport: emailTransport,
        email_worker_enabled: emailWorkerEnabled,
        email_resend_configured: emailSecretsConfigured,
        payload_bucket: this.payloads.getConfiguredBucketStatus(),
        build_sha: process.env.GIT_SHA ?? process.env.GITHUB_SHA ?? null,
      },
    };
  }
}
