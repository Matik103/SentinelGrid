# Raw event payload object storage (Phase 0 gap)

**Status:** Not implemented. Schema hooks only.

## What exists today

| Column | Table | Meaning |
| ------ | ----- | ------- |
| `original_payload_ref` | `events` | Opaque URI / key for the original bytes |
| `payload_ref` | `evidence_records` | Opaque URI / key for preserved evidence bytes |
| `payload_sha256` | `evidence_records` | SHA-256 digest of those bytes |

Postgres stores **references and digests**, not the raw payload body.

## Intended model (not built)

1. Ingestion API receives payload → writes object to tenant-scoped S3-compatible storage.
2. Path shape: `{organisation_id}/events/{yyyy}/{mm}/{event_id}` (exact layout TBD).
3. Persist `payload_ref` / `original_payload_ref` pointing at that object.
4. Compute SHA-256 over the stored bytes into `evidence_records.payload_sha256`.
5. Verification re-reads object bytes and compares digests.
6. Access via signed URLs or server-mediated download; access logged.
7. Independent backup of the object store; checkpoints stored separately from the primary DB.

## Security notes

- A hash proves integrity of stored bytes — **not** truthfulness of the original sensor.
- Object paths must be tenant-aware; never trust a client-supplied organisation id for path authorization.
- Service-role / backend credentials for object storage must not appear in frontend code.

## Schema hook decision

No additional storage product tables were added. Existing ref columns are sufficient hooks for the security and evidence model until object storage is implemented.
