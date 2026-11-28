# Phase 0 acceptance checklist (authoritative)

**Canonical branch:** `work/sentinel-command-release-v2`  
**Current tip (evidence below):** `16b4e3c4924b61cf06600b0dacc0e45f14c7834b` (2026-11-28 America/Los_Angeles)  
**www / `main` FE tip:** `c68caea0f72da46a953a4ce265c336d765562129`  
**Prior tip (Criterion G + E2E-08):** `dbe84a7bb6ad9103ca14fb5fc6c7b16c6de3384f`  
**Prior tip (docs):** `ca5b2f14fc84a824f58668ce3091507f3f8f32d5`  
**Prior tip (migration/docs packet):** `05138a4daeceac3ebf0171b3a7b98cf9b8c4b9bd`  
**Prior tip (quality-gate packet):** `b094207b91b5889cdc8376a853412e015c71cc80`  
**Prior Issue #9 audit baseline:** `17b4af6b571f17f5338b683b135287adf0bfa947` (preserved in historical / baseline sections)  
**Rule:** Do **not** mark Phase 0 COMPLETE unless every required row is fully verified at the **ops** level with linked evidence. This document is the repo-local source of truth for gate decisions.

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
| 2 | Organisation invitations create/accept/revoke + outbox | tested + **ops** | RPCs + outbox + Resend worker; `/?invite=` links. Criterion G + authenticated E2E 2026-11-28 PT: create → outbox **sent** → recipient confirmed → invitee signup/accept → membership **active** `read_only_viewer` on Afya |
| 3 | Infrastructure registry incl. zones lifecycle | tested | HTTP create/list/archive |
| 4 | Connector register/heartbeat/rotate/revoke + authenticated ingest | tested (partial E2E) | Credential guard + tenant-derived ingest; Nest HTTP E2E still limited |
| 5 | Edge connector durable buffer + OT adapters | code / unit-tested | **OPEN ops / scaffold:** Modbus/MQTT/OPC UA are connectivity probes only — not full acquisition |
| 6 | Event ingest dedup + DLQ payload preserve/replay | tested | Fail-closed missing-object replay |
| 7 | Evidence event↔payload linkage, checkpoints, verify/export | tested | Atomic `append_evidence_record` RPC + unit tests |
| 8 | Payload storage SHA-256 + production fail-closed | tested + **ops** | Supabase Storage API path (not Amazon S3). Hosted upload/download/SHA + disposable restore digest PASS 2026-11-28 PT (`reports/hosted-restore-drill-2026-11-28.json`) |
| 9 | Rate limiting Redis/memory fail-closed | tested | Distributed/proxy identity still limited |
| 10 | Audit log read API | tested | |
| 11 | Sentinel Command UI live workflows | **ops** | Signed-out smoke + authenticated admin + invitee accept + facility-manager isolation PASS 2026-11-28 PT (`reports/e2e-auth-pass-2026-11-28.json`) |
| 12 | Engineering quality gate green on tip SHA | **tested** (CI) | Full Docker-backed gate green on tip `dbe84a7` via `.github/workflows/audit.yml` (run 46155054515). Includes `phase0_tenant_isolation.sql`. Cursor local Docker/Supabase CLI still unavailable |
| 13 | Ops docs + this checklist | code | Updated 2026-11-28 PT for tip `dbe84a7` + Criterion G + browser E2E evidence |
| 14 | Facility-manager same-org cross-facility isolation + assignment APIs | tested + **ops** | SQL isolation + assignment HTTP + browser E2E-08 (ALPHA visible / BETA hidden) |

## Operational criteria

