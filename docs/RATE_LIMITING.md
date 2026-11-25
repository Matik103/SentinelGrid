# API rate limiting

The NestJS API applies distributed-ready rate limiting on all `/v1/*` routes.

## Backends

| `RATE_LIMIT_BACKEND` | Behaviour |
|---|---|
| `redis` (or unset when `REDIS_URL` is present) | Redis `INCR` + `PEXPIRE` sliding fixed window |
| `memory` / default without Redis | In-process counters |

## Production fail-closed

When `NODE_ENV=production` and the backend is memory, the API **refuses requests** unless `RATE_LIMIT_ALLOW_MEMORY=1` is explicitly set. Prefer Redis in staging/production.

## Tunables

- `RATE_LIMIT_MAX` — default `120`
- `RATE_LIMIT_WINDOW_MS` — default `60000`
- `REDIS_URL` — required for redis backend

Misconfigured Redis (missing URL or connection failure) fails closed with HTTP 503.
