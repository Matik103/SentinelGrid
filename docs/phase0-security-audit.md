# Phase 0 security audit — SentinelGrid

**Branch:** `work/phase0-security-hardening` (`12cca40`)  
**Remote DB (abaeizgfsskvjklfslrh):** Forward migrations `20261125170000` and `20261125180000` **applied** via Management API (statement-by-statement; multi-statement batches were no-ops). Verified: `platform_admins` present, `bootstrap_organisation` / `has_org_permission` present, 16 `*_same_org_*` FKs, `memberships_write` removed, `memberships_insert_admin` present, demo orgs=2.  
**Phase 0 status:** Not COMPLETE.

## Exact findings (pre-fix review of `20261125170000`)

| ID | Severity | Finding | Remediation |
| -- | -------- | ------- | ----------- |
| F1 | Critical | After foundation + 170000, `authenticated` / `service_role` lacked SELECT/INSERT/UPDATE/DELETE on tenant tables (only REFERENCES/TRIGGER/TRUNCATE). RLS policies were unreachable; DML failed at GRANT layer. | Forward migration `20261125180000` grants least-privilege DML; ledger UPDATE/DELETE revoked for authenticated. |
| F2 | High | `is_platform_admin()` still membership-derived in 170000; no separate platform boundary. | `platform_admins` table + redefined `is_platform_admin()`; grant/revoke RPCs audited; role cannot be assigned via memberships. |
| F3 | High | Org admin could mutate membership `organisation_id` / `user_id` (identity) within RLS. | Trigger `enforce_membership_invariants` blocks identity reassignment. |
| F4 | Medium | No invitee accept path (only admin UPDATE). | Policy `memberships_accept_own` for invited→active; role immutable on accept. |
| F5 | Medium | `bootstrap_organisation` created org+admin but wrote no audit row. | Bootstrap now inserts `organisation.provision` audit log. |
| F6 | Medium | Platform admin EXECUTE grants omitted `service_role` on helpers. | EXECUTE granted to `authenticated` and `service_role`. |
| F7 | Low | Seed path was wrong historically (`./seed.sql`). | Already fixed on branch to `./seed/phase0_demo.sql` (verified). |
| F8 | Info | Raw payload object storage absent. | Documented in `docs/PAYLOAD_STORAGE.md`; ref/hash columns retained as hooks. |
| F9 | Info | 170000 improvements retained: composite same-tenant FKs, permission-gated registry policies, append-only events/evidence policies, org INSERT denied for authenticated, `bootstrap_organisation`, role_permissions mapping. | Keep; do not weaken. |

## Migration strategy

1. Preserve `20261125160000_phase0_foundation.sql` (already applied historically).
2. Keep ChatGPT `20261125170000_phase0_security_hardening.sql` unchanged in intent.
3. Add `20261125180000_phase0_security_grants_and_platform_boundary.sql` for grants + platform boundary + membership invariants + audited bootstrap.
4. Apply forward-only to remote only when explicitly approved.

## Changed / added files (this verification)

- `supabase/migrations/20261125180000_phase0_security_grants_and_platform_boundary.sql`
- `supabase/tests/phase0_tenant_isolation.sql`
- `scripts/run-phase0-security-tests.sh`
- `scripts/audit.sh`
- `docs/PAYLOAD_STORAGE.md`
- `docs/ENGINEERING_QUALITY_GATE.md`
- `docs/phase0-security-audit.md`
- `.github/workflows/audit.yml`
- `supabase/config.toml` (analytics/vector disabled for Colima local; seed path already correct)

## Tests executed (local only)

Commands:

```bash
export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"
supabase start --ignore-health-check -x storage,realtime,studio,imgproxy,edge-runtime
supabase db reset --yes
./scripts/run-phase0-security-tests.sh
```

Results (clean reset with migrations 160000+170000+180000 + seed):

- PASS direct organisations INSERT denied
- PASS bootstrap_organisation assigns first admin
- PASS second organisation provisioned
- PASS non-admin membership insert denied
- PASS membership self-escalation blocked
- PASS platform_administrator assignment blocked for org admin
- PASS cross-tenant facility SELECT denied
- PASS cross-tenant facility UPDATE denied
- PASS cross-tenant device/asset FK rejected
- PASS cross-tenant asset/facility FK rejected
- PASS client-supplied organisation_id does not grant access
- PASS read_only_viewer cannot mutate facilities
- PASS revoked membership loses access
- PASS events append-only for authenticated
- PASS evidence append-only; audit insert denied for authenticated
- PASS service_role can write audit_logs
- PASS invitee can accept invitation
- PASS membership identity immutable
- PASS platform admin boundary uses platform_admins table
- PASS bootstrap_organisation writes audit log
- NOTICE: ALL PHASE0 SECURITY TESTS PASSED

Seed: `demo-org-alpha` and `demo-org-beta` present with `settings.simulated=true` after `db reset`.

Upgrade-path simulation was started (foundation-only reset then `migration up`) but interrupted to restore files for the approved push/apply; **do not treat upgrade-path as passed in this report**. Re-run before production apply if required.

## Remaining limitations

- No application API layer; SECURITY DEFINER RPCs + RLS are DB controls only.
- Facility-scoped RBAC not modelled (facility_manager is org-wide).
- First platform admin still requires out-of-band insert (service role / operator).
- Object storage, connector runtime, ingestion API, Command shell, CI green on GitHub Actions not proven until workflow runs on GitHub.
- Analytics disabled locally due to Colima docker.sock mount failure for vector.

## Recommended next milestone

Wire a minimal NestJS/Next auth surface that uses `bootstrap_organisation` and never exposes service-role keys; add CI-confirmed `./scripts/audit.sh` on GitHub; then explicitly approve remote migration apply with preflight for cross-tenant FK violations.
