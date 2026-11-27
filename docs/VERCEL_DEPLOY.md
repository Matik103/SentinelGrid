# Sentinel Command deployment and API configuration

## Vercel frontend

Project: `sentinelgrid-delta` (`https://sentinelgrid-delta.vercel.app/`)

| Setting | Value |
| --- | --- |
| **Production Branch** | `main` (verified live: brand assets + Command SPA) |
| **Root Directory** | **blank** (preferred; root `vercel.json`) **or** `apps/web` |

Do **not** put a branch name in Root Directory. `work/sentinel-command-release-v2` is a parallel integration branch; keep Production on `main` unless project settings are deliberately changed.

Root `vercel.json` builds the Vite workspace app:
- Install: `npm ci`
- Build: `npm run build -w @sentinelgrid/web`
- Output: `apps/web/dist`

## API URL configuration

The browser needs the public HTTPS origin of the separately deployed NestJS API (`/v1`, including `/v1/health`).

Configuration precedence:
1. Vercel project environment variable `VITE_API_BASE_URL` (build-time override).
2. Supabase `public.app_public_config`, row `key = 'api_base_url'`, JSON value `{"url":"https://YOUR-API-HOST"}`.

As of 2026-11-26 the Supabase row still has an empty URL and Vercel has no `VITE_API_BASE_URL`. That is why Command shows a configuration error until the Nest API is deployed and wired.

Once the API is live, set the Supabase row (recommended):

```sql
UPDATE public.app_public_config
SET value = jsonb_build_object('url', 'https://YOUR-REAL-API-HOST'),
    updated_at = now()
WHERE key = 'api_base_url';
```

Never put `SUPABASE_SERVICE_ROLE_KEY` or other server secrets in any `VITE_` variable.

## Backend deployment requirements

The API is a separate NestJS service in `apps/api`; Vercel only builds the web workspace.

Required API environment:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-side only)
- `PORT` (host-provided)
- `NODE_ENV=production`
- CORS allowlist including `https://www.sentinelgrid.tech`, `https://sentinelgrid.tech`, and `https://sentinelgrid-delta.vercel.app`
- `SG_PUBLIC_APP_URL` (invitation accept links; defaults to the Vercel production origin)

Email (Resend):
- **Preferred:** Supabase Edge Function `email-outbox-worker` using Edge secrets `RESEND_API_KEY` + `SG_EMAIL_FROM` on project `abaeizgfsskvjklfslrh` (see `edge/connector/README.md`).
- **Optional Nest host** (Render/`render.yaml`): `SG_EMAIL_TRANSPORT=resend`, `SG_EMAIL_WORKER_ENABLED=true`, plus host secrets `RESEND_API_KEY` / `SG_EMAIL_FROM`. Never put these in Vercel `VITE_` vars.

`GET /v1/health` reports `monitoring.email_transport`, `email_worker_enabled`, and `email_resend_configured` (boolean only; no secret values).

Acceptance:
1. `npm run build -w @sentinelgrid/api`
2. `npm test -w @sentinelgrid/api`
3. `GET /v1/health` → 200
4. AAL2 MFA guard + tenant RLS verified against hosted Supabase
5. Configure `api_base_url` only after health passes
6. With Resend secrets present, enqueue an invite/outbox row and confirm Resend accepts delivery

## Brand assets

- Mark: `apps/web/public/assets/sentinelgrid-logo-mark.png` + `/favicon.png`
- Wordmark: `apps/web/public/assets/sentinelgrid-logo-wordmark.png`

## Redeploy

Push to `main`, or Vercel → Deployments → Redeploy from `main`.

## Cloudflare console noise (www)

`www.sentinelgrid.tech` sits behind Cloudflare. Browser console lines about:

- `static.cloudflareinsights.com/beacon.min.js` CORS / Subresource Integrity mismatches
- `__cf_bm` cookie rejected for invalid domain (often while loading Supabase Storage images)

are **not** application bugs. The Vite app does not load Cloudflare Insights. Those scripts/cookies are injected or set by the Cloudflare zone (Web Analytics / bot management) or by Cloudflare in front of Supabase.

Do **not** weaken app CORS or CSP to hide them. In the Cloudflare dashboard for `sentinelgrid.tech`:

1. Disable **Web Analytics** (or remove the Insights beacon) if the SRI/CORS beacon errors appear.
2. Leave Bot Fight / Bot Management as needed for the zone; `__cf_bm` domain warnings on third-party hosts are expected browser noise and are safe to ignore.

A missing hashed `/assets/index-*.js` returning Vercel `NOT_FOUND` as `text/plain` is a separate stale-deploy issue — hard-refresh after Production promotes `main`.
