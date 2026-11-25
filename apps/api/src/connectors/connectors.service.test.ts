import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { ConnectorsService } from "./connectors.service.js";

function hash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

describe("ConnectorsService credential lifecycle", () => {
  it("register stores only a hash and returns one-time token", async () => {
    const inserted: { current: Record<string, unknown> | null } = { current: null };
    const userSb = {
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          inserted.current = row;
          return {
            select: () => ({
              single: async () => ({
                data: {
                  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                  name: row.name,
                  connector_uid: row.connector_uid,
                  status: "registered",
                  version: null,
                  protocols: [],
                  credential_status: "issued",
                  created_at: new Date().toISOString(),
                },
                error: null,
              }),
            }),
          };
        },
      }),
    };
    const adminInserts: unknown[] = [];
    const admin = {
      client: {
        from: () => ({
          insert: async (row: unknown) => {
            adminInserts.push(row);
            return { error: null };
          },
        }),
      },
    };
    const svc = new ConnectorsService(
      { requirePermission: async () => undefined } as never,
      { create: () => userSb } as never,
      admin as never,
    );
    const out = await svc.register(
      { id: "u1", accessToken: "t" } as never,
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      { name: "edge-1" },
    );
    assert.equal(out.credential.status, "issued");
    assert.ok(out.credential.token?.startsWith("sgc_"));
    assert.equal(out.credential.token_hash, hash(out.credential.token));
    assert.equal(inserted.current?.credential_token_hash, out.credential.token_hash);
    assert.equal(inserted.current?.credential_status, "issued");
    assert.ok(!JSON.stringify(inserted.current).includes(out.credential.token));
  });

  it("authorizeConnectorToken accepts matching token and rejects wrong/revoked", async () => {
    const token = "sgc_testdeadbeef";
    const tokenHash = hash(token);
    let row: Record<string, unknown> = {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      credential_status: "issued",
      credential_token_hash: tokenHash,
      status: "active",
    };
    const admin = {
      client: {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: row, error: null }),
              }),
            }),
          }),
        }),
      },
    };
    const svc = new ConnectorsService(
      { requirePermission: async () => undefined } as never,
      { create: () => ({}) } as never,
      admin as never,
    );
    assert.equal(
      await svc.authorizeConnectorToken(
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        token,
      ),
      true,
    );
    assert.equal(
      await svc.authorizeConnectorToken(
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        "sgc_wrong",
      ),
      false,
    );
    row = { ...row, credential_status: "revoked", status: "revoked" };
    assert.equal(
      await svc.authorizeConnectorToken(
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        token,
      ),
      false,
    );
  });
});
