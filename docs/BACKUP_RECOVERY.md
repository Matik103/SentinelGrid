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
- **Drill status:** pending authorized disposable drill (below).

## Application

- Redeploy API + edge connector from the same git SHA as the schema.
- Rotate connector credentials after any suspected compromise (`POST .../connectors/:id/revoke`).

## Disposable restore drill design (not executed)

**Authorization required before any run that touches hosted backups or production buckets.** Prefer a disposable Supabase project or a clearly named staging project — never overwrite production.

### Goals
1. Prove Postgres backup → restore yields a consistent schema + sample tenant rows.
2. Prove at least one evidence payload object restores with matching SHA-256.
3. Record commands, timestamps (America/Los_Angeles), operator, and git SHA in `reports/restore-drill.json` (or Issue #9).

### Prerequisites
| Need | Purpose |
|---|---|
| Supabase owner/admin on a **disposable** project (or approved staging) | Create backup / restore target |
| Sample `payload_objects` row + corresponding Storage object | Hash verification |
| Nest lab build or script with service-role read | `readRaw` / digest check |
| Approval note on Issue #9 | Explicit authorization |

### Procedure (when authorized)
1. Snapshot or use Supabase daily backup on the disposable project; record backup ID/time.
2. Restore into a **new empty** project (or reset disposable). Never restore over production.
3. Confirm migration versions match the intended app SHA.
4. Insert or restore one known payload object; compute SHA-256; compare to `payload_objects.content_sha256`.
5. Hit `/v1/health` on a lab API pointed at the restored project (optional).
6. Write the JSON evidence file; link from the acceptance checklist tip log.
7. Tear down the disposable project.

### Pass / fail
- **Pass:** DB usable, migrations aligned, one object digest matches, no production project mutated.
- **Fail:** digest mismatch, missing migrations, or any production write.

### Explicit non-goals
- Not a PITR chaos test against production.
- Not Criterion G email proof.
- Not UniFi / hardware acquisition proof.
