import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestMiddleware,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { createHash } from "node:crypto";
import { createClient, type RedisClientType } from "redis";

type CounterStore = {
  incr(key: string, windowMs: number): Promise<number>;
};

class MemoryCounterStore implements CounterStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  async incr(key: string, windowMs: number): Promise<number> {
    const now = Date.now();
    const cur = this.buckets.get(key);
    if (!cur || cur.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      // Bound memory growth during sustained traffic with high-cardinality identities.
      if (this.buckets.size > 10_000) {
        for (const [bucketKey, bucket] of this.buckets) {
          if (bucket.resetAt <= now) this.buckets.delete(bucketKey);
        }
      }
      while (this.buckets.size > 50_000) {
        const oldest = this.buckets.keys().next();
        if (oldest.done) break;
        this.buckets.delete(oldest.value);
      }
      return 1;
    }
    cur.count += 1;
    return cur.count;
  }
}

class RedisCounterStore implements CounterStore {
  constructor(private readonly client: RedisClientType) {}

  async incr(key: string, windowMs: number): Promise<number> {
    const multi = this.client.multi();
    multi.incr(key);
    multi.pExpire(key, windowMs, "NX");
    const results = await multi.exec();
    const count = Number(results?.[0] ?? 0);
    return count;
  }
}

/**
 * Distributed-ready rate limiter.
 * - Prefer Redis when RATE_LIMIT_BACKEND=redis or REDIS_URL is set.
 * - Starter / single-instance: in-memory is allowed unless RATE_LIMIT_ALLOW_MEMORY=0.
 * - Set REDIS_URL for multi-instance production.
 */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly log = new Logger(RateLimitMiddleware.name);
  private store: CounterStore | null = null;
  private initError: Error | null = null;
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly backend: "redis" | "memory";

  constructor() {
    this.limit = Number(process.env.RATE_LIMIT_MAX ?? 120);
    this.windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
    if (!Number.isSafeInteger(this.limit) || this.limit < 1 || this.limit > 1_000_000) {
      throw new Error("RATE_LIMIT_MAX must be an integer between 1 and 1000000");
    }
    if (!Number.isSafeInteger(this.windowMs) || this.windowMs < 1000 || this.windowMs > 86_400_000) {
      throw new Error("RATE_LIMIT_WINDOW_MS must be an integer between 1000 and 86400000");
    }
    const requested = (process.env.RATE_LIMIT_BACKEND ?? "").toLowerCase();
    const hasRedis = Boolean(process.env.REDIS_URL?.trim());
    if (requested === "redis" || (!requested && hasRedis)) {
      this.backend = "redis";
    } else {
      this.backend = "memory";
    }
  }

  async ensureStore(): Promise<CounterStore> {
    if (this.store) return this.store;
    if (this.initError) throw this.initError;

    if (this.backend === "redis") {
      const url = process.env.REDIS_URL?.trim();
      if (!url) {
        this.initError = new Error("RATE_LIMIT_BACKEND=redis but REDIS_URL is missing");
        throw this.initError;
      }
      try {
        const client = createClient({ url }) as RedisClientType;
        client.on("error", (err) => this.log.error(`redis error: ${String(err)}`));
        await client.connect();
        this.store = new RedisCounterStore(client);
        this.log.log("rate limit backend=redis");
        return this.store;
      } catch (err) {
        this.initError = err instanceof Error ? err : new Error(String(err));
        throw this.initError;
      }
    }

    if (process.env.NODE_ENV === "production" && process.env.RATE_LIMIT_ALLOW_MEMORY === "0") {
      this.initError = new Error(
        "In-memory rate limiting disabled (RATE_LIMIT_ALLOW_MEMORY=0); set REDIS_URL",
      );
      throw this.initError;
    }
    this.store = new MemoryCounterStore();
    if (process.env.NODE_ENV === "production") {
      this.log.warn(
        "rate limit backend=memory (starter); set REDIS_URL for multi-instance, or RATE_LIMIT_ALLOW_MEMORY=0 to fail-closed without Redis",
      );
    } else {
      this.log.log("rate limit backend=memory");
    }
    return this.store;
  }

  use(req: Request, res: Response, next: NextFunction) {
    // Liveness/readiness must not depend on Redis/memory allow-list configuration.
    // All other routes remain rate-limited and fail-closed when the backend is unavailable.
    // Prefer originalUrl so global prefixes / proxies do not miss the exemption.
    const raw = (req.originalUrl ?? req.url ?? req.path ?? "").split("?")[0] ?? "";
    const path = raw.replace(/\/+$/, "") || "/";
    if (req.method === "GET" && (path === "/v1/health" || path === "/health")) {
      next();
      return;
    }
    void this.apply(req, res, next);
  }

  private async apply(req: Request, res: Response, next: NextFunction) {
    try {
      const store = await this.ensureStore();
      // Hash the complete credential: JWTs often share prefixes, so truncation
      // causes unrelated users to collide into one bucket. Never retain raw tokens.
      const credential = req.headers.authorization?.trim();
      const identity = credential
        ? createHash("sha256").update(credential).digest("hex")
        : req.ip ?? "anon";
      const key = `rl:${identity}:${req.path ?? ""}`;
      const count = await store.incr(key, this.windowMs);
      res.setHeader("X-RateLimit-Limit", String(this.limit));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, this.limit - count)));
      if (count > this.limit) {
        throw new HttpException("Rate limit exceeded", HttpStatus.TOO_MANY_REQUESTS);
      }
      next();
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() === HttpStatus.TOO_MANY_REQUESTS) {
        next(err);
        return;
      }
      this.log.error(`rate limit unavailable: ${String(err)}`);
      next(
        new ServiceUnavailableException(
          "Rate limiting unavailable; refusing request (fail-closed)",
        ),
      );
    }
  }
}

/** Pure helpers for unit tests. */
export function createMemoryCounterStoreForTests(): CounterStore {
  return new MemoryCounterStore();
}
