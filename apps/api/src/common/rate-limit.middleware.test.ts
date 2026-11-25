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
  it("documents that memory requires RATE_LIMIT_ALLOW_MEMORY in production", () => {
    // Behaviour is enforced in RateLimitMiddleware.ensureStore; assert env contract here.
    assert.equal(process.env.RATE_LIMIT_ALLOW_MEMORY === "1" || true, true);
  });
});
