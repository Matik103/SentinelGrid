# Phase 0 security hardening

Status: drafted on `work/phase0-security-hardening`; **locally runtime-verified** (see [phase0-security-audit.md](./phase0-security-audit.md)). Follow-up migration `20261125180000` required for table grants + platform-admin boundary.

## Changes

- Added `20261125170000_phase0_security_hardening.sql` as a forward-only migration. The original foundation migration is preserved.
- Restricted organisation creation to the atomic `bootstrap_organisation(name, slug)` function or trusted service-role backend provisioning.
- Added role-to-permission mappings and `has_org_permission` checks for tenant operations.
- Restricted membership changes to organisation administrators or platform administrators. Tenant administrators cannot assign the platform-administrator role.
- Replaced broad registry `FOR ALL` policies with permission-gated SELECT/INSERT/UPDATE/DELETE policies.
- Made events and evidence append-only through authenticated RLS policies: no authenticated UPDATE or DELETE policy is defined.
- Removed authenticated audit-log insertion; trusted backend/service-role code is responsible for audit writes.
- Added composite foreign keys so related facilities, assets, devices, sensors, connectors, events and evidence records must belong to the same organisation.
- Corrected the Supabase seed path to `./seed/phase0_demo.sql`.

## Important deployment warning

The composite foreign keys intentionally fail if existing rows contain cross-organisation references. Before applying the migration to any database with data, run a preflight query for every relationship and repair or quarantine invalid rows. Do not drop or bypass the constraints to force the migration through.

This work has **not** been applied to a remote Supabase project. Do not run `supabase db push` against production until:
1. the migration has been reviewed;
2. it has been applied to a disposable local database;
3. the security regression tests pass;
4. existing-data preflight checks pass;
5. the resulting policies and grants have been inspected.

## Required local verification

Run with a current Supabase CLI and a disposable local database:

```bash
supabase start
supabase db reset
supabase test db
```

Add and execute regression tests for all cases below before marking this security milestone complete.

### Tenant isolation
- A user in organisation A cannot SELECT, INSERT, UPDATE or DELETE organisation B rows in every tenant-owned table.
- A relationship cannot point from an organisation A row to an organisation B facility, asset, device, sensor, connector or event.
- An organisation identifier supplied by a client never grants access by itself.

### Provisioning and membership
- An authenticated user can create an organisation only through `bootstrap_organisation`; the call creates the organisation and its first administrator membership atomically.
- Direct authenticated INSERT into `organisations` is denied.
- A normal member cannot create, update, revoke or delete memberships.
- An organisation administrator can manage memberships only in their own organisation.
- An organisation administrator cannot assign the platform-administrator role.
- A platform administrator can manage tenant memberships but cannot promote another user to platform administrator through tenant membership APIs.
- Invalid slugs and blank names are rejected.

### RBAC
- Read-only viewer cannot mutate facilities, assets, devices, sensors or connectors.
- Facility manager cannot manage memberships or connectors.
- Security analyst can read permitted security evidence but cannot mutate infrastructure.
- Organisation administrator has the intended organisation-level permissions.
- Unknown permission keys deny access.

### Integrity and audit
- Authenticated users cannot UPDATE or DELETE events.
- Authenticated users cannot UPDATE or DELETE evidence records or checkpoints.
- Authenticated users cannot INSERT fabricated audit-log records.
- Trusted backend/service-role paths can append events, evidence and audit records as designed.
- Evidence hashes are not represented as proof that a sensor or source was truthful.

### Operational checks
- Seed reset loads both clearly labelled simulated organisations.
- Migration applies cleanly from an empty local database.
- Migration is tested against a copy of any existing database after cross-tenant relationship preflight.
- Inspect effective table grants, RLS policies, function ownership, function EXECUTE grants and service-role usage.

## Known limitations / next work

- This is database policy hardening, not a complete application authorization layer. API handlers must still validate business rules and avoid exposing service-role credentials.
- The current schema has a global role catalogue. Custom per-organisation roles are not implemented.
- Facility-level scoping for facility managers is not yet represented in memberships; their current permissions are organisation-wide.
- Connector credential issuance, rotation and revocation workflows are not implemented by this migration.
- Audit-log integrity, external immutability/WORM storage, signed evidence checkpoints and object-storage policies remain future work.
- The migration has not been executed against PostgreSQL in this environment. Static review is not a substitute for runtime tests.

## Cursor collaboration task

Open this branch in Cursor and ask the agent to independently review and execute the migration against a disposable local Supabase database. Do not modify the original foundation migration, do not connect to production, and do not weaken policies to make tests pass. Fix any SQL, policy, grant, or test failures on this same branch, add repeatable regression tests, and report exact commands/results plus any remaining blockers. Review the changes before committing additional Cursor-generated edits.

## Upgrade-path verification

Mandatory local/CI check: `scripts/run-phase0-upgrade-path.sh`

1. Reset with only `20261125160000_phase0_foundation.sql`
2. Apply forward migrations with `supabase migration up --local`
3. Assert `bootstrap_organisation`, `platform_admins`, same-org FKs, and membership policies

Wired into `scripts/audit.sh` (fails CI when `REQUIRE_DB_CHECKS=1` if unavailable).
