# SentinelGrid implementation status

**Canonical branch:** `work/sentinel-command-release-v2`  
**Current tip:** `bcc25ef16d2a5caaa15d9d2d04c23ca377d8560b` — disposable hosted-schema restore **ops**; Nest health reads `GIT_SHA || RENDER_GIT_COMMIT || GITHUB_SHA`; www FE on `main` @ `c68caea0f72da46a953a4ce265c336d765562129`  
**Prior tip (Criterion G + E2E-08):** `dbe84a7bb6ad9103ca14fb5fc6c7b16c6de3384f`  
**Prior tip (docs closeout):** `ca5b2f14fc84a824f58668ce3091507f3f8f32d5`  
**Prior tip (migration/docs packet):** `05138a4daeceac3ebf0171b3a7b98cf9b8c4b9bd`  
**Prior tip (quality-gate packet):** `b094207b91b5889cdc8376a853412e015c71cc80`  
**Prior Issue #9 audit baseline:** `17b4af6b571f17f5338b683b135287adf0bfa947`  
**Last reviewed:** 2026-11-28 (America/Los_Angeles) — disposable hosted restore + Render `build_sha` path closed in this packet  
**Overall status:** platform foundation and workbenches are in progress; not production-complete. www production tracks `main`; this branch is the shared implementation tip. Nest API tracks this work tip on Render.

Use [`ROADMAP.md`](ROADMAP.md) for the consolidated product direction, sequencing, dependencies and acceptance criteria. This file is the concise status snapshot. The detailed Phase 0 gate remains in [`docs/PHASE0_ACCEPTANCE_CHECKLIST.md`](docs/PHASE0_ACCEPTANCE_CHECKLIST.md).

**Do not treat `origin/main` tip `7b99e49` as the working-branch baseline.** Vercel production may still track `main`; Render Nest tracks this shared work branch.

## Evidence vocabulary

- **Implemented:** code exists.
- **Tested:** automated checks exercise it and pass.
- **Operationally verified:** tested against real deployed services/hardware.
- **Scaffold:** interface/probe/placeholder exists, not full acquisition.
- **Open:** required work/evidence remains.
- **Blocked:** required check could not run in the named environment.

## Current capability snapshot

| Capability | Current status | Remaining proof / boundary |
|---|---|---|
| Auth, tenant bootstrap, RBAC, RLS | Implemented / SQL-tested / **ops (partial)** | Hosted migrations closed; signup/MFA + invite accept ops-verified; hosted cross-tenant runtime E2E still open |
| TOTP MFA / AAL2 | Implemented / **ops** | Browser E2E MFA enroll/verify on invitee + admin AAL2 shell 2026-11-28 PT |
| Organisation invitations | Implemented / tested / **ops-verified** | Criterion G + authenticated E2E 2026-11-28 PT: create → outbox **sent** → delivery confirmed → accept → Afya membership **active** `read_only_viewer` |
| Infrastructure registry | Implemented / API-tested | Broader real source onboarding; registry is not auto-discovery |
| Facility/zone/asset hierarchy | Implemented / tested | Real-world mapping and validation for each integration |
| Connector lifecycle | Implemented / tested | Operational deployment and supported source integrations |
| Event ingest, deduplication, DLQ/replay | Implemented / tested | End-to-end source acquisition and production load/failure validation |
| Evidence chain/checkpoints | Implemented / tested | Production restore, retention and operational verification |
| Payload storage | Implemented / tested (Supabase Storage API) | Live object upload/download/restore; hosted migration for bucket/RLS/backend label unverified. Not Amazon S3 |
| Audit log | Implemented / tested | Production monitoring and retention verification |
| Sentinel Command workbenches | Implemented UI/API surfaces | Signed-out smoke + authenticated admin + invitee accept + facility-manager isolation PASS 2026-11-28 PT (`reports/e2e-auth-pass-2026-11-28.json`) |
| Topology / failure scenario lab | Implemented | Registry-based, non-actuating what-if only; not a physical digital twin or engineering-grade simulation |
| Asset metadata and private media | Schema/API/UI foundation present | Hosted migration divergence with `main` branding/media migrations; full edit/upload lifecycle ops |
| Energy measurement schema/API | Implemented | Live hardware acquisition and end-to-end verification |
| Energy connector ingestion | Code path present | Validate real source payloads, device maps, idempotency and tenant/facility references end-to-end |
| Energy anomaly evaluation | Initial explainable rule in code | Limited initial rule set; validate with real history and false-positive controls |
| Go edge runtime / durable buffer | Implemented / unit-tested (tip audit) | Deploy and verify on target edge hardware |
| Modbus / MQTT / OPC UA | **Scaffold** (read-only connectivity probes) | No full register polling, MQTT topic subscription or OPC UA session/tag acquisition |
| Network intelligence (router/AP inventory) | **Planned** — design only | See [`docs/ROUTER_AP_ADAPTER_DESIGN.md`](docs/ROUTER_AP_ADAPTER_DESIGN.md). Not implemented |
| Wireless security (monitor-mode / rogue AP / deauth) | Planned | Separate adapter family; router inventory is **not** wireless attack proof |
| Electrical intelligence (outlet/circuit/submeter) | Planned | Separate adapter family; not inferred from router DHCP alone |
| Smart-home / physical security integrations | Planned | Camera/NVR, doorbell, lock, alarm, hub and sensor adapters |
| Cross-domain cyber-physical correlation | Planned | Requires validated network, wireless, energy and physical source events |
| Controlled mitigation | Deferred until detection is reliable | Approval, policy, safety, rollback and audit controls required |

