# SentinelGrid deployment and production readiness

## Deployment topology

- Frontend: Vercel project `sentinelgrid`, custom domains `https://www.sentinelgrid.tech` and `https://sentinelgrid.tech`.
- API: NestJS service in `apps/api`, deployed separately using the root `render.yaml` Blueprint and `apps/api/Dockerfile`.
- Database and identity: hosted Supabase project `abaeizgfsskvjklfslrh`.
- Invitation delivery: the NestJS `EmailWorkerService` drains `email_outbox` through Resend when explicitly configured.

The shared implementation branch is `work/sentinel-command-release-v2`. The Vercel project currently has a production deployment sourced from `main`; pushes to the shared work branch produce previews unless the Vercel production branch setting is deliberately changed. Do not treat a preview build as a production release.

## Frontend API configuration

The browser calls the NestJS API under `/v1`. Configuration precedence:

1. Vercel build-time variable `VITE_API_BASE_URL`.
2. Supabase public runtime config row `public.app_public_config.key = 'api_base_url'`, value shape `{"url":"https://<api-origin>"}`.

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
3. Expect HTTP 200, `dependencies.supabase = "ok"`, and `monitoring.email_worker_enabled = true` only when the Resend worker's required environment is present.
4. If the API fails to boot, inspect missing server env values and logs; the service intentionally refuses to start without Supabase URL and service-role credentials.

## Supabase migrations and authentication

Apply pending migrations to the hosted project from the repository root:

```sh
npx supabase link --project-ref abaeizgfsskvjklfslrh
npx supabase db push
```

Review the pending migration list before confirming `db push`; it applies all unapplied migrations, not just the profile fix. The important missing migration on the shared branch is:

`supabase/migrations/20261127090000_ensure_own_profile_bootstrap_definer.sql`

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
