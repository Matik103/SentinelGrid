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
| Evidence chain / checkpoints API | PARTIAL | API exists; atomic per-organisation append RPC in `20261125240000` (local applied; remote after local gate); concurrency stress still open |
| Rate limiting | UNIT TESTED | Redis or memory; prod fail-closed — `docs/RATE_LIMITING.md` |
| Audit log read API | IMPLEMENTED | `GET /v1/orgs/:id/audit-logs` |
| Sentinel Command UI | PARTIAL (config-gated live API) | `apps/web`; full authentication/onboarding/browser E2E not proven |
| Backup/recovery drill | DOCUMENTED ONLY | `docs/BACKUP_RECOVERY.md` — **real restore drill still OPEN** |
| OpenAPI contract | DRAFTED | `docs/openapi.yaml` present; keep in sync with routes |
| Production email transport/worker | OPEN | Outbox table + local_log only |
| Full OT telemetry | OPEN | Adapters are reachability probes today |
| Facility-manager facility scoping | OPEN | Org-scoped RBAC exists; facility-scoped manager grants not proven |

## Acceptance criteria (honest)

Product table (§10): criteria 1–2 have SQL evidence; 3–10 have schema/API path but incomplete end-to-end product proof; 11 UI shell only; 12 CI required; 13 docs partial.

Operational table: isolation tests exist; backup drill **not** done; dashboard screenshots **not** done.

## Remote migrations (`abaeizgfsskvjklfslrh`)

Local disposable Supabase: through `20261125240000` (verified via `supabase db reset` + upgrade-path + `append_evidence_record` / `expire_organisation_invitation_by_token` present).  
Remote `abaeizgfsskvjklfslrh`: previously through `20261125230000`; `20261125240000` applied only after local gate pass (see tip evidence log). No main merge.
