# Implementation status — Phase 0

**Branch:** `work/phase0-security-hardening`  
**Phase status:** **PARTIALLY COMPLETE / IN TESTING** — not COMPLETE.  
**Timezone note:** dates below are America/Los_Angeles unless marked otherwise.

Do not mark Phase 0 COMPLETE until `docs/PHASE0_ACCEPTANCE_CHECKLIST.md` rows are all PASS with tip CI green + restore drill report. See also Project store PRD/gates.

## Capability maturity

| Capability | Status | Evidence |
|---|---|---|
| Auth / tenancy (bootstrap, membership, RBAC) | INTEGRATION TESTED (SQL) | `supabase/tests/phase0_tenant_isolation.sql` |
| Organisation invitations create/accept/revoke | PARTIAL | Tenant-scoped revoke; invitation role guard; `20261125240000` adds separate committed expiry-by-token path; production email transport/worker still absent |
| Infrastructure registry HTTP API | IMPLEMENTED | `apps/api/src/registry/*` (CRUD subset); SQL RLS exists |
| Connector register / heartbeat / rotate / revoke API | IMPLEMENTED; ingest integration pending | `apps/api/src/connectors/*`; `/v1/connectors/ingest` derives tenant from connector token; current-tip CI/integration tests pending |
| Edge Go connector durable runtime | UNIT TESTED; protocol acquisition limited | `edge/connector`; OPC UA/Modbus/MQTT adapters currently probe reachability, not process telemetry |
| Event ingest + dedup + DLQ | PARTIAL | Replay now rejects missing original payload; failure-path and integration tests pending |
| Event search/list API | IMPLEMENTED | `GET /v1/events` |
| Evidence payload storage SHA-256 + S3 | UNIT TESTED | `apps/api/src/evidence/*`, `docs/PAYLOAD_STORAGE.md` |
| Evidence chain / checkpoints API | PARTIAL | API exists; atomic per-organisation append RPC added in `20261125240000`; migration apply + concurrency tests pending |
| Rate limiting | UNIT TESTED | Redis or memory; prod fail-closed — `docs/RATE_LIMITING.md` |
| Audit log read API | IMPLEMENTED | `GET /v1/orgs/:id/audit-logs` |
| Sentinel Command UI | PARTIAL (config-gated live API) | `apps/web`; full authentication/onboarding/browser E2E not proven |
| Backup/recovery drill | DOCUMENTED ONLY | `docs/BACKUP_RECOVERY.md` — drill pending |
| OpenAPI contract | NOT IMPLEMENTED | — |

## Acceptance criteria (honest)

Product table (§10): criteria 1–2 have SQL evidence; 3–10 have schema/API path but incomplete end-to-end product proof; 11 UI shell only; 12 CI required; 13 docs partial.

Operational table: isolation tests exist; backup drill **not** done; dashboard screenshots **not** done.

## Remote migrations (`abaeizgfsskvjklfslrh`)

Previously applied through `20261125230000_phase0_outbox_dlq_creds_role_guard.sql` per prior branch notes. New migration `20261125240000_phase0_atomic_evidence_and_invite_expiry.sql` is committed to the working branch but NOT applied remotely; Cursor/operator must review and apply it to the intended non-production database, then verify the RPCs and tests. No production migration was applied by this work.
