#!/usr/bin/env node
/**
 * Ensure the public workspace-branding Storage bucket exists.
 *
 * Prefers SUPABASE_SERVICE_ROLE_KEY (+ SUPABASE_URL) via Storage API.
 * Falls back to SUPABASE_ACCESS_TOKEN Management SQL for project abaeizgfsskvjklfslrh.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

const projectRef = "abaeizgfsskvjklfslrh";
const defaultUrl = `https://${projectRef}.supabase.co`;
const bucketId = "workspace-branding";

function loadPat() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  const p = resolve(homedir(), ".supabase/access-token");
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  return null;
}

async function ensureViaServiceRole() {
  const url = (process.env.SUPABASE_URL || defaultUrl).replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) return { ok: false, reason: "no_service_role" };

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  const get = await fetch(`${url}/storage/v1/bucket/${bucketId}`, { headers });
  if (get.ok) {
    console.log(`Bucket ready via service role: ${bucketId}`);
    return { ok: true, created: false };
  }

  const create = await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: bucketId,
      name: bucketId,
      public: true,
      file_size_limit: 2097152,
      allowed_mime_types: ["image/jpeg", "image/png", "image/webp", "image/avif"],
    }),
  });
  const text = await create.text();
  if (!create.ok && !/already exists|duplicate|resource already/i.test(text)) {
    throw new Error(`Storage createBucket failed HTTP ${create.status}: ${text.slice(0, 500)}`);
  }
  console.log(`Bucket ensured via service role: ${bucketId}`);
  return { ok: true, created: create.ok };
}

async function ensureViaManagementPat() {
  const token = loadPat();
  if (!token) return { ok: false, reason: "no_pat" };
  const sql = `INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'workspace-branding',
  'workspace-branding',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;`;
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Management SQL failed HTTP ${res.status}: ${text.slice(0, 800)}`);
  console.log(`Bucket ensured via Management API SQL: ${bucketId}`);
  return { ok: true, created: true };
}

const viaRole = await ensureViaServiceRole();
if (viaRole.ok) process.exit(0);
const viaPat = await ensureViaManagementPat();
if (viaPat.ok) process.exit(0);
console.error(
  "Could not create workspace-branding bucket. Set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ACCESS_TOKEN.",
);
process.exit(1);
