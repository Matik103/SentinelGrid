#!/usr/bin/env bash
# Runs Phase 0 RLS/RBAC tests against the local Supabase DB only.
# Do not override DOCKER_HOST: Desktop, Colima and CI configure it themselves.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

command -v supabase >/dev/null 2>&1 || { echo "ERROR: Supabase CLI required." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker required." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "ERROR: Docker daemon unavailable." >&2; exit 1; }

STATUS="$(supabase status -o env)"
DB_URL="$(printf '%s\n' "$STATUS" | sed -n 's/^DB_URL=//p' | tr -d '"')"
[[ -n "$DB_URL" ]] || { echo "ERROR: Local Supabase DB_URL unavailable." >&2; exit 1; }

echo "Running tenant isolation tests against local Supabase only."
if command -v psql >/dev/null 2>&1; then
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/phase0_tenant_isolation.sql"
else
  DB_CTR="$(docker ps --format '{{.Names}}' | grep -E '^supabase_db_' | head -n 1 || true)"
  [[ -n "$DB_CTR" ]] || { echo "ERROR: Local Supabase database container not found." >&2; exit 1; }
  docker exec -i "$DB_CTR" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$ROOT/supabase/tests/phase0_tenant_isolation.sql"
fi
echo "PASS: Phase 0 tenant isolation regression suite."
