import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resendTagValue } from "./email-worker.service.js";

describe("EmailWorkerService surface", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "email-worker.service.ts"), "utf8");

  it("stays disabled unless SG_EMAIL_WORKER_ENABLED=true and Resend is configured", () => {
    assert.match(source, /SG_EMAIL_WORKER_ENABLED/);
    assert.match(source, /SG_EMAIL_TRANSPORT/);
    assert.match(source, /RESEND_API_KEY/);
    assert.match(source, /SG_EMAIL_FROM/);
    assert.match(source, /claim_email_outbox/);
    assert.match(source, /finish_email_outbox/);
    assert.match(source, /Idempotency-Key/);
    assert.match(source, /resendTagValue/);
  });

  it("sanitizes Resend tag values (dots/spaces rejected by Resend)", () => {
    assert.equal(resendTagValue("organisation.invite"), "organisation_invite");
    assert.equal(resendTagValue("a b/c"), "a_b_c");
    assert.equal(resendTagValue("..."), "template");
  });
});
