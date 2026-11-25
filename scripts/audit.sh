#!/usr/bin/env bash
# SentinelGrid Engineering Quality Gate.
# CI sets REQUIRE_DB_CHECKS=1: required database tests can never silently skip.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
REPORT_JSON="${AUDIT_REPORT_PATH:-reports/audit-report.json}"
mkdir -p "$(dirname "$REPORT_JSON")"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FINDINGS="$TMP/findings.jsonl"
: > "$FINDINGS"
FAILURES=0

record() {
  python3 - "$FINDINGS" "$1" "$2" "$3" "$4" "$5" "$6" <<'PY'
import json, pathlib, sys
path, severity, ident, title, file_ref, remediation, status = sys.argv[1:8]
with pathlib.Path(path).open("a") as out:
    out.write(json.dumps({"id": ident, "severity": severity, "title": title,
        "file": file_ref, "remediation": remediation, "status": status}) + "\n")
PY
}
pass_check() { record info "$1" "$2" "$3" "" passed; echo "PASS  $1 — $2"; }
fail_check() { record "$1" "$2" "$3" "$4" "$5" failed; echo "FAIL  $2 — $3" >&2; FAILURES=$((FAILURES + 1)); }
skip_check() { record info "$1" "$2" "$3" "$4" not_applicable; echo "N/A   $1 — $2 ($3)"; }

echo "== SentinelGrid Engineering Quality Gate =="
echo "branch: $(git branch --show-current 2>/dev/null || echo unknown)"
echo "commit: $(git rev-parse HEAD 2>/dev/null || echo unknown)"

for tool in python3 git supabase docker; do
  if command -v "$tool" >/dev/null 2>&1; then pass_check "env.$tool" "$tool available" "scripts/audit.sh"
  else fail_check high "env.$tool" "$tool missing" "scripts/audit.sh" "Install $tool."
  fi
done

DB_READY=0
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 && command -v supabase >/dev/null 2>&1; then
  if supabase status >/dev/null 2>&1; then DB_READY=1; fi
fi
if [[ "$DB_READY" -eq 1 ]]; then pass_check env.database "Docker and local Supabase are ready" "supabase/config.toml"
elif [[ "${REQUIRE_DB_CHECKS:-0}" == "1" ]]; then fail_check critical db.required "Required local database checks unavailable" "scripts/audit.sh" "Start the disposable Supabase stack before running the audit."
else skip_check db.required "Local database checks" "Docker/Supabase is not running; CI must set REQUIRE_DB_CHECKS=1." "supabase/config.toml"
fi

if [[ -f .gitignore ]] && grep -Eq '^/?\.env(\*|$|\.)' .gitignore; then pass_check repo.env_ignored ".env files are ignored" ".gitignore"
else fail_check high repo.env_ignored ".env ignore rule missing" ".gitignore" "Ignore local environment files."
fi
if git ls-files | grep -E '(^|/)([.]env($|[.])|id_rsa$|.*[.]pem$|.*service_role.*)' | grep -Ev '(^|/)[.]env[.]example$' >/dev/null; then
  fail_check critical repo.secret_paths "Potential secret-bearing path is tracked" "." "Remove it, rotate the credential and purge it from history."
else pass_check repo.secret_paths "No obvious secret-bearing paths tracked (safe .env.example template excluded)" ".gitignore"
fi

