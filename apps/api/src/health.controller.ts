import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  get() {
    const started = Number(process.env.SG_PROCESS_STARTED_AT_MS ?? Date.now());
    const production = process.env.NODE_ENV === "production";
    const emailTransport =
      process.env.SG_EMAIL_TRANSPORT ?? (production ? "none" : "local_log");
    const workerFlag = process.env.SG_EMAIL_WORKER_ENABLED === "true";
    const resendConfigured = Boolean(process.env.RESEND_API_KEY && process.env.SG_EMAIL_FROM);
    return {
      status: "ok",
      phase: "0",
      ot_default: "read_only",
      service_role_in_frontend: false,
      monitoring: {
        uptime_ms: Date.now() - started,
        node_env: process.env.NODE_ENV ?? "development",
        payload_backend: process.env.PAYLOAD_STORAGE_BACKEND ?? "local_dev",
        rate_limit_backend: process.env.RATE_LIMIT_REDIS_URL ? "redis" : "memory",
        email_transport: emailTransport,
        email_worker_enabled: workerFlag && emailTransport === "resend" && resendConfigured,
        email_resend_configured: resendConfigured,
        build_sha: process.env.GIT_SHA ?? process.env.GITHUB_SHA ?? null,
      },
    };
  }
}
