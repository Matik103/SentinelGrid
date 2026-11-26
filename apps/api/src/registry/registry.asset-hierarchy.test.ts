import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RegistryService } from "./registry.service.js";

const organisationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const facilityId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const parentId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const user = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", accessToken: "token" } as never;

describe("RegistryService asset hierarchy", () => {
  it("rejects a parent outside the organisation/facility before inserting", async () => {
    const calls: string[] = [];
    const sb = {
      from: (table: string) => {
        calls.push(`from:${table}`);
        return {
          select: () => ({
            eq: (column: string, value: string) => {
              calls.push(`eq:${column}:${value}`);
              return {
                eq: (column2: string, value2: string) => {
                  calls.push(`eq:${column2}:${value2}`);
                  return { maybeSingle: async () => ({ data: null, error: null }) };
                },
              };
            },
          }),
          insert: () => { calls.push("insert"); throw new Error("insert must not run"); },
        };
      },
    };
    const service = new RegistryService(
      { requirePermission: async () => undefined } as never,
      { create: () => sb } as never,
    );
    await assert.rejects(
      service.createAsset(user, organisationId, {
        facility_id: facilityId, parent_asset_id: parentId, name: "Chiller", criticality: "high",
      }),
      /same organisation and facility/i,
    );
    assert.equal(calls.includes("insert"), false);
    assert.ok(calls.includes(`eq:organisation_id:${organisationId}`));
    assert.ok(calls.includes(`eq:facility_id:${facilityId}`));
  });

  it("persists a verified same-facility parent and criticality", async () => {
    let inserted: Record<string, unknown> | undefined;
    const sb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: parentId }, error: null }),
            }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          inserted = row;
          return {
            select: () => ({
              single: async () => ({ data: { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", ...row }, error: null }),
            }),
          };
        },
      }),
    };
    const service = new RegistryService(
      { requirePermission: async () => undefined } as never,
      { create: () => sb } as never,
    );
    const result = await service.createAsset(user, organisationId, {
      facility_id: facilityId, parent_asset_id: parentId, name: "Cooling pump", criticality: "critical",
    });
    assert.equal(inserted?.parent_asset_id, parentId);
    assert.equal(inserted?.criticality, "critical");
    assert.equal(inserted?.organisation_id, organisationId);
    assert.equal(result.parent_asset_id, parentId);
  });
});
