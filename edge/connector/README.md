# SentinelGrid Edge Connector (Phase 0)

Go runtime for OT/edge ingestion with durable buffering, credential lifecycle, and read-only protocol adapters.

## Defaults

- **OT access: `read_only`** — config load fails if set otherwise.
- **Durable buffer** under `buffer.dir` (crash-safe JSON files); flush on startup and poll.
- **Retry / backoff** with jitter (`retry.*`); failed deliveries stay queued.
- **Credential lifecycle** (credential lifecycle hooks):
  - Load from `SENTINELGRID_CONNECTOR_TOKEN`
  - Optional AES-GCM sealed store under `credentials.store_dir` (key: `SENTINELGRID_CONNECTOR_SEAL_KEY`)
  - Durable `REVOKED` marker; `Rotate` / `Revoke` / `ClearRevoke` / `RefreshFromDisk`
  - `SG_CONNECTOR_ENV=production` forces `require_seal`
- **OPC UA / Modbus / MQTT adapters** implement `ProtocolAdapter` with read-only TCP reachability probes.
  - Never invent process/tag/register/topic values.
  - Hardware unavailable → `status=hardware_unavailable`, `scaffold=true`.
  - Live probes require `SG_CONNECTOR_LIVE_PROBES=1` (off by default in CI).
- Optional `file` protocol emits a **synthetic** scaffold heartbeat for API wiring.
- Auth token never hardcoded.

## Build

```bash
cd edge/connector
go mod tidy
go test ./...
go build -o bin/connector ./cmd/connector
SG_CONNECTOR_LIVE_PROBES=1 ./bin/connector -config config.example.yaml
```

## Email outbox worker

The API includes an opt-in Resend worker. It is disabled by default and requires these deployment environment variables:

- `SG_EMAIL_WORKER_ENABLED=true`
- `SG_EMAIL_TRANSPORT=resend`
- `RESEND_API_KEY` (store as a deployment secret; never commit it)
- `SG_EMAIL_FROM` (a verified sender identity)

Apply migration `20261125260000_phase0_email_worker_leases.sql` before enabling the worker. The worker claims rows with expiring leases, uses the outbox UUID as the provider idempotency key, retries transient failures with backoff, and marks exhausted messages failed. Verify provider-domain authentication and delivery in the Resend account before enabling production sending.

## Security notes

- Connector never embeds the Supabase service role.
- Tenant identity is derived by the API from the connector bearer credential and connector ID; the edge payload cannot select its organisation.
- Send events to `POST /v1/connectors/ingest` with `connector_id` in the envelope and `Authorization: Bearer <connector-token>`. The API injects the authorised `organisation_id`.
- Revoked credentials block outbound delivery; buffered envelopes remain until re-auth.
