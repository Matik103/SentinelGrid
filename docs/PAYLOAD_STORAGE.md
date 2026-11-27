# Payload / evidence object storage

Phase 0 evidence payloads are written to an object store **before** `payload_objects` metadata is committed. Reads verify SHA-256 against metadata.

Production uses **Supabase Storage** (project buckets) via the S3-compatible protocol — not Amazon S3.

## Backends

| `PAYLOAD_STORAGE_BACKEND` | Use | Notes |
|---|---|---|
| `local_dev` | Local / CI only | Files under `PAYLOAD_STORAGE_ROOT` (default `.payload-store`). **Forbidden when `NODE_ENV=production`.** Ignored at Nest boot in production if still set in the host env. |
| `s3` / `s3_compatible` | Staging / production | Real PutObject / GetObject via `@aws-sdk/client-s3` against Supabase Storage’s S3 endpoint. DB column stores `s3_compatible`. |

Unknown backends and metadata-only writes are refused (fail-closed).

## Supabase Storage (production)

Hosted project: **`abaeizgfsskvjklfslrh`**.

| Piece | Value |
| --- | --- |
| Bucket | `evidence-payloads` (private; migration `20261127100000_evidence_payloads_storage_bucket.sql`) |
| Do **not** reuse | `asset-media` (equipment photos + image MIME / different RLS) |
| S3 endpoint | `https://abaeizgfsskvjklfslrh.storage.supabase.co/storage/v1/s3` |
| Path style | `S3_FORCE_PATH_STYLE=true` |
| Region | Copy from Supabase Dashboard → **Storage → S3 connection** (project region) |
| Access keys | Dashboard → **Storage → S3 access keys** (server-only; bypass RLS). **Not** the anon key. Prefer dedicated Storage S3 keys over pasting the DB service role into AWS_* vars. |

### Render Dashboard env (names + non-secret values)

Set on **Render → sentinelgrid-api → Environment** (Blueprint `sync: false` often does not merge into an already-created service):

| Name | Value |
| --- | --- |
| `PAYLOAD_STORAGE_BACKEND` | `s3_compatible` |
| `S3_BUCKET` | `evidence-payloads` |
| `S3_ENDPOINT` | `https://abaeizgfsskvjklfslrh.storage.supabase.co/storage/v1/s3` |
| `S3_FORCE_PATH_STYLE` | `true` |
| `AWS_REGION` | *(from Supabase Storage S3 connection page)* |
| `AWS_ACCESS_KEY_ID` | *(Supabase Storage S3 access key id)* |
| `AWS_SECRET_ACCESS_KEY` | *(Supabase Storage S3 secret)* |

Also **delete** `PAYLOAD_STORAGE_BACKEND=local_dev` if present.

After redeploy, `GET /v1/health` should show `"payload_backend":"s3_compatible"` (not `deferred` / `local_dev`). Apply migration `20261127100000` on the remote project so the bucket exists.

### Required env summary

- `S3_BUCKET` or `PAYLOAD_S3_BUCKET`
- `AWS_REGION` or `S3_REGION`
- `S3_ENDPOINT` — Supabase Storage S3 URL (`https://` only in production)
- `S3_FORCE_PATH_STYLE=true`
- `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (both required on Render; pair both)

Misconfiguration (missing bucket/region, unpaired keys, http endpoint in production) throws at startup / first use — the API does not fall back to local disk in production.

## Integrity

1. Compute SHA-256 of JSON bytes.
2. `put` object.
3. `get` object and re-hash; discard object and abort if mismatch.
4. Insert `payload_objects` row; on insert failure, delete the object.

## Audit

`scripts/audit.sh` requires this document and asserts production forbids `local_dev` while S3-compatible stores are implemented.
