# Phase 0 acceptance checklist (authoritative)

**Canonical branch:** `work/sentinel-command-release-v2`  
**Current tip (evidence below):** `05138a4daeceac3ebf0171b3a7b98cf9b8c4b9bd` (2026-11-28 America/Los_Angeles; functional invite/role UI tip `6ef1ccf`)  
**www / `main` FE tip:** `43ae5995ee9eb4d0d8fc8644d9f40d7009d05e59`  
**Prior tip (quality-gate packet):** `b094207b91b5889cdc8376a853412e015c71cc80`  
**Prior Issue #9 audit baseline:** `17b4af6b571f17f5338b683b135287adf0bfa947` (preserved in historical / baseline sections)  
**Rule:** Do **not** mark Phase 0 COMPLETE unless every required row is fully verified at the **ops** level with linked evidence. This document is the repo-local source of truth for gate decisions. Manual Criterion G invite proof does **not** by itself close Phase 0.

Timezone for operator notes: America/Los_Angeles.

Historical tip SHAs and run links below refer to the branch state **at the time they were recorded**. They are not current-tip proof. `origin/main` tip `7b99e49` is **not** the canonical working-branch baseline.

## Evidence levels (use these labels)

| Level | Meaning |
|---|---|
| **code** | Implemented in branch (APIs/migrations/workers) |
| **tested** | Automated tests / tip CI green prove the behaviour |
| **ops** | Verified against real remote credentials / restore / live delivery |
| **blocked** | Required check could not execute in the named environment |

## Product criteria

| # | Criterion | Level | Status / notes |
|---|---|---|---|
| 1 | Multi-tenant bootstrap + membership RBAC | tested | SQL isolation + org API |
| 2 | Organisation invitations create/accept/revoke + outbox | tested + **ops** | RPCs + outbox + Resend worker; `/?invite=` links. Criterion G manual accept path + authenticated E2E invite create/outbox **sent**/recipient-confirmed 2026-11-28 PT. E2E-06 invitee accept (second mailbox) still open |
| 3 | Infrastructure registry incl. zones lifecycle | tested | HTTP create/list/archive |
| 4 | Connector register/heartbeat/rotate/revoke + authenticated ingest | tested (partial E2E) | Credential guard + tenant-derived ingest; Nest HTTP E2E still limited |
| 5 | Edge connector durable buffer + OT adapters | code / unit-tested | **OPEN ops / scaffold:** Modbus/MQTT/OPC UA are connectivity probes only — not full acquisition |
| 6 | Event ingest dedup + DLQ payload preserve/replay | tested | Fail-closed missing-object replay |
| 7 | Evidence event↔payload linkage, checkpoints, verify/export | tested | Atomic `append_evidence_record` RPC + unit tests |
| 8 | Payload storage SHA-256 + production fail-closed | tested | Supabase Storage API path (not Amazon S3). Live object upload/download/restore still **OPEN ops** |
| 9 | Rate limiting Redis/memory fail-closed | tested | Distributed/proxy identity still limited |
| 10 | Audit log read API | tested | |
| 11 | Sentinel Command UI live workflows | **ops (partial suite)** | Signed-out smoke + authenticated admin shell PASS 2026-11-28 PT (`reports/e2e-auth-pass-2026-11-28.json`). E2E-08 facility-manager isolation and invitee accept still open |
| 12 | Engineering quality gate green on tip SHA | **tested** (CI) | Full Docker-backed gate green on tip `6ef1ccf` via `.github/workflows/audit.yml` (run 46149277028). Includes `phase0_tenant_isolation.sql`. Cursor local Docker/Supabase CLI still unavailable |
| 13 | Ops docs + this checklist | code | Updated 2026-11-28 PT for tip `6ef1ccf` + Criterion G manual invite evidence |
| 14 | Facility-manager same-org cross-facility isolation + assignment APIs | tested | Migration `20261125250000` + SQL isolation + assignment HTTP |

## Operational criteria

