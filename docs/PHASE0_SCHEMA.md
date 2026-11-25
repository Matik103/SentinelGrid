# Phase 0 schema notes

Migration: `supabase/migrations/20261125160000_phase0_foundation.sql`

## Tables

| Table | Purpose |
| ----- | ------- |
| organisations | Tenant root |
| profiles | User profile linked to `auth.users` |
| roles / permissions / role_permissions | RBAC catalogue |
| memberships | User ↔ org ↔ role |
| facilities / zones / assets / devices / sensors | Infrastructure registry |
| connectors | Edge connector registry + heartbeat fields |
| events | Event ledger (idempotent on org+source+source_event_id) |
| evidence_records / evidence_checkpoints | Payload integrity |
| audit_logs | Administrative action history |

## RLS

Enabled on all customer-owned tables. Access via `current_user_org_ids()` derived from `memberships` for `auth.uid()` — never from a client-supplied tenant id. Platform administrator role may cross tenants.

## Not yet in this migration

- Auth UI / invitation flows
- Go edge connector runtime
- Ingestion API + Zod validation
- Automated tenant-isolation test suite
- Command shell UI
- Object storage for raw payloads
