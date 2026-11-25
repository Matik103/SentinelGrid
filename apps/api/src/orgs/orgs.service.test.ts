import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OrgsService } from "./orgs.service.js";

describe("OrgsService invitation flow", () => {
  it("create invite calls RPC and stubs local_dev email delivery", async () => {
    const rpcCalls: unknown[] = [];
    const logs: string[] = [];
    const sb = {
      rpc: async (name: string, args: unknown) => {
        rpcCalls.push({ name, args });
        return {
          data: {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            organisation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            email: "invitee@example.com",
            role_key: "read_only_viewer",
            role_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            status: "pending",
            token: "tokensecretvalue1234567890",
          },
          error: null,
        };
      },
    };
    const svc = new OrgsService({ create: () => sb } as never);
    svc.requirePermission = async () => undefined;
    // Force local_dev logging path
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    const originalLog = console.log;
    // Logger uses Nest Logger; we just assert RPC + return shape.
    try {
      const out = await svc.invite(
        { id: "user-1", accessToken: "t" } as never,
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        { email: "invitee@example.com", role_key: "read_only_viewer" },
      );
      assert.equal(out.status, "pending");
      assert.equal(out.invitation_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      assert.equal(out.delivery.channel, "local_dev_log");
      assert.ok(out.delivery.token);
      assert.deepEqual(rpcCalls[0], {
        name: "create_organisation_invitation",
        args: {
          p_organisation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          p_email: "invitee@example.com",
          p_role_key: "read_only_viewer",
        },
      });
    } finally {
      process.env.NODE_ENV = prev;
      console.log = originalLog;
      void logs;
    }
  });

  it("accept invite calls accept RPC", async () => {
    const rpcCalls: unknown[] = [];
    const sb = {
      rpc: async (name: string, args: unknown) => {
        rpcCalls.push({ name, args });
        return {
          data: {
            invitation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            organisation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            membership_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            role_key: "read_only_viewer",
            status: "accepted",
          },
          error: null,
        };
      },
    };
    const svc = new OrgsService({ create: () => sb } as never);
    // bypass requirePermission by not calling invite
    const out = await svc.acceptInvite({ id: "u", accessToken: "t" } as never, {
      token: "tokensecretvalue1234567890",
    });
    assert.equal((out as { status: string }).status, "accepted");
    assert.equal((rpcCalls[0] as { name: string }).name, "accept_organisation_invitation");
  });

  it("revoke invite enforces org permission then RPC", async () => {
    const calls: unknown[] = [];
    const sb = {
      rpc: async (name: string, args: unknown) => {
        calls.push({ name, args });
        return {
          data: {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            organisation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            status: "revoked",
          },
          error: null,
        };
      },
    };
    const svc = new OrgsService({ create: () => sb } as never);
    svc.requirePermission = async (...args: unknown[]) => {
      calls.push(["perm", ...args]);
    };
    const out = await svc.revokeInvite(
      { id: "u", accessToken: "t" } as never,
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    assert.equal((out as { status: string }).status, "revoked");
    assert.equal((calls[0] as unknown[])[0], "perm");
    assert.equal((calls[1] as { name: string }).name, "revoke_organisation_invitation");
  });
});