## Tip verification snapshots

### Current tip — restore + `build_sha` packet (2026-11-28 America/Los_Angeles)

| Check | Result |
|---|---|
| Shared work HEAD = origin | `dbe84a7bb6ad9103ca14fb5fc6c7b16c6de3384f` |
| www / `main` FE tip | `c68caea0f72da46a953a4ce265c336d765562129` (Vercel production Ready) |
| GitHub Actions release checks (work tip) | **success** — https://github.com/Matik103/SentinelGrid/actions/runs/46155054494 |
| Engineering Quality Gate (work tip) | **success** — https://github.com/Matik103/SentinelGrid/actions/runs/46155054515 (Docker Supabase upgrade path + `phase0_tenant_isolation.sql`) |
| Vercel (`main` / www) | **success** — deployment completed for `c68caea` (facility-manager create-form gate) |
| Nest `/v1/health` | HTTP 200; supabase ok; Resend worker enabled; `payload_backend=supabase`; **`build_sha=c4392e8dd6d4d30c70104c1baafbf7a4bc44506f`** (matches work tip; `reports/render-build-sha-2026-11-28.json`) |
| Local `npm test -w @sentinelgrid/api` | 58/58 pass (Cursor machine, tip sync) |
| Local `npm test -w @sentinelgrid/web` | 12/12 pass |
| Hosted migrations (`abaeizgfsskvjklfslrh`) | **Parity closed** through `20261128160000` (32 versions); dry-run pending=0 vs repo |
| Criterion G live invite | **ops** — manual + authenticated E2E; see below |
| Browser E2E | **ops** — signed-out + authenticated admin + invitee accept + facility-manager isolation PASS (`reports/e2e-auth-pass-2026-11-28.json`). Plan: [`docs/BROWSER_E2E_PLAN.md`](docs/BROWSER_E2E_PLAN.md) |
| Restore drill | **ops** — disposable hosted-schema restore + Storage SHA round-trip PASS (`reports/hosted-restore-drill-2026-11-28.json`); local marker still `reports/restore-drill.json` |

#### Criterion G — invite ops evidence (2026-11-28 PT)

Operator-verified on production www against Nest on the shared work tip, then reconfirmed via authenticated browser E2E. **No invitation tokens are recorded here.**

| Step | Result |
|---|---|
| Workspace | Afya (existing tenant) |
| Inviter | Workspace creator / organisation administrator (protected) |
| Invitee role | Read-only viewer |
| Email delivery | Invite email received (Resend outbox → mailbox); E2E outbox status **sent** |
| Account setup | Invitee created account + completed confirmation |
| MFA | Invitee completed authenticator enrollment / verification |
| Membership | People & access: creator (admin, protected) + active read-only viewer(s); pending invitations empty after accept |
| Role respect | Viewer lacks `user.manage`; invite UI gated; facility_manager isolation PASS (E2E-08) |
| Test account (admin E2E) | Workspace admin test mailbox used for MFA shell + invite create (password/TOTP not stored in repo) |
| Classification | **Ops-verified** invite path + browser E2E suite recorded — Phase 0 still **not COMPLETE** until OT acquisition/deferral and any remaining ops rows in the checklist are closed |

### Prior Issue #9 baseline — `17b4af6`

