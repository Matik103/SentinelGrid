/**
 * Resolve Supabase Management API PAT for ops scripts.
 * Order: SUPABASE_ACCESS_TOKEN env → ~/.supabase/access-token →
 * Cursor user store (personal) paths used by Cloud Agents.
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const CANDIDATES = () => [
  process.env.SUPABASE_ACCESS_TOKEN
    ? { kind: "env", path: null, value: process.env.SUPABASE_ACCESS_TOKEN }
    : null,
  { kind: "file", path: resolve(homedir(), ".supabase/access-token") },
  {
    kind: "file",
    path: resolve(
      process.env.CURSOR_USER_STORE || "/cursor/stores/user",
      "secrets/SUPABASE_ACCESS_TOKEN",
    ),
  },
  {
    kind: "file",
    path: resolve(
      process.env.CURSOR_USER_STORE || "/cursor/stores/user",
      "supabase/access-token",
    ),
  },
].filter(Boolean);

export function loadSupabaseAccessToken() {
  for (const candidate of CANDIDATES()) {
    if (candidate.kind === "env") {
      const value = String(candidate.value || "").trim();
      if (value) return value;
      continue;
    }
    if (existsSync(candidate.path)) {
      const value = readFileSync(candidate.path, "utf8").trim();
      if (value) return value;
    }
  }
  throw new Error(
    "No SUPABASE_ACCESS_TOKEN (env), ~/.supabase/access-token, or Cursor user-store secret",
  );
}