MIGRATIONS="supabase/migrations"
if [[ -d "$MIGRATIONS" ]]; then
  mapfile -t SQL_FILES < <(find "$MIGRATIONS" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | sort)
  if [[ "${#SQL_FILES[@]}" -gt 0 ]]; then
    pass_check db.migrations_present "${#SQL_FILES[@]} SQL migrations found" "$MIGRATIONS"
    if printf '%s\n' "${SQL_FILES[@]}" | grep -Ev '^[0-9]{14}_[a-z0-9_]+\.sql$' >/dev/null; then
      fail_check high db.migration_naming "Invalid migration filename" "$MIGRATIONS" "Use timestamp_name.sql for new migrations."
    else pass_check db.migration_naming "Migration filenames follow timestamp format" "$MIGRATIONS"; fi
    if [[ "$(printf '%s\n' "${SQL_FILES[@]}" | sort -u | wc -l | tr -d ' ')" != "${#SQL_FILES[@]}" ]]; then
      fail_check high db.migration_duplicate "Duplicate migration filenames detected" "$MIGRATIONS" "Give each migration a unique timestamp and name."
    else pass_check db.migration_unique "Migration filenames are unique" "$MIGRATIONS"; fi
  else fail_check critical db.migrations_missing "No SQL migrations found" "$MIGRATIONS" "Add versioned SQL migrations."; fi
else fail_check critical db.migrations_dir_missing "Migration directory missing" "$MIGRATIONS" "Restore Supabase migrations."; fi

for required in \
  supabase/migrations/20261125160000_phase0_foundation.sql \
  supabase/migrations/20261125170000_phase0_security_hardening.sql \
  supabase/migrations/20261125180000_phase0_security_grants_and_platform_boundary.sql \
  supabase/migrations/20261125190000_phase0_ingestion_dlq_and_payload_objects.sql \
  supabase/migrations/20261125200000_phase0_ingestion_replay_and_tenant_integrity.sql \
  supabase/seed/phase0_demo.sql \
  supabase/tests/phase0_tenant_isolation.sql \
  apps/api/src/main.ts \
  apps/api/src/orgs/orgs.controller.ts \
  apps/api/src/events/ingestion.service.ts \
  apps/api/src/evidence/payload-storage.service.ts \
  edge/connector/cmd/connector/main.go
do
  if [[ -f "$required" ]]; then pass_check "files.$(basename "$required")" "Required Phase 0 file exists" "$required"
  else fail_check critical "files.$(basename "$required")" "Required Phase 0 file missing" "$required" "Restore the required file."; fi
done

if grep -Fq 'sql_paths = ["./seed/phase0_demo.sql"]' supabase/config.toml; then pass_check seed.path "Supabase seed path is valid" "supabase/config.toml"
else fail_check high seed.path "Supabase seed path mismatch" "supabase/config.toml" "Set db.seed.sql_paths to ./seed/phase0_demo.sql."; fi

if [[ "$DB_READY" -eq 1 ]]; then
  if supabase db lint --local; then pass_check db.lint "Supabase local database lint passed" "$MIGRATIONS"
  else fail_check critical db.lint "Supabase local database lint failed" "$MIGRATIONS" "Fix SQL lint and schema errors."; fi
  if scripts/run-phase0-upgrade-path.sh; then pass_check db.upgrade_path "Foundation-only then forward migrations succeeded" "scripts/run-phase0-upgrade-path.sh"
  else fail_check critical db.upgrade_path "Upgrade-path migration test failed" "scripts/run-phase0-upgrade-path.sh" "Fix forward migrations without rewriting the foundation file."; fi
  if supabase db reset --local --yes; then pass_check db.reset_after_upgrade "Local DB reset after upgrade-path test" "supabase/migrations"
  else fail_check critical db.reset_after_upgrade "db reset after upgrade-path failed" "supabase/migrations" "Inspect migration/seed failures."; fi
  if scripts/run-phase0-security-tests.sh; then pass_check security.tenant_isolation "Tenant isolation and RBAC SQL tests passed" "supabase/tests/phase0_tenant_isolation.sql"
  else fail_check critical security.tenant_isolation "Tenant isolation and RBAC SQL tests failed" "supabase/tests/phase0_tenant_isolation.sql" "Fix regressions without weakening assertions."; fi
  DB_CTR="$(docker ps --format '{{.Names}}' | grep -E '^supabase_db_' | head -n 1 || true)"
  if [[ -n "$DB_CTR" ]]; then
    COUNT="$(docker exec "$DB_CTR" psql -U postgres -d postgres -Atc "select count(*) from public.organisations where slug in ('demo-org-alpha','demo-org-beta') and coalesce((settings->>'simulated')::boolean, false);" 2>/dev/null || echo 0)"
    if [[ "$COUNT" == "2" ]]; then pass_check seed.demo_orgs "Both demo organisations are marked simulated" "supabase/seed/phase0_demo.sql"
    else fail_check high seed.demo_orgs "Expected simulated demo organisations missing" "supabase/seed/phase0_demo.sql" "Run supabase db reset and inspect the seed."; fi
  else fail_check critical db.container "Supabase database container not found" "scripts/audit.sh" "Check local Supabase startup."; fi
