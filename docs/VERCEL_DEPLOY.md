# Vercel deploy (Sentinel Command)

## Why `/` was `NOT_FOUND`

`main` only contains docs/supabase scaffolding — **no `apps/web`**. The Vercel project `sentinelgrid-delta` returns `x-vercel-error: NOT_FOUND` when it deploys an empty tree or a branch without a built SPA.

## Two different fields (do not mix them up)

| Setting | What it is | Correct value | Wrong value |
| --- | --- | --- | --- |
| **Production Branch** | Git **branch** name | `work/phase0-security-hardening` | anything else if you want Command UI without merging to `main` |
| **Root Directory** | Folder **inside the repo** for the build | **leave blank** (preferred) **or** `apps/web` | **never** put a branch name here |

### Common mistake (screenshot failure)

> Root Directory "`work/phase0-security-hardening`" does not exist.

That string is the **branch**, not a folder. There is no `work/phase0-security-hardening/` directory in the repo. Clear Root Directory (or set it to `apps/web` only).

## Preferred: blank Root Directory + root `vercel.json`

Leave **Root Directory empty**. Root [`vercel.json`](../vercel.json) already forces the monorepo SPA build:

- `installCommand`: `npm ci` (repo root workspaces)
- `buildCommand`: `npm run build -w @sentinelgrid/web`
- `outputDirectory`: `apps/web/dist`
- SPA rewrite → `/index.html`

No dashboard Root Directory override is required.

## Alternate: Root Directory = `apps/web`

Only if you insist on a non-empty Root Directory, set it to the path **`apps/web`** (folder), never the branch name. That path uses [`apps/web/vercel.json`](../apps/web/vercel.json), which `cd`s up to the repo root for `npm ci` / workspace build, then emits `dist`.

## Other dashboard settings

1. **Production Branch:** `work/phase0-security-hardening` (do **not** require a main merge for Command UI).
2. **Framework:** Vite (from `vercel.json`).
3. No Vercel **backend** env vars are required for the SPA. Do not put `SUPABASE_SERVICE_ROLE_KEY` in Vercel.

## Config loading (DB-backed)

1. **Irreducible public bootstrap** (baked into `apps/web/src/bootstrap.ts`):
   - `PUBLIC_SUPABASE_URL` = `https://abaeizgfsskvjklfslrh.supabase.co`
   - `PUBLIC_SUPABASE_ANON_KEY` = project anon JWT (public-by-design; RLS enforces access)
2. SPA then `GET /rest/v1/app_public_config` and reads non-secret keys (`api_base_url`, `command_title`).
3. Optional local override only: `VITE_API_BASE_URL`.

## Redeploy

1. Clear Root Directory (or set `apps/web`).
2. Set Production Branch to `work/phase0-security-hardening`.
3. Push to that branch, or Vercel → Deployments → Redeploy from that branch.
