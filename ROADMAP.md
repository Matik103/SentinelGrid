# SentinelGrid — Product & Engineering Roadmap

**Status:** consolidated working plan  
**Last reviewed:** 2026-11-26 (America/Los_Angeles) — Issue #9 design packet  
**Canonical implementation branch:** `work/sentinel-command-release-v2` (baseline tip at packet start: `17b4af6`)  
**Purpose:** preserve the existing infrastructure, energy, evidence and command-platform plan while extending SentinelGrid into a broad cyber-physical security and intelligence platform.

This document is the single navigation point for product sequencing. It does not declare unfinished work complete. Capability status must be backed by code, tests and operational evidence.

## 1. Product direction

SentinelGrid monitors and explains **what connects, what changes, what communicates, what consumes energy, and what happens in the physical environment** across homes, buildings, campuses, industrial facilities and critical infrastructure.

The product is not limited to smart homes, nor is it only an energy dashboard or an asset registry. Energy and equipment intelligence remain an important adoption path. The wider product joins infrastructure inventory, network and device security, wireless security, energy telemetry, physical/IoT events, incident correlation and tamper-evident evidence.

## 2. What already exists — preserve it

The following work is already present in the shared branch or its documented implementation. These are foundations, not proof that the complete end-user capability is finished.

| Existing workstream | Current evidence / boundary |
|---|---|
| Multi-tenant platform, auth, RBAC, MFA, RLS | Schema, API and SQL tests exist; hosted rollout and full production E2E gates remain open |
| Infrastructure hierarchy | Organisation → Facility → Zone → Asset → Device → Sensor |
| Registry | Facilities, zones, assets, devices, sensors, connectors; richer asset metadata and categories |
| Command workbenches | Overview, topology, incident investigation, historical read-only replay, non-actuating failure scenario lab |
| Events and evidence | Append-only event ledger, deduplication/DLQ, evidence records/checkpoints, payload storage and audit surfaces |
| Edge connector | Go runtime, durable buffer, credential lifecycle, read-only defaults; Modbus/MQTT/OPC UA adapters are currently connectivity probes/scaffolds, not full acquisition |
| Energy foundation | Energy measurement schema/API, connector-authenticated ingestion path, initial explainable sustained-demand rule; real source acquisition and end-to-end validation remain incomplete |
| Asset media | Private asset-media storage and provenance model |
| Deployment foundation | Vercel frontend, Nest API deployment blueprint, Supabase backend configuration; production operational gates remain open |

**Do not discard or rewrite these workstreams when adding IoT/network capabilities.** Extend the common event, device, connector, evidence and tenant model.

Primary existing design references:
- [Phase 0 schema](docs/PHASE0_SCHEMA.md)
- [Phase 0 acceptance checklist](docs/PHASE0_ACCEPTANCE_CHECKLIST.md)
- [Phase 0 security hardening](docs/PHASE0_SECURITY_HARDENING.md)
- [Command workbench implementation](docs/COMMAND_WORKBENCH_IMPLEMENTATION.md)
- [Energy and visual handoff](docs/CURSOR_ENERGY_VISUAL_HANDOFF.md)
- [Engineering quality gate](docs/ENGINEERING_QUALITY_GATE.md)
- [Deployment and production readiness](docs/VERCEL_DEPLOY.md)

## 3. Capability status vocabulary

Use these labels consistently in issues, PRs, UI and status reports:

- **Implemented:** code path exists.
- **Tested:** automated tests exercise the behavior and pass.
- **Operationally verified:** tested against real supported hardware/services and credentials.
- **Scaffold:** interface, probe, placeholder or simulated path exists; it is not real acquisition.
- **Planned:** accepted work not implemented yet.
- **Deferred:** intentionally out of current scope, with reason and revisit trigger.

A registry entry is not device discovery. A reachable TCP port is not telemetry. A router being unreachable is not proof of a deauthentication attack. A hash proves byte integrity, not sensor truth. Synthetic, replayed and inferred data must always remain visibly classified.

## 4. Target coverage

### A. Network-connected devices
Phones, laptops, desktops, tablets, printers, TVs, game consoles, NAS, routers, switches, access points, repeaters, smart speakers, network storage, cameras, doorbells, plugs, bulbs and unknown endpoints.

### B. Wireless and network infrastructure
Wi-Fi APs, guest networks, mesh systems, Ethernet switches, DHCP/DNS/gateway services, VLANs, firewall rules, VPN gateways, Bluetooth/BLE and supported IoT radio gateways.

