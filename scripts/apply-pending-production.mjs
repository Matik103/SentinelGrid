#!/usr/bin/env node
/**
 * Apply pending production SQL to abaeizgfsskvjklfslrh via Management API.
 * Auth: SUPABASE_ACCESS_TOKEN or ~/.supabase/access-token
 *
 * Usage: node scripts/apply-pending-production.mjs
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRef = "abaeizgfsskvjklfslrh";
const files = [
  "supabase/migrations/20261127090000_ensure_own_profile_bootstrap_definer.sql",
  "supabase/migrations/20261127100000_evidence_payloads_storage_bucket.sql",
  "supabase/migrations/20261127120000_payload_storage_supabase_backend.sql",
  "supabase/ops/configure-api-url.sql",
];

const apply = resolve(root, "scripts/apply-remote-sql.mjs");

for (const rel of files) {
  const sqlPath = resolve(root, rel);
  const args =
    rel.endsWith("configure-api-url.sql")
      ? null
      : [apply, projectRef, sqlPath];
  if (!args) {
    // configure-api-url.sql needs psql variable substitution; apply equivalent statement.
    const tmp = resolve(root, "supabase/ops/_api_base_url_upsert.sql");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      tmp,
      `INSERT INTO public.app_public_config (key, value, updated_at)
VALUES ('api_base_url', jsonb_build_object('url', 'https://sentinelgrid-fpzo.onrender.com'), now())
ON CONFLICT (key) DO UPDATE
SET value = jsonb_build_object('url', 'https://sentinelgrid-fpzo.onrender.com'),
    updated_at = now();
SELECT key, value FROM public.app_public_config WHERE key = 'api_base_url';
`,
    );
    const r = spawnSync(process.execPath, [apply, projectRef, tmp], { stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status ?? 1);
    continue;
  }
  console.log(`\n=== ${rel} ===`);
  const r = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log("\nAll pending production SQL applied.");
