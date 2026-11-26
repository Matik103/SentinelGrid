import { Injectable, Logger } from "@nestjs/common";
import { SupabaseAdminService } from "./supabase-admin.service.js";

export type OutboxEnqueueInput = {
  organisationId: string | null;
  templateKey: string;
  toEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  payload?: Record<string, unknown>;
};

export type OutboxRow = {
  id: string;
  organisation_id: string | null;
  template_key: string;
  to_email: string;
  subject: string;
  body_text: string;
  status: string;
};

/**
 * Durable email outbox. Local/dev drains by logging; production marks pending
 * until a real transport worker is configured (never claim delivery without it).
 */
@Injectable()
export class EmailOutboxService {
  private readonly log = new Logger(EmailOutboxService.name);

  constructor(private readonly admin: SupabaseAdminService) {}

  async enqueue(input: OutboxEnqueueInput): Promise<OutboxRow> {
    const { data, error } = await this.admin.client
      .from("email_outbox")
      .insert({
        organisation_id: input.organisationId,
        template_key: input.templateKey,
        to_email: input.toEmail,
        subject: input.subject,
        body_text: input.bodyText,
        body_html: input.bodyHtml ?? null,
        payload: input.payload ?? {},
        status: "pending",
      })
      .select("id, organisation_id, template_key, to_email, subject, body_text, status")
      .single();
    if (error || !data) {
      throw new Error(`email outbox enqueue failed: ${error?.message ?? "unknown"}`);
    }
    await this.drainLocal(data as OutboxRow);
    return data as OutboxRow;
  }

  /** Local transport: log and mark sent. Production leaves pending. */
  private async drainLocal(row: OutboxRow): Promise<void> {
    const production = process.env.NODE_ENV === "production";
    const transport = process.env.SG_EMAIL_TRANSPORT ?? (production ? "none" : "local_log");
    if (transport === "none") {
      this.log.warn(
        `email outbox pending id=${row.id} template=${row.template_key} to=${row.to_email} (no transport)`,
      );
      return;
    }
    if (transport === "local_log") {
      this.log.log(
        `[local_dev] email outbox → to=${row.to_email} subject=${row.subject} body=${row.body_text}`,
      );
      await this.admin.client
        .from("email_outbox")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          attempts: 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      return;
    }
    this.log.warn(`unknown SG_EMAIL_TRANSPORT=${transport}; leaving outbox pending id=${row.id}`);
  }
}
