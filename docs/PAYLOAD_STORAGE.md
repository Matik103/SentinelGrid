# Raw event payload object storage (Phase 0)

**Status:** Scaffold implemented (local_dev backend + `payload_objects` metadata). S3-compatible path is configured but not invoked without credentials.

## What exists

| Piece | Location | Meaning |
| ----- | -------- | ------- |
| `original_payload_ref` | `events` | Opaque URI / key for original bytes |
| `payload_ref` / `payload_sha256` | `evidence_records` | Evidence bytes ref + digest |
| `payload_objects` | migration `20261125190000_…` | Tenant-scoped object metadata (key, sha256, backend, classification) |
| `PayloadStorageService` | `apps/api/src/evidence/payload-storage.service.ts` | Writes bytes (local_dev) + metadata row |

Postgres stores **references and digests**, not the raw payload body.

## Model

1. Ingestion / evidence API receives payload → `PayloadStorageService.storeRaw`.
2. Path shape: `{organisation_id}/{yyyy-mm-dd}/{sha16}-{uuid}.json`.
3. Persist `object_key` on `payload_objects` and optionally `original_payload_ref` on `events`.
4. SHA-256 computed over stored bytes.
5. Access is server-mediated; RLS allows authenticated `evidence.read` SELECT on metadata only.
6. Service-role credentials for storage/admin never appear in frontend code.

## Security notes

- A hash proves integrity of stored bytes — **not** truthfulness of the original sensor.
- Object paths are tenant-prefixed; API enforces `evidence.write` / `evidence.read` via `has_org_permission` — never trust client tenant_id alone.
- Default OT posture remains read-only; storage does not invent live OT data.
