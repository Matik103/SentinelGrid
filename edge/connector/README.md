# SentinelGrid Edge Connector (Phase 0)

Go runtime for OT/edge ingestion with durable buffering and retry.

## Defaults

- **OT access: `read_only`** — config load fails if set otherwise.
- **Durable buffer** under `buffer.dir` (crash-safe JSON files); flush on startup and poll.
- **Retry / backoff** with jitter (`retry.*`); failed deliveries stay queued.
- **Credential lifecycle** via env token: `Load` / `Rotate` / `Revoke` hooks (`internal/credentials`).
- OPC UA / Modbus / MQTT are **adapter stubs** behind `ProtocolAdapter` — no fake live telemetry.
- Optional `file` protocol emits a **synthetic** scaffold heartbeat for API wiring.
- Auth token from env (`SENTINELGRID_CONNECTOR_TOKEN`); never hardcoded.

## Build

```bash
cd edge/connector
go mod tidy
go test ./...
go build -o bin/connector ./cmd/connector
./bin/connector -config config.example.yaml
```

## Security notes

- Connector never embeds the Supabase service role.
- Tenant `organisation_id` is config-scoped; API still enforces RBAC on ingest.
- Revoked credentials block outbound delivery; buffered envelopes remain until re-auth.
