# Vercel deploy (Sentinel Command)

## Why `/` was `NOT_FOUND`

`main` only contains docs/supabase scaffolding — **no `apps/web`**. The Vercel project `sentinelgrid-delta` returns `x-vercel-error: NOT_FOUND` when it deploys an empty tree or a branch without a built SPA.

## Required project settings (dashboard)

1. **Git branch for Production:** `work/phase0-security-hardening` (do **not** require a main merge for Command UI).
2. **Root Directory:** repository root (uses root `vercel.json`) **or** `apps/web` (uses `apps/web/vercel.json`).
3. **Framework:** Vite (auto from `vercel.json`).
4. **Build:** `npm run build -w @sentinelgrid/web` → output `apps/web/dist`.

No Vercel **backend** env vars are required for the SPA. Do not put `SUPABASE_SERVICE_ROLE_KEY` in Vercel.

## Config loading (DB-backed)

1. **Irreducible public bootstrap** (baked into `apps/web/src/bootstrap.ts`):
   - `PUBLIC_SUPABASE_URL` = `https://abaeizgfsskvjklfslrh.supabase.co`
   - `PUBLIC_SUPABASE_ANON_KEY` = project anon JWT (public-by-design; RLS enforces access)
2. SPA then `GET /rest/v1/app_public_config` and reads non-secret keys (`api_base_url`, `command_title`).
3. Optional local override only: `VITE_API_BASE_URL`.

## Redeploy

Push to `work/phase0-security-hardening` triggers Git-connected Vercel if Production Branch is that branch. Otherwise: Vercel → Deployments → Redeploy latest from that branch.
