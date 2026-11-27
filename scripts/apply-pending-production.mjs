#!/usr/bin/env node
/**
 * Inventory hosted schema_migrations, then apply missing work-branch SQL
 * to abaeizgfsskvjklfslrh via Management API. Records each applied version.
 *
 * Auth: SUPABASE_ACCESS_TOKEN or ~/.supabase/access-token
 * Usage: node scripts/apply-pending-production.mjs [--dry-run]
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRef = "abaeizgfsskvjklfslrh";
const dryRun = process.argv.includes("--dry-run");
const apply = resolve(root, "scripts/apply-remote-sql.mjs");
const migrationsDir = resolve(root, "supabase/migrations");

function loadToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  const p = resolve(homedir(), ".supabase/access-token");
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  throw new Error("No SUPABASE_ACCESS_TOKEN or ~/.supabase/access-token");
}

async function query(token, sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Query failed HTTP ${res.status}: ${text.slice(0, 1500)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function listRepoMigrations() {
  return readdirSync(migrationsDir)
    .filter((f) => /^\d{14}_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({
      file: f,
      version: f.slice(0, 14),
      path: resolve(migrationsDir, f),
    }));
}

const token = loadToken();
const repo = listRepoMigrations();

console.log(`Project: ${projectRef}`);
console.log(`Repo migrations: ${repo.length}`);

// Hosts that were migrated via raw Management SQL may lack this table.
await query(
  token,
  `create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key
);`,
);

const appliedRows = await query(
  token,
  "select version from supabase_migrations.schema_migrations order by version;",
);
const applied = new Set(
  (Array.isArray(appliedRows) ? appliedRows : [])
    .map((r) => String(r.version ?? r))
    .filter(Boolean),
);

console.log(`Hosted applied versions: ${applied.size}`);
for (const v of [...applied].sort()) console.log(`  applied  ${v}`);

const pending = repo.filter((m) => !applied.has(m.version));
console.log(`\nPending (${pending.length}):`);
for (const m of pending) console.log(`  pending  ${m.file}`);

if (pending.length === 0) {
  console.log("\nNothing to apply — hosted matches repo migration set.");
} else if (dryRun) {
  console.log("\nDry-run only; no statements executed.");
  process.exit(0);
} else {
  for (const m of pending) {
    console.log(`\n=== Applying ${m.file} ===`);
    const r = spawnSync(process.execPath, [apply, projectRef, m.path], {
      stdio: "inherit",
      env: process.env,
    });
    if (r.status !== 0) process.exit(r.status ?? 1);

    // Record version so subsequent inventory is accurate.
    const recordSql = resolve(root, "supabase/ops/_record_migration_version.sql");
    writeFileSync(
      recordSql,
      `INSERT INTO supabase_migrations.schema_migrations (version)
VALUES ('${m.version}')
ON CONFLICT (version) DO NOTHING;
`,
    );
    try {
      const rec = spawnSync(process.execPath, [apply, projectRef, recordSql], {
        stdio: "inherit",
        env: process.env,
      });
      if (rec.status !== 0) {
        console.error(
          `WARN: SQL applied for ${m.file} but schema_migrations record failed`,
        );
        process.exit(rec.status ?? 1);
      }
    } finally {
      try {
        unlinkSync(recordSql);
      } catch {
        /* ignore */
      }
    }
  }
  console.log(`\nApplied ${pending.length} migration file(s).`);
}

// Ensure api_base_url points at Nest (idempotent upsert).
const apiSql = resolve(root, "supabase/ops/_api_base_url_upsert.sql");
writeFileSync(
  apiSql,
  `INSERT INTO public.app_public_config (key, value, updated_at)
VALUES ('api_base_url', jsonb_build_object('url', 'https://sentinelgrid-fpzo.onrender.com'), now())
ON CONFLICT (key) DO UPDATE
SET value = jsonb_build_object('url', 'https://sentinelgrid-fpzo.onrender.com'),
    updated_at = now();
SELECT key, value FROM public.app_public_config WHERE key = 'api_base_url';
`,
);
try {
  console.log("\n=== Ensure api_base_url ===");
  if (!dryRun) {
    const r = spawnSync(process.execPath, [apply, projectRef, apiSql], {
      stdio: "inherit",
      env: process.env,
    });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
} finally {
  try {
    unlinkSync(apiSql);
  } catch {
    /* ignore */
  }
}

console.log("\nAll pending production SQL processing complete.");
console.log(`Tip: verify with psql \"$SUPABASE_DB_URL\" -f supabase/ops/verify-production.sql`);
