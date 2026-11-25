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
