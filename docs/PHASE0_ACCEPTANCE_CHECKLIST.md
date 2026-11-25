# Phase 0 acceptance checklist (authoritative)

**Branch:** `work/phase0-security-hardening`  
**Rule:** Do **not** mark Phase 0 COMPLETE unless every required row is `PASS` with linked evidence (CI URL, migration apply log, test output, or drill report). This document is the repo-local source of truth for gate decisions.

Timezone for operator notes: America/Los_Angeles.

## Product criteria

| # | Criterion | Required evidence | Status |
|---|---|---|---|
| 1 | Multi-tenant bootstrap + membership RBAC | SQL isolation tests + org API | PASS (SQL + API) |
| 2 | Organisation invitations create/accept/revoke + outbox | Migration RPCs + API + unit tests + real production transport | PARTIAL — expiry persistence fixed in `20261125240000`; production delivery worker/provider still absent |
| 3 | Infrastructure registry incl. zones lifecycle | HTTP create/list/archive | PASS (API) |
| 4 | Connector register/heartbeat/rotate/revoke + authenticated ingestion | API + credential guard + tenant-derived ingest + negative tests | PARTIAL — connector ingest endpoint + unit guards present; Nest+DB endpoint E2E still open |
| 5 | Edge connector durable buffer + read-only OT adapters | Go tests + protocol integration against representative devices | PARTIAL — probes are reachability checks, not production telemetry acquisition (**OPEN**) |
| 6 | Event ingest dedup + DLQ with original payload preserve/replay | Ingestion tests + missing-object replay rejection | PARTIAL — replay fails closed when required bytes cannot be restored; broader Nest+DB E2E still open |
| 7 | Evidence event↔payload linkage, checkpoints, verify/export | Atomic DB append RPC + concurrent append tests + API tests | PARTIAL — `append_evidence_record` RPC + unit tests; concurrency stress still open |
| 8 | Payload storage SHA-256 + production fail-closed | Payload storage tests + docs | PASS |
| 9 | Rate limiting Redis/memory fail-closed | Middleware tests + docs matching fixed-window semantics | PARTIAL — identity and bounded memory fixes present; distributed behavior and proxy identity need integration verification |
| 10 | Audit log read API | Audit controller | PASS |
| 11 | Sentinel Command UI wired to live org/registry/events/evidence workflows | Authenticated onboarding + browser E2E | PARTIAL — API workflows are configuration-gated; full sign-in/onboarding E2E remains |
| 12 | Engineering quality gate green on tip SHA | GitHub Actions audit workflow | **REQUIRED on tip** |
| 13 | Ops docs: backup/recovery, rate limit, payload storage, this checklist | `docs/*` | PASS |

## Operational criteria

| # | Criterion | Required evidence | Status |
|---|---|---|---|
| A | Cross-tenant isolation proven | `supabase/tests/phase0_tenant_isolation.sql` | PASS |
| B | Forward migrations applied to remote `abaeizgfsskvjklfslrh` through latest | Apply script logs | Track per tip |
| C | Restore drill script executed (actual backup restore + data integrity) | Restore report with restored database/object-store verification | NOT RUN — script presence alone is not a restore drill |
| D | OpenAPI contract published for Phase 0 HTTP surface | `docs/openapi.yaml` | PASS |
| E | Monitoring hooks on health endpoint | `/v1/health` fields | PASS |
| F | No main merge without explicit approval | Branch policy | Enforced |

## How to close COMPLETE

1. Tip SHA has green CI URL recorded below.
2. Latest forward migration applied to remote (statement count logged).
3. `scripts/restore-drill.sh` report status `passed`.
4. No open Critical/High rows in the remaining-gaps audit.
5. Update this table and `IMPLEMENTATION_STATUS.md` in the same commit.

## Tip evidence log

| Tip SHA | CI | Migrations applied | Notes |
|---|---|---|---|
| `a518912` | failure ([45690313033](https://github.com/Matik103/SentinelGrid/actions/runs/45690313033)) | through `20261125230000` | Findings 1–3; TS test typing |
| `adc000c` | success ([45691343420](https://github.com/Matik103/SentinelGrid/actions/runs/45691343420)) | through `20261125230000` | Prior tip only; later fixes and migration require a new green run |
| `cd7d842` | failure ([45692369309](https://github.com/Matik103/SentinelGrid/actions/runs/45692369309)) | local only until fixed tip | CI failed: migration `AS $` dollar-quote syntax |
| `e22d673` | failure ([45694367817](https://github.com/Matik103/SentinelGrid/actions/runs/45694367817)) | n/a | Empty/no-op “fix dollar quoting” commit; tip still broken |
| `4061a4b` | **success** ([45696244525](https://github.com/Matik103/SentinelGrid/actions/runs/45696244525)) | local + remote `abaeizgfsskvjklfslrh` through `20261125240000` | Real `AS $$` fix; Zod/tests/script portability; RPCs confirmed |

**Still OPEN (do not close Phase 0):** production email transport/worker + creds; full OT protocol acquisition (probes only); facility-scoped auth + isolation tests; real backup/object-store restore drill.

**Phase 0 status:** PARTIALLY COMPLETE / IN TESTING — tip CI green on `4061a4b`, **not COMPLETE**.
