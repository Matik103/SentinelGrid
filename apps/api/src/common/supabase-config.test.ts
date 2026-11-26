import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { SupabaseAdminService } from "./supabase-admin.service.js";
import { SupabaseUserFactory } from "./supabase-user.factory.js";

const keys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY"] as const;
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
after(() => {
  for (const key of keys) {
    const value = previous[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Supabase credential configuration", () => {
  it("does not create an admin client with placeholder credentials", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.throws(() => new SupabaseAdminService(), /required for the API/);
  });

  it("does not create a user client with placeholder credentials", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    assert.throws(() => new SupabaseUserFactory().create("test-access-token"), /required for user-scoped database access/);
  });
});