### C. Smart-home and building systems
Cameras, doorbells, NVRs, smart locks, alarms, motion/presence sensors, door/window contacts, glass-break sensors, lighting, thermostats, HVAC, environmental sensors, smart plugs, appliances, access-control panels, intercoms and automation hubs.

### D. Electrical and energy systems
Smart plugs/outlets, submeters, circuit monitors, main meters, UPS, batteries, solar inverters, generators, chargers, lighting circuits, HVAC/refrigeration loads, pumps, motors and other equipment.

### E. Industrial and critical infrastructure
Existing and future categories must continue to cover electrical distribution, transformers, UPS, generators, solar, batteries, HVAC, refrigeration, pumps/motors, industrial equipment, BMS, data centres, cooling plant and other assets. Add protocol/source support without narrowing the product to residential IoT.

## 5. Unified architecture

Keep the existing tenant-scoped hierarchy and event/evidence backbone. Add acquisition adapters as peers feeding the common normalized event pipeline.

**Acquisition sources** (three independent families must stay distinct: **network intelligence**, **wireless security**, **electrical intelligence**)
1. Router/AP integrations: DHCP leases, associated clients, AP inventory, configuration snapshots, uptime, firmware, admin/account and security events. Design-only first adapter: [`docs/ROUTER_AP_ADAPTER_DESIGN.md`](docs/ROUTER_AP_ADAPTER_DESIGN.md) (UniFi Network Application candidate; not implemented).
2. Network discovery: passive observation first; controlled active discovery where explicitly enabled; endpoint fingerprinting and service inventory.
3. Wireless security sensors: monitor-mode 802.11 telemetry, AP/controller security events, rogue AP and deauth/disassociation indicators — **not** inferred from router inventory alone.
4. Energy devices: smart plugs, outlet monitors, submeters, circuit monitors and utility meters — **not** inferred from DHCP or association tables.
5. Smart-home/building hubs: Matter, Thread, Zigbee, Z-Wave and vendor APIs where documented and supported.
6. Physical security: camera/NVR, doorbell, lock, alarm, access-control and sensor event integrations.
7. OT/industrial connectors: documented Modbus register maps, MQTT topics, OPC UA nodes, SNMP and vendor/BMS interfaces.

**Shared processing**
- Edge connector / gateway authenticates to SentinelGrid; tenant identity is derived from the connector credential, never trusted from an event body.
- Adapter-specific payloads are validated and normalized into versioned envelopes.
- Every observation records source, acquisition method, observed time, received time, clock/data quality, classification, confidence, tenant/facility context and relevant device/asset/sensor IDs.
- Preserve raw payload references where permitted; append the normalized event to the event ledger; attach evidence/checkpoints through the existing evidence chain.
- Resolve identity and relationships conservatively. Unknown devices remain unknown until evidence supports classification.
- Correlate observations across network, wireless, energy and physical domains into one incident timeline.
- Keep all customer data tenant-isolated with RLS and server-side authorization.

**Required observation semantics**
- `classification`: real / synthetic / simulated / replayed / inferred (only use values supported by the current shared schema; extend it through reviewed migrations when necessary).
- `confidence`: explicit numeric or categorical confidence with documented meaning; never silently convert an inference to a fact.
- `source`: adapter, integration or sensor identifier.
- `quality`: good / degraded / stale / invalid or the canonical schema equivalent.
- `observed_at` and `received_at`: retain both to expose clock skew and delayed delivery.
- `evidence_ref`: link to immutable event/payload evidence where available.

## 6. Original six-phase product roadmap — retained

The six-phase structure is the product's original organizing model. New capabilities are additions inside these phases, not replacement phases. The ordering below preserves the original phase names and incorporates the newly discussed network, IoT, wireless, electrical and physical-security requirements.

### Phase 0 — Platform Foundation
**Status: in progress; not complete.**

Build and operationally verify the secure multi-tenant foundation on which every later capability depends:
- Tenant bootstrap, organisations, memberships, RBAC, MFA/AAL2 and strict RLS.
- Organisation → Facility → Zone → Asset → Device → Sensor hierarchy.
- Connector registry, authenticated connector identity, heartbeat, credential rotation and revocation.
- Versioned event ingestion, tenant-derived identity, validation, idempotency, deduplication, dead-letter handling and replay.
- Evidence records, raw-payload storage, event/payload linkage, integrity checks, checkpoints, export and audit history.
- Durable edge buffering, safe retry/recovery and connector health.
- API, frontend, deployment, monitoring, backup and restore foundations.
- Production auth and browser E2E for Command workbenches, registry, invitations, energy and evidence.

