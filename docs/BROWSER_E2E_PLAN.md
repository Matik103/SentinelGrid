# Authenticated browser E2E plan (Phase 0)

**Status:** partial execution authorized 2026-11-28 PT — signed-out smoke **PASS**; authenticated suite still blocked without E2E credentials  
**Issue:** [#9](https://github.com/Matik103/SentinelGrid/issues/9)  
**Canonical branch:** `work/sentinel-command-release-v2`  
**Timezone:** America/Los_Angeles  
**Latest smoke evidence:** `reports/e2e-smoke-2026-11-28.json` + Playwright `e2e/smoke.unauth.spec.ts` (4/4 pass vs www)

## 1. Goal

Produce **ops**-level evidence for Phase 0 criteria that unit/SQL tests cannot close:

- Signup / AAL1 profile bootstrap
- TOTP MFA enrollment and AAL2-gated reads
- Organisation create + invite create/accept/revoke (`/?invite=<token>`)
- Infrastructure registry (facility/zone/asset) happy path
- Energy and evidence surfaces load with authenticated tenant context
- Same-org facility isolation (facility manager cannot see unassigned facilities)

## 2. Target surfaces

| Surface | URL / service | Notes |
|---|---|---|
| UI | Vercel **preview** for this work branch first | Prefer preview over `www.sentinelgrid.tech` until FE cutover is decided |
| API | `https://sentinelgrid-fpzo.onrender.com` | Confirm via `app_public_config.api_base_url` |
| Auth / DB | Supabase project `abaeizgfsskvjklfslrh` | Prefer disposable project if invite/MFA mutations are risky |

Do **not** use production www as the first E2E target if the FE still ships from `main` while Nest ships from this work branch (split-brain).

## 3. Tooling recommendation

- Playwright (Chromium) against a known tip SHA preview URL.
- Store credentials only in CI secrets or a local `.env` that is gitignored — never commit.
- Prefer a dedicated E2E mailbox (Resend test domain or catch-all) for invite delivery proof.
- Record: tip SHA, preview URL, API base URL, start/end timestamps (America/Los_Angeles), pass/fail per scenario, screenshots/trace on failure.

## 4. Scenario matrix

| ID | Scenario | Pass criteria | Risk |
|---|---|---|---|
| E2E-01 | Unauthenticated landing loads | HTTP 200; brand/Command entry visible | Low |
| E2E-02 | Sign up + email confirm (or test bypass if authorized) | Profile row exists; AAL1 session | Medium — creates users |
| E2E-03 | Bootstrap organisation | First admin membership; org visible in UI | Medium |
| E2E-04 | Enroll TOTP MFA → AAL2 | AAL2-required org data readable after MFA | Medium |
| E2E-05 | Create invite → mailbox receives link with `/?invite=` | Link format exact; token redeemable | High — live email (Criterion G) |
| E2E-06 | Second user accepts invite | Membership created; audit/outbox consistent | Medium |
| E2E-07 | Facility/zone/asset create + list | Registry rows visible to admin | Low |
| E2E-08 | Facility manager isolation | Unassigned facility hidden / denied | Medium |
| E2E-09 | Energy workbench loads | Authenticated fetch succeeds or empty-state without inventing telemetry | Low |
| E2E-10 | Evidence list/export entry | Authenticated; no cross-tenant leakage | Medium |

## 5. Prerequisites before run

1. Tip SHA with green release checks **and** Engineering Quality Gate.
2. Preview deployment for that SHA READY.
3. Nest `/v1/health` ok; `api_base_url` points at Nest.
4. Hosted migration inventory known (or disposable Supabase project seeded from work-branch migrations). **Do not apply production migrations as part of E2E setup.**
5. Approved E2E user identities and (for E2E-05) mailbox access.
6. Explicit authorization to create users/orgs/invites on the chosen environment.

## 6. Stop conditions

- Stop if the UI tip and API tip disagree on contract (split-brain breakage).
- Stop if invite links still point at `/accept-invite` or any path other than `/?invite=`.
- Stop rather than fabricate telemetry, MFA secrets, or “delivered” email without mailbox proof.
- Never run restore or migration apply as a side effect of E2E.

## 7. Evidence to publish

After an authorized run, update in the **same** commit:

- `docs/PHASE0_ACCEPTANCE_CHECKLIST.md` — tip evidence log + criteria 2, 11, G as applicable
- `IMPLEMENTATION_STATUS.md` — frontend acceptance / Criterion G rows
- Issue #9 comment with SHA, URLs, scenario table, and failures with traces

## 8. 2026-11-28 PT execution note

Owner authorized proceeding to browser E2E. Signed-out smoke (E2E-01*) ran against `https://www.sentinelgrid.tech` (no credentials, no mutations). Playwright suite under `e2e/` reproduces those checks. E2E-02–04 and E2E-07–10 remain **BLOCKED** until an approved E2E identity and mailbox exist. E2E-05/06 remain **PARTIAL** via prior manual Criterion G ops evidence (not a substitute for full automated invite E2E).

Authenticated browser E2E therefore remains **OPEN** for Phase 0 Criterion 11 closeout.
