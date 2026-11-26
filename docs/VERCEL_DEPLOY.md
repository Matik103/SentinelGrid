# Vercel deploy (Sentinel Command)

## Live production target

Project: `sentinelgrid-delta` (`https://sentinelgrid-delta.vercel.app/`)

| Setting | Value |
| --- | --- |
| **Production Branch** | `main` (verified live: serves `apps/web` with `/assets/sentinelgrid-mark.svg` before logo-pair update) |
| **Root Directory** | **blank** (preferred; root `vercel.json`) **or** `apps/web` |

Do **not** put a branch name in Root Directory.

## Preferred: blank Root Directory + root `vercel.json`

- `installCommand`: `npm ci`
- `buildCommand`: `npm run build -w @sentinelgrid/web`
- `outputDirectory`: `apps/web/dist`
- SPA rewrite → `/index.html`

## Brand assets

- Mark (compact/favicon): `apps/web/public/assets/sentinelgrid-logo-mark.png` + `/favicon.png`
- Wordmark (hero/auth/og): `apps/web/public/assets/sentinelgrid-logo-wordmark.png`

## Config loading (DB-backed)

1. Public bootstrap in `apps/web/src/bootstrap.ts` (Supabase URL + anon key).
2. SPA reads `app_public_config` for `api_base_url` / `command_title`.
3. Optional local override: `VITE_API_BASE_URL`.

No Vercel backend env vars required for the SPA. Never put `SUPABASE_SERVICE_ROLE_KEY` in Vercel.

## Redeploy

Push to `main`, or Vercel → Deployments → Redeploy from `main`.