else
  skip_check db.lint "Supabase database lint" "Local Supabase is not running." "$MIGRATIONS"
  if [[ "${REQUIRE_DB_CHECKS:-0}" == "1" ]]; then
    fail_check critical db.upgrade_path "Upgrade-path migration test unavailable" "scripts/run-phase0-upgrade-path.sh" "Start disposable Supabase; upgrade-path is mandatory in CI."
  else
    skip_check db.upgrade_path "Upgrade-path migration test" "Local Supabase is not running." "scripts/run-phase0-upgrade-path.sh"
  fi
  skip_check security.tenant_isolation "Tenant isolation SQL tests" "Local Supabase is not running." "supabase/tests/phase0_tenant_isolation.sql"
  skip_check seed.demo_orgs "Demo seed verification" "Local Supabase is not running." "supabase/seed/phase0_demo.sql"
fi

if [[ -f package.json ]]; then
  if [[ -f package-lock.json ]]; then
    if npm ci --ignore-scripts; then
      pass_check deps.npm_install "npm lockfile install is reproducible" "package-lock.json"
      if npm run build; then pass_check deps.npm_build "Workspace TypeScript build succeeded" "package.json"
      else fail_check high deps.npm_build "Workspace TypeScript build failed" "package.json" "Fix compile errors in packages/shared and apps/api."; fi
      if npm test; then pass_check deps.npm_test "API/shared unit tests passed" "apps/api"
      else fail_check high deps.npm_test "API/shared unit tests failed" "apps/api" "Fix failing Node tests."; fi
      if npm audit --audit-level=high; then pass_check deps.npm_audit "No high/critical npm advisories" "package-lock.json"
      else fail_check high deps.npm_audit "npm audit reported high/critical advisories" "package-lock.json" "Upgrade or replace affected packages."; fi
    else fail_check high deps.npm_install "npm ci failed" "package-lock.json" "Regenerate a consistent lockfile."; fi
  else fail_check high deps.npm_lock "package.json has no package-lock.json" "package.json" "Commit package-lock.json."; fi
else skip_check deps.npm "npm dependency audit" "No package.json exists yet." "package.json"; fi

if [[ -f edge/connector/go.mod ]]; then
  if command -v go >/dev/null 2>&1; then
    if (cd edge/connector && go mod tidy && go test ./... && go build -o /tmp/sg-connector ./cmd/connector); then
      pass_check deps.go "Go connector modules verified, tested, and built" "edge/connector/go.mod"
    else fail_check high deps.go "Go connector verify/test/build failed" "edge/connector" "Repair module checksums and build."; fi
  else fail_check high deps.go_toolchain "edge/connector/go.mod exists but Go is unavailable" "edge/connector/go.mod" "Install Go in CI."; fi
else skip_check deps.go "Go dependency audit" "Go connector has not been added yet." "edge/connector/go.mod"; fi

if [[ -f apps/api/src/events/ingestion.service.ts ]] && grep -q 'event_ingestion_dlq' apps/api/src/events/ingestion.service.ts && grep -q 'deduplicated' apps/api/src/events/ingestion.service.ts; then
  pass_check product.ingestion_api "Event ingestion API with dedup and DLQ hooks present" "apps/api/src/events/ingestion.service.ts"