**Exit gate:** current-tip CI and disposable database security tests pass; pending migrations are reviewed and safely applied to the intended environment; remote tenant isolation is verified; API/frontend E2E passes; backup and object-storage restore are demonstrated; email is verified or formally excluded; no probe/scaffold is represented as live source acquisition.

### Phase 1 — Infrastructure & Energy Intelligence
Build the trusted inventory and source-backed understanding of the physical infrastructure being monitored:
- Rich asset, device and sensor profiles, manufacturer/model/serial metadata, rated values, specifications and media provenance.
- Facilities, zones, asset hierarchy, dependency relationships and equipment criticality.
- Broad equipment coverage: electrical distribution, transformers, UPS, generators, solar, batteries, HVAC, refrigeration, pumps/motors, industrial equipment, BMS, data centres, cooling plant and other infrastructure.
- Energy measurements with units, timestamps, source identity, quality, clock quality and real/simulated/replayed classification.
- Real acquisition through documented Modbus register maps, MQTT topics, OPC UA nodes, SNMP, meters, submeters, smart plugs/outlets and vendor/BMS integrations.
- Explainable energy baselines and anomaly findings: unexpected load, sustained demand deviation, standby consumption, abnormal power cycles, temperature/energy divergence, UPS/battery behavior and missing/stale telemetry.
- Asset energy profiles, historical comparisons, measurement provenance and exports.
- Device inventory foundations needed by later security work, including stable identity, source history and facility/zone/asset relationships.

**Newly consolidated requirements:** identify a new smart plug or networked bulb through its router/hub; detect a new electrical load through a smart outlet or meter; map outlets/circuits to physical locations and assets. Do not claim that a conventional non-networked bulb or charger has been individually identified from aggregate circuit consumption alone.

**Exit gate:** measurements are acquired from supported real sources with validated maps/topics/node IDs, correct units and timestamps; tenant/facility relationships and idempotency are tested; quality and classification are visible; anomaly rules have replay fixtures and false-positive controls.

### Phase 2 — Operational Intelligence
Turn infrastructure and telemetry into useful operational understanding, investigation and decisions:
- Sentinel Command overview and facility/site workbenches.
- Infrastructure topology based on validated relationships, not invented digital-twin links.
- Event and measurement timelines, freshness, source health, data quality and coverage gaps.
- Incident investigation queue, event replay, evidence navigation and audit history.
- Explainable operational findings, anomaly review lifecycle, acknowledgement, resolution and false-positive handling.
- Failure scenario and dependency analysis that clearly distinguishes registry-based what-if calculations from engineering-grade simulation.
- Cross-source operational correlation and root-cause investigation using actual supporting observations.
- Role-specific workflows, reporting and escalation.

**Newly consolidated requirements:** show a coherent operational timeline when a device appears, a router changes, a camera disconnects or energy consumption changes; correlate events only when there is sufficient source evidence and expose uncertainty and alternative explanations.

**Exit gate:** users can trace each finding to its source events and measurements, replay the sequence, understand data-quality limitations and record investigation outcomes. No AI diagnosis or engineering prediction is claimed without validated methods and evidence.

### Phase 3 — Cyber-Physical Security
Expand SentinelGrid from infrastructure and operational monitoring into broad cyber-physical security across homes, buildings, campuses, industrial facilities and critical infrastructure.

**Network and device security**
- Router/AP integrations for associated clients, DHCP leases, connected-device inventory, AP inventory and configuration snapshots.
- Passive network discovery and controlled, opt-in LAN discovery; endpoint and service fingerprinting.
- First-seen/last-seen, new/removed/changed endpoint events, device identity history and confidence-aware matching across IP changes and MAC randomization.
- Known/authorized/guest/unknown device states, review workflows and policy-based alerts.
- Rogue devices, unexpected services, rogue access points and suspicious network changes.
- Router integrity: reboot/reset, uptime, firmware, SSID/security changes, DNS/DHCP/gateway changes, admin-account changes, firewall and port-forwarding changes, WAN interruption and configuration drift.

**Wireless security**
- Dedicated wireless sensor support using compatible monitor-mode hardware and/or AP/controller security telemetry.
- Deauthentication/disassociation bursts, suspicious management-frame patterns, evil-twin/rogue AP indicators, unexpected BSSID/channel changes and wireless availability anomalies.
- Corroboration across multiple observations and sensors where supported.
- Evidence and privacy controls for captured packet metadata/content.

**Smart-home, IoT and building security**
- Cameras, doorbells, NVRs, smart locks, alarms, motion/presence sensors, door/window contacts, glass-break sensors, access control, intercoms, lighting and environmental devices.
- Supported Matter, Thread, Zigbee, Z-Wave and vendor hub integrations.
- Device access/authentication/configuration events, offline events and integration health.
- Distinguish device offline or connectivity loss from confirmed physical tampering.

