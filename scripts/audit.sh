#!/usr/bin/env bash
# SentinelGrid Engineering Quality Gate — single entrypoint for local + CI.
# Never weakens security tests. Skips checks that cannot run yet and records why.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REPORT_DIR="$ROOT/reports"
REPORT_JSON="$REPORT_DIR/audit-report.json"
mkdir -p "$REPORT_DIR"

STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
export DOCKER_HOST="${DOCKER_HOST:-unix://${HOME}/.colima/default/docker.sock}"

# Collect findings as JSON lines then assemble.
TMP="$(mktemp -d)"
FINDINGS="$TMP/findings.jsonl"
: > "$FINDINGS"

add_finding() {
  local severity="$1" id="$2" title="$3" file_ref="$4" remediation="$5" status="$6"
  python3 - "$severity" <<'PY' >> "$FINDINGS"
import json, sys
severity, id_, title, file_ref, remediation, status = sys.argv[1:7]
print(json.dumps({
  "id": id_,
  "severity": severity,
  "title": title,
  "file": file_ref,
  "remediation": remediation,
  "status": status,
}, ensure_ascii=False))
PY
}

pass_check() {
  local id="$1" title="$2" file_ref="$3"
  add_finding "info" "$id" "$title" "$file_ref" "" "passed"
  echo "PASS  $id — $title"
}

fail_check() {
  local severity="$1" id="$2" title="$3" file_ref="$4" remediation="$5"
  add_finding "$severity" "$id" "$title" "$file_ref" "$remediation" "failed"
  echo "FAIL  $id — $title" >&2
}

skip_check() {
  local id="$1" title="$2" reason="$3"
  add_finding "info" "$id" "$title" "" "$reason" "not_applicable"
  echo "N/A   $id — $title ($reason)"
}

FAILURES=0

echo "== SentinelGrid audit =="
echo "root: $ROOT"
echo "started: $STARTED_AT"

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
if command -v supabase >/dev/null; then
  pass_check "env.supabase_cli" "Supabase CLI present" "scripts/audit.sh"
else
  fail_check "high" "env.supabase_cli" "Supabase CLI missing" "scripts/audit.sh" \
    "Install Supabase CLI to run local migration and security verification."
  FAILURES=$((FAILURES + 1))
fi

if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  pass_check "env.docker" "Docker daemon reachable" "scripts/audit.sh"
else
  skip_check "env.docker" "Docker daemon" \
    "Docker/Colima not reachable in this environment; DB-backed checks will be skipped."
fi

if command -v gh >/dev/null; then
  pass_check "env.gh" "GitHub CLI present" "scripts/audit.sh"
else
  skip_check "env.gh" "GitHub CLI" "gh not installed; remote branch checks skipped."
fi

# ---------------------------------------------------------------------------
# Dependencies / repo consistency
# ---------------------------------------------------------------------------
if [[ -f package.json ]]; then
  skip_check "deps.npm" "npm install / test" "package.json exists but app scripts not defined yet."
else
  skip_check "deps.npm" "Application package dependencies" \
    "No package.json yet — schema-only Phase 0 foundation."
fi

if [[ -f .gitignore ]] && grep -q '^\.env' .gitignore; then
  pass_check "repo.gitignore_env" ".env ignored" ".gitignore"
else
  fail_check "high" "repo.gitignore_env" ".env not ignored" ".gitignore" \
    "Ensure .env and secrets are gitignored."
  FAILURES=$((FAILURES + 1))
fi

if git ls-files | grep -E '(^\.env$|\.pem$|service_role)' >/dev/null; then
  fail_check "critical" "repo.secrets_committed" "Possible secret file tracked" "." \
    "Remove secrets from git history and rotate credentials."
  FAILURES=$((FAILURES + 1))
else
  pass_check "repo.no_secret_files" "No obvious secret files tracked" ".gitignore"
fi

# ---------------------------------------------------------------------------
# Migrations + seed path
# ---------------------------------------------------------------------------
FOUNDATION="supabase/migrations/20261125160000_phase0_foundation.sql"
HARDEN="supabase/migrations/20261125170000_phase0_security_hardening.sql"
GRANTS="supabase/migrations/20261125180000_phase0_security_grants_and_platform_boundary.sql"
SEED="supabase/seed/phase0_demo.sql"

for f in "$FOUNDATION" "$HARDEN" "$GRANTS" "$SEED"; do
  if [[ -f "$f" ]]; then
    pass_check "files.present.$(basename "$f")" "Required file present" "$f"
  else
    fail_check "critical" "files.missing.$(basename "$f")" "Required file missing" "$f" \
      "Restore the missing migration or seed file."
    FAILURES=$((FAILURES + 1))
  fi
done

if grep -q 'sql_paths = \["./seed/phase0_demo.sql"\]' supabase/config.toml; then
  pass_check "seed.path" "Seed path points at phase0_demo.sql" "supabase/config.toml"