| # | Criterion | Level | Status |
|---|---|---|---|
| A | Cross-tenant isolation | tested | `supabase/tests/phase0_tenant_isolation.sql` (local/CI historically). Hosted runtime cross-tenant E2E **OPEN** |
| B | Forward migrations on remote `abaeizgfsskvjklfslrh` | **ops** | Hosted matches repo through `20261128160000` (32 versions). Applied AAL2 self-service invite RPCs 2026-11-28 PT; `apply-pending-production.mjs --dry-run` pending=0 |
| C | Real backup + object-store restore drill | **ops** | Disposable hosted-schema restore + Storage SHA round-trip PASS 2026-11-28 PT — `reports/hosted-restore-drill-2026-11-28.json` (see [`BACKUP_RECOVERY.md`](BACKUP_RECOVERY.md)). Local marker still `reports/restore-drill.json`. Physical PITR into a second hosted project not claimed (API 403 / no dashboard login) |
| D | OpenAPI contract | code | `docs/openapi.yaml` |
| E | Monitoring hooks on `/v1/health` | **ops** (after Render autoDeploy) | Nest prefers `GIT_SHA \|\| RENDER_GIT_COMMIT \|\| GITHUB_SHA`. Live correlation verified against Render deploy of this tip |
| F | No main merge without approval | enforced | Shared work continues on `work/sentinel-command-release-v2` |
| G | Production email delivery (Resend) | **ops** | Manual path + authenticated E2E 2026-11-28 PT: invite create → outbox **sent** → recipient confirmed → accept/signup → Afya membership **active** (`read_only_viewer`). Tokens/PII not recorded |

## How to close COMPLETE

1. Tip SHA has green CI URL recorded below (Node release checks) **and** full quality gate evidence from a Docker-capable runner (or formal environment exception).
2. Latest forward migration applied to remote after divergence reconciliation (statement count logged). **Not authorized in Issue #9 packet.**
3. Real backup/object-store restore drill recorded (not marker-only) — **done 2026-11-28 PT** (`reports/hosted-restore-drill-2026-11-28.json`).
4. Production email ops-verified (delivered + accepted invite) — **done 2026-11-28 PT** (manual Criterion G + authenticated E2E invite path).
5. Full OT acquisition path or formal deferral with device map evidence (probes ≠ acquisition).
6. Update this table and `IMPLEMENTATION_STATUS.md` in the same commit.
7. Render `monitoring.build_sha` correlates to deployed git tip — closed via `RENDER_GIT_COMMIT` (optional `GIT_SHA` override).

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

### Current tip — restore + `build_sha` packet (2026-11-28 PT)

