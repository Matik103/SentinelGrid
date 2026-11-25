# Backup and recovery (Phase 0)

## Scope

Phase 0 stores tenant data in Supabase Postgres and evidence payloads in S3-compatible object storage (or `local_dev` files outside production).

## Database

- Use Supabase project backups / PITR for `abaeizgfsskvjklfslrh` (or the linked project).
- Schema is forward-only under `supabase/migrations/`. Restore DB, then ensure migrations match the deployed application revision.
- **Drill status:** not executed in this environment — document the next scheduled restore drill before marking Phase 0 COMPLETE.

## Object storage

- Payload objects are content-addressed by SHA-256 in `payload_objects`.
- Recovery: restore bucket objects, then verify digests via `PayloadStorageService.readRaw` / evidence retrieve API.
- **Drill status:** pending — run a restore of a sample object and verify hash match.

## Application

- Redeploy API + edge connector from the same git SHA as the schema.
- Rotate connector credentials after any suspected compromise (`POST .../connectors/:id/revoke`).