else
  fail_check "high" "seed.path" "Seed path misconfigured" "supabase/config.toml" \
    "Set [db.seed] sql_paths to [\"./seed/phase0_demo.sql\"]."
  FAILURES=$((FAILURES + 1))
fi

if grep -n "FOR ALL TO authenticated" "$HARDEN" >/dev/null 2>&1; then
  fail_check "high" "sql.broad_for_all" "Broad FOR ALL policy still in hardening migration" "$HARDEN" \
    "Replace FOR ALL with permission-gated policies."
  FAILURES=$((FAILURES + 1))
else
  pass_check "sql.no_for_all_in_hardening" "Hardening migration avoids FOR ALL authenticated" "$HARDEN"
fi

# ---------------------------------------------------------------------------
# Security tests (local DB)
# ---------------------------------------------------------------------------
DB_UP=0
if command -v supabase >/dev/null && docker info >/dev/null 2>&1; then
  if supabase status >/dev/null 2>&1; then
    DB_UP=1
  fi
fi

if [[ "$DB_UP" -eq 1 ]]; then
  if [[ -x scripts/run-phase0-security-tests.sh ]]; then
    if scripts/run-phase0-security-tests.sh; then
      pass_check "security.tenant_isolation_sql" "Phase 0 tenant isolation SQL tests" \
        "supabase/tests/phase0_tenant_isolation.sql"
    else
      fail_check "critical" "security.tenant_isolation_sql" \
        "Phase 0 tenant isolation SQL tests failed" \
        "supabase/tests/phase0_tenant_isolation.sql" \
        "Fix RLS/grants/policies; do not weaken tests."
      FAILURES=$((FAILURES + 1))
    fi
  else
    fail_check "high" "security.test_runner" "Security test runner missing" \
      "scripts/run-phase0-security-tests.sh" "Restore executable runner script."
    FAILURES=$((FAILURES + 1))
  fi

  # Seed orgs present after reset/start
  if docker ps --format '{{.Names}}' | grep -q '^supabase_db_'; then
    CTR="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)"
    COUNT="$(docker exec -i "$CTR" psql -U postgres -d postgres -Atc \
      "select count(*) from public.organisations where slug in ('demo-org-alpha','demo-org-beta');" 2>/dev/null || echo 0)"
    if [[ "$COUNT" == "2" ]]; then
      pass_check "seed.demo_orgs" "Demo simulated orgs present" "$SEED"
    else
      fail_check "medium" "seed.demo_orgs" "Demo orgs not found in local DB" "$SEED" \
        "Run supabase db reset and confirm seed path."
      FAILURES=$((FAILURES + 1))
    fi
  fi
else
  skip_check "security.tenant_isolation_sql" "Phase 0 tenant isolation SQL tests" \
    "Local Supabase/Docker not running; start disposable local stack to execute."
  skip_check "seed.demo_orgs" "Demo seed verification" \
    "Requires running local Supabase database."
fi

# Product features not yet in repo
skip_check "product.connector_runtime" "Edge connector identity/heartbeat/credential rotation" \
  "Schema fields only; Go connector not implemented."
skip_check "product.ingestion_api" "Event ingestion / dedup / replay / DLQ API" \
  "Ledger uniqueness exists; HTTP ingestion API not implemented."
skip_check "product.payload_storage" "Raw payload object storage" \
  "Documented gap in docs/PAYLOAD_STORAGE.md; refs/hashes only."
skip_check "product.command_shell" "Sentinel Command UI" \
  "No frontend application in repository yet."
skip_check "product.agent_authority" "AI agent authority controls" \
  "Out of Phase 0 scope."

ENDED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"

python3 - "$FINDINGS" "$REPORT_JSON" "$STARTED_AT" "$ENDED_AT" "$BRANCH" "$SHA" "$FAILURES" <<'PY'
import json, sys, pathlib
findings_path, out_path, started, ended, branch, sha, failures = sys.argv[1:8]
findings = []
for line in pathlib.Path(findings_path).read_text().splitlines():
    if line.strip():
        findings.append(json.loads(line))
report = {
    "schema_version": "1.0",
    "project": "SentinelGrid",
    "gate": "engineering-quality-gate",
    "started_at": started,
    "ended_at": ended,
    "git": {"branch": branch, "sha": sha},
    "summary": {
        "failures": int(failures),
        "passed": sum(1 for f in findings if f["status"] == "passed"),
        "failed": sum(1 for f in findings if f["status"] == "failed"),
        "not_applicable": sum(1 for f in findings if f["status"] == "not_applicable"),
        "result": "failed" if int(failures) else "passed",
    },
    "findings": findings,
    "notes": [
        "A green audit is not Phase 0 product acceptance.",
        "Remote/production database apply is out of band and requires explicit approval.",
    ],
}
pathlib.Path(out_path).write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report["summary"], indent=2))
PY

echo "Wrote $REPORT_JSON"
if [[ "$FAILURES" -gt 0 ]]; then
  exit 1
fi
exit 0
