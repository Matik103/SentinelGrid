#!/usr/bin/env bash
# Upgrade-path test: foundation-only → forward migrations to current HEAD.
# Disposable local Supabase only. Never touches remote/production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FOUNDATION="supabase/migrations/20261125160000_phase0_foundation.sql"
FORWARD=(
  "supabase/migrations/20261125170000_phase0_security_hardening.sql"
  "supabase/migrations/20261125180000_phase0_security_grants_and_platform_boundary.sql"
)

command -v supabase >/dev/null 2>&1 || { echo "ERROR: Supabase CLI required." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker required." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "ERROR: Docker daemon unavailable." >&2; exit 1; }
supabase status >/dev/null 2>&1 || { echo "ERROR: Local Supabase is not running." >&2; exit 1; }

[[ -f "$FOUNDATION" ]] || { echo "ERROR: missing $FOUNDATION" >&2; exit 1; }
for f in "${FORWARD[@]}"; do
  [[ -f "$f" ]] || { echo "ERROR: missing $f" >&2; exit 1; }
done

HOLD="$(mktemp -d "${TMPDIR:-/tmp}/sg-upgrade-hold.XXXXXX")"
restore_forward() {
  local f base
  for f in "${FORWARD[@]}"; do
    base="$(basename "$f")"
    if [[ -f "$HOLD/$base" ]]; then
      mv -f "$HOLD/$base" "$f"
    fi
  done
  rmdir "$HOLD" 2>/dev/null || true
}
trap restore_forward EXIT

psql_local() {
  local sql="$1"
  local DB_CTR
  DB_CTR="$(docker ps --format '{{.Names}}' | grep -E '^supabase_db_' | head -n 1 || true)"
  [[ -n "$DB_CTR" ]] || { echo "ERROR: supabase_db_* container not found" >&2; exit 1; }
  docker exec -i "$DB_CTR" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atc "$sql"
}

echo "== Phase 0 upgrade-path test =="
echo "1) Park forward migrations; reset to foundation-only"
for f in "${FORWARD[@]}"; do
  mv "$f" "$HOLD/$(basename "$f")"
done

supabase db reset --local --yes

echo "2) Assert foundation-only schema state"
FOUND_VER="$(psql_local "select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations;")"
if [[ "$FOUND_VER" != "20261125160000" ]]; then
  echo "ERROR: expected only foundation migration applied, got: $FOUND_VER" >&2
  exit 1
fi
HAS_BOOT="$(psql_local "select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='bootstrap_organisation');")"
if [[ "$HAS_BOOT" == "t" ]]; then
  echo "ERROR: bootstrap_organisation unexpectedly present after foundation-only reset" >&2
  exit 1
fi
HAS_PLATFORM="$(psql_local "select to_regclass('public.platform_admins') is not null;")"
if [[ "$HAS_PLATFORM" == "t" ]]; then
  echo "ERROR: platform_admins unexpectedly present after foundation-only reset" >&2
  exit 1
fi
echo "   foundation-only OK (version=$FOUND_VER)"

echo "3) Restore forward migrations and apply with migration up"
restore_forward
trap - EXIT

supabase migration up --local

echo "4) Assert upgraded schema state"
FINAL_VER="$(psql_local "select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations;")"
EXPECTED="20261125160000,20261125170000,20261125180000"
if [[ "$FINAL_VER" != "$EXPECTED" ]]; then
  echo "ERROR: expected migrations $EXPECTED, got: $FINAL_VER" >&2
  exit 1
fi
HAS_BOOT="$(psql_local "select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='bootstrap_organisation');")"
HAS_PERM="$(psql_local "select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='has_org_permission');")"
HAS_PLATFORM="$(psql_local "select to_regclass('public.platform_admins') is not null;")"
FK_COUNT="$(psql_local "select count(*) from pg_constraint where conname like '%same_org%';")"
OLD_WRITE="$(psql_local "select count(*) from pg_policies where tablename='memberships' and policyname='memberships_write';")"
NEW_INSERT="$(psql_local "select count(*) from pg_policies where tablename='memberships' and policyname='memberships_insert_admin';")"

[[ "$HAS_BOOT" == "t" ]] || { echo "ERROR: bootstrap_organisation missing after upgrade" >&2; exit 1; }
[[ "$HAS_PERM" == "t" ]] || { echo "ERROR: has_org_permission missing after upgrade" >&2; exit 1; }
[[ "$HAS_PLATFORM" == "t" ]] || { echo "ERROR: platform_admins missing after upgrade" >&2; exit 1; }
[[ "$FK_COUNT" -ge 10 ]] || { echo "ERROR: expected same-org FKs, got $FK_COUNT" >&2; exit 1; }
[[ "$OLD_WRITE" == "0" ]] || { echo "ERROR: memberships_write still present" >&2; exit 1; }
[[ "$NEW_INSERT" == "1" ]] || { echo "ERROR: memberships_insert_admin missing" >&2; exit 1; }

echo "   upgraded OK (versions=$FINAL_VER, same_org_fks=$FK_COUNT)"
echo "PASS: Phase 0 foundation → forward migration upgrade path."
