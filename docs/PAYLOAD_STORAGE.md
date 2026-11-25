# Raw event payload object storage (Phase 0)

**Status:** Local development storage is implemented with SHA-256 verification. Production object storage is not implemented. The API deliberately rejects S3 configuration rather than creating metadata for missing objects.

## Implemented

- Local-only filesystem backend under `.payload-store` (or `PAYLOAD_STORAGE_ROOT`).
- Tenant-prefixed opaque object keys.
- SHA-256 computed over the exact stored bytes.
- Files created with restrictive directory/file permissions.
- Metadata is inserted only after the object write succeeds.
- Failed metadata writes trigger object cleanup.
- Duplicate-event cleanup removes unreferenced local objects and metadata.
- Retrieval requires `evidence.read`, matches both object ID and organisation ID, and verifies SHA-256 before returning bytes.
- Maximum payload size defaults to 1 MiB and can be changed with `MAX_EVIDENCE_PAYLOAD_BYTES`.

## Explicit limitations

- `PAYLOAD_STORAGE_BACKEND=s3` is rejected until a real S3-compatible adapter is installed, configured, and tested.
- `local_dev` is rejected when `NODE_ENV=production`.
- Local filesystem storage is not a production durability or backup solution.
- The DLQ stores a bounded structured event envelope in Postgres for replay; the original_payload field is stripped from that envelope. It does not store arbitrary binary payload bytes.
- No signed URL or direct browser object-storage access is implemented.

## Production gate

Before enabling production evidence storage, implement and test an S3-compatible adapter with:
1. server-side encryption and tenant-scoped bucket/prefix policy;
2. object versioning or retention controls appropriate to customer policy;
3. write-after-read verification and digest validation;
4. private retrieval through short-lived signed URLs or a server-mediated stream;
5. access logging, lifecycle/retention enforcement, backup and restore tests;
6. failure handling that never commits metadata before object durability is confirmed.

A hash proves integrity of stored bytes, not truthfulness of the original sensor.
