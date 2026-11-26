import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Lightweight integration-surface guards: ensure cross-tenant, auth, storage,
 * and recovery hooks remain wired. Full Nest+DB suite still runs via SQL tests
 * and CI audit; these assert the contract surfaces exist.
 */
describe("Phase 0 integration surfaces", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "../../../..");

  it("keeps tenant-scoped DLQ replay and connector auth guards", () => {
    const ingestion = readFileSync(join(root, "apps/api/src/events/ingestion.service.ts"), "utf8");
    assert.match(ingestion, /rebuildReplayBody/);
    assert.match(ingestion, /original_payload_object_id/);
    assert.match(ingestion, /authorisedOrganisationId/);

    const connectors = readFileSync(join(root, "apps/api/src/connectors/connectors.service.ts"), "utf8");
    assert.match(connectors, /credential_token_hash/);
    assert.match(connectors, /authorizeConnectorToken/);
    assert.match(connectors, /timingSafeEqual/);
  });

  it("keeps evidence chain + registry zones + outbox + facility assignments + email worker", () => {
    const chain = readFileSync(join(root, "apps/api/src/evidence/evidence-chain.service.ts"), "utf8");
    assert.match(chain, /linkEventPayload/);
    assert.match(chain, /createCheckpoint/);
    assert.match(chain, /verifyChain/);
    assert.match(chain, /exportBundle/);

    const registry = readFileSync(join(root, "apps/api/src/registry/registry.service.ts"), "utf8");
    assert.match(registry, /listZones/);
    assert.match(registry, /archiveZone/);
    assert.match(registry, /assignFacility/);
    assert.match(registry, /facility_user_assignments/);

    const outbox = readFileSync(join(root, "apps/api/src/common/email-outbox.service.ts"), "utf8");
    assert.match(outbox, /email_outbox/);

    const worker = readFileSync(join(root, "apps/api/src/common/email-worker.service.ts"), "utf8");
    assert.match(worker, /SG_EMAIL_WORKER_ENABLED/);
    assert.match(worker, /claim_email_outbox/);
  });

  it("publishes OpenAPI and acceptance checklist", () => {
    const openapi = readFileSync(join(root, "docs/openapi.yaml"), "utf8");
    assert.match(openapi, /\/orgs\/\{organisationId\}\/zones/);
    assert.match(openapi, /evidence\/verify/);
    const checklist = readFileSync(join(root, "docs/PHASE0_ACCEPTANCE_CHECKLIST.md"), "utf8");
    assert.match(checklist, /Do \*\*not\*\* mark Phase 0 COMPLETE/);
  });
});
