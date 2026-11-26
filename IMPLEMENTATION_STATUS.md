# Implementation status — Phase 0

**Branch:** `work/phase0-security-hardening`  
**Phase status:** **PARTIALLY COMPLETE / IN TESTING** — not COMPLETE.  
**Timezone note:** dates below are America/Los_Angeles unless marked otherwise.

Evidence levels: **code** (implemented) · **tested** (automated/CI) · **ops** (live credentials/restore/delivery).  
Do not mark Phase 0 COMPLETE until checklist rows reach required **ops** evidence.

## Capability maturity

| Capability | Status | Evidence |
|---|---|---|
| Auth / tenancy (bootstrap, membership, RBAC) | INTEGRATION TESTED (SQL) | `supabase/tests/phase0_tenant_isolation.sql` |
| Authenticator MFA (TOTP / AAL2) | code / preview | Enrollment UI, API guard, restrictive RLS migration and AAL1/AAL2 SQL regression added; hosted rollout and full API/DB test gate OPEN |
| Organisation invitations create/accept/revoke | tested | Expiry-by-token + outbox; leased email worker **code** (`SG_EMAIL_WORKER_ENABLED`); Resend **ops OPEN** without key |
| Infrastructure registry HTTP API | tested | CRUD subset + zones; SQL RLS |
| Facility-manager scoping + assignments | tested | `20261125250000` RLS + assignment APIs + same-org isolation SQL |
| Connector register / heartbeat / rotate / revoke / ingest | tested | Tenant derived from connector token |
| Edge Go connector durable runtime | unit-tested | **OPEN ops:** OT acquisition needs maps/node IDs/topics (probes today) |
| Event ingest + dedup + DLQ | tested | Fail-closed missing original payload |
| Event search/list API | tested | `GET /v1/events` |
| Evidence payload storage SHA-256 + S3 | tested | |
| Evidence chain / checkpoints API | tested | Atomic append RPC |
| Rate limiting | tested | Redis/memory; prod fail-closed |
| Audit log read API | tested | |
| Sentinel Command UI | code | Config-gated; browser/auth E2E OPEN |
| Backup/recovery drill | **OPEN ops** | Docs only — real restore still OPEN |
| OpenAPI contract | code | `docs/openapi.yaml` |
| Email worker (leases + Resend) | code / tested RPCs | Disabled unless enabled; delivery **ops OPEN** without `RESEND_API_KEY` |

## Acceptance criteria (honest)

Product table (§10): criteria 1–2 have SQL evidence; 3–10 have schema/API path but incomplete end-to-end product proof; 11 UI shell only; 12 CI required; 13 docs partial.

Operational table: isolation tests exist; backup drill **not** done; dashboard screenshots **not** done.

## Remote migrations (`abaeizgfsskvjklfslrh`)

Local disposable: through `20261125260000` (db reset + upgrade-path + facility isolation + email claim/finish tests).  
Remote `abaeizgfsskvjklfslrh`: through `20261125260000` (`facility_user_assignments`, `claim_email_outbox`, `finish_email_outbox` confirmed). No main merge.
