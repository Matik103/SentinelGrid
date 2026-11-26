# Sentinel Command deployment and API configuration

## Vercel frontend

The Vercel project `sentinelgrid` is connected to repository `Matik103/SentinelGrid`. The verified preview deployment was built from `work/sentinel-command-release-v2`; keep this as the shared deployment branch unless the project settings are deliberately changed.

The repository-root `vercel.json` builds the Vite workspace app:
- Install: `npm ci`
- Build: `npm run build -w @sentinelgrid/web`
- Output: `apps/web/dist`

Do not set Root Directory to a Git branch name. Leave it blank for the root config, or use the actual folder `apps/web` with its matching nested Vercel config.

## API URL configuration

The browser needs the public HTTPS origin of the separately deployed NestJS API. It calls endpoints under `/v1`, including `/v1/health`.

Configuration precedence:
1. Vercel project environment variable `VITE_API_BASE_URL` (build-time override).
2. Supabase `public.app_public_config`, row `key = 'api_base_url'`, JSON value `{"url":"https://YOUR-API-HOST"}`.

The Vercel project was inspected on 2026-11-26 and had no configured environment variables. The Supabase migration seeds `api_base_url` with an empty URL. This explains the visible configuration error. Neither source contains a valid deployed API origin yet.

Once the API is deployed, choose one configuration source. Recommended for this deployment: set the Supabase row to the real API origin. Example SQL (replace the placeholder; never run it unchanged):

```sql
UPDATE public.app_public_config
SET value = jsonb_build_object('url', 'https://YOUR-REAL-API-HOST'),
    updated_at = now()
WHERE key = 'api_base_url';
```

If the row does not exist, insert it rather than assuming the migration will update it. The migration uses `ON CONFLICT DO NOTHING`, so reapplying it does not fill an existing empty value.

Alternatively set `VITE_API_BASE_URL` in Vercel for Preview and Production as appropriate, then trigger a new deployment. It is a public build-time value. Never put `SUPABASE_SERVICE_ROLE_KEY`, database passwords, or other server secrets in any `VITE_` variable.

## Backend deployment requirements / Cursor handoff

The API is a separate NestJS service in `apps/api`; Vercel's current build only builds the web workspace. Deploy the API to the chosen backend host and provide a stable HTTPS origin before configuring the frontend.

Required API environment:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-side only)
- `PORT` (host-provided port)
- `NODE_ENV=production`

Optional features have additional environment requirements documented in their service implementations (Redis rate limiting, object storage, email transport). Do not mark the backend ready until each required feature has either valid configuration or an explicitly accepted disabled/degraded mode.

Deployment acceptance:
1. Build with `npm run build -w @sentinelgrid/api`.
2. Run tests with `npm test -w @sentinelgrid/api`.
3. Start the service with `npm run start -w @sentinelgrid/api`.
4. Verify public `GET /v1/health` returns HTTP 200 and the expected build SHA.
5. Verify CORS permits the SentinelGrid Vercel origin.
6. Verify authenticated API calls, AAL2 enforcement, tenant scoping and RLS against the hosted Supabase project.
7. Configure the frontend API URL only after the health check passes.

## Frontend diagnostics

The shared browser bootstrap validates the URL and preserves the actual reason configuration could not be loaded. Pages using `apiGet`, `apiPost`, or `apiPatch` share this diagnostic, so the same missing URL is not reported as a separate page-specific failure.
