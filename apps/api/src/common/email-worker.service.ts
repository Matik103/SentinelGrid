import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { SupabaseAdminService } from "./supabase-admin.service.js";

type ClaimedEmail = {
  id: string; lease_token: string; to_email: string; subject: string;
  body_text: string; body_html: string | null; template_key: string;
  attempts: number;
};

@Injectable()
export class EmailWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(EmailWorkerService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly admin: SupabaseAdminService) {}

  onModuleInit() {
    if (process.env.SG_EMAIL_WORKER_ENABLED !== "true") return;
    if ((process.env.SG_EMAIL_TRANSPORT ?? "none") !== "resend") {
      this.log.warn("Email worker enabled but SG_EMAIL_TRANSPORT is not resend; worker remains disabled");
      return;
    }
    if (!process.env.RESEND_API_KEY || !process.env.SG_EMAIL_FROM) {
      this.log.error("Email worker not started: RESEND_API_KEY and SG_EMAIL_FROM are required");
      return;
    }
    this.timer = setInterval(() => void this.tick(), 5000);
    this.timer.unref();
    void this.tick();
    this.log.log("Email worker started (Resend transport)");
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const { data, error } = await this.admin.client.rpc("claim_email_outbox", {
        p_limit: 10, p_lease_seconds: 120,
      });
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as ClaimedEmail[]) {
        await this.deliver(row);
      }
    } catch (error) {
      this.log.error(`Email worker poll failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async deliver(row: ClaimedEmail) {
    const key = process.env.RESEND_API_KEY!;
    const from = process.env.SG_EMAIL_FROM!;
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": row.id,
        },
        body: JSON.stringify({
          from, to: [row.to_email], subject: row.subject,
          text: row.body_text, ...(row.body_html ? { html: row.body_html } : {}),
          tags: [{ name: "sentinelgrid_template", value: row.template_key.slice(0, 50) }],
        }),
        signal: AbortSignal.timeout(15000),
      });
      const payload = await response.json().catch(() => ({})) as { id?: string; message?: string };
      if (!response.ok || !payload.id) {
        throw new Error(`Resend HTTP ${response.status}: ${payload.message ?? "message ID missing"}`);
      }
      const result = await this.admin.client.rpc("finish_email_outbox", {
        p_id: row.id, p_lease_token: row.lease_token, p_success: true,
        p_provider_message_id: payload.id, p_error: null, p_max_attempts: 8,
      });
      if (result.error) throw new Error(result.error.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const result = await this.admin.client.rpc("finish_email_outbox", {
        p_id: row.id, p_lease_token: row.lease_token, p_success: false,
        p_provider_message_id: null, p_error: message, p_max_attempts: 8,
      });
      if (result.error) {
        this.log.error(`Unable to record email failure id=${row.id}: ${result.error.message}`);
      } else {
        this.log.warn(`Email delivery failed id=${row.id} attempt=${row.attempts}: ${message}`);
      }
    }
  }
}