**Electrical and physical context**
- Smart plugs/outlets, circuit monitors and meters as security-relevant observations.
- New/unexpected load, unusual power cycle or load change correlated with network and physical events.
- Location and zone mapping for outlets, cameras, locks, sensors and unknown devices, with explicit source and confidence.

**Cross-domain cyber-physical correlation**
- Correlate network, router, wireless, energy, OT and physical observations into one incident timeline.
- Example scenarios: unknown endpoint plus router configuration change; camera offline plus new AP; deauth pattern plus multiple device disconnects; new outlet load plus nearby unknown device; smart-lock event plus unusual network access.
- Explainable rules, confidence, alternative explanations, deduplication and investigation lifecycle.

**Critical detection boundaries**
- A Wi-Fi outage alone is not proof of deauthentication.
- A network scan cannot identify a conventional non-networked bulb or charger.
- Aggregate circuit power does not always identify the exact appliance.
- A camera going offline is not proof of tampering.
- Fingerprinting is probabilistic; unknown devices must remain unknown until evidence improves.

**Exit gate:** each claimed integration has a supported-device/API matrix and real or certified-lab test evidence; replayed attacks and normal roaming/reboot/interference scenarios are both tested; every finding exposes source, confidence, evidence and limitations; privacy and tenant-isolation tests pass.

### Phase 4 — AI Agent Accountability
Preserve the original AI-agent accountability phase as a distinct product pillar; do not let the new IoT roadmap erase it.

The platform must make AI-assisted analysis and any future agent-initiated action inspectable and governable:
- Explicit identity and scope for each agent, integration and tool.
- Permission boundaries and least-privilege access to tenant data, devices and operational actions.
- Policy evaluation before sensitive reads, writes, configuration changes or response actions.
- Human approval for consequential actions; dry-run and preview before execution.
- Complete action trace: initiating actor/agent, intent, policy decision, approval, target, inputs, before/after state, result and evidence.
- Tool/API provenance, model/agent version and reproducible decision context where available.
- Deny-by-default behavior for unknown or out-of-scope actions; revocation and emergency stop.
- Clear separation between AI-generated hypotheses, rule-based findings, observed facts and operator-confirmed conclusions.

**Newly consolidated requirements:** AI may help correlate an unknown device, wireless anomaly, energy change or physical event, but it must show the supporting evidence and uncertainty. It must not autonomously quarantine devices, change router settings, unlock/lock doors or write to OT systems without explicit policy and authorization.

**Exit gate:** agent actions are permission-checked, attributable, reviewable and auditable; denied actions fail closed; approval and revocation paths are tested; AI hypotheses are never represented as confirmed observations.

### Phase 5 — Managed Infrastructure Resilience
Turn SentinelGrid into a continuous resilience and managed-infrastructure capability:
- Fleet/site management across homes, buildings, campuses, data centres and industrial facilities.
- Connector, sensor, device and integration health; source coverage, freshness and data-quality monitoring.
- Resilience posture, dependency awareness, incident history, operational readiness and recovery workflows.
- Backup, restore, evidence retention, export and disaster recovery.
- Controlled response recommendations and, where supported, approved actions through router/firewall/controller APIs.
- Response policy, role checks, human approval, dry-run, safety guardrails, expiry, rollback and audit evidence.
- OT remains read-only by default; no uncontrolled industrial actuation.
- Operational reporting, service reviews, compatibility matrices, onboarding and lifecycle management.
- Expand tested protocols and vendors for BMS, data centres, electrical systems, industrial environments and critical infrastructure.

**Exit gate:** resilience claims are based on measured coverage and tested recovery; every supported response has explicit authorization and rollback; each device/protocol family has an operational runbook and support boundary.

## 7. Healthcare Revenue Validation — preserve as a separate strategic decision record

The prior **Healthcare Revenue Validation** work is not a new SentinelGrid technical phase and must not be silently converted into a product feature.

The retrieved decision context records:
- The evaluated outsourced healthcare revenue-recovery opportunity was **NO-GO**, with a score of **39/100**.
- Preserve the underlying audit findings, healthcare-facility database, payer/HMIS competitive research, rejection research and regulatory analysis as decision evidence.
- Healthcare facilities remain a possible longer-term SentinelGrid customer/coverage vertical, but that does not reverse the NO-GO decision on the outsourced revenue-recovery business model.
- No healthcare-specific SentinelGrid capability plan is evidenced in the retrieved original roadmap context. Do not invent one or assume that revenue-cycle automation, claims processing or payer integrations are approved product scope.

