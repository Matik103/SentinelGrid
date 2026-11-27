import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryCounterStoreForTests } from "./rate-limit.middleware.js";

describe("MemoryCounterStore", () => {
  it("increments within window", async () => {
    const store = createMemoryCounterStoreForTests();
    assert.equal(await store.incr("a", 60_000), 1);
    assert.equal(await store.incr("a", 60_000), 2);
    assert.equal(await store.incr("b", 60_000), 1);
  });
});

describe("production fail-closed policy", () => {
  it("documents starter memory allow with explicit opt-out RATE_LIMIT_ALLOW_MEMORY=0", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "rate-limit.middleware.ts"), "utf8");
    assert.match(source, /RATE_LIMIT_ALLOW_MEMORY === "0"/);
    assert.match(source, /set REDIS_URL for multi-instance/);
  });

  it("skips rate limiting for GET /v1/health in middleware source", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "rate-limit.middleware.ts"), "utf8");
    assert.match(source, /path === "\/v1\/health"/);
    assert.match(source, /Liveness\/readiness must not depend/);
  });
});
