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

Invitations enqueue into `email_outbox`. Delivery is leased (`claim_email_outbox` / `finish_email_outbox`) with Resend idempotency key = outbox UUID.

### Preferred production path (Supabase Edge Function)

`supabase/functions/email-outbox-worker` runs on the hosted project and reads Edge Function secrets:

- `RESEND_API_KEY` (already configured on production project `abaeizgfsskvjklfslrh`)
- `SG_EMAIL_FROM` (required; verified Resend sender, e.g. `SentinelGrid <noreply@your-domain>` — use Resend dashboard domain auth; for Resend test-only sends, `beth.t@example.com` to the account owner)

Deploy (requires `SUPABASE_ACCESS_TOKEN`):

```bash
npx supabase secrets list --project-ref abaeizgfsskvjklfslrh
# ensure SG_EMAIL_FROM is set (never commit the value)
npx supabase functions deploy email-outbox-worker --project-ref abaeizgfsskvjklfslrh
# invoke with service-role Authorization Bearer (cron or ops)
```

Verify secret *names* only: `node scripts/supabase-email-secrets-check.mjs abaeizgfsskvjklfslrh`

### Optional Nest worker (Render / Docker host)

When Nest also has the Resend secrets, set:

- `SG_EMAIL_WORKER_ENABLED=true`
- `SG_EMAIL_TRANSPORT=resend`
- `RESEND_API_KEY` / `SG_EMAIL_FROM` (host secrets — never commit)

Lease + Resend idempotency keep dual Nest/Edge workers safe. Apply migration `20261125260000_phase0_email_worker_leases.sql` before enabling either worker.

## Security notes

- Connector never embeds the Supabase service role.
- Tenant identity is derived by the API from the connector bearer credential and connector ID; the edge payload cannot select its organisation.
- Send events to `POST /v1/connectors/ingest` with `connector_id` in the envelope and `Authorization: Bearer <connector-token>`. The API injects the authorised `organisation_id`.
- Revoked credentials block outbound delivery; buffered envelopes remain until re-auth.
