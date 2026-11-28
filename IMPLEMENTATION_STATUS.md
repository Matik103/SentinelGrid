# SentinelGrid implementation status

**Canonical branch:** `work/sentinel-command-release-v2`  
**Current tip:** hosted migration parity through `20261128160000` + Criterion G invite ops evidence; functional invite/role UI tip `6ef1ccf`; www FE on `main` @ `43ae5995ee9eb4d0d8fc8644d9f40d7009d05e59`  
**Prior tip (quality-gate packet):** `b094207b91b5889cdc8376a853412e015c71cc80`  
**Prior Issue #9 audit baseline:** `17b4af6b571f17f5338b683b135287adf0bfa947`  
**Last reviewed:** 2026-11-28 (America/Los_Angeles) — applied hosted `20261128160000` (AAL2 self-service invites); Criterion G manual invite ops-verified; browser E2E suite / backup drill / Render `build_sha` still open  
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
| Auth, tenant bootstrap, RBAC, RLS | Implemented / SQL-tested | Hosted migration verification, full signup/MFA and cross-tenant runtime E2E |
| TOTP MFA / AAL2 | Implemented in code and preview flow | Hosted rollout and browser E2E |
| Organisation invitations | Implemented / tested / **ops-verified (manual invite path)** | Resend delivery + signup/MFA/membership activation verified 2026-11-28 PT on Afya (see tip log). Full Playwright browser E2E suite still open |
| Infrastructure registry | Implemented / API-tested | Broader real source onboarding; registry is not auto-discovery |
| Facility/zone/asset hierarchy | Implemented / tested | Real-world mapping and validation for each integration |
| Connector lifecycle | Implemented / tested | Operational deployment and supported source integrations |
| Event ingest, deduplication, DLQ/replay | Implemented / tested | End-to-end source acquisition and production load/failure validation |
| Evidence chain/checkpoints | Implemented / tested | Production restore, retention and operational verification |
| Payload storage | Implemented / tested (Supabase Storage API) | Live object upload/download/restore; hosted migration for bucket/RLS/backend label unverified. Not Amazon S3 |
| Audit log | Implemented / tested | Production monitoring and retention verification |
| Sentinel Command workbenches | Implemented UI/API surfaces | Full authenticated browser E2E and source-backed operational data |
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

### Current tip — `22421d1` / functional UI tip `6ef1ccf` (2026-11-28 America/Los_Angeles)

| Check | Result |
|---|---|
| Shared work HEAD = origin | `22421d189a2e111b57f9c2c63c61c8be0ff2d5af` (docs evidence); functional invite/role UI at `6ef1ccf270485e28725de744ad87498190e71201` |
| www / `main` FE tip | `43ae5995ee9eb4d0d8fc8644d9f40d7009d05e59` (Vercel production source) |
| GitHub Actions release checks (work tip) | **success** — https://github.com/Matik103/SentinelGrid/actions/runs/46149277052 |
| Engineering Quality Gate (work tip) | **success** — https://github.com/Matik103/SentinelGrid/actions/runs/46149277028 (includes Docker Supabase upgrade path + `phase0_tenant_isolation.sql`) |
| Engineering Quality Gate (`main`) | **success** — https://github.com/Matik103/SentinelGrid/actions/runs/46149279913 |
| Vercel (`main` / www) | **success** — deployment completed for `43ae599` (2026-11-28T13:22:30Z) |
| Nest `/v1/health` | HTTP 200; supabase ok; Resend worker enabled; `payload_backend=supabase`; `build_sha` still empty |
| Local `npm test -w @sentinelgrid/api` | 57/57 pass (Cursor machine, tip sync) |
| Local `npm test -w @sentinelgrid/web` | 12/12 pass |
| Hosted migrations (`abaeizgfsskvjklfslrh`) | **Parity closed** through `20261128160000` (32 versions). Applied 2026-11-28 PT via Management API; dry-run pending=0 vs repo |
| Criterion G live invite | **ops (manual)** — see below |
| Browser E2E (Playwright plan) | **OPEN** — [`docs/BROWSER_E2E_PLAN.md`](docs/BROWSER_E2E_PLAN.md); manual invite path is not a substitute for the full suite |

#### Criterion G — manual invite ops evidence (2026-11-28 PT)

Operator-verified on production www against Nest on the shared work tip. **No invitation tokens or personal mailbox addresses are recorded here.**

| Step | Result |
|---|---|
| Workspace | Afya (existing tenant) |
| Inviter | Workspace creator / organisation administrator |
| Invitee role selected | Read-only viewer |
| Email delivery | Invite email received (Resend outbox → mailbox) |
| Account setup | Invitee created account, completed email confirmation |
| MFA | Invitee completed authenticator enrollment / verification |
| Membership | Invitee appears as **active** read-only viewer on People & access; pending invitations empty |
| Role respect | Viewer lacks `user.manage`; People page no longer surfaces Nest 403 JSON for that role (FE gate on tip) |
| Classification | **User-verified functional evidence** for Criterion G invite path — **not** a complete Phase 0 acceptance gate |

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
2. **Backend deploy SHA correlation:** Render health is green but `monitoring.build_sha` is empty. Set `GIT_SHA` on Render only with explicit infra approval.
3. **Email / Criterion G:** **manual ops path closed** 2026-11-28 PT (delivery + accept + MFA + membership). Automated mailbox/Playwright invite E2E still open.
4. **Backup/recovery:** disposable drill design in [`docs/BACKUP_RECOVERY.md`](docs/BACKUP_RECOVERY.md). Execute only when authorized on a non-production project.
5. **Energy/OT acquisition:** probes are not measurements. Provide real register maps, MQTT topics, OPC UA node IDs and fixtures before claiming live telemetry.
6. **Frontend acceptance:** full authenticated browser E2E suite (registry/energy/evidence/facility isolation, etc.) remains open — plan in [`docs/BROWSER_E2E_PLAN.md`](docs/BROWSER_E2E_PLAN.md). Manual invite path alone does not close Criterion 11.
7. **Production FE branch:** www ships from `main` while Nest ships from this work branch — treat as split-brain until an explicit cutover decision.
8. **Full quality gate:** **green on tip `6ef1ccf`** via `.github/workflows/audit.yml` (run 46149277028). Cursor local Docker/Supabase CLI remains unavailable; rely on CI for DB regression.

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
