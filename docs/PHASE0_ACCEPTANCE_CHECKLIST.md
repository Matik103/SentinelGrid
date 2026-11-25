# Phase 0 acceptance checklist (authoritative)

**Branch:** `work/phase0-security-hardening`  
**Rule:** Do **not** mark Phase 0 COMPLETE unless every required row is fully verified at the **ops** level with linked evidence. This document is the repo-local source of truth for gate decisions.

Timezone for operator notes: America/Los_Angeles.

## Evidence levels (use these labels)

| Level | Meaning |
|---|---|
| **code** | Implemented in branch (APIs/migrations/workers) |
| **tested** | Automated tests / tip CI green prove the behaviour |
| **ops** | Verified against real remote credentials / restore / live delivery |

## Product criteria

| # | Criterion | Level | Status / notes |
|---|---|---|---|
| 1 | Multi-tenant bootstrap + membership RBAC | tested | SQL isolation + org API |
| 2 | Organisation invitations create/accept/revoke + outbox | tested (code for worker) | RPCs + outbox + leased worker **code**; Resend **ops** only with `RESEND_API_KEY` (**OPEN** without key) |
| 3 | Infrastructure registry incl. zones lifecycle | tested | HTTP create/list/archive |
| 4 | Connector register/heartbeat/rotate/revoke + authenticated ingest | tested (partial E2E) | Credential guard + tenant-derived ingest; Nest HTTP E2E still limited |
| 5 | Edge connector durable buffer + OT adapters | code / unit-tested | **OPEN ops:** full protocol acquisition needs maps/node IDs/topics (probes only today) |
| 6 | Event ingest dedup + DLQ payload preserve/replay | tested | Fail-closed missing-object replay |
| 7 | Evidence event↔payload linkage, checkpoints, verify/export | tested | Atomic `append_evidence_record` RPC + unit tests |
| 8 | Payload storage SHA-256 + production fail-closed | tested | |
| 9 | Rate limiting Redis/memory fail-closed | tested | Distributed/proxy identity still limited |
| 10 | Audit log read API | tested | |
| 11 | Sentinel Command UI live workflows | code | Config-gated API client; browser/auth E2E **OPEN** |
| 12 | Engineering quality gate green on tip SHA | tested | Required on current tip |
| 13 | Ops docs + this checklist | code | |
| 14 | Facility-manager same-org cross-facility isolation + assignment APIs | tested | Migration `20261125250000` + SQL isolation + assignment HTTP |

## Operational criteria

| # | Criterion | Level | Status |
|---|---|---|---|
| A | Cross-tenant isolation | tested | `supabase/tests/phase0_tenant_isolation.sql` |
| B | Forward migrations on remote `abaeizgfsskvjklfslrh` | ops (schema) | Track per tip — through `20261125260000` as of tip `3e2c9f2` follow-up |
| C | Real backup + object-store restore drill | **OPEN** | Marker script ≠ restore |
| D | OpenAPI contract | code | `docs/openapi.yaml` |
| E | Monitoring hooks on `/v1/health` | code | |
| F | No main merge without approval | enforced | |
| G | Production email delivery (Resend) | **OPEN ops** | Worker disabled unless `SG_EMAIL_WORKER_ENABLED=true` + Resend env; no key in this environment |

## How to close COMPLETE

1. Tip SHA has green CI URL recorded below.
2. Latest forward migration applied to remote (statement count logged).
3. Real backup/object-store restore drill recorded (not marker-only).
4. Production email either ops-verified or formally out-of-scope with signed exception.
5. Full OT acquisition path or formal deferral with device map evidence.
6. Update this table and `IMPLEMENTATION_STATUS.md` in the same commit.

## Tip evidence log

| Tip SHA | CI | Migrations applied | Notes |
|---|---|---|---|
| `4061a4b` | success ([45696244525](https://github.com/Matik103/SentinelGrid/actions/runs/45696244525)) | through `20261125240000` local+remote | Dollar-quote fix |
| `da49bcb` | success ([45697018751](https://github.com/Matik103/SentinelGrid/actions/runs/45697018751)) | through `240000` | Checklist evidence |
| `3e2c9f2` | success ([45698815441](https://github.com/Matik103/SentinelGrid/actions/runs/45698815441)) | through `20261125260000` local+remote | Facility RLS + email worker leases |
| `647ea0b` | failure ([45701124636](https://github.com/Matik103/SentinelGrid/actions/runs/45701124636)) | through `260000` | Facility tests; TS `never` in assignment test |
| `07b06ee` | **success** ([45701978909](https://github.com/Matik103/SentinelGrid/actions/runs/45701978909)) | through `20261125260000` local+remote | Facility isolation SQL + email lease tests + 3-level checklist |

**Still OPEN (do not close Phase 0):**
- Production email delivery without Resend creds (**ops**)
- Full OT protocol acquisition (**ops** — needs maps/node IDs/topics)
- Real backup + object-store restore drill (**ops**)

**Phase 0 status:** PARTIALLY COMPLETE / IN TESTING — tip CI green on `07b06ee`, migrations through `260000` remote — **not COMPLETE**.