| # | Criterion | Level | Status |
|---|---|---|---|
| A | Cross-tenant isolation | tested | `supabase/tests/phase0_tenant_isolation.sql` (local/CI historically). Hosted runtime cross-tenant E2E **OPEN** |
| B | Forward migrations on remote `abaeizgfsskvjklfslrh` | **ops** | Hosted matches repo through `20261128160000` (32 versions). Applied AAL2 self-service invite RPCs 2026-11-28 PT; `apply-pending-production.mjs --dry-run` pending=0 |
| C | Real backup + object-store restore drill | **OPEN** (local marker passed) | `scripts/restore-drill.sh` passed 2026-11-28 PT (migration/marker check → `reports/restore-drill.json`). Disposable hosted Postgres+Storage restore still required |
| D | OpenAPI contract | code | `docs/openapi.yaml` |
| E | Monitoring hooks on `/v1/health` | code / partial ops | Live HTTP 200 with supabase/email/storage signals. `monitoring.build_sha` empty — cannot correlate Render process to git SHA from health alone |
| F | No main merge without approval | enforced | Shared work continues on `work/sentinel-command-release-v2` |
| G | Production email delivery (Resend) | **ops** | Manual path 2026-11-28 PT (delivery + accept + MFA + membership). Authenticated E2E same day: invite create → outbox **sent** → recipient confirmed for intramaxx1@gmail.com. Tokens/PII not recorded. E2E-06 accept for that invite still open |

## How to close COMPLETE

1. Tip SHA has green CI URL recorded below (Node release checks) **and** full quality gate evidence from a Docker-capable runner (or formal environment exception).
2. Latest forward migration applied to remote after divergence reconciliation (statement count logged). **Not authorized in Issue #9 packet.**
3. Real backup/object-store restore drill recorded (not marker-only).
4. Production email ops-verified (delivered + accepted invite) — **manual path done 2026-11-28 PT**; keep automated invite E2E or formal deferral of remaining browser suite.
5. Full OT acquisition path or formal deferral with device map evidence (probes ≠ acquisition).
6. Update this table and `IMPLEMENTATION_STATUS.md` in the same commit.

## Tip evidence log

### Historical (preserve; not current-tip proof)

