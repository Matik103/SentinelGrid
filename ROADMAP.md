# SentinelGrid — Product & Engineering Roadmap

**Status:** consolidated working plan  
**Last reviewed:** 2026-11-27  
**Canonical implementation branch:** `work/sentinel-command-release-v2`  
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

**Acquisition sources**
1. Router/AP integrations: DHCP leases, associated clients, AP inventory, configuration snapshots, uptime, firmware, admin/account and security events.
2. Network discovery: passive observation first; controlled active discovery where explicitly enabled; endpoint fingerprinting and service inventory.
3. Wireless security sensors: monitor-mode 802.11 telemetry, AP/controller security events, rogue AP and deauth/disassociation indicators.
4. Energy devices: smart plugs, outlet monitors, submeters, circuit monitors and utility meters.
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

## 6. Sequenced delivery plan

The sequence deliberately finishes and verifies the shared platform foundation before depending on broad live integrations. Work can overlap only when its contracts and prerequisites are stable.

### Milestone 0 — Platform foundation and operational closure
**Status: in progress; do not mark complete.**

Preserve and close the existing Phase 0 work:
- Tenant bootstrap, membership/RBAC, MFA/AAL2 and RLS.
- Registry, zones, asset relationships and facility scoping.
- Connector registration, heartbeat, rotate/revoke and authenticated ingestion.
- Event ledger, idempotency, DLQ/replay and payload preservation.
- Evidence chain, checkpoints, verification/export and audit history.
- Sentinel Command workbenches, auth/browser E2E and energy/asset flows.
- Production API, Supabase migration and configuration, email delivery and backup/restore.

**Exit gate:** current tip CI and disposable database security tests pass; pending migrations are reviewed and applied only to the intended environment; remote tenant isolation is verified; API/frontend E2E passes; backup/object-storage restore is demonstrated; email is either delivered end-to-end or explicitly excluded; no scaffold is reported as live acquisition.

### Milestone 1 — Universal device inventory and network change detection
**Priority: first new capability.**

Deliver:
- Router/AP connector framework and first supported router integration(s), selected by available documented APIs.
- Discover associated clients and DHCP leases; enrich with MAC/OUI, IP, hostname, vendor and observed services when available.
- Optional controlled LAN discovery for devices not exposed by router APIs.
- Stable device identity resolution across IP changes, MAC randomization and multiple observation sources, with confidence and identity history.
- First-seen/last-seen, online/offline, new/removed/changed device events.
- Authorized/known/guest/unknown device states, user review and allow-list policy.
- Alerts for an unknown device, new AP, unexpected network service or device appearing in a sensitive zone.
- Device inventory view connected to existing Device Registry and incident workbench.

**Acceptance:** a test network with known devices produces accurate inventory and first-seen events; DHCP/IP changes do not create duplicate physical identities without explanation; unknown devices are flagged with source and confidence; unsupported devices are reported as unknown rather than guessed; tenant boundaries and replay/idempotency tests pass.

### Milestone 2 — Router integrity and wireless threat detection
Deliver:
- Router/AP uptime, reboot/reset, firmware and configuration snapshots where the vendor API exposes them.
- Detect SSID/security-mode changes, DHCP/DNS/gateway changes, new admin accounts, changed firewall/port-forwarding rules and WAN interruptions.
- Wireless sensor agent with monitor-mode capture support on documented compatible hardware.
- Detect deauthentication/disassociation bursts, suspicious management-frame patterns, rogue/evil-twin AP indicators and unexpected BSSID/channel changes.
- Distinguish observations from conclusions: a Wi-Fi outage alone is not a deauth finding.
- Multi-sensor corroboration and confidence scoring where supported; preserve packet/metadata evidence according to privacy and retention policy.

**Acceptance:** replayable lab captures trigger expected alerts; normal roaming, channel changes and router reboot scenarios are tested as false-positive controls; the UI identifies which telemetry supports each finding; monitor-mode hardware and platform limitations are documented.

