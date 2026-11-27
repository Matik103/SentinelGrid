import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EmailOutboxService } from "./email-outbox.service.js";

function mockAdmin(updates: unknown[]) {
  return {
    client: {
      from: (table: string) => {
        assert.equal(table, "email_outbox");
        return {
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => ({
                data: {
                  id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
                  organisation_id: row.organisation_id,
                  template_key: row.template_key,
                  to_email: row.to_email,
                  subject: row.subject,
                  body_text: row.body_text,
                  status: "pending",
                },
                error: null,
              }),
            }),
          }),
          update: (row: unknown) => {
            updates.push(row);
            return {
              eq: async () => ({ error: null }),
            };
          },
        };
      },
    },
  };
}

describe("EmailOutboxService", () => {
  it("enqueues and drains via local_log transport", async () => {
    const updates: unknown[] = [];
    const prev = process.env.NODE_ENV;
    const prevTransport = process.env.SG_EMAIL_TRANSPORT;
    process.env.NODE_ENV = "test";
    delete process.env.SG_EMAIL_TRANSPORT;
    try {
      const svc = new EmailOutboxService(mockAdmin(updates) as never);
      const row = await svc.enqueue({
        organisationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        templateKey: "organisation.invite",
        toEmail: "invitee@example.com",
        subject: "Invite",
        bodyText: "token=abc",
      });
      assert.equal(row.status, "pending");
      assert.equal(updates.length, 1);
      assert.equal((updates[0] as { status: string }).status, "sent");
    } finally {
      process.env.NODE_ENV = prev;
      if (prevTransport === undefined) delete process.env.SG_EMAIL_TRANSPORT;
      else process.env.SG_EMAIL_TRANSPORT = prevTransport;
    }
  });

  it("leaves rows pending for resend worker transport", async () => {
    const updates: unknown[] = [];
    const prev = process.env.NODE_ENV;
    const prevTransport = process.env.SG_EMAIL_TRANSPORT;
    process.env.NODE_ENV = "production";
    process.env.SG_EMAIL_TRANSPORT = "resend";
    try {
      const svc = new EmailOutboxService(mockAdmin(updates) as never);
      const row = await svc.enqueue({
        organisationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        templateKey: "organisation.invite",
        toEmail: "invitee@example.com",
        subject: "Invite",
        bodyText: "token=abc",
      });
      assert.equal(row.status, "pending");
      assert.equal(updates.length, 0);
    } finally {
      process.env.NODE_ENV = prev;
      if (prevTransport === undefined) delete process.env.SG_EMAIL_TRANSPORT;
      else process.env.SG_EMAIL_TRANSPORT = prevTransport;
    }
  });
});
