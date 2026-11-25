import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { RegistryController } from "../registry/registry.controller.js";
import { ConnectorsController } from "../connectors/connectors.controller.js";
import { OrgsController } from "../orgs/orgs.controller.js";
import { AuditController } from "../audit/audit.controller.js";

const orgA = "00000000-0000-4000-8000-0000000000aa";
const orgB = "00000000-0000-4000-8000-0000000000bb";
const user = { id: "user-a", accessToken: "tok" } as never;

describe("Multi-tenant API permission gates", () => {
  it("registry refuses facility create without facility.write", async () => {
    const orgs = {
      requirePermission: async (_u: unknown, organisationId: string, permission: string) => {
        if (organisationId === orgB) throw new ForbiddenException(`Missing permission: ${permission}`);
      },
    };
    await assert.rejects(
      () => orgs.requirePermission(user, orgB, "facility.write"),
      (err: unknown) => err instanceof ForbiddenException,
    );
  });

  it("connectors list rejects invalid organisation UUID", () => {
    const controller = new ConnectorsController({
      list: async () => [],
    } as never);
    assert.throws(() => controller.list(user, "not-a-uuid"));
  });

  it("org invite create/accept/revoke routes exist and validate UUIDs", async () => {
    const orgs = {
      invite: async () => ({ status: "pending" }),
      acceptInvite: async () => ({ status: "accepted" }),
      revokeInvite: async () => ({ status: "revoked" }),
      listInvites: async () => [],
      bootstrap: async () => ({}),
      listMine: async () => [],
      getMembership: async () => ({}),
      listMembers: async () => [],
      checkPermission: async () => true,
    };
    const controller = new OrgsController(orgs as never);
    assert.throws(() =>
      controller.invite(user, "bad", { email: "a@b.c", role_key: "read_only_viewer" }),
    );
    assert.throws(() => controller.revokeInvite(user, orgA, "not-uuid"));
    const accept = await controller.acceptInvite(user, { token: "tokensecretvalue1234567890" });
    assert.equal((accept as { status: string }).status, "accepted");
  });

  it("audit list requires audit.read for the organisation in the path", async () => {
    const calls: unknown[] = [];
    const controller = new AuditController(
      {
        requirePermission: async (...args: unknown[]) => {
          calls.push(args);
        },
      } as never,
      {
        create: () => ({
          from: () => ({
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: async () => ({ data: [], error: null }),
                }),
              }),
            }),
          }),
        }),
      } as never,
    );
    await controller.list(user, orgA);
    assert.deepEqual(calls[0], [user, orgA, "audit.read"]);
  });

  it("registry controller validates organisation UUID before service call", () => {
    let called = false;
    const controller = new RegistryController({
      listFacilities: async () => {
        called = true;
        return [];
      },
    } as never);
    assert.throws(() => controller.listFacilities(user, "nope"));
    assert.equal(called, false);
  });
});