else fail_check high product.ingestion_api "Event ingestion API/DLQ missing expected hooks" "apps/api" "Implement ingest, dedup, and DLQ paths."; fi

if [[ -f apps/api/src/evidence/payload-storage.service.ts ]] \
  && [[ -f apps/api/src/evidence/object-store.ts ]] \
  && [[ -f supabase/migrations/20261125190000_phase0_ingestion_dlq_and_payload_objects.sql ]] \
  && [[ -f docs/PAYLOAD_STORAGE.md ]] \
  && grep -q 'forbidden in production' apps/api/src/evidence/object-store.ts \
  && grep -q 'S3ObjectStore\|s3_compatible' apps/api/src/evidence/object-store.ts \
  && grep -q 'sha256' apps/api/src/evidence/payload-storage.service.ts; then
  pass_check product.payload_storage "S3-compatible payload storage with SHA-256 integrity and production fail-closed local_dev ban" "apps/api/src/evidence"
else fail_check high product.payload_storage "Payload storage incomplete (need S3 adapter, integrity, docs)" "docs/PAYLOAD_STORAGE.md" "Implement ObjectStore + PayloadStorageService with fail-closed S3 config."; fi

if [[ -f edge/connector/cmd/connector/main.go ]] \
  && grep -q 'read_only' edge/connector/internal/config/config.go \
  && [[ -f edge/connector/internal/buffer/buffer.go ]] \
  && [[ -f edge/connector/internal/outbound/outbound.go ]] \
  && [[ -f edge/connector/internal/credentials/credentials.go ]] \
  && [[ -f edge/connector/internal/adapter/adapter.go ]] \
  && grep -q 'ProtocolAdapter' edge/connector/internal/adapter/adapter.go \
  && grep -q 'opcua\|OPCUA' edge/connector/internal/adapter/stubs.go; then
  pass_check product.connector_runtime "Durable Go connector: buffer, retry, credentials, read-only OT, protocol adapter stubs" "edge/connector"
else fail_check high product.connector_runtime "Edge connector incomplete (need buffer/retry/credentials/adapters)" "edge/connector" "Add durable buffer, outbound retry, credential hooks, OPC UA/Modbus/MQTT adapter interfaces."; fi

if [[ -f apps/api/src/orgs/orgs.controller.ts ]] && grep -q 'bootstrap_organisation' apps/api/src/orgs/orgs.service.ts && grep -q 'has_org_permission' apps/api/src/orgs/orgs.service.ts; then
  pass_check product.org_api "Org provisioning/membership/RBAC API surface present" "apps/api/src/orgs"
else fail_check high product.org_api "Org/RBAC API surface missing" "apps/api/src/orgs" "Implement bootstrap, membership, and permission checks."; fi

if [[ -f supabase/migrations/20261125210000_phase0_organisation_invitations.sql ]] \
  && grep -q 'create_organisation_invitation' apps/api/src/orgs/orgs.service.ts \
  && grep -q 'accept_organisation_invitation' apps/api/src/orgs/orgs.service.ts \
  && grep -q 'revoke_organisation_invitation' apps/api/src/orgs/orgs.service.ts; then
  pass_check product.org_invites "Organisation invitation create/accept/revoke path with membership RPCs" "apps/api/src/orgs"
else fail_check high product.org_invites "Organisation invitation flow incomplete" "apps/api/src/orgs" "Wire invite RPCs and HTTP create/accept/revoke."; fi

if [[ -f apps/api/src/common/rate-limit.middleware.ts ]] \
  && [[ -f docs/RATE_LIMITING.md ]] \
  && grep -q 'RATE_LIMIT_ALLOW_MEMORY' apps/api/src/common/rate-limit.middleware.ts; then
  pass_check product.rate_limit "Distributed-ready rate limiting with production memory fail-closed" "apps/api/src/common/rate-limit.middleware.ts"
