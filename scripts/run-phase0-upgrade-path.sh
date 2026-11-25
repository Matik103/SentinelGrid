#!/usr/bin/env bash
# Upgrade-path test: foundation-only → all forward migrations at current HEAD.
# Disposable local Supabase only. Never touches remote/production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FOUNDATION="supabase/migrations/20261125160000_phase0_foundation.sql"
MIGRATIONS_DIR="supabase/migrations"

command -v supabase >/dev/null 2>&1 || { echo "ERROR: Supabase CLI required." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker required." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "ERROR: Docker daemon unavailable." >&2; exit 1; }
supabase status >/dev/null 2>&1 || { echo "ERROR: Local Supabase is not running." >&2; exit 1; }
[[ -f "$FOUNDATION" ]] || { echo "ERROR: missing $FOUNDATION" >&2; exit 1; }

# Portable across macOS/BSD find and bash 3.2 (no mapfile / -printf).
FORWARD=()
while IFS= read -r _base; do
  [[ -n "$_base" ]] && FORWARD+=("$MIGRATIONS_DIR/$_base")
done < <(
  find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' -exec basename {} \; \
    | LC_ALL=C sort \
    | grep -v '^20261125160000_phase0_foundation\.sql$'
)
[[ "${#FORWARD[@]}" -gt 0 ]] || { echo "ERROR: no forward migrations found after foundation" >&2; exit 1; }
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
echo "1) Park ${#FORWARD[@]} forward migration(s); reset to foundation-only"
for f in "${FORWARD[@]}"; do mv "$f" "$HOLD/$(basename "$f")"; done
supabase db reset --local --yes

FOUND_VER="$(psql_local "select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations;")"
[[ "$FOUND_VER" == "20261125160000" ]] || { echo "ERROR: foundation-only reset applied unexpected versions: $FOUND_VER" >&2; exit 1; }
[[ "$(psql_local "select to_regclass('public.platform_admins') is not null;")" == "f" ]] || { echo "ERROR: platform_admins exists in foundation-only schema" >&2; exit 1; }
[[ "$(psql_local "select to_regclass('public.event_ingestion_dlq') is not null;")" == "f" ]] || { echo "ERROR: event_ingestion_dlq exists in foundation-only schema" >&2; exit 1; }
echo "PASS foundation-only state: $FOUND_VER"

restore_forward
trap - EXIT
supabase migration up --local

FINAL_VER="$(psql_local "select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations;")"
EXPECTED="$(
  {
    echo 20261125160000
    for f in "${FORWARD[@]}"; do basename "$f" | cut -d_ -f1; done
  } | sort | paste -sd, -
)"
[[ "$FINAL_VER" == "$EXPECTED" ]] || { echo "ERROR: expected $EXPECTED, got $FINAL_VER" >&2; exit 1; }

for check in \
  "to_regclass('public.platform_admins') is not null" \
  "to_regclass('public.event_ingestion_dlq') is not null" \
  "to_regclass('public.payload_objects') is not null" \
  "exists(select 1 from pg_proc where proname='has_org_permission')" \
  "exists(select 1 from pg_proc where proname='bootstrap_organisation')"
do
  [[ "$(psql_local "select $check;")" == "t" ]] || { echo "ERROR: upgrade assertion failed: $check" >&2; exit 1; }
done

echo "PASS upgrade path: $FINAL_VER"