| Item | Result | Evidence |
|---|---|---|
| Branch / SHA | `work/sentinel-command-release-v2` @ `16b4e3c4924b61cf06600b0dacc0e45f14c7834b` | Disposable restore evidence + Nest `RENDER_GIT_COMMIT` → `monitoring.build_sha` |
| www / `main` FE | `c68caea0f72da46a953a4ce265c336d765562129` | Vercel production Ready ([#34](https://github.com/Matik103/SentinelGrid/pull/34)) |
| Nest `/v1/health` `build_sha` | **ops** after Render autoDeploy | Prefers `GIT_SHA \|\| RENDER_GIT_COMMIT \|\| GITHUB_SHA`; live value must match deployed commit |
| Hosted migrations | **parity closed** through `20261128160000` | 32 versions; dry-run pending=0 vs repo |
| Criterion G live invite | **ops** | See prior tip `dbe84a7` + `IMPLEMENTATION_STATUS.md` |
| Backup/restore | **ops** | `reports/hosted-restore-drill-2026-11-28.json` — disposable PG17 dump/restore + hosted Storage SHA round-trip torn down; [`BACKUP_RECOVERY.md`](BACKUP_RECOVERY.md) |
| Browser E2E | **ops** | `reports/e2e-auth-pass-2026-11-28.json` |
| UniFi adapter implementation | **not authorized** | Design only: [`ROUTER_AP_ADAPTER_DESIGN.md`](ROUTER_AP_ADAPTER_DESIGN.md) |

### Prior tip — `dbe84a7` (2026-11-28 PT)

| Item | Result | Evidence |
|---|---|---|
| Branch / SHA | `work/sentinel-command-release-v2` @ `dbe84a7bb6ad9103ca14fb5fc6c7b16c6de3384f` = origin | Merged authenticated E2E + facility-manager create gate ([#33](https://github.com/Matik103/SentinelGrid/pull/33)) |
| www / `main` FE | `c68caea0f72da46a953a4ce265c336d765562129` | Vercel production Ready ([#34](https://github.com/Matik103/SentinelGrid/pull/34)) |
| Tip CI release checks | **success** | https://github.com/Matik103/SentinelGrid/actions/runs/46155054494 |
| Full Engineering Quality Gate | **success** | https://github.com/Matik103/SentinelGrid/actions/runs/46155054515 — Docker + Supabase; upgrade path; `security.tenant_isolation` (`phase0_tenant_isolation.sql`); npm/go; gitleaks |
| Vercel (`main`) | **success** | Deployment completed for `c68caea` |
| Nest `/v1/health` | HTTP 200 partial ops | supabase ok; Resend worker enabled; `payload_backend=supabase`; `build_sha=""` (superseded by this packet) |
| Local API / web unit tests | **pass** | API 58/58; web 12/12 on Cursor machine at tip sync |
| Hosted migrations | **parity closed** through `20261128160000` | Applied + recorded 2026-11-28 PT (32 versions); dry-run pending=0 vs repo |
| Criterion G live invite | **ops** | Afya: creator (admin, protected) + active read-only viewer(s); email delivered; signup + MFA; membership **active**; pending empty. No tokens in this log. See `IMPLEMENTATION_STATUS.md` |
| Backup/restore | was **OPEN** | Superseded by `reports/hosted-restore-drill-2026-11-28.json` |
| Browser E2E | **ops** | Signed-out + authenticated admin + invitee accept + facility-manager isolation PASS — `reports/e2e-auth-pass-2026-11-28.json` |
| UniFi adapter implementation | **not authorized** | Design only: [`ROUTER_AP_ADAPTER_DESIGN.md`](ROUTER_AP_ADAPTER_DESIGN.md) |

### Prior tip — `05138a4` (2026-11-28 PT)

| Item | Result | Evidence |
|---|---|---|
| Branch / SHA | `work/sentinel-command-release-v2` @ `05138a4daeceac3ebf0171b3a7b98cf9b8c4b9bd` | Hosted `20261128160000` closeout + Criterion G manual invite docs |
| www / `main` FE (then) | `43ae5995ee9eb4d0d8fc8644d9f40d7009d05e59` | Superseded by `c68caea` |
| Tip CI / EQG (then) | **success** | runs 46149277052 / 46149277028 |

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
- Hosted runtime cross-tenant E2E beyond SQL/CI isolation (**ops**)

**Phase 0 status:** PARTIALLY COMPLETE / IN TESTING — disposable hosted restore + Render `build_sha` path closed 2026-11-28 PT; Criterion G + browser E2E + hosted migrations through `20261128160000` closed; www `main` @ `c68caea`; OT acquisition/deferral still open — **not COMPLETE**.

## Related plans (not Phase 0 exit / not authorized to execute)

- Router/AP inventory adapter design (implementation **not** authorized yet): [`ROUTER_AP_ADAPTER_DESIGN.md`](ROUTER_AP_ADAPTER_DESIGN.md). Keep network intelligence separate from wireless security sensors and electrical outlet/circuit sensing.
- Hosted migration reconciliation (**do not apply** until approved): [`MIGRATION_RECONCILIATION_PLAN.md`](MIGRATION_RECONCILIATION_PLAN.md).
- Disposable backup/restore drill design: [`BACKUP_RECOVERY.md`](BACKUP_RECOVERY.md).
- Authenticated browser E2E plan: [`BROWSER_E2E_PLAN.md`](BROWSER_E2E_PLAN.md).
- Full DB quality gate CI: `.github/workflows/audit.yml` on this canonical branch — **green** on tip `dbe84a7` (run 46155054515; Node release checks alone remain insufficient as sole evidence).
