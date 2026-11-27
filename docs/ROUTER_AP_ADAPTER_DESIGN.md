# Router / AP inventory adapter — design & lab plan

**Status:** design only — **not implemented**  
**Issue:** [#9](https://github.com/Matik103/SentinelGrid/issues/9)  
**Baseline tip when authored:** `17b4af6b571f17f5338b683b135287adf0bfa947`  
**Canonical branch:** `work/sentinel-command-release-v2`  
**Timezone:** America/Los_Angeles  

## 1. Purpose and non-goals

### Purpose
Define the first **network intelligence** acquisition adapter: pull router/controller inventory (access points, associated/DHCP clients, firmware/uptime, selected configuration snapshots) into SentinelGrid’s existing connector → normalize → event ledger → evidence path.

### Non-goals (strict)
- **Not** wireless security: no monitor-mode capture, deauth/disassociation scoring, or rogue-AP RF claims.
- **Not** electrical intelligence: no outlet/circuit/submeter watts or “device identified from load.”
- **Not** proof of physical presence or true endpoint identity (especially under MAC randomization).
- **Not** actuation: no firewall rule changes, client blocks, or WLAN reconfiguration in Milestone 1.
- **Not** claiming OT/Modbus/MQTT/OPC UA acquisition.

These three acquisition families remain independent peers that later correlate through the shared event/evidence architecture when each has real hardware evidence.

## 2. First candidate source

| Field | Choice |
|---|---|
| Vendor / product | **Ubiquiti UniFi Network Application** (self-hosted or UniFi OS console) |
| Why first | Documented controller API surface for sites, devices (APs/gateways), and clients; common lab/SMB gear; fits read-only inventory without RF sensors |
| Minimum supported hardware (lab) | UniFi Gateway or Cloud Gateway **or** a UniFi Network Application controlling ≥1 UniFi AP; Network Application version to be pinned during lab bring-up (record exact version in fixtures) |
| Minimum firmware | Gateway/AP firmware versions recorded at lab start; reject undocumented “any firmware” claims |
| Out of first scope | UniFi Protect-only cameras, Talk, Access; third-party routers; mesh vendors without a reviewed API |

**Fallback candidates (not designed here):** OpenWrt `ubus`/RPC (higher fragmentation), Meraki Dashboard API (cloud/org model), OPNsense plugins. Revisit only if UniFi lab hardware is unavailable.

## 3. Authentication and least privilege

| Requirement | Design |
|---|---|
| Credential storage | SentinelGrid connector credential store (existing sealed/rotated connector secrets). Never embed controller passwords in event bodies or FE |
| Auth method | Local UniFi Network API session (username/password → session cookie / API key where Network Application version supports API keys). Prefer **API key / limited local admin** over owner cloud SSO tokens |
| Scopes | Read-only: list sites, devices, clients/DHCP leases, basic system info. **No** write, adopt, restart, or WLAN mutate |
| Network path | Lab VLAN or management network only; TLS to controller where available; pin or document certificate trust for lab |
| Tenant binding | Connector credential → organisation (and facility mapping config). Controller site ID maps to facility via operator config — never from client-supplied tenant IDs |

## 4. Source fields / events (as available)

Poll interval: configurable; default lab **60s**. Emit change events, not raw dumps every cycle.

| Source object | Example fields | Event kinds (proposed) |
|---|---|---|
| Controller / gateway | name, model, firmware, uptime, WAN IP (careful with PII) | `network.controller.heartbeat`, `network.controller.firmware_changed` |
| Access point | MAC, model, firmware, IP, adopted state, radio summaries | `network.ap.inventory`, `network.ap.firmware_changed`, `network.ap.offline` / `online` |
| Client / station | MAC, hostname, IP, AP/BSSID association, wired/wireless, first/last seen | `network.endpoint.first_seen`, `network.endpoint.changed`, `network.endpoint.disassociated` |
| DHCP lease (if exposed) | MAC, IP, hostname, lease times | Contribute to endpoint identity; do not invent DNS truth |
| Config snapshot (selected) | WLAN SSID names (not PSKs), LAN subnet labels | `network.config.snapshot` with redaction; store raw under evidence payload policy |

**Unavailable → omit:** do not synthesize RF channel conflict, deauth counts, or power draw from these objects.

## 5. Normalized envelope and identity strategy

Reuse Phase 0 observation semantics (`classification`, `confidence`, `source`, `quality`, `observed_at`, `received_at`, `evidence_ref`).

### Proposed envelope (design sketch)

```json
{
  "schema": "sentinelgrid.network.unifi.v0",
  "source": { "adapter": "unifi_network", "controller_id": "…", "site_id": "…" },
  "classification": "real",
  "confidence": { "endpoint_identity": 0.4, "link_observation": 0.9 },
  "quality": "good",
  "observed_at": "2026-11-27T01:00:00Z",
  "received_at": "2026-11-27T01:00:02Z",
  "facility_id": "<mapped>",
  "kind": "network.endpoint.first_seen",
  "subject": {
    "mac": "aa:bb:…",
    "mac_randomized": true,
    "ip": "192.0.2.10",
    "hostname": "optional",
    "ap_mac": "…"
  },
  "uncertainty": ["mac_randomization_possible", "hostname_untrusted"]
}
```

### Identity rules
- Primary unstable key: client MAC (normalize lowercase, strip separators).
- Flag `mac_randomized` when locally administered bit set or vendor OUI indicates privacy MAC.
- IP alone is **not** durable identity (DHCP churn).
- Hostname is advisory only.
- First-seen creates an **unknown endpoint** registry candidate; promotion to named asset requires operator confirmation or stronger multi-signal evidence (later milestones).
- Roaming (same MAC, new AP) is `network.endpoint.changed`, not a new device.
- Controller reboot: expect mass `online`/`offline` churn — fixtures must include reboot storms so detectors do not page as “fleet wipe.”

### Idempotency
- Dedupe key: `connector_id + site_id + kind + subject_mac + observed_at_bucket` (or UniFi object revision if available).
- Use existing ingest idempotency / DLQ paths; never trust body `organisation_id`.

### Provenance
- Store redacted raw controller JSON in payload storage (Supabase Storage) when policy allows; link via evidence chain.
- Record adapter version, controller version, poll cursor.

## 6. Privacy and retention

- Do not retain Wi-Fi PSKs, admin passwords, or full config exports with secrets.
- Treat client hostnames and WAN IPs as sensitive; default retention aligned with org event retention (TBD operator policy).
- Lab fixtures use synthetic MACs/IPs.
- Guest network clients may require shorter retention or hashing of MAC after N days (policy decision — not coded here).

## 7. Replay fixtures and acceptance tests

| Fixture | Intent |
|---|---|
| `unifi_site_steady.json` | Stable AP + 3 clients; repeated poll → no duplicate first_seen |
| `unifi_new_client.json` | One new MAC → single `first_seen` |
| `unifi_roam.json` | Same MAC, AP change → `changed`, not new identity |
| `unifi_reboot.json` | All APs flap → controlled storm; quality may be `degraded` |
| `unifi_random_mac.json` | Privacy MAC → low `endpoint_identity` confidence |
| `unifi_ip_churn.json` | Same MAC, new IP → identity stable, IP attribute change |

Automated acceptance (when implementation is authorized): unit normalize tests + ingest idempotency tests against fixtures. No live controller required for fixture tests.

## 8. Lab hardware and operator test plan

### Hardware (minimum)
1. UniFi Network Application (local VM/container or UniFi OS console).
2. One UniFi AP (or gateway with WLAN) on an isolated lab SSID.
3. Two client devices: one capable of MAC randomization (phone), one stable MAC (Ethernet IoT or desktop with randomization off).
4. Management laptop for API credentials and SentinelGrid lab org.

### Operator steps (after implementation approval — not now)
1. Record Network Application version, AP model/firmware, lab subnet.
2. Create read-only local user or API key; store only in connector secret path.
3. Map UniFi site → lab facility in connector config.
4. Register connector in SentinelGrid lab org; confirm heartbeat.
5. Run steady poll 10 minutes; confirm no alert spam.
6. Join new client → verify one `first_seen` event + evidence payload ref.
7. Roam or force reassociate → `changed` only.
8. Toggle phone private Wi-Fi MAC → confidence/uncertainty flags.
9. Reboot AP/gateway → reboot fixture behavior; no false “all devices retired” without recovery.
10. Confirm **no** wireless-deauth or electrical events were emitted.

### Pass / fail
- Pass: events match kinds above; tenant isolation holds; secrets absent from payloads; uncertainty visible for randomized MAC.
- Fail: duplicate identities on roam; PSK in evidence; claims of rogue AP/deauth/outlet load from this adapter.

## 9. Implementation gates (future)

Do **not** start coding until ChatGPT/owner approve this design and Phase 0 blockers allow a safe lab connector deploy. Suggested implementation order later: normalize + fixtures → connector poller → ingest wiring → lab ops runbook evidence → only then roadmap Milestone 1 “done.”

## 10. References

- [`ROADMAP.md`](../ROADMAP.md) — acquisition sources and phase sequencing
- [`IMPLEMENTATION_STATUS.md`](../IMPLEMENTATION_STATUS.md) — capability snapshot
- [`PHASE0_ACCEPTANCE_CHECKLIST.md`](PHASE0_ACCEPTANCE_CHECKLIST.md) — Phase 0 still open
- [`PHASE0_SCHEMA.md`](PHASE0_SCHEMA.md) — tenant/event foundations
- UniFi Network Application API documentation (vendor; pin version during lab)
