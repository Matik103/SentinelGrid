import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { EvidenceChainService } from "./evidence-chain.service.js";

describe("EvidenceChainService", () => {
  it("links event to payload and chains hashes", async () => {
    const inserts: Record<string, unknown>[] = [];
    let tip: string | null = null;
    const admin = {
      client: {
        from: (table: string) => {
          if (table === "payload_objects") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: {
                        id: "11111111-1111-4111-8111-111111111111",
                        object_key: "org/day/x.json",
                        content_sha256: createHash("sha256").update("payload").digest("hex"),
                        organisation_id: "22222222-2222-4222-8222-222222222222",
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "events") {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: {
                        id: "33333333-3333-4333-8333-333333333333",
                        organisation_id: "22222222-2222-4222-8222-222222222222",
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
              update: () => ({
                eq: () => ({
                  eq: async () => ({ error: null }),
                }),
              }),
            };
          }
          if (table === "evidence_records") {
            return {
              select: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: tip ? { chain_hash: tip } : null,
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
              insert: (row: Record<string, unknown>) => {
                inserts.push(row);
                tip = row.chain_hash as string;
                return {
                  select: () => ({
                    single: async () => ({
                      data: {
                        id: "44444444-4444-4444-8444-444444444444",
                        event_id: row.event_id,
                        payload_sha256: row.payload_sha256,
                        previous_hash: row.previous_hash,
                        chain_hash: row.chain_hash,
                      },
                      error: null,
                    }),
                  }),
                };
              },
            };
          }
          throw new Error(`unexpected table ${table}`);
        },
      },
    };

    const svc = new EvidenceChainService(
      admin as never,
      {} as never,
      { requirePermission: async () => undefined } as never,
      { create: () => ({}) } as never,
    );

    const first = await svc.linkEventPayload(
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "11111111-1111-4111-8111-111111111111",
    );
    assert.equal(first.previous_hash, null);
    assert.equal(first.chain_hash.length, 64);
    assert.equal(inserts.length, 1);

    const second = await svc.linkEventPayload(
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "11111111-1111-4111-8111-111111111111",
    );
    assert.equal(second.previous_hash, first.chain_hash);
    assert.notEqual(second.chain_hash, first.chain_hash);
  });
});
