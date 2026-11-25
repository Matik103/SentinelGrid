# SentinelGrid Engineering Quality Gate

This checklist is matched to the **current** repository state (Supabase schema + security migrations + SQL tests). A green CI run proves only the checks that were executed — not full Phase 0 product acceptance.

Run locally and in CI:

```bash
./scripts/audit.sh
```

Machine-readable output: `reports/audit-report.json`

## Eight areas

### 1. Code quality
- [ ] SQL migrations are forward-only and reviewable
- [ ] No secrets committed (`.env` ignored; `.env.example` placeholders only)
- [ ] Foundation migration `20261125160000` is not rewritten after apply

### 2. Dependencies
- [ ] No application `package.json` / lockfile yet — N/A until app stack lands
- [ ] Supabase CLI version documented when used for local verification

### 3. API coverage
- [ ] No public HTTP API yet — N/A
- [ ] DB RPC surface documented: `bootstrap_organisation`, `has_org_permission`, `is_platform_admin`, platform-admin grant/revoke

### 4. Architecture
- [ ] Modular monolith + separate edge connector (preferred) — connector not implemented
- [ ] Tenant ownership on customer records
- [ ] Read-only OT default preserved (no write industrial paths in schema)

### 5. Database
- [ ] Migrations apply cleanly on disposable local DB
- [ ] Seed path `./seed/phase0_demo.sql` loads simulated orgs
- [ ] Composite same-tenant FKs present
- [ ] Append-only events/evidence policies + grant revocation

### 6. Security
- [ ] Automated tenant-isolation / RBAC regression SQL tests
- [ ] Organisation provisioning via `bootstrap_organisation` only for clients
- [ ] Membership escalation blocked; platform admin separate from memberships
- [ ] Audit log client insert denied
- [ ] Service-role key never in frontend (no frontend yet; `.env.example` warns)

### 7. Operations
- [ ] Local audit command identical to CI
- [ ] Scheduled GitHub Actions audit
- [ ] Remote/production apply requires explicit approval; preflight for cross-tenant rows

### 8. Product completeness (Phase 0 gate — not claimed by this audit)
- [ ] Auth UI / invitations end-to-end
- [ ] Command shell UI
- [ ] Edge connector runtime
- [ ] Event ingestion API with validation / dedup / DLQ
- [ ] Evidence object storage + verify/export
- [ ] Backup/recovery drill documented and tested

## SentinelGrid-specific checks

| Check | Status in this repo |
| ----- | ------------------- |
| Connector identity / heartbeat / credential rotation | Schema fields only; workflows not implemented |
| Event ingestion / dedup / replay / DLQ | Ledger uniqueness on `(org, source, source_event_id)`; no API/DLQ |
| Evidence integrity | Hash + ref columns; object store absent ([PAYLOAD_STORAGE.md](./PAYLOAD_STORAGE.md)) |
| Incident linkage | Not in Phase 0 schema |
| Agent authority | Out of Phase 0 scope |
| Simulated vs measured vs estimate vs hypothesis | `events.classification` includes simulated/replayed/synthetic/real |
| Read-only OT defaults | No OT write paths in schema |
| Tenant isolation | RLS + grants + SQL regression tests (see `supabase/tests/`) |

**Reminder:** A green build is not proof that connectors, ingestion, evidence storage, or the Command shell work.
