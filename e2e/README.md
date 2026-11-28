# Phase 0 browser E2E

Plan: [`docs/BROWSER_E2E_PLAN.md`](../docs/BROWSER_E2E_PLAN.md)

## Status

- **2026-11-28 PT:** signed-out smoke (E2E-01*) executed against `https://www.sentinelgrid.tech` with owner authorization. Evidence: `reports/e2e-smoke-2026-11-28.json`.
- Authenticated scenarios (E2E-02–04, 07–10) remain **blocked** until an approved E2E identity + mailbox are provided (never commit credentials).

## Local / CI Playwright (signed-out smoke)

```bash
cd e2e
npm install
npx playwright install chromium
BASE_URL=https://www.sentinelgrid.tech npm test
```

Do not point authenticated mutation tests at production without explicit approval and a disposable mailbox.
