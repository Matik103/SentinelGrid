# Payload / evidence object storage

Phase 0 evidence payloads are written to an object store **before** `payload_objects` metadata is committed. Reads verify SHA-256 against metadata.

Production uses **Supabase Storage** via the service-role Storage API — not Amazon S3 and not the S3-compatible SDK path.

## Backends

| `PAYLOAD_STORAGE_BACKEND` | Use | Notes |
|---|---|---|
| `local_dev` | Local / CI only | Files under `PAYLOAD_STORAGE_ROOT` (default `.payload-store`). **Forbidden when `NODE_ENV=production`.** Ignored at Nest boot in production if still set in the host env. |
| `supabase` | Staging / production | `storage.from(bucket).upload/download/remove` with the Nest service-role client. DB column stores `supabase`. |

Legacy aliases `s3` / `s3_compatible` map to `supabase` for one release, then should be removed from host env. Amazon S3 SDK / `AWS_*` credentials are not used.

Unknown backends and metadata-only writes are refused (fail-closed).

## Supabase Storage (production)

Hosted project: **`abaeizgfsskvjklfslrh`**.

| Piece | Value |
| --- | --- |
| Bucket | `evidence-payloads` (private; migration `20261127100000_evidence_payloads_storage_bucket.sql`) |
| Do **not** reuse | `asset-media` (equipment photos + image MIME / different RLS) |
| Auth | Nest `SUPABASE_SERVICE_ROLE_KEY` (server-only). Bypasses Storage object RLS. |

### Render Dashboard env (names + non-secret values)

| Name | Value |
| --- | --- |
| `PAYLOAD_STORAGE_BACKEND` | `supabase` |
| `PAYLOAD_STORAGE_BUCKET` | `evidence-payloads` |

Also **delete** any of: `PAYLOAD_STORAGE_BACKEND=local_dev`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`, `S3_BUCKET` (optional legacy; `PAYLOAD_STORAGE_BUCKET` preferred).

After redeploy, `GET /v1/health` should show `"payload_backend":"supabase"` and `"payload_bucket":"ready"|"created"`. Apply migrations `20261127090000`, `20261127100000`, and `20261127120000` on the remote project (AAL1 DEFINER, bucket RLS, backend check).

### Required env summary

- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
- `PAYLOAD_STORAGE_BACKEND=supabase`
- `PAYLOAD_STORAGE_BUCKET=evidence-payloads` (optional; defaults to `evidence-payloads`)

Misconfiguration throws at startup / first use — the API does not fall back to local disk or Amazon S3 in production.

## Integrity

1. Compute SHA-256 of JSON bytes.
2. `put` object.
3. `get` object and re-hash; discard object and abort if mismatch.
4. Insert `payload_objects` row; on insert failure, delete the object.

## Audit

`scripts/audit.sh` requires this document and asserts production forbids `local_dev` while Supabase Storage is implemented.
