import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OrgsService } from "./orgs.service.js";

describe("OrgsService invitation flow", () => {
  it("create invite expires stale invites, calls RPC, and enqueues outbox", async () => {
    const rpcCalls: unknown[] = [];
    const sb = {
      rpc: async (name: string, args: unknown) => {
        rpcCalls.push({ name, args });
        if (name === "expire_organisation_invitations") {
          return { data: { expired_count: 0 }, error: null };
        }
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
    const outbox = {
      enqueue: async (input: { toEmail: string; templateKey: string }) => ({
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        organisation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        template_key: input.templateKey,
        to_email: input.toEmail,
        subject: "SentinelGrid organisation invitation",
        body_text: "body",
        status: "sent",
      }),
    };
    const admin = {
      client: {
        from: (table: string) => {
          if (table === "profiles") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            };
          }
          return { select: () => ({ in: async () => ({ data: [], error: null }) }) };
        },
      },
    };
    const svc = new OrgsService({ create: () => sb } as never, admin as never, outbox as never);
    svc.requirePermission = async () => undefined;
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    try {
      const out = await svc.invite(
        { id: "user-1", accessToken: "t" } as never,
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        { email: "invitee@example.com", role_key: "read_only_viewer" },
      );
      assert.equal(out.status, "pending");
      assert.equal(out.invitation_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      assert.equal(out.delivery.channel, "outbox");
      assert.equal(out.delivery.outbox_id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
      assert.ok(out.delivery.token);
      assert.equal((rpcCalls[0] as { name: string }).name, "expire_organisation_invitations");
      assert.equal((rpcCalls[1] as { name: string }).name, "create_organisation_invitation");
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it("revokeMember purges auth user when no active memberships remain", async () => {
    const deleteCalls: string[] = [];
    const nullUpdates: string[] = [];
    const sb = {
      rpc: async (name: string) => {
        assert.equal(name, "revoke_organisation_member");
        return { data: { status: "revoked", user_id: "member-1" }, error: null };
      },
    };
    const admin = {
      client: {
        from: (table: string) => {
          if (table === "memberships") {
            return {
              select: () => ({
                eq: () => ({
                  eq: async () => ({ count: 0, error: null }),
                }),
              }),
              delete: () => ({
                eq: () => ({
                  neq: async () => ({ error: null }),
                }),
              }),
              update: (row: Record<string, unknown>) => ({
                eq: async () => {
                  nullUpdates.push(`memberships.${Object.keys(row)[0]}`);
                  return { error: null };
                },
              }),
            };
          }
          return {
            update: (row: Record<string, unknown>) => ({
              eq: async () => {
                nullUpdates.push(`${table}.${Object.keys(row)[0]}`);
                return { error: null };
              },
            }),
          };
        },
        auth: {
          admin: {
            deleteUser: async (id: string) => {
              deleteCalls.push(id);
              return { data: { user: null }, error: null };
            },
          },
        },
      },
    };
    const svc = new OrgsService({ create: () => sb } as never, admin as never, { enqueue: async () => ({}) } as never);
    svc.requirePermission = async () => undefined;
    const out = await svc.revokeMember(
      { id: "admin", accessToken: "t" } as never,
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "member-1",
    );
    assert.equal((out as { auth_account_purged: boolean }).auth_account_purged, true);
    assert.deepEqual(deleteCalls, ["member-1"]);
    assert.ok(nullUpdates.includes("organisation_invitations.accepted_by"));
  });

  it("revokeMember keeps auth user when another active membership exists", async () => {
    const deleteCalls: string[] = [];
    const sb = {
      rpc: async () => ({ data: { status: "revoked" }, error: null }),
    };
    const admin = {
      client: {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: async () => ({ count: 1, error: null }),
            }),
          }),
        }),
        auth: {
          admin: {
            deleteUser: async (id: string) => {
              deleteCalls.push(id);
              return { data: null, error: null };
            },
          },
        },
      },
    };
    const svc = new OrgsService({ create: () => sb } as never, admin as never, { enqueue: async () => ({}) } as never);
    svc.requirePermission = async () => undefined;
    const out = await svc.revokeMember(
      { id: "admin", accessToken: "t" } as never,
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "member-1",
    );
    assert.equal((out as { auth_account_purged: boolean }).auth_account_purged, false);
    assert.deepEqual(deleteCalls, []);
  });

  it("accept invite expires-by-token then calls accept RPC", async () => {
    const rpcCalls: unknown[] = [];
    const sb = {
      rpc: async (name: string, args: unknown) => {
        rpcCalls.push({ name, args });
        if (name === "expire_organisation_invitation_by_token") {
          return { data: { status: "pending" }, error: null };
        }
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
    const svc = new OrgsService({ create: () => sb } as never, { client: {} } as never, { enqueue: async () => ({}) } as never);
    const out = await svc.acceptInvite({ id: "u", accessToken: "t" } as never, {
      token: "tokensecretvalue1234567890",
    });
    assert.equal((out as { status: string }).status, "accepted");
    assert.equal((rpcCalls[0] as { name: string }).name, "expire_organisation_invitation_by_token");
    assert.equal((rpcCalls[1] as { name: string }).name, "accept_organisation_invitation");
  });

  it("revoke invite scopes mutation to organisation", async () => {
    const calls: unknown[] = [];
    const sb = {
      from: () => ({
        update: (row: unknown) => {
          calls.push(["update", row]);
          return {
            eq: (col: string, val: unknown) => {
              calls.push(["eq", col, val]);
              return {
                eq: (col2: string, val2: unknown) => {
                  calls.push(["eq", col2, val2]);
                  return {
                    eq: (col3: string, val3: unknown) => {
                      calls.push(["eq", col3, val3]);
                      return {
                        select: () => ({
                          maybeSingle: async () => ({
                            data: {
                              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                              organisation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                              status: "revoked",
                              revoked_at: new Date().toISOString(),
                            },
                            error: null,
                          }),
                        }),
                      };
                    },
                  };
                },
              };
            },
          };
        },
      }),
    };
    const admin = {
      client: {
        from: (table: string) => {
          if (table === "profiles") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            };
          }
          return {};
        },
      },
    };
    const svc = new OrgsService({ create: () => sb } as never, admin as never, { enqueue: async () => ({}) } as never);
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
    assert.equal((calls[1] as unknown[])[0], "update");
  });
});
