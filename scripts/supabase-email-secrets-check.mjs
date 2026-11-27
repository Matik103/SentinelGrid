#!/usr/bin/env node
/**
 * List Edge Function secret *names* (and digests when present) for a project.
 * Never prints secret values.
 *
 * Usage: node scripts/supabase-email-secrets-check.mjs <project-ref>
 * Auth: SUPABASE_ACCESS_TOKEN or ~/.supabase/access-token
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const projectRef = process.argv[2];
if (!projectRef) {
  console.error("Usage: node scripts/supabase-email-secrets-check.mjs <project-ref>");
  process.exit(2);
}

function loadToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  const p = resolve(homedir(), ".supabase", "access-token");
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  throw new Error("No SUPABASE_ACCESS_TOKEN or ~/.supabase/access-token");
}

const required = ["RESEND_API_KEY", "SG_EMAIL_FROM"];
const token = loadToken();
const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/secrets`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
});
if (!res.ok) {
  console.error(`secrets list failed HTTP ${res.status}`);
  process.exit(1);
}
const secrets = await res.json();
const rows = Array.isArray(secrets) ? secrets : [];
const names = rows.map((s) => s.name ?? s.Name ?? "").filter(Boolean);
const digests = Object.fromEntries(
  rows
    .map((s) => {
      const name = s.name ?? s.Name ?? "";
      const digest = s.digest ?? s.value_digest ?? s.updated_at ?? null;
      return name ? [name, digest] : null;
    })
    .filter(Boolean),
);

console.log(JSON.stringify({
  project_ref: projectRef,
  secret_names: names.sort(),
  required_email: Object.fromEntries(
    required.map((name) => [name, { present: names.includes(name), digest: digests[name] ?? null }]),
  ),
}, null, 2));
