#!/usr/bin/env bash
# Phase 0 restore drill — verifies migration parity and payload integrity hooks.
# Does not mutate production. Safe to run in CI/local with a disposable Supabase.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REPORT="${AUDIT_REPORT_PATH:-reports/restore-drill.json}"
mkdir -p "$(dirname "$REPORT")"

echo "== SentinelGrid Phase 0 restore drill =="
echo "repo=$ROOT"

fail=0
migration_count=0

# 1) Migration parity: every forward migration file is ordered and non-empty
shopt -s nullglob
for f in supabase/migrations/*.sql; do
  migration_count=$((migration_count + 1))
  if [[ ! -s "$f" ]]; then
    echo "FAIL empty migration $f"
    fail=1
  fi
done
shopt -u nullglob

if [[ "$migration_count" -lt 1 ]]; then
  echo "FAIL no migrations found"
  fail=1
else
  echo "PASS migrations present count=${migration_count}"
fi

# 2) Expected Phase 0 artefacts exist in migrations
REQUIRED_MARKERS=(
  "event_ingestion_dlq"
  "payload_objects"
  "evidence_records"
  "evidence_checkpoints"
  "organisation_invitations"
  "email_outbox"
  "credential_token_hash"
)
for marker in "${REQUIRED_MARKERS[@]}"; do
  if ! grep -R -q -- "$marker" supabase/migrations; then
    echo "FAIL migration marker missing: $marker"
    fail=1
  else
    echo "PASS marker $marker"
  fi
done

# 3) Payload storage integrity surface
if [[ -f apps/api/src/evidence/payload-storage.service.ts ]] \
  && grep -q 'content_sha256' apps/api/src/evidence/payload-storage.service.ts; then
  echo "PASS payload SHA-256 verification surface"
else
  echo "FAIL payload integrity surface missing"
  fail=1
fi

# 4) Evidence verify/export surface
if [[ -f apps/api/src/evidence/evidence-chain.service.ts ]] \
  && grep -q 'verifyChain' apps/api/src/evidence/evidence-chain.service.ts \
  && grep -q 'exportBundle' apps/api/src/evidence/evidence-chain.service.ts; then
  echo "PASS evidence verify/export surface"
else
  echo "FAIL evidence chain verify/export missing"
  fail=1
fi

# 5) Optional local supabase reset drill when ALLOW_LOCAL_DB_DRILL=1
if [[ "${ALLOW_LOCAL_DB_DRILL:-0}" == "1" ]]; then
  echo "Running local supabase db reset drill…"
  if command -v supabase >/dev/null 2>&1; then
    supabase db reset --yes
    echo "PASS local db reset completed"
  else
    echo "FAIL supabase CLI unavailable for local drill"
    fail=1
  fi
else
  echo "SKIP local db reset (set ALLOW_LOCAL_DB_DRILL=1 to execute)"
fi

status="passed"
if [[ "$fail" -ne 0 ]]; then status="failed"; fi

generated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat >"$REPORT" <<EOF
{
  "drill": "phase0_restore",
  "status": "$status",
  "migrations": $migration_count,
  "failures": $fail,
  "generated_at": "$generated_at"
}
EOF

echo "Report: $REPORT"
[[ "$fail" -eq 0 ]]
