# SentinelGrid deployment and production readiness

## Deployment topology (normal production path)

Production is three hosted services — not a Cloud Agent VM:

| Layer | Host | Role |
| --- | --- | --- |
| UI | Vercel → `https://www.sentinelgrid.tech` | Browser app + Supabase Auth (anon key + RLS) |
| API | Render Nest → `https://sentinelgrid-fpzo.onrender.com` | `/v1/*`, Resend outbox worker, Supabase Storage via service role |
| Data/Auth | Supabase `abaeizgfsskvjklfslrh` | Postgres, Auth/MFA, Storage buckets, `app_public_config` |

Invitation emails must link to `https://www.sentinelgrid.tech/?invite=<token>` (FE accept flow). Do not email raw tokens or `/accept-invite`.

The shared implementation branch is `work/sentinel-command-release-v2` (Render auto-deploys this). Vercel production is still sourced from `main` until an explicit cutover — keep invite/auth/API contracts aligned across both, and do not treat a preview build as a production release.

## Frontend API configuration

The browser calls the NestJS API under `/v1`. Configuration precedence:

1. Supabase public runtime config row `public.app_public_config.key = 'api_base_url'`, value shape `{"url":"https://<api-origin>"}` (production default).
2. Vercel build-time `VITE_API_BASE_URL` only when `VITE_API_BASE_URL_FORCE=1` or during local Vite DEV.

The public config migration deliberately inserts an empty URL. Do not fill it with a guessed hostname. Deploy the API first and verify `GET /v1/health` returns HTTP 200 with `dependencies.supabase = "ok"`. Then run:

```sh
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
  -v api_base_url="https://<actual-render-service>.onrender.com" \
  -f supabase/ops/configure-api-url.sql
```

The script validates an HTTPS origin and upserts the existing row; it will not leave an existing empty value untouched. Rebuild/redeploy the Vercel frontend only if using `VITE_API_BASE_URL`; Supabase runtime config is fetched by the app at startup.

Never put `SUPABASE_SERVICE_ROLE_KEY`, Resend keys, database passwords, or other server secrets in a `VITE_` variable.

## Backend deployment (Render)

The Render Blueprint creates `sentinelgrid-api` from `work/sentinel-command-release-v2` using the root Docker context and `apps/api/Dockerfile`. Import the Blueprint in Render and supply these secret values in the service environment:

Required:
- `SUPABASE_URL` — `https://abaeizgfsskvjklfslrh.supabase.co`
- `SUPABASE_ANON_KEY` — public anon key (server-side environment only)
- `SUPABASE_SERVICE_ROLE_KEY` — secret service-role key, server-side only

Email delivery:
- `RESEND_API_KEY` — Resend API key, stored as a Render secret
- `SG_EMAIL_FROM` — exact sender identity verified in Resend; do not assume an unverified address
- `SG_EMAIL_TRANSPORT=resend`
- `SG_EMAIL_WORKER_ENABLED=true`

The Blueprint sets `NODE_ENV=production`, `PORT=8080`, `SG_PUBLIC_APP_URL=https://www.sentinelgrid.tech`, and a CORS allowlist for the custom domains. Do not expose service-role or Resend credentials in frontend settings.

After the Blueprint deploys:
1. Confirm Render reports the service healthy.
2. Call `https://<actual-render-service>.onrender.com/v1/health`.
3. Expect HTTP 200 and `dependencies.supabase = "ok"`. `monitoring.email_worker_enabled` reflects whether the worker actually started; `monitoring.email_resend_configured` reports whether both Resend secrets exist; `public_api_origin_configured` reports whether the public API origin has been written to Supabase.
4. If the API fails to boot, inspect missing server env values and logs; the service intentionally refuses to start without Supabase URL and service-role credentials.

## Supabase migrations and authentication

Apply pending migrations on the hosted Supabase project (operator machine or CI — not the Render Nest service):

```sh
# Supabase personal access token (Management API), or linked CLI session:
node scripts/apply-pending-production.mjs
# or:
node scripts/apply-remote-sql.mjs abaeizgfsskvjklfslrh supabase/migrations/<file>.sql
npx supabase link --project-ref abaeizgfsskvjklfslrh && npx supabase db push
```

Do not put a Management API token on Render. Nest only needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (+ Resend secrets).

Review the pending migration list before confirming `db push`. Important pending migrations on the shared branch include:

`supabase/migrations/20261127090000_ensure_own_profile_bootstrap_definer.sql`
`supabase/migrations/20261127100000_evidence_payloads_storage_bucket.sql`
`supabase/migrations/20261127120000_payload_storage_supabase_backend.sql`

It changes `ensure_own_profile(text)` to a tightly scoped SECURITY DEFINER function so first-session profile creation works at AAL1. It does not relax direct profile table access: the restrictive AAL2 policy remains in force. The matching regression case is in `supabase/tests/phase0_tenant_isolation.sql`.

Run the read-only verification queries after migration:

```sh
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/ops/verify-production.sql
```

In Supabase Authentication URL Configuration:
- Site URL: `https://www.sentinelgrid.tech`
- Add allowed redirects for `https://www.sentinelgrid.tech/**` and `https://sentinelgrid.tech/**`
- Keep local development redirects only if needed.

TOTP authenticator MFA is required for workspace and API access. New users can create an account, initialize only their own profile through the bootstrap RPC, enroll TOTP, and then proceed at AAL2. Do not remove the AAL2 restrictive policies to fix onboarding.

## Workspace creation and invitations

The web app now includes account signup and handles invitation links:
1. Invitee opens the link from the invitation email.
2. They sign in or create an account using the invited email.
3. They complete TOTP enrollment/challenge.
4. The frontend submits the invitation token to `POST /v1/orgs/invites/accept`.
5. On success, the workspace list refreshes and selects the new membership.

The API creates invitations through the database RPC and enqueues email in `email_outbox`. The Render worker polls every five seconds, uses the outbox UUID as Resend's idempotency key, and records success/failure with a lease token. Apply `20261125260000_phase0_email_worker_leases.sql` before enabling the worker. Monitor outbox statuses with `supabase/ops/verify-production.sql`.

If delivery remains pending, check the worker flags, sender verification, Resend logs, Render runtime logs, and `email_outbox.last_error`. An invitation being queued is not proof that an email was delivered.

## Acceptance gates

Do not call the app ready until all of these pass:

1. Frontend Vercel build succeeds for the target commit.
2. API Docker build and `npm run build -w @sentinelgrid/api` succeed.
3. API tests pass: `npm test -w @sentinelgrid/api`.
4. Hosted Supabase migrations are applied and the read-only verification script confirms the bootstrap function is SECURITY DEFINER.
5. New account signup works; the user can bootstrap their own profile at AAL1, enroll TOTP, and reach AAL2.
6. Workspace creation creates exactly one organisation and administrator membership.
7. Invitation email is accepted by Resend and received; invitee can accept after MFA.
8. A second tenant cannot read or mutate the first tenant's data.
9. API health reports Supabase ready and the configured email worker.
10. Verify the Vercel deployment SHA and environment before calling anything production.

## Known unrelated browser noise

Cloudflare Insights beacon CORS/SRI errors are separate from the API, Supabase profile policy, and invitation flow. Investigate the Cloudflare script injection/integrity configuration independently; do not weaken application CORS or CSP to hide those errors.
