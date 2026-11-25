import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { EvidenceChainService } from "./evidence-chain.service.js";

describe("EvidenceChainService", () => {
  it("links event to payload via atomic append RPC", async () => {
    const rpcCalls: unknown[] = [];
    let tip: string | null = null;
    const payloadSha = createHash("sha256").update("payload").digest("hex");
    const eventId = "33333333-3333-4333-8333-333333333333";
    const orgId = "22222222-2222-4222-8222-222222222222";
    const payloadId = "11111111-1111-4111-8111-111111111111";

    const admin = {
      client: {
        rpc: async (name: string, args: Record<string, unknown>) => {
          rpcCalls.push({ name, args });
          assert.equal(name, "append_evidence_record");
          const previous = tip;
          const chain = createHash("sha256")
            .update(`${previous ?? ""}|${payloadSha}|${eventId}`, "utf8")
            .digest("hex");
          tip = chain;
          return {
            data: {
              evidence_id: "44444444-4444-4444-8444-444444444444",
              event_id: eventId,
              payload_sha256: payloadSha,
              previous_hash: previous,
              chain_hash: chain,
            },
            error: null,
          };
        },
      },
    };

    const svc = new EvidenceChainService(
      admin as never,
      {} as never,
      { requirePermission: async () => undefined } as never,
      { create: () => ({}) } as never,
    );

    const first = await svc.linkEventPayload(orgId, eventId, payloadId);
    assert.equal(first.previous_hash, null);
    assert.equal(first.chain_hash.length, 64);
    assert.equal((rpcCalls[0] as { name: string }).name, "append_evidence_record");

    const second = await svc.linkEventPayload(orgId, eventId, payloadId);
    assert.equal(second.previous_hash, first.chain_hash);
    assert.notEqual(second.chain_hash, first.chain_hash);
    assert.equal(rpcCalls.length, 2);
  });
});
