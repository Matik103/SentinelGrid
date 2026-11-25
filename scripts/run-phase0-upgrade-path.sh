#!/usr/bin/env bash
# Upgrade-path test: foundation-only → all forward migrations at current HEAD.
# Disposable local Supabase only. Never touches remote/production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FORWARD=(
  "supabase/migrations/20261125170000_phase0_security_hardening.sql"
  "supabase/migrations/20261125180000_phase0_security_grants_and_platform_boundary.sql"
  "supabase/migrations/20261125190000_phase0_ingestion_dlq_and_payload_objects.sql"
  "supabase/migrations/20261125200000_phase0_ingestion_replay_and_tenant_integrity.sql"
)
EXPECTED="20261125160000,20261125170000,20261125180000,20261125190000,20261125200000"

command -v supabase >/dev/null 2>&1 || { echo "ERROR: Supabase CLI required." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker required." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "ERROR: Docker daemon unavailable." >&2; exit 1; }
supabase status >/dev/null 2>&1 || { echo "ERROR: Local Supabase is not running." >&2; exit 1; }
for f in "${FORWARD[@]}"; do [[ -f "$f" ]] || { echo "ERROR: missing $f" >&2; exit 1; }; done

HOLD="$(mktemp -d "${TMPDIR:-/tmp}/sg-upgrade-hold.XXXXXX")"
restore_forward() {
  local f
  for f in "${FORWARD[@]}"; do
    [[ -f "$HOLD/$(basename "$f")" ]] && mv -f "$HOLD/$(basename "$f")" "$f"
  done
  rmdir "$HOLD" 2>/dev/null || true
}
trap restore_forward EXIT

psql_local() {
  local container
  container="$(docker ps --format '{{.Names}}' | grep -E '^supabase_db_' | head -n 1 || true)"
  [[ -n "$container" ]] || { echo "ERROR: Supabase DB container missing" >&2; exit 1; }
  docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc "$1"
}

echo "== Phase 0 upgrade-path test =="
for f in "${FORWARD[@]}"; do mv "$f" "$HOLD/$(basename "$f")"; done
supabase db reset --local --yes

FOUND_VER="$(psql_local "select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations;")"
[[ "$FOUND_VER" == "20261125160000" ]] || { echo "ERROR: foundation-only reset applied unexpected versions: $FOUND_VER" >&2; exit 1; }
[[ "$(psql_local "select to_regclass('public.platform_admins') is not null;")" == "f" ]] || { echo "ERROR: platform_admins exists in foundation-only schema" >&2; exit 1; }
echo "PASS foundation-only state: $FOUND_VER"

restore_forward
trap - EXIT
supabase migration up --local

FINAL_VER="$(psql_local "select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations;")"
[[ "$FINAL_VER" == "$EXPECTED" ]] || { echo "ERROR: expected $EXPECTED, got $FINAL_VER" >&2; exit 1; }
for check in   "to_regclass('public.platform_admins') is not null"   "to_regclass('public.event_ingestion_dlq') is not null"   "to_regclass('public.payload_objects') is not null"   "exists(select 1 from pg_constraint where conname='event_ingestion_dlq_connector_same_org_fk')"   "exists(select 1 from pg_proc where proname='has_org_permission')"; do
  [[ "$(psql_local "select $check;")" == "t" ]] || { echo "ERROR: upgrade assertion failed: $check" >&2; exit 1; }
done
echo "PASS upgrade path: $FINAL_VER"
