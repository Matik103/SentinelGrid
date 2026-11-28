# Backup and recovery (Phase 0)

## Scope

Phase 0 stores tenant data in Supabase Postgres and evidence payloads in **Supabase Storage** (service-role / private buckets such as `evidence-payloads`). Do not describe production payload storage as Amazon S3.

## Database

- Use Supabase project backups / PITR for `abaeizgfsskvjklfslrh` (or the linked project).
- Schema is forward-only under `supabase/migrations/`. Restore DB, then ensure migrations match the deployed application revision (see [`MIGRATION_RECONCILIATION_PLAN.md`](MIGRATION_RECONCILIATION_PLAN.md)).
- **Local parity marker:** `./scripts/restore-drill.sh` with `ALLOW_LOCAL_DB_DRILL=1` runs a disposable local `supabase db reset`. That is **not** a production restore.

## Object storage

- Payload objects are content-addressed by SHA-256 in `payload_objects`.
- Recovery: restore bucket objects, then verify digests via `PayloadStorageService.readRaw` / evidence retrieve API.
- **Drill status:** **ops** — disposable hosted-schema restore + Storage SHA round-trip recorded 2026-11-28 PT (`reports/hosted-restore-drill-2026-11-28.json`).

## Application

- Redeploy API + edge connector from the same git SHA as the schema.
- Rotate connector credentials after any suspected compromise (`POST .../connectors/:id/revoke`).

## Disposable restore drill (executed 2026-11-28 America/Los_Angeles)

**Evidence:** [`reports/hosted-restore-drill-2026-11-28.json`](../reports/hosted-restore-drill-2026-11-28.json)

### What ran
1. Read hosted migration inventory on `abaeizgfsskvjklfslrh` via Management API (tip `20261128160000`, 32 versions).
2. Applied repo migrations onto a disposable local PostgreSQL 17 database (`sg_restore_drill`) — never restored over production.
3. Seeded a synthetic `payload_objects` row + local bucket object; `pg_dump` → drop DB → `pg_restore`; verified `content_sha256` match.
4. Hosted Storage round-trip on `evidence-payloads`: upload → download → SHA-256 match → delete (torn down). Production Postgres was not written.

### Constraints observed
- Management API `POST /v1/projects` returns **403** for this token (cannot mint a second Supabase project).
- `cli/login-role` can open a pooler session, but `pg_dump` fails with `permission denied` on table locks for public tables.
- Dashboards (Supabase / Render) require interactive login — not available in the agent browser session.

### Pass / fail (this run)
- **Pass:** disposable DB usable after restore; migration tip aligned with hosted `20261128160000`; object digests matched locally and on hosted Storage; hosted drill object torn down; production DB not mutated.
- **Not claimed:** physical PITR restore of a Supabase daily backup into a second hosted project (blocked without project-create permission).

### Explicit non-goals
- Not a PITR chaos test against production.
- Not Criterion G email proof.
- Not UniFi / hardware acquisition proof.
