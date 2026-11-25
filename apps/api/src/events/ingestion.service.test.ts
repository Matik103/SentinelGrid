import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventIngestSchema } from "@sentinelgrid/shared";

describe("EventIngestSchema", () => {
  it("rejects missing source_event_id", () => {
    const r = EventIngestSchema.safeParse({
      organisation_id: "00000000-0000-4000-8000-000000000001",
      event_type: "plc.heartbeat",
      occurred_at: new Date().toISOString(),
      source: "connector-a",
    });
    assert.equal(r.success, false);
  });

  it("accepts minimal valid event", () => {
    const r = EventIngestSchema.safeParse({
      organisation_id: "00000000-0000-4000-8000-000000000001",
      event_type: "plc.heartbeat",
      occurred_at: "2026-11-25T18:00:00.000Z",
      source: "connector-a",
      source_event_id: "evt-1",
    });
    assert.equal(r.success, true);
    if (r.success) {
      assert.equal(r.data.classification, "real");
      assert.equal(r.data.schema_version, "0.1.0");
    }
  });
});


import { EventsController } from "./events.controller.js";

describe("EventsController tenant authorization", () => {
  it("rejects ingestion without a valid tenant before calling ingestion", async () => {
    let called = false;
    const controller = new EventsController(
      { ingest: async () => { called = true; return { status: "accepted", event_id: "x", deduplicated: false }; } } as never,
      { requirePermission: async () => true } as never,
      {} as never,
    );
    await assert.rejects(
      controller.ingest({ id: "user-1" } as never, { event_type: "test" }),
    );
    assert.equal(called, false);
  });

  it("checks event.ingest permission before forwarding the authorised tenant", async () => {
    const calls: unknown[] = [];
    const controller = new EventsController(
      { ingest: async (body: unknown, options: unknown) => {
        calls.push({ body, options });
        return { status: "accepted", event_id: "event-1", deduplicated: false };
      } } as never,
      { requirePermission: async (...args: unknown[]) => { calls.push(args); } } as never,
      {} as never,
    );
    const body = {
      organisation_id: "00000000-0000-4000-8000-000000000001",
      event_type: "connector.heartbeat",
    };
    await controller.ingest({ id: "user-1" } as never, body);
    assert.deepEqual(calls[0], [
      { id: "user-1" },
      body.organisation_id,
      "event.ingest",
    ]);
    assert.deepEqual(calls[1], {
      body,
      options: { authorisedOrganisationId: body.organisation_id },
    });
  });

  it("scopes DLQ replay to the tenant that passed permission checks", async () => {
    const calls: unknown[] = [];
    const controller = new EventsController(
      { replayFromDlq: async (...args: unknown[]) => { calls.push(args); return { status: "accepted", event_id: "event-2", deduplicated: false }; } } as never,
      { requirePermission: async (...args: unknown[]) => { calls.push(args); } } as never,
      {} as never,
    );
    const org = "00000000-0000-4000-8000-000000000002";
    await controller.replay({ id: "user-2" } as never, "dlq-1", { organisation_id: org });
    assert.deepEqual(calls[0], [{ id: "user-2" }, org, "event.ingest"]);
    assert.deepEqual(calls[1], ["dlq-1", org]);
  });
});
