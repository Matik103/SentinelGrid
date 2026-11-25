# Implementation status — Phase 0

**Branch:** `work/phase0-security-hardening`  
**Phase status:** **PARTIALLY COMPLETE / IN TESTING** — not COMPLETE.  
**Timezone note:** dates below are America/Los_Angeles unless marked otherwise.

Do not mark Phase 0 COMPLETE until `docs/PHASE0_ACCEPTANCE_CHECKLIST.md` rows are all PASS with tip CI green + restore drill report. See also Project store PRD/gates.

## Capability maturity

| Capability | Status | Evidence |
|---|---|---|
| Auth / tenancy (bootstrap, membership, RBAC) | INTEGRATION TESTED (SQL) | `supabase/tests/phase0_tenant_isolation.sql` |
| Organisation invitations create/accept/revoke | UNIT + SQL | Migration `20261125210000`, RPCs applied remote, API routes, SQL section 17 |
| Infrastructure registry HTTP API | IMPLEMENTED | `apps/api/src/registry/*` (CRUD subset); SQL RLS exists |
| Connector register / heartbeat / revoke API | IMPLEMENTED | `apps/api/src/connectors/*` |
| Edge Go connector durable runtime | UNIT TESTED | `edge/connector` buffer/retry/credentials/adapters |
| Event ingest + dedup + DLQ | UNIT + SQL | Nest ingest + DLQ migration/tests |
| Event search/list API | IMPLEMENTED | `GET /v1/events` |
| Evidence payload storage SHA-256 + S3 | UNIT TESTED | `apps/api/src/evidence/*`, `docs/PAYLOAD_STORAGE.md` |
| Evidence chain / checkpoints API | NOT IMPLEMENTED | Tables exist; no app wiring |
| Rate limiting | UNIT TESTED | Redis or memory; prod fail-closed — `docs/RATE_LIMITING.md` |
| Audit log read API | IMPLEMENTED | `GET /v1/orgs/:id/audit-logs` |
| Sentinel Command UI shell | IMPLEMENTED (empty states) | `apps/web` — not data-wired E2E |
| Backup/recovery drill | DOCUMENTED ONLY | `docs/BACKUP_RECOVERY.md` — drill pending |
| OpenAPI contract | NOT IMPLEMENTED | — |

## Acceptance criteria (honest)

Product table (§10): criteria 1–2 have SQL evidence; 3–10 have schema/API path but incomplete end-to-end product proof; 11 UI shell only; 12 CI required; 13 docs partial.

Operational table: isolation tests exist; backup drill **not** done; dashboard screenshots **not** done.

## Remote migrations (`abaeizgfsskvjklfslrh`)

Applied through `20261125210000_phase0_organisation_invitations.sql` via Management API.
