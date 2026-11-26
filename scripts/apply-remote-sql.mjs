#!/usr/bin/env node
/**
 * Apply a SQL file to a Supabase project via Management API, statement-by-statement.
 * Usage: node scripts/apply-remote-sql.mjs <project-ref> <path-to.sql>
 * Auth: SUPABASE_ACCESS_TOKEN env or ~/.supabase/access-token
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const projectRef = process.argv[2];
const sqlPath = process.argv[3];
if (!projectRef || !sqlPath) {
  console.error("Usage: node scripts/apply-remote-sql.mjs <project-ref> <sql-file>");
  process.exit(2);
}

function loadToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  const p = resolve(homedir(), ".supabase/access-token");
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  throw new Error("No SUPABASE_ACCESS_TOKEN or ~/.supabase/access-token");
}

/** Split SQL into executable statements; respect $tag$ ... $tag$ and standard quotes. */
function splitStatements(sql) {
  const out = [];
  let buf = "";
  let i = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inSingle = false;
  let dollarTag = null;

  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      buf += c;
      if (c === "\n") inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      buf += c;
      if (c === "*" && next === "/") {
        buf += next;
        i += 2;
        inBlockComment = false;
        continue;
      }
      i++;
      continue;
    }
    if (dollarTag !== null) {
      const end = sql.indexOf(dollarTag, i);
      if (end === -1) {
        buf += sql.slice(i);
        break;
      }
      buf += sql.slice(i, end + dollarTag.length);
      i = end + dollarTag.length;
      dollarTag = null;
      continue;
    }
    if (inSingle) {
      buf += c;
      if (c === "'" && next === "'") {
        buf += next;
        i += 2;
        continue;
      }
      if (c === "'") inSingle = false;
      i++;
      continue;
    }

    if (c === "-" && next === "-") {
      inLineComment = true;
      buf += c;
      i++;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlockComment = true;
      buf += c;
      i++;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      buf += c;
      i++;
      continue;
    }
    if (c === "$") {
      const m = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (m) {
        dollarTag = m[0];
        buf += m[0];
        i += m[0].length;
        continue;
      }
    }
    if (c === ";") {
      const stmt = buf.trim();
      if (stmt.length > 0 && !/^BEGIN$/i.test(stmt) && !/^COMMIT$/i.test(stmt)) {
        out.push(stmt);
      }
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  const tail = buf.trim();
  if (tail.length > 0 && !/^BEGIN$/i.test(tail) && !/^COMMIT$/i.test(tail)) out.push(tail);
  return out;
}

const token = loadToken();
const sql = readFileSync(resolve(sqlPath), "utf8");
const statements = splitStatements(sql);
console.log(`Applying ${statements.length} statements from ${sqlPath} → ${projectRef}`);

let ok = 0;
for (let n = 0; n < statements.length; n++) {
  const query = statements[n];
  const preview = query.replace(/\s+/g, " ").slice(0, 100);
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    console.error(`FAIL #${n + 1} HTTP ${res.status}: ${preview}`);
    console.error(text.slice(0, 1500));
    process.exit(1);
  }
  ok++;
  console.log(`OK #${n + 1}: ${preview}`);
}
console.log(`Done: ${ok}/${statements.length} statements applied.`);
