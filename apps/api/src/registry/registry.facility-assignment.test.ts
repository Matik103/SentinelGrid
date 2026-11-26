import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RegistryService } from "./registry.service.js";

const org = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const facility = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const member = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const user = { id: userId, accessToken: "tok" } as { id: string; accessToken: string } as never;

describe("RegistryService facility assignments", () => {
  it("assignFacility requires user.manage and upserts assignment", async () => {
    const perms: unknown[] = [];
    const calls: unknown[] = [];
    const sb = {
      from: (table: string) => {
        assert.equal(table, "facility_user_assignments");
        return {
          upsert: (row: unknown, opts: unknown) => {
            calls.push(["upsert", row, opts]);
            return {
              select: () => ({
                single: async () => ({
                  data: {
                    organisation_id: org,
                    facility_id: facility,
                    user_id: member,
                    assigned_by: userId,
                    created_at: new Date().toISOString(),
                  },
                  error: null,
                }),
              }),
            };
          },
        };
      },
    };
    const svc = new RegistryService(
      {
        requirePermission: async (...args: unknown[]) => {
          perms.push(args);
        },
      } as never,
      { create: () => sb } as never,
    );
    const out = await svc.assignFacility(user, org, { facility_id: facility, user_id: member });
    assert.equal(out.facility_id, facility);
    assert.deepEqual(perms[0], [user, org, "user.manage"]);
    assert.equal((calls[0] as unknown[])[0], "upsert");
  });

  it("unassignFacility scopes delete to organisation/facility/user", async () => {
    const eqs: unknown[] = [];
    const sb = {
      from: () => ({
        delete: () => ({
          eq: (col: string, val: unknown) => {
            eqs.push([col, val]);
            return {
              eq: (col2: string, val2: unknown) => {
                eqs.push([col2, val2]);
                return {
                  eq: (col3: string, val3: unknown) => {
                    eqs.push([col3, val3]);
                    return {
                      select: () => ({
                        maybeSingle: async () => ({
                          data: { organisation_id: org, facility_id: facility, user_id: member },
                          error: null,
                        }),
                      }),
                    };
                  },
                };
              },
            };
          },
        }),
      }),
    };
    const svc = new RegistryService(
      { requirePermission: async () => undefined } as never,
      { create: () => sb } as never,
    );
    const out = await svc.unassignFacility(user, org, facility, member);
    assert.equal(out.user_id, member);
    assert.deepEqual(eqs, [
      ["organisation_id", org],
      ["facility_id", facility],
      ["user_id", member],
    ]);
  });
});
