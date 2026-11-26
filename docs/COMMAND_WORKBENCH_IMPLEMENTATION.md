# Sentinel Command workbench implementation

## Implemented surfaces

| Workspace | Data source | Current behavior | Boundary |
|---|---|---|---|
| Overview | Authenticated organisation API | Facility, asset, device and event snapshot | Empty states remain empty; no seeded telemetry is presented as live |
| Infrastructure topology | `GET /v1/orgs/:organisationId/assets`, facilities | Shows registered assets and explicit parent links | No inferred links or synthetic digital-twin state |
| Asset relationship editor | `POST /v1/orgs/:organisationId/assets/:assetId/parent` | Sets or clears an asset's parent | Parent must be in same organisation and facility; self-links and cycles rejected |
| Incident investigation | `GET /v1/events` | Rule-based review queue, integrity/data-quality cues, event correlation by asset/facility | Not an AI diagnosis or confirmed incident severity |
| Event replay | `GET /v1/events` | Historical, timestamp-ordered event stepping | Read-only; does not re-ingest or mutate events |
| Failure scenario lab | Asset registry + event window | Calculates explicitly linked descendants and sums recorded nameplate power | Deterministic registry what-if only; no failure probability, measured load, engineering prediction or actuation |
| Energy intelligence | Existing energy API/Supabase tables | Existing measured-energy views retained | Real/simulated/replayed/synthetic labels remain explicit |

## Asset hierarchy API safety

Asset creation accepts optional `parent_asset_id` and `criticality`. Before insertion, the API verifies that the proposed parent exists within the same organisation and facility.

The relationship endpoint requires `asset.write`, scopes the selected asset and parent to the organisation, enforces same-facility links, checks the proposed ancestry for a cycle, and updates only the requested tenant-scoped asset. RLS and existing facility-manager restrictions remain in force.

The event reader now returns the event's data-quality and clock-quality metadata to authorised event readers for investigation context.

## Validation status

- Frontend TypeScript/Vite preview build: passed on the first operational workbench pass.
- Latest full frontend build: queued/in progress through the Vercel PR preview; verify against the latest branch head.
- API unit tests: asset hierarchy registration and cycle-prevention tests added; run in the Engineering Quality Gate.
- Full disposable Supabase migration, RLS and repository audit: pending Engineering Quality Gate completion.
- Browser-level visual inspection: pending protected preview access (Vercel SSO).

## Explicitly not claimed as complete

A physical digital twin requires validated asset/zone/device/sensor relationships, spatial/location data and source-backed state. Engineering-grade failure simulation requires validated dependency types, rated/operating constraints, failure modes, and domain-specific propagation rules. Live operations and control require approved commands, identity, safety interlocks, acknowledgements, audit evidence and integration testing. The current workbench deliberately does not invent any of these.
