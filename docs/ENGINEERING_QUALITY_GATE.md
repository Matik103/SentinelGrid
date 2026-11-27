# SentinelGrid Engineering Quality Gate

Run locally:

    supabase start -x storage,realtime,studio,imgproxy,edge-runtime,analytics
    supabase db reset --local --yes
    ./scripts/audit.sh

The security test runner targets the local Supabase database only. It never links, pushes or applies migrations to a remote project.

## CI behavior

- Workflow: `.github/workflows/audit.yml` (**Engineering Quality Gate**).
- Runs on pushes and pull requests to `work/sentinel-command-release-v2` (canonical), `main`, and legacy `work/phase0-security-hardening`; daily at 06:00 UTC; and `workflow_dispatch`.
- Node-only release checks (`.github/workflows/sentinelgrid-release-checks.yml`) are **not** a substitute for this gate.
- Uses a pinned Supabase CLI version (`2.75.0` in the workflow).
- Uses the runner's Docker endpoint; scripts do not hard-code a Colima socket.
- Startup and reset failures stop the workflow.
- CI sets `REQUIRE_DB_CHECKS=1`. Database readiness, SQL lint and tenant-isolation failures fail CI.
- ShellCheck validates shell scripts.
- Gitleaks scans repository content for secrets.
- Audit JSON is uploaded as a workflow artifact and ignored by Git.

## Checks

- Toolchain and Docker availability.
- Environment-file ignore rules and obvious tracked secret paths.
- Migration presence, naming and uniqueness.
- Supabase seed path.
- Local database lint.
- Tenant isolation, RBAC, membership and append-only SQL regression tests.
- Demo seed presence and simulated classification.
- npm lockfile reproducibility and high/critical vulnerability audit when a Node project exists.
- Go module verification and tests when a Go module exists.
- Explicit reporting of product capabilities not implemented yet.

## Finding semantics

- passed: check executed and passed.
- failed: check failed, or a required CI check could not execute.
- not_applicable: capability does not exist yet, or an optional local check was unavailable.

A CI run must not be green if required database checks did not execute.

## What a green gate does *not* prove

See [`IMPLEMENTATION_STATUS.md`](../IMPLEMENTATION_STATUS.md) and [`PHASE0_ACCEPTANCE_CHECKLIST.md`](PHASE0_ACCEPTANCE_CHECKLIST.md) for live capability status. A green quality gate proves local disposable DB/security/repo checks on the tip SHA. It is **not** proof of:

- Hosted Supabase migration parity with the repository.
- Production email delivery or invite acceptance.
- Authenticated browser E2E against deployed UI+API.
- Backup/object-store restore drills.
- Live OT / router / wireless / electrical acquisition.

A green quality gate is not Phase 0 complete.
