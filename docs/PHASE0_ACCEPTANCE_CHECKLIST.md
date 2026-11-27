# Phase 0 acceptance checklist (authoritative)

**Canonical branch:** `work/sentinel-command-release-v2`  
**Current audit baseline tip:** `17b4af6b571f17f5338b683b135287adf0bfa947` (2026-11-26 America/Los_Angeles)  
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
| 2 | Organisation invitations create/accept/revoke + outbox | tested (code for worker) | RPCs + outbox + leased worker **code**; invite emails must use `/?invite=<token>` (aligned on tip `17b4af6`). Resend **ops delivery** still **OPEN** |
| 3 | Infrastructure registry incl. zones lifecycle | tested | HTTP create/list/archive |
| 4 | Connector register/heartbeat/rotate/revoke + authenticated ingest | tested (partial E2E) | Credential guard + tenant-derived ingest; Nest HTTP E2E still limited |
| 5 | Edge connector durable buffer + OT adapters | code / unit-tested | **OPEN ops / scaffold:** Modbus/MQTT/OPC UA are connectivity probes only — not full acquisition |
| 6 | Event ingest dedup + DLQ payload preserve/replay | tested | Fail-closed missing-object replay |
| 7 | Evidence event↔payload linkage, checkpoints, verify/export | tested | Atomic `append_evidence_record` RPC + unit tests |
| 8 | Payload storage SHA-256 + production fail-closed | tested | Supabase Storage API path (not Amazon S3). Live object upload/download/restore still **OPEN ops** |
| 9 | Rate limiting Redis/memory fail-closed | tested | Distributed/proxy identity still limited |
| 10 | Audit log read API | tested | |
| 11 | Sentinel Command UI live workflows | code | Config-gated API client; browser/auth E2E **OPEN** |
| 12 | Engineering quality gate green on tip SHA | tested / **blocked** locally | Tip CI Node release checks green (below). Full `docs/ENGINEERING_QUALITY_GATE.md` (`supabase start` + `./scripts/audit.sh`) **blocked** on Cursor audit machine (Docker + Supabase CLI missing) — **not** a pass |
| 13 | Ops docs + this checklist | code | Updated for tip `17b4af6` audit |
| 14 | Facility-manager same-org cross-facility isolation + assignment APIs | tested | Migration `20261125250000` + SQL isolation + assignment HTTP |

## Operational criteria

| # | Criterion | Level | Status |
|---|---|---|---|
| A | Cross-tenant isolation | tested | `supabase/tests/phase0_tenant_isolation.sql` (local/CI historically). Hosted runtime cross-tenant E2E **OPEN** |
| B | Forward migrations on remote `abaeizgfsskvjklfslrh` | **OPEN** (unverified) | Historical claim: through `20261125260000` as of tip `07b06ee`. Hosted `schema_migrations` **not re-read** in tip `17b4af6` audit. Repo has later migrations; **main↔work migration sets diverge** — do not apply without an approved reconciliation plan |
| C | Real backup + object-store restore drill | **OPEN** | Marker script ≠ restore. Design only until authorized on a disposable environment |
| D | OpenAPI contract | code | `docs/openapi.yaml` |
| E | Monitoring hooks on `/v1/health` | code / partial ops | Live HTTP 200 with supabase/email/storage signals (below). `monitoring.build_sha` empty — cannot correlate Render process to git SHA from health alone |
| F | No main merge without approval | enforced | Shared work continues on `work/sentinel-command-release-v2` |
| G | Production email delivery (Resend) | **OPEN ops** | Health shows `email_transport=resend`, worker enabled, Resend configured. That is **configuration readiness**, not a delivered/accepted invite |

## How to close COMPLETE

1. Tip SHA has green CI URL recorded below (Node release checks) **and** full quality gate evidence from a Docker-capable runner (or formal environment exception).
2. Latest forward migration applied to remote after divergence reconciliation (statement count logged). **Not authorized in Issue #9 packet.**
3. Real backup/object-store restore drill recorded (not marker-only).
4. Production email either ops-verified (delivered + accepted invite) or formally deferred with owner and revisit trigger.
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

### Current audit baseline — tip `17b4af6` (2026-11-26 PT)

| Item | Result | Evidence |
|---|---|---|
| Branch / SHA | `work/sentinel-command-release-v2` @ `17b4af6b571f17f5338b683b135287adf0bfa947` = origin | Issue #9 Cursor audit; `git rev-parse` match |
| Tip CI `build-and-test` | **success** | https://github.com/Matik103/SentinelGrid/actions/runs/45945271767 |
| Vercel status on tip | **success** (branch/preview deployment) | https://vercel.com/excel-11ea67ae/sentinelgrid/3vhX1TdVCrAHmkUE55X1fV7m5nMh — **preview ≠ www production** |
| Local API tests | **54/54 pass** | `npm test -w @sentinelgrid/api` on Cursor audit machine |
| Local web build | **pass** | `npm run build -w @sentinelgrid/web` |
| Local Go connector tests | **pass** | `go test ./...` under `edge/connector` |
| Full quality gate | **blocked / not executed** | Docker + `supabase` CLI missing → `env.docker`, `env.supabase` fail under `REQUIRE_DB_CHECKS=0 ./scripts/audit.sh` |
| Nest `/v1/health` | HTTP 200 partial ops | `status=ok`, supabase ok, `payload_backend=supabase`, `payload_bucket=ready`, Resend worker enabled/configured, `build_sha=""` |
| `app_public_config.api_base_url` | set | `https://sentinelgrid-fpzo.onrender.com` |
| www.sentinelgrid.tech | HTTP 200 | Landing reachable; production FE still documented as sourced from `main` |
| Hosted migrations | **unverified** | Do not apply. See migration risk note below |
| Criterion G live invite | **OPEN** | No mailbox delivery proof |
| Backup/restore | **OPEN** | Not executed |
| Browser E2E | **OPEN** | Not executed in this packet |

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
- Hosted migration reconciliation + verified apply (**ops**, approved plan required)
- Production email delivery proof (**ops**)
- Full OT protocol acquisition or formal deferral (**ops** — needs maps/node IDs/topics)
- Real backup + object-storage restore drill (**ops**)
- Authenticated browser E2E (signup/MFA/invite/registry/energy/evidence) (**ops**)
- Full engineering quality gate on a Docker-capable runner for tip SHA (**tested/ops**)

**Phase 0 status:** PARTIALLY COMPLETE / IN TESTING — tip `17b4af6` Node CI green; full quality gate blocked on audit machine; migrations/email/restore/E2E still open — **not COMPLETE**.

## Related plans (not Phase 0 exit / not authorized to execute)

- Router/AP inventory adapter design (implementation **not** authorized yet): [`ROUTER_AP_ADAPTER_DESIGN.md`](ROUTER_AP_ADAPTER_DESIGN.md). Keep network intelligence separate from wireless security sensors and electrical outlet/circuit sensing.
- Hosted migration reconciliation (**do not apply** until approved): [`MIGRATION_RECONCILIATION_PLAN.md`](MIGRATION_RECONCILIATION_PLAN.md).
- Disposable backup/restore drill design: [`BACKUP_RECOVERY.md`](BACKUP_RECOVERY.md).
- Full DB quality gate CI: `.github/workflows/audit.yml` must run on this canonical branch (Node release checks alone are insufficient).
