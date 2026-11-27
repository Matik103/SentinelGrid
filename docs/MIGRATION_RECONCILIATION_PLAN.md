# Hosted migration reconciliation plan (read-only)

**Status:** plan only — **do not apply** until ChatGPT/owner explicit approval  
**Issue:** [#9](https://github.com/Matik103/SentinelGrid/issues/9)  
**Work tip when authored:** `2de294edc2ae1dbacfb152fd71443f777ecbc597`  
**Canonical branch:** `work/sentinel-command-release-v2`  
**Hosted project:** `abaeizgfsskvjklfslrh`  
**Timezone:** America/Los_Angeles  

## 1. Why this exists

Phase 0 cannot close while hosted schema state is unknown relative to the repository. Historical checklist evidence claimed remote applied through `20261125260000` (tip `07b06ee`). The work branch and `main` have since diverged. Applying either side blindly is unsafe.

## 2. Known facts (evidence-backed)

| Fact | Evidence |
|---|---|
| Work tip migrations after `20261125260000` | Listed in §3 |
| `app_public_config` exists and `api_base_url` is set live | Anon REST read during Issue #9 audit |
| Nest health uses service-role Supabase successfully | `/v1/health` 200 |
| Exact hosted `supabase_migrations.schema_migrations` rows | **Unknown** — requires Management API / SQL read with approved credentials |
| `main`-only vs work-only files | §4 |

## 3. Work-branch forward list (after historical `20261125260000`)

These exist on `work/sentinel-command-release-v2`. Treat as **candidate pending** until hosted inventory is read:

1. `20261125270000_phase0_app_public_config.sql` — likely already live (table readable)
2. `20261126090000_energy_intelligence_asset_media.sql`
3. `20261126235900_mfa_assurance_enforcement.sql`
4. `20261127090000_ensure_own_profile_bootstrap_definer.sql`
5. `20261127100000_evidence_payloads_storage_bucket.sql` (**work-only**)
6. `20261127120000_payload_storage_supabase_backend.sql` (**work-only**)

## 4. Divergence matrix

| Migration | `main` | `work/sentinel-command-release-v2` |
|---|---|---|
| `20261126100000_workspace_branding.sql` | yes | **no** |
| `20261126110000_atomic_asset_media_primary.sql` | yes | **no** |
| `20261126120000_auth_identity_assets.sql` | yes | **no** |
| `20261126120100_ensure_own_profile_jwt_email.sql` | yes | **no** |
| `20261127100000_evidence_payloads_storage_bucket.sql` | **no** | yes |
| `20261127120000_payload_storage_supabase_backend.sql` | **no** | yes |

Timestamps between `202611261*` (main) and `2026112709*` / `202611271*` (work) interleave. A naive `db push` from either branch alone can leave production FE or Nest assumptions half-met.

## 5. Safe procedure (when authorized)

### Step A — inventory (read-only)
1. With `SUPABASE_ACCESS_TOKEN` or SQL editor access, list applied versions from `supabase_migrations.schema_migrations` (or dashboard migration history).
2. Diff that set against §3 and §4. Produce an exact “missing on host” list.
3. Stop and publish the list on Issue #9. **Do not apply in the same step.**

### Step B — choose a single target lineage
Recommended product decision (subject to lead approval):

- **Target lineage = work branch** (matches Render Nest + Issue #9 canonical branch).
- Port missing `main`-only migrations onto work **in a new forward-only commit** with fresh timestamps after `20261127120000` (do not rename history on already-shipped files without review).
- Resolve any overlap between `20261126120100_ensure_own_profile_jwt_email.sql` and `20261127090000_ensure_own_profile_bootstrap_definer.sql` by reading both and keeping a single SECURITY DEFINER definition.

### Step C — disposable dry-run
1. On a throwaway Supabase project or local `supabase db reset`, apply the reconciled chain.
2. Run `supabase/tests/phase0_tenant_isolation.sql` and `supabase/ops/verify-production.sql` (read-only checks).
3. Record statement counts and failures.

### Step D — production apply (separate approval)
1. Explicit ChatGPT/owner approval naming the host project and migration list.
2. Apply via `node scripts/apply-remote-sql.mjs` **or** linked `supabase db push` — never from Nest Render env.
3. Re-run verify SQL; update `PHASE0_ACCEPTANCE_CHECKLIST.md` tip evidence in the same follow-up commit.

## 6. Explicit non-actions

- No production apply in this document’s authorizing packet.
- No dropping or rewriting applied remote versions without a lead-approved rollback plan.
- No mixing Amazon S3 assumptions; payload path is Supabase Storage.

## 7. Owner / revisit

| Item | Owner | Revisit trigger |
|---|---|---|
| Hosted inventory read | Operator with Supabase access + Cursor/ChatGPT | Credentials available |
| Lineage decision (work vs merge) | ChatGPT technical lead | After inventory |
| Production apply | Explicit approval only | Dry-run green + lead OK |
