# SentinelGrid implementation status

**Canonical branch:** `work/sentinel-command-release-v2`  
**Last reviewed:** 2026-11-27  
**Overall status:** platform foundation and workbenches are in progress; not production-complete.

Use [`ROADMAP.md`](ROADMAP.md) for the consolidated product direction, sequencing, dependencies and acceptance criteria. This file is the concise status snapshot. The detailed Phase 0 gate remains in [`docs/PHASE0_ACCEPTANCE_CHECKLIST.md`](docs/PHASE0_ACCEPTANCE_CHECKLIST.md).

## Evidence vocabulary

- **Implemented:** code exists.
- **Tested:** automated checks exercise it and pass.
- **Operationally verified:** tested against real deployed services/hardware.
- **Scaffold:** interface/probe/placeholder exists, not full acquisition.
- **Open:** required work/evidence remains.

## Current capability snapshot

| Capability | Current status | Remaining proof / boundary |
|---|---|---|
| Auth, tenant bootstrap, RBAC, RLS | Implemented / SQL-tested | Hosted migration rollout, full signup/MFA and cross-tenant runtime E2E |
| TOTP MFA / AAL2 | Implemented in code and preview flow | Hosted rollout and browser E2E |
| Organisation invitations | Implemented / tested | Real Resend delivery and invite acceptance in deployed environment |
| Infrastructure registry | Implemented / API-tested | Broader real source onboarding; registry is not auto-discovery |
| Facility/zone/asset hierarchy | Implemented / tested | Real-world mapping and validation for each integration |
| Connector lifecycle | Implemented / tested | Operational deployment and supported source integrations |
| Event ingest, deduplication, DLQ/replay | Implemented / tested | End-to-end source acquisition and production load/failure validation |
| Evidence chain/checkpoints | Implemented / tested | Production restore, retention and operational verification |
| Payload storage | Supabase Storage backend code present | Verify latest migrations and live object upload/download/restore; do not describe as Amazon S3 |
| Audit log | Implemented / tested | Production monitoring and retention verification |
| Sentinel Command workbenches | Implemented UI/API surfaces | Full authenticated browser E2E and source-backed operational data |
| Topology / failure scenario lab | Implemented | Registry-based, non-actuating what-if only; not a physical digital twin or engineering-grade simulation |
| Asset metadata and private media | Schema/API/UI foundation present | Verify hosted migration, exact-match media provenance and full edit/upload lifecycle |
| Energy measurement schema/API | Implemented | Live hardware acquisition and end-to-end verification |
| Energy connector ingestion | Code path present | Validate real source payloads, device maps, idempotency and tenant/facility references end-to-end |
| Energy anomaly evaluation | Initial explainable rule in code | Limited initial rule set; validate with real history and false-positive controls |
| Go edge runtime / durable buffer | Implemented / unit-tested | Deploy and verify on target edge hardware |
| Modbus / MQTT / OPC UA | Read-only connectivity probe scaffolds | No full register polling, MQTT topic subscription or OPC UA session/tag acquisition yet |
| Universal LAN/router discovery | Planned | First router/AP integration, endpoint identity resolution and first-seen pipeline |
| Wireless deauth / rogue AP detection | Planned | Requires monitor-mode sensor or AP/controller telemetry; Wi-Fi outage alone is not proof |
| Outlet/circuit device-level monitoring | Planned | Requires smart plugs, outlet monitors or meters |
| Smart-home / physical security integrations | Planned | Camera/NVR, doorbell, lock, alarm, hub and sensor adapters |
| Cross-domain cyber-physical correlation | Planned | Requires validated network, wireless, energy and physical source events |
| Controlled mitigation | Deferred until detection is reliable | Approval, policy, safety, rollback and audit controls required |

## Operational blockers

1. **Hosted Supabase migrations:** repository contains migrations beyond the last remote-applied point documented in prior status notes. The latest remote migration state has not been re-verified here. Review the pending list and apply only after the migration chain is validated.
2. **Backend deployment:** Render Blueprint exists; deployed service health and production API origin must be verified.
3. **Email:** worker code exists; actual provider configuration and delivered invite must be verified.
4. **Backup/recovery:** documentation is not a restore drill. Complete a real database and object-storage recovery test.
5. **Energy/OT acquisition:** probes are not measurements. Provide real register maps, MQTT topics, OPC UA node IDs and test fixtures before claiming live telemetry.
6. **Frontend acceptance:** complete authenticated browser E2E for signup, MFA, workspace creation, invitations, registry, energy and evidence flows.
7. **Production status:** a Vercel preview is not a production release. Verify deployment SHA, backend health, Supabase state and domain before making production claims.

## Rules

- Do not mark Phase 0 complete until every required row in the acceptance checklist has evidence at the required level.
- Do not classify synthetic, replayed or inferred data as real.
- Do not trust tenant IDs from clients or event payloads.
- Keep OT read-only by default.
- Evidence hashes prove stored-byte integrity, not sensor truth.
- Update this file and [`ROADMAP.md`](ROADMAP.md) in the same change whenever implementation status or sequencing changes.