| Check | Result |
|---|---|
| Shared branch HEAD = origin | `17b4af6` |
| GitHub Actions release checks | success — https://github.com/Matik103/SentinelGrid/actions/runs/45945271767 |
| Vercel tip status | success **preview/branch** deploy (not www production SHA proof) |
| `npm test -w @sentinelgrid/api` | 54/54 pass (Cursor audit machine) |
| `npm run build -w @sentinelgrid/web` | pass |
| `go test ./...` (`edge/connector`) | pass |
| Full quality gate | **blocked on audit machine** (no Docker / Supabase CLI) |
| Nest `/v1/health` | HTTP 200; supabase ok; payload `supabase` / bucket ready; Resend configured+worker on; `build_sha` empty |
| Criterion G live invite | **open** |
| Hosted migrations vs repo | **open / unverified**; main↔work divergence |

### Current tip — `b094207`

| Check | Result |
|---|---|
| Shared branch HEAD = origin | `b094207` |
| Docs/design packet | `2de294e` accepted (Phase 0 tip audit + UniFi design) |
| GitHub Actions release checks | success — https://github.com/Matik103/SentinelGrid/actions/runs/45947732132 |
| Full Engineering Quality Gate | **success** — https://github.com/Matik103/SentinelGrid/actions/runs/45947732146 (Docker + Supabase CLI; lint; 17-migration upgrade path; tenant isolation; npm/go; gitleaks) |
| Vercel tip status | success **preview/branch** — https://vercel.com/excel-11ea67ae/sentinelgrid/4jKNtLkmNYp2aKUMNu2D7WAtnDbm (not www production) |
| Hosted migrations vs repo | **open / unverified**; plan only — [`docs/MIGRATION_RECONCILIATION_PLAN.md`](docs/MIGRATION_RECONCILIATION_PLAN.md) |
| Criterion G live invite | **open** |
| Browser E2E | **open** — plan [`docs/BROWSER_E2E_PLAN.md`](docs/BROWSER_E2E_PLAN.md) |
| Backup/restore drill | **open** — design in [`docs/BACKUP_RECOVERY.md`](docs/BACKUP_RECOVERY.md) |
| UniFi implementation | **not authorized** — design only |

## Operational blockers

1. **Hosted Supabase migrations:** **closed** 2026-11-28 PT — host matches repo through `20261128160000` (pending=0). Plan history: [`docs/MIGRATION_RECONCILIATION_PLAN.md`](docs/MIGRATION_RECONCILIATION_PLAN.md).
2. **Backend deploy SHA correlation:** **ops closed** 2026-11-28 PT — Nest prefers `GIT_SHA || RENDER_GIT_COMMIT || GITHUB_SHA`; live `build_sha` matched work tip (`reports/render-build-sha-2026-11-28.json`, verified on `c4392e8` / `49e44eb`).
3. **Email / Criterion G:** **ops closed** 2026-11-28 PT — manual path + authenticated E2E invite create/delivery/accept (Afya `read_only_viewer`).
4. **Backup/recovery:** **ops closed** 2026-11-28 PT — disposable hosted-schema restore + Storage digest round-trip; see [`docs/BACKUP_RECOVERY.md`](docs/BACKUP_RECOVERY.md) and `reports/hosted-restore-drill-2026-11-28.json`.
5. **Energy/OT acquisition:** probes are not measurements. Provide real register maps, MQTT topics, OPC UA node IDs and fixtures before claiming live telemetry.
6. **Frontend acceptance:** authenticated browser E2E suite closed 2026-11-28 PT (through E2E-08) — [`docs/BROWSER_E2E_PLAN.md`](docs/BROWSER_E2E_PLAN.md).
7. **Production FE branch:** www ships from `main` while Nest ships from this work branch — treat as split-brain until an explicit cutover decision.
8. **Full quality gate:** **green on tip `dbe84a7`** via `.github/workflows/audit.yml` (run 46155054515). Cursor local Docker/Supabase CLI remains unavailable; rely on CI for DB regression.

## Acquisition capability boundaries (architectural)

Keep these **independent** even when they share the event/evidence backbone:

| Capability | Observes | Must not claim |
|---|---|---|
| Network intelligence | Router/AP inventory, DHCP/association, config/uptime changes | Wireless attacks, physical presence, circuit-level load |
| Wireless security | Monitor-mode / controller security telemetry | Endpoint inventory completeness from RF alone; electrical load |
| Electrical intelligence | Smart outlets, submeters, circuit monitors | Device identity from watts alone; Wi-Fi deauth proof |

## Rules

- Do not mark Phase 0 complete until every required row in the acceptance checklist has evidence at the required level.
- Do not classify synthetic, replayed or inferred data as real.
- Do not trust tenant IDs from clients or event payloads.
- Keep OT read-only by default.
- Evidence hashes prove stored-byte integrity, not sensor truth.
- Update this file and [`ROADMAP.md`](ROADMAP.md) in the same change whenever implementation status or sequencing changes.
