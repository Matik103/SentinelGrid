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
    const admin = { client: { from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }) } };
    const svc = new OrgsService({ create: () => sb } as never, admin as never, outbox as never);
    svc.requirePermission = async () => undefined;
    const prev = process.env.NODE_ENV;
    const prevTransport = process.env.SG_EMAIL_TRANSPORT;
    process.env.NODE_ENV = "test";
    delete process.env.SG_EMAIL_TRANSPORT;
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
      if (prevTransport === undefined) delete process.env.SG_EMAIL_TRANSPORT;
      else process.env.SG_EMAIL_TRANSPORT = prevTransport;
    }
  });

  it("reports outbox_pending when Resend transport is configured", async () => {
    const sb = {
      rpc: async (name: string) => {
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
      enqueue: async () => ({
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        organisation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        template_key: "organisation.invite",
        to_email: "invitee@example.com",
        subject: "SentinelGrid organisation invitation",
        body_text: "body",
        status: "pending",
      }),
    };
    const svc = new OrgsService({ create: () => sb } as never, outbox as never);
    svc.requirePermission = async () => undefined;
    const prev = process.env.NODE_ENV;
    const prevTransport = process.env.SG_EMAIL_TRANSPORT;
    process.env.NODE_ENV = "production";
    process.env.SG_EMAIL_TRANSPORT = "resend";
    try {
      const out = await svc.invite(
        { id: "user-1", accessToken: "t" } as never,
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        { email: "invitee@example.com", role_key: "read_only_viewer" },
      );
      assert.equal(out.delivery.channel, "outbox_pending");
      assert.equal(out.delivery.status, "pending");
    } finally {
      process.env.NODE_ENV = prev;
      if (prevTransport === undefined) delete process.env.SG_EMAIL_TRANSPORT;
      else process.env.SG_EMAIL_TRANSPORT = prevTransport;
    }
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
    const svc = new OrgsService({ create: () => sb } as never, { client: {} } as never, { enqueue: async () => ({}) } as never);
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
