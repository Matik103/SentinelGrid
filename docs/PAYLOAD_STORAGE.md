# Payload / evidence object storage

Phase 0 evidence payloads are written to an object store **before** `payload_objects` metadata is committed. Reads verify SHA-256 against metadata.

## Backends

| `PAYLOAD_STORAGE_BACKEND` | Use | Notes |
|---|---|---|
| `local_dev` | Local / CI only | Files under `PAYLOAD_STORAGE_ROOT` (default `.payload-store`). **Forbidden when `NODE_ENV=production`.** |
| `s3` / `s3_compatible` | Staging / production | Real PutObject / GetObject via `@aws-sdk/client-s3`. DB column stores `s3_compatible`. |

Unknown backends and metadata-only writes are refused (fail-closed).

## S3-compatible configuration

Required:

- `S3_BUCKET` or `PAYLOAD_S3_BUCKET`
- `AWS_REGION` or `S3_REGION`

Optional:

- `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (both or neither; neither uses the default provider chain / IAM role)
- `S3_ENDPOINT` — MinIO / custom endpoint (must be `https://` in production)
- `S3_FORCE_PATH_STYLE=true` — path-style addressing (default when endpoint is set)

Misconfiguration (missing bucket/region, unpaired keys, http endpoint in production) throws at startup / first use — the API does not fall back to local disk in production.

## Integrity

1. Compute SHA-256 of JSON bytes.
2. `put` object.
3. `get` object and re-hash; discard object and abort if mismatch.
4. Insert `payload_objects` row; on insert failure, delete the object.

## Audit

`scripts/audit.sh` requires this document and asserts production forbids `local_dev` while S3-compatible stores are implemented.
