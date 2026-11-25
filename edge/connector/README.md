# SentinelGrid Edge Connector (Phase 0 scaffold)

Go runtime scaffold for OT/edge ingestion.

## Defaults

- **OT access: `read_only`** — config load fails if set otherwise.
- No live OPC UA / Modbus / MQTT sessions in Phase 0; those protocols log scaffold-only.
- Optional `file` protocol emits a **synthetic** heartbeat for API wiring (never labeled `real`).
- Auth token is read from env (`SENTINELGRID_CONNECTOR_TOKEN`); never hardcoded.

## Build

```bash
cd edge/connector
go mod tidy
go build -o bin/connector ./cmd/connector
./bin/connector -config config.example.yaml
```

## Security notes

- Connector never embeds the Supabase service role.
- Tenant `organisation_id` is config-scoped; API still enforces RBAC on ingest.