| Tip SHA | CI | Migrations applied | Notes |
|---|---|---|---|
| `4061a4b` | success ([45696244525](https://github.com/Matik103/SentinelGrid/actions/runs/45696244525)) | through `20261125240000` local+remote | Dollar-quote fix |
| `da49bcb` | success ([45697018751](https://github.com/Matik103/SentinelGrid/actions/runs/45697018751)) | through `240000` | Checklist evidence |
| `3e2c9f2` | success ([45698815441](https://github.com/Matik103/SentinelGrid/actions/runs/45698815441)) | through `20261125260000` local+remote | Facility RLS + email worker leases |
| `647ea0b` | failure ([45701124636](https://github.com/Matik103/SentinelGrid/actions/runs/45701124636)) | through `260000` | Facility tests; TS `never` in assignment test |
| `07b06ee` | **success** ([45701978909](https://github.com/Matik103/SentinelGrid/actions/runs/45701978909)) | through `20261125260000` local+remote | Facility isolation SQL + email lease tests + 3-level checklist |

### Prior Issue #9 audit baseline — tip `17b4af6` (2026-11-26 PT)

| Item | Result | Evidence |
|---|---|---|
| Branch / SHA | `work/sentinel-command-release-v2` @ `17b4af6b571f17f5338b683b135287adf0bfa947` = origin | Issue #9 Cursor audit; `git rev-parse` match |
| Tip CI `build-and-test` | **success** | https://github.com/Matik103/SentinelGrid/actions/runs/45945271767 |
| Vercel status on tip | **success** (branch/preview deployment) | https://vercel.com/excel-11ea67ae/sentinelgrid/3vhX1TdVCrAHmkUE55X1fV7m5nMh — **preview ≠ www production** |
| Local API tests | **54/54 pass** | `npm test -w @sentinelgrid/api` on Cursor audit machine |
| Local web build | **pass** | `npm run build -w @sentinelgrid/web` |
| Local Go connector tests | **pass** | `go test ./...` under `edge/connector` |
| Full quality gate | **blocked on audit machine** | Docker + `supabase` CLI missing locally at that time |
| Nest `/v1/health` | HTTP 200 partial ops | `status=ok`, supabase ok, `payload_backend=supabase`, `payload_bucket=ready`, Resend worker enabled/configured, `build_sha=""` |
| `app_public_config.api_base_url` | set | `https://sentinelgrid-fpzo.onrender.com` |
| www.sentinelgrid.tech | HTTP 200 | Landing reachable; production FE still documented as sourced from `main` |
| Hosted migrations | **unverified** | Do not apply. See migration risk note below |
| Criterion G live invite | **OPEN** | No mailbox delivery proof |
| Backup/restore | **OPEN** | Not executed |
| Browser E2E | **OPEN** | Not executed |

### Current tip — `05138a4` (2026-11-28 PT)

| Item | Result | Evidence |
|---|---|---|
| Branch / SHA | `work/sentinel-command-release-v2` @ `05138a4daeceac3ebf0171b3a7b98cf9b8c4b9bd` = origin | Docs + hosted `20261128160000` closeout; functional invite/role UI tip `6ef1ccf270485e28725de744ad87498190e71201` |
| www / `main` FE | `43ae5995ee9eb4d0d8fc8644d9f40d7009d05e59` | Vercel production source for www.sentinelgrid.tech |
| Tip CI release checks | **success** | https://github.com/Matik103/SentinelGrid/actions/runs/46149277052 |
| Full Engineering Quality Gate | **success** | https://github.com/Matik103/SentinelGrid/actions/runs/46149277028 — Docker + Supabase; upgrade path; `security.tenant_isolation` (`phase0_tenant_isolation.sql`); npm/go; gitleaks |
| `main` Engineering Quality Gate | **success** | https://github.com/Matik103/SentinelGrid/actions/runs/46149279913 |
| Vercel (`main`) | **success** | Deployment completed for `43ae599` at 2026-11-28T13:22:30Z |
| Nest `/v1/health` | HTTP 200 partial ops | supabase ok; Resend worker enabled; `payload_backend=supabase`; `build_sha=""` |
| Local API / web unit tests | **pass** | API 57/57; web 12/12 on Cursor machine at tip sync |
| Hosted migrations | **parity closed** through `20261128160000` | Applied + recorded 2026-11-28 PT (32 versions); dry-run pending=0 vs repo |
| Criterion G live invite | **ops (manual)** | Afya: admin invited read-only viewer; email delivered; signup + MFA completed; membership **active**; pending empty. No tokens/PII in this log. See `IMPLEMENTATION_STATUS.md` |
| Backup/restore | **OPEN** (design ready) | Disposable drill in [`BACKUP_RECOVERY.md`](BACKUP_RECOVERY.md) — not executed |
| Browser E2E | **ops (partial suite)** | Signed-out smoke + authenticated admin PASS 2026-11-28 PT — `reports/e2e-auth-pass-2026-11-28.json` (MFA, People, invite to intramaxx1@gmail.com outbox **sent** + recipient confirmed, facilities/assets/energy/evidence/audit). E2E-06 invitee accept + E2E-08 facility-manager isolation still open |
| UniFi adapter implementation | **not authorized** | Design only: [`ROUTER_AP_ADAPTER_DESIGN.md`](ROUTER_AP_ADAPTER_DESIGN.md) |

### Prior tip — `b094207` (2026-11-26 PT)

| Item | Result | Evidence |
|---|---|---|
| Branch / SHA | `work/sentinel-command-release-v2` @ `b094207b91b5889cdc8376a853412e015c71cc80` = origin | Post–`2de294e` quality-gate + plan packet |
| Docs/design commit | **accepted** | `2de294edc2ae1dbacfb152fd71443f777ecbc597` — Phase 0 tip audit + UniFi design |
| Tip CI release checks | **success** | https://github.com/Matik103/SentinelGrid/actions/runs/45947732132 |
| Full Engineering Quality Gate | **success** | https://github.com/Matik103/SentinelGrid/actions/runs/45947732146 — Docker + Supabase CLI 2.75.0; `db.lint`, upgrade path (17 migrations), `security.tenant_isolation`, npm/go checks, gitleaks |
| Vercel status on tip | **success** (branch/preview) | https://vercel.com/excel-11ea67ae/sentinelgrid/4jKNtLkmNYp2aKUMNu2D7WAtnDbm — **preview ≠ www production** |
| Hosted migrations | **ops applied** through `20261127150000` | Management API apply 2026-11-26 PT; constraint allows `supabase` backend; tracking table seeded; dry-run pending=0. See [`MIGRATION_RECONCILIATION_PLAN.md`](MIGRATION_RECONCILIATION_PLAN.md) |
| Criterion G live invite | was **OPEN** at this tip | Superseded by 2026-11-28 PT manual ops evidence on tip `6ef1ccf` |
| Backup/restore | **OPEN** (design ready) | Disposable drill in [`BACKUP_RECOVERY.md`](BACKUP_RECOVERY.md) — not executed |
| Browser E2E | **OPEN** (plan ready) | [`BROWSER_E2E_PLAN.md`](BROWSER_E2E_PLAN.md) — not executed |
| UniFi adapter implementation | **not authorized** | Design only: [`ROUTER_AP_ADAPTER_DESIGN.md`](ROUTER_AP_ADAPTER_DESIGN.md) |

### Migration risk note (read-only; no apply)

Repo migrations after historical remote claim `20261125260000` (may or may not already be on host — **unverified**):

- `20261125270000_phase0_app_public_config.sql`
- `20261126090000_energy_intelligence_asset_media.sql`
- `20261126235900_mfa_assurance_enforcement.sql`
- `20261127090000_ensure_own_profile_bootstrap_definer.sql`
- `20261127100000_evidence_payloads_storage_bucket.sql` (**work-only**)
- `20261127120000_payload_storage_supabase_backend.sql` (**work-only**)

Migrations present on `main` but **not** on this work tip: `20261126100000_workspace_branding.sql`, `20261126110000_atomic_asset_media_primary.sql`, `20261126120000_auth_identity_assets.sql`, `20261126120100_ensure_own_profile_jwt_email.sql`.

**Still OPEN (do not close Phase 0):**
- Full OT protocol acquisition or formal deferral (**ops** — needs maps/node IDs/topics)
- Real backup + object-storage restore drill (**ops** — design ready; execute only when authorized on a disposable project)
- Remaining browser E2E: invitee accept (E2E-06) + facility-manager isolation (E2E-08)
- Render `monitoring.build_sha` correlation to git tip (requires explicit infra approval to set `GIT_SHA`)

**Phase 0 status:** PARTIALLY COMPLETE / IN TESTING — tip quality gate green on `6ef1ccf`; Criterion G manual invite ops-verified; hosted migrations through `20261128160000` parity closed; signed-out + authenticated admin browser E2E PASS (`reports/e2e-auth-pass-2026-11-28.json`); remaining E2E-06/E2E-08 + disposable hosted restore + Render SHA correlation still open — **not COMPLETE**.

## Related plans (not Phase 0 exit / not authorized to execute)

- Router/AP inventory adapter design (implementation **not** authorized yet): [`ROUTER_AP_ADAPTER_DESIGN.md`](ROUTER_AP_ADAPTER_DESIGN.md). Keep network intelligence separate from wireless security sensors and electrical outlet/circuit sensing.
- Hosted migration reconciliation (**do not apply** until approved): [`MIGRATION_RECONCILIATION_PLAN.md`](MIGRATION_RECONCILIATION_PLAN.md).
- Disposable backup/restore drill design: [`BACKUP_RECOVERY.md`](BACKUP_RECOVERY.md).
- Authenticated browser E2E plan: [`BROWSER_E2E_PLAN.md`](BROWSER_E2E_PLAN.md).
- Full DB quality gate CI: `.github/workflows/audit.yml` on this canonical branch — **green** on tip `6ef1ccf` (run 46149277028; Node release checks alone remain insufficient as sole evidence).
