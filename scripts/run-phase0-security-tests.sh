#!/usr/bin/env bash
# Run Phase 0 tenant-isolation / RBAC regression tests against local Supabase.
# Does NOT touch any remote database.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export DOCKER_HOST="${DOCKER_HOST:-unix://${HOME}/.colima/default/docker.sock}"

if ! command -v supabase >/dev/null; then
  echo "supabase CLI required" >&2
  exit 1
fi

DB_URL="$(supabase status -o env 2>/dev/null | sed -n 's/^DB_URL=//p' | tr -d '"')"
if [[ -z "${DB_URL}" ]]; then
  echo "Local Supabase is not running. Start with:" >&2
  echo "  supabase start --ignore-health-check -x storage,realtime,studio,imgproxy,edge-runtime,analytics" >&2
  exit 1
fi

echo "Using local DB only."
echo "Running supabase/tests/phase0_tenant_isolation.sql ..."

if command -v psql >/dev/null; then
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/phase0_tenant_isolation.sql"
else
  DB_CTR="$(docker ps --format '{{.Names}}' | grep -E '^supabase_db_' | head -1)"
  if [[ -z "$DB_CTR" ]]; then
    echo "No supabase_db_* container found and psql is not installed." >&2
    exit 1
  fi
  docker exec -i "$DB_CTR" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
    < "$ROOT/supabase/tests/phase0_tenant_isolation.sql"
fi
echo "OK"
