# Phase 0 acceptance checklist (authoritative)

**Branch:** `work/phase0-security-hardening`  
**Rule:** Do **not** mark Phase 0 COMPLETE unless every required row is `PASS` with linked evidence (CI URL, migration apply log, test output, or drill report). This document is the repo-local source of truth for gate decisions.

Timezone for operator notes: America/Los_Angeles.

## Product criteria

| # | Criterion | Required evidence | Status |
|---|---|---|---|
| 1 | Multi-tenant bootstrap + membership RBAC | SQL isolation tests + org API | PASS (SQL + API) |
| 2 | Organisation invitations create/accept/revoke + outbox | Migration RPCs + API + unit tests | PASS |
| 3 | Infrastructure registry incl. zones lifecycle | HTTP create/list/archive | PASS (API) |
| 4 | Connector register/heartbeat/rotate/revoke with hashed credentials | API + Go credential lifecycle tests | PASS |
| 5 | Edge connector durable buffer + read-only OT adapters | `edge/connector` unit tests | PASS |
| 6 | Event ingest dedup + DLQ with original payload preserve/replay | Ingestion service + migration columns | PASS |
| 7 | Evidence event↔payload linkage, checkpoints, verify/export | Evidence chain API + tests | PASS (API/unit) |
| 8 | Payload storage SHA-256 + production fail-closed | Payload storage tests + docs | PASS |
| 9 | Rate limiting Redis/memory fail-closed | Middleware tests + docs | PASS |
| 10 | Audit log read API | Audit controller | PASS |
| 11 | Sentinel Command UI wired to live org/registry/events/evidence workflows | `apps/web` API client | PASS (config-gated) |
| 12 | Engineering quality gate green on tip SHA | GitHub Actions audit workflow | **REQUIRED on tip** |
| 13 | Ops docs: backup/recovery, rate limit, payload storage, this checklist | `docs/*` | PASS |

## Operational criteria

| # | Criterion | Required evidence | Status |
|---|---|---|---|
| A | Cross-tenant isolation proven | `supabase/tests/phase0_tenant_isolation.sql` | PASS |
| B | Forward migrations applied to remote `abaeizgfsskvjklfslrh` through latest | Apply script logs | Track per tip |
| C | Restore drill script executed (parity + integrity markers) | `scripts/restore-drill.sh` report | Run before COMPLETE |
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
| `a518912` | pending/fix as recorded | through `20261125230000` | Findings 1–3 |
| _(next)_ | | | Findings 4–9 |

**Phase 0 status:** PARTIALLY COMPLETE — not COMPLETE until row 12 + ops C are green on the same tip.
