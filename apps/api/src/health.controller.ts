import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  get() {
    const started = Number(process.env.SG_PROCESS_STARTED_AT_MS ?? Date.now());
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
        email_transport: process.env.SG_EMAIL_TRANSPORT ?? (process.env.NODE_ENV === "production" ? "none" : "local_log"),
        build_sha: process.env.GIT_SHA ?? process.env.GITHUB_SHA ?? null,
      },
    };
  }
}