### Milestone 3 — Electrical and outlet-level intelligence
Deliver:
- Integrations for smart plugs/outlets and selected meters/submeters/circuit monitors.
- Device/asset mapping for outlets and circuits, with location and owner/authorization metadata.
- New-load, unexpected-load, standby-load, power-cycle and abnormal consumption detection.
- Time-of-day and operating-schedule baselines where sufficient real history exists.
- Explainable anomaly records with measurement, unit, baseline, deviation, rule version and review lifecycle.
- Distinguish a detected electrical load change from a claim about the exact appliance.

**Acceptance:** known test loads are measured with correct units/timestamps/source; plug/unplug and power-cycle cases are repeatable; missing/stale/poor-quality data is not scored as a real anomaly; aggregate circuit measurements do not claim to identify a specific charger or bulb without supporting device-level evidence.

### Milestone 4 — Smart-home, building and physical security integrations
Deliver:
- Hub integrations for supported Matter/Thread, Zigbee, Z-Wave and vendor systems.
- Camera/NVR/doorbell availability, configuration and access/authentication events.
- Smart-lock, alarm, motion, door/window, glass-break, presence and access-control events.
- Lighting and environmental telemetry.
- Device capability profiles, integration health and permission/consent boundaries.
- Map device events to facility/zone/asset relationships without assuming physical placement.

**Acceptance:** each integration has a published supported-device/API matrix; events retain source identity and timestamps; access/configuration events can be audited; offline state is separated from tampering; unsupported brands/protocols fail clearly.

### Milestone 5 — Cross-domain cyber-physical correlation
Deliver:
- Correlation engine linking network, router, wireless, energy, OT and physical observations.
- Incident timeline with source-backed sequence and evidence references.
- Examples: unknown endpoint + router configuration change; camera offline + new wireless AP; deauth burst + device disconnects; new outlet load + unknown device nearby; smart-lock event + unusual network access.
- Explainable correlation rules, confidence and alternative explanations.
- Incident grouping, deduplication, acknowledgement, investigation and resolution lifecycle.
- Historical replay for testing and post-incident review.

**Acceptance:** synthetic/replay test scenarios are clearly labelled; correlated incidents show contributing events and uncertainty; one weak signal never becomes a confirmed attack; duplicate observations do not create duplicate incidents.

### Milestone 6 — Controlled response and resilience
Deliver:
- Response recommendations first: investigate, verify owner, rotate credentials, disable guest access, isolate device, block endpoint or revoke integration.
- Optional approved actions only through supported router/firewall/controller APIs.
- Explicit policy, operator approval, role checks, dry-run preview, safety guardrails, expiry, rollback and audit evidence.
- Preserve OT read-only defaults; no uncontrolled industrial actuation.

**Acceptance:** no response executes without the configured approval policy; every action records requester, approver, target, before/after state, result and rollback status; failure leaves a safe, visible state.

### Milestone 7 — Broad infrastructure and enterprise maturity
Deliver:
- Expand tested protocol and vendor coverage for BMS, data centres, electrical systems, industrial environments and critical infrastructure.
- Fleet/site management, connector health, source coverage and data-quality reporting.
- Retention, export, evidence integrity and disaster recovery controls.
- Role-specific dashboards and operational reporting.
- Compatibility matrix, onboarding guides and deployment profiles for home, building, campus and industrial environments.

**Acceptance:** each claimed protocol/device family has a tested compatibility statement, representative hardware or certified simulator evidence, operational runbook and support boundary.

## 7. Specific detection truth table

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

**Recommended immediate next packet:** complete the Phase 0 operational blockers and, in parallel after the event/device contract is reviewed, implement Milestone 1's first router/AP inventory adapter and device first-seen/change pipeline. Keep wireless monitor-mode detection and electrical outlet sensing as separate acquisition adapters so their hardware prerequisites and claims remain accurate.