If healthcare becomes a target vertical later, assess it against SentinelGrid's existing infrastructure, energy, operational intelligence, cyber-physical security, AI accountability and resilience phases. Any healthcare-specific integrations or compliance scope require a separate validated product decision.

## 8. Specific detection truth table



| User concern | Required evidence source | What SentinelGrid may claim |
|---|---|---|
| New phone/laptop/camera on Wi-Fi | Router/AP client inventory, DHCP, passive network observation | New/unknown network endpoint observed; identity confidence stated |
| New smart bulb/plug on Wi-Fi | Router/AP or hub discovery | New network/hub device observed |
| Ordinary bulb/charger plugged into wall | Smart outlet, outlet monitor or circuit meter | New load or power change observed; exact appliance only if source identifies it |
| Router reset/reboot | Router uptime, system log, heartbeat/config snapshot | Reboot/reset observed or suspected, with source |
| Router settings changed | Before/after configuration or controller audit log | Specific configuration change observed |
| Wi-Fi deauth attack | Monitor-mode 802.11 frames or AP security telemetry | Deauth/disassociation pattern observed; attribution and attack confidence separately stated |
| Camera/doorbell tampering or access | Camera/NVR/controller logs, config/auth events, traffic metadata | Specific access/configuration/offline event observed; physical tampering only with supporting sensor evidence |
| Smart-lock/door event | Lock/access controller/door sensor | Reported lock or door event; validate device clock and source |
| Unknown device communicating | Passive traffic metadata, endpoint discovery, firewall/router logs | Communication observed and destination/service described where available |

**Hard limits:** Wi-Fi discovery cannot identify a conventional non-networked bulb or charger by itself. Aggregate circuit load cannot reliably identify an exact appliance in every case. A dropped Wi-Fi connection does not prove deauthentication. Camera offline does not prove physical tampering. A device fingerprint is probabilistic, not an identity certificate.

## 8. Cross-cutting requirements for every milestone

1. **Security first:** tenant identity comes from authenticated connector/session context; never trust tenant IDs from clients or payloads.
2. **Read-only by default:** no OT write/control path in acquisition milestones.
3. **Privacy:** minimize packet/payload collection; define consent, retention, access and redaction before capturing content.
4. **Evidence:** preserve provenance, timestamps, quality, source and immutable references; integrity does not prove truth.
5. **No fabricated reality:** simulated/replayed/inferred data is labelled in storage, API and UI.
6. **Explainability:** every alert links to the observations and rule version that produced it.
7. **Resilience:** durable edge buffering, idempotent delivery, bounded retries, clock-quality handling and explicit stale/offline states.
8. **Interoperability:** prefer documented vendor APIs and open protocols; keep vendor adapters isolated behind versioned contracts.
9. **Safe discovery:** active scans are opt-in, rate-limited and scoped to networks the operator is authorized to assess.
10. **Quality gates:** migration tests, unit/integration tests, replay fixtures, tenant isolation, security review and operational evidence are required before a milestone is closed.

## 9. Execution rules and next work packet

- Work only on `work/sentinel-command-release-v2`; sync before editing; never force-push or silently switch to `main`.
- Keep one coherent change set at a time. Update this roadmap and `IMPLEMENTATION_STATUS.md` whenever capability status changes.
- Create focused GitHub issues for milestone-sized work; link each issue to its acceptance criteria and dependencies.
- Do not begin hardware-dependent detection until its source contract, supported hardware/API, test fixture and evidence semantics are defined.
- Do not add vendor-specific fields to the shared core when an adapter-specific metadata envelope is sufficient.
- Do not declare an integration supported based only on a successful TCP connection.

**Recommended immediate next packet:** (1) full Engineering Quality Gate on the canonical branch via `.github/workflows/audit.yml`, (2) hosted migration inventory + approved apply per [`docs/MIGRATION_RECONCILIATION_PLAN.md`](docs/MIGRATION_RECONCILIATION_PLAN.md), (3) browser E2E, (4) disposable restore drill per [`docs/BACKUP_RECOVERY.md`](docs/BACKUP_RECOVERY.md), (5) UniFi lab API validation, then (6) implement Milestone 1 per [`docs/ROUTER_AP_ADAPTER_DESIGN.md`](docs/ROUTER_AP_ADAPTER_DESIGN.md). Keep wireless monitor-mode detection and electrical outlet sensing as separate acquisition adapters so their hardware prerequisites and claims remain accurate.