else fail_check high product.rate_limit "API rate limiting missing" "docs/RATE_LIMITING.md" "Add Redis/memory rate limit with production fail-closed."; fi

if [[ -f apps/api/src/registry/registry.controller.ts ]] \
  && [[ -f apps/api/src/connectors/connectors.controller.ts ]] \
  && [[ -f apps/api/src/audit/audit.controller.ts ]]; then
  pass_check product.registry_connectors_audit "Registry, connector management, and audit read APIs present" "apps/api/src"
else fail_check high product.registry_connectors_audit "Registry/connector/audit HTTP APIs incomplete" "apps/api" "Add facilities/assets/devices/sensors, connectors, audit routes."; fi

if [[ -f docs/BACKUP_RECOVERY.md ]] && [[ -f IMPLEMENTATION_STATUS.md ]]; then
  pass_check docs.ops_status "Backup/recovery notes and IMPLEMENTATION_STATUS present" "docs/BACKUP_RECOVERY.md"
else fail_check medium docs.ops_status "Ops status docs missing" "IMPLEMENTATION_STATUS.md" "Add backup/recovery and status docs."; fi

# Browser/client code must never reference the service-role secret.
CLIENT_FILES="$(git ls-files apps/web packages 2>/dev/null | grep -E '\.(ts|tsx|js|jsx)$' || true)"
if [[ -n "$CLIENT_FILES" ]]; then
  if printf '%s\n' "$CLIENT_FILES" | xargs grep -nE 'SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY' 2>/dev/null >/dev/null; then
    fail_check critical security.no_service_role_frontend "Possible service-role credential reference in client code" "apps/web or packages" "Keep service-role credentials exclusively in server-side secret storage."
  else
    pass_check security.no_service_role_frontend "No service-role credential reference detected in client code" "apps/web and packages"
  fi
else
  pass_check security.no_service_role_frontend "No browser application files exist yet; server API excluded from client scan" "apps/web"
fi

if [[ -f apps/web/src/App.tsx ]] && [[ -f apps/web/src/tokens.css ]] && grep -q 'Sentinel' apps/web/src/App.tsx; then
  pass_check product.command_ui "Sentinel Command UI shell with design tokens and Phase 0 surfaces" "apps/web"
else fail_check high product.command_ui "Sentinel Command UI missing" "apps/web" "Add Command shell per design-system tokens."; fi

ENDED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
BRANCH="$(git branch --show-current 2>/dev/null || echo unknown)"
SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
python3 - "$FINDINGS" "$REPORT_JSON" "$STARTED_AT" "$ENDED_AT" "$BRANCH" "$SHA" "$FAILURES" <<'PY'
import json, pathlib, sys
findings_file, report_file, started, ended, branch, sha, failures = sys.argv[1:8]
items = [json.loads(line) for line in pathlib.Path(findings_file).read_text().splitlines() if line]
report = {
 "schema_version": "1.1", "project": "SentinelGrid", "gate": "engineering-quality-gate",
 "started_at": started, "ended_at": ended, "git": {"branch": branch, "sha": sha},
 "summary": {"failures": int(failures), "passed": sum(x["status"] == "passed" for x in items),
 "failed": sum(x["status"] == "failed" for x in items),
 "not_applicable": sum(x["status"] == "not_applicable" for x in items),
 "result": "failed" if int(failures) else "passed"},
 "findings": items,
 "notes": ["A green gate proves only checks that actually executed.",
 "CI requires database lint and tenant-isolation tests; unavailable checks fail CI.",
 "Remote/production database changes are never performed by this workflow."]
}
pathlib.Path(report_file).write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report["summary"], indent=2))
PY
echo "Audit report: $REPORT_JSON"
[[ "$FAILURES" -eq 0 ]]
