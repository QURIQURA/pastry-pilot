#!/usr/bin/env node
// pastry-pilot#18 YEON OS Auto-Pilot — apply PILOT migrations to Supabase from CI, safely.
//
// Why not `supabase db push`: this Supabase project is shared with SHCS and its history was written
// by Lovable, the SQL editor and MCP under versions that do not match the files here, so db push
// would try to re-run everything. Instead:
//   pending = files newer than supabase/automation-baseline.txt
//             − versions already in supabase_migrations.schema_migrations (Lovable/CLI applied)
//             − files already in yeon_ops.migration_ledger (applied by this script)
// Each pending file is first run inside a transaction that is rolled back (dry run), then applied
// in its own transaction together with its ledger row. The first failure stops everything; the
// failed file leaves no partial change. An already-applied file whose content changed is an error.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/supabase-migrate.mjs plan|check|apply
//        (or SUPABASE_DB_URL=... for psql; check = plan + rolled-back dry run)
//        node scripts/supabase-migrate.mjs risk <file...>   (no database needed)
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = "supabase/migrations";
const REPO = "QURIQURA/pastry-pilot";

/** Statements that always need the owner's approval before they run on the live database. */
const HIGH_RISK_SQL = [
  [
    /\bdrop\s+(table|schema|function|policy|column|trigger|view|type|index|extension)\b/i,
    "drops an object",
  ],
  [/\btruncate\b/i, "truncates a table"],
  [/\bdelete\s+from\b/i, "deletes rows"],
  [/\bupdate\s+(public\.)?\w+\s+set\b/i, "updates existing rows"],
  [
    /\balter\s+table\b[^;]*\b(drop|rename|alter\s+column|type)\b/i,
    "changes or removes existing columns",
  ],
  [/\b(grant|revoke)\b/i, "changes privileges"],
  [/\b(create|alter|drop)\s+policy\b|\brow\s+level\s+security\b/i, "changes RLS"],
  [/\bsecurity\s+definer\b/i, "adds a SECURITY DEFINER function"],
  [/\bauth\.|\bstorage\.|\bvault\.|\bnet\.http_/i, "touches auth, storage, vault or outbound HTTP"],
  [/\bshco_|\bshcs\b/i, "touches SHCS-owned objects"],
  [/\bcreate\s+(or\s+replace\s+)?trigger\b/i, "adds a trigger"],
  [/\bcreate\s+or\s+replace\s+function\b/i, "replaces a function"],
];

export function classifySql(sql) {
  const stripped = sql.replace(/--[^\n]*/g, "");
  const reasons = HIGH_RISK_SQL.filter(([re]) => re.test(stripped)).map(([, why]) => why);
  return { risk: reasons.length ? "high" : "low", reasons };
}

export function readBaseline(text) {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));
  if (!line || !/^\d{14}$/.test(line))
    throw new Error("automation-baseline.txt has no 14-digit version");
  return line;
}

/** Pure planning step, so it can be unit tested without a database. */
export function planMigrations({ files, baseline, remoteVersions, ledger }) {
  const pending = [];
  const drift = [];
  for (const f of [...files].sort()) {
    const version = f.name.slice(0, 14);
    if (!/^\d{14}_/.test(f.name) || version <= baseline) continue;
    const done = ledger.get(f.name);
    if (done) {
      if (done !== f.sha256) drift.push(f.name);
      continue;
    }
    if (remoteVersions.has(version)) continue;
    pending.push({ ...f, ...classifySql(f.sql) });
  }
  return { pending, drift };
}

const sha = (s) => createHash("sha256").update(s).digest("hex");

/**
 * Two ways to reach the database, both run the whole text as one multi-statement request:
 * - Supabase Management API (default in CI): only needs SUPABASE_ACCESS_TOKEN, which is already a
 *   repository secret. POST /v1/projects/{ref}/database/query.
 * - psql with SUPABASE_DB_URL (optional, also used by the local tests).
 * Errors never include the token or the connection string.
 */
const PROJECT_REF = process.env.SUPABASE_PROJECT_ID || "meswjzwxldhqkjglnmzt";

export async function exec(sqlText) {
  const url = process.env.SUPABASE_DB_URL;
  if (url) {
    const file = join(tmpdir(), `yeon-${process.pid}-${Date.now()}.sql`);
    writeFileSync(file, sqlText);
    const r = spawnSync("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-f", file], {
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error((r.stderr || r.stdout || "psql failed").trim());
    return r.stdout;
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("Set SUPABASE_ACCESS_TOKEN (or SUPABASE_DB_URL)");
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sqlText }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = JSON.parse(text).message ?? text;
    } catch {
      /* keep text */
    }
    throw new Error(`Management API HTTP ${res.status}: ${String(msg).slice(0, 500)}`);
  }
  return text;
}

/** Runs a query that returns one json column named j in one row, and parses it. */
async function queryJson(selectJ) {
  const out = await exec(selectJ);
  if (process.env.SUPABASE_DB_URL) return JSON.parse(out.trim().split("\n").pop());
  const rows = JSON.parse(out);
  const v = rows?.[0]?.j;
  return typeof v === "string" ? JSON.parse(v) : v;
}

// One lock for every repository that applies migrations to this shared database (PILOT now, SHCS
// later), so two runs can never interleave.
const LOCK = "select pg_advisory_xact_lock(hashtext('yeon_ops.migrations'));";

const LEDGER_DDL = `begin;
${LOCK}
create schema if not exists yeon_ops;
revoke all on schema yeon_ops from public, anon, authenticated;
create table if not exists yeon_ops.migration_ledger (
  repo text not null,
  filename text not null,
  sha256 text not null,
  applied_at timestamptz not null default now(),
  run_url text,
  primary key (repo, filename)
);
revoke all on yeon_ops.migration_ledger from public, anon, authenticated;
commit;`;

async function loadState() {
  const files = readdirSync(DIR)
    .filter((n) => n.endsWith(".sql"))
    .map((name) => {
      const sql = readFileSync(join(DIR, name), "utf8");
      return { name, sql, sha256: sha(sql) };
    });
  const baseline = readBaseline(readFileSync("supabase/automation-baseline.txt", "utf8"));
  const versions = await queryJson(
    "select coalesce(json_agg(version), '[]'::json) as j from supabase_migrations.schema_migrations;",
  );
  const hasLedger = await queryJson(
    "select to_json(to_regclass('yeon_ops.migration_ledger') is not null) as j;",
  );
  const rows = hasLedger
    ? await queryJson(
        `select coalesce(json_agg(json_build_array(filename, sha256)), '[]'::json) as j from yeon_ops.migration_ledger where repo = '${REPO}';`,
      )
    : [];
  return {
    files,
    baseline,
    remoteVersions: new Set(versions),
    ledger: new Map(rows),
    hasLedger,
  };
}

export const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

function output(key, value) {
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}<<EOF_OUT\n${value}\nEOF_OUT\n`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "risk") {
    for (const f of rest) console.log(f, JSON.stringify(classifySql(readFileSync(f, "utf8"))));
    return;
  }
  if (!["plan", "check", "apply"].includes(cmd)) {
    console.error("usage: supabase-migrate.mjs plan|check|apply | risk <file...>");
    process.exit(2);
  }
  const state = await loadState();
  const { pending, drift } = planMigrations(state);
  const risk = pending.some((p) => p.risk === "high") ? "high" : pending.length ? "low" : "none";
  const summary = pending.length
    ? pending
        .map((p) => `- ${p.name}: ${p.risk}${p.reasons.length ? ` (${p.reasons.join(", ")})` : ""}`)
        .join("\n")
    : "- no pending migrations";
  console.log(
    `Connected to ${process.env.SUPABASE_DB_URL ? "database from SUPABASE_DB_URL" : PROJECT_REF}: ${state.remoteVersions.size} versions in schema_migrations, ledger ${state.hasLedger ? `has ${state.ledger.size} PILOT rows` : "not created yet"}.`,
  );
  console.log(`Migration risk: ${risk}\n${summary}`);
  output("risk", risk);
  output("summary", summary);
  if (drift.length) {
    console.error(
      `Already-applied migrations were edited (write a new migration instead):\n- ${drift.join("\n- ")}`,
    );
    process.exit(1);
  }
  if (cmd === "plan" || pending.length === 0) return;

  // Dry run every pending file together, then roll back: nothing changes if any one fails.
  // `check` stops here (used on PRs); `apply` continues.
  await exec(`begin;\n${LOCK}\n${pending.map((p) => p.sql).join("\n;\n")}\n;\nrollback;`);
  console.log("Dry run passed (rolled back, no change).");
  if (cmd === "check") return;

  await exec(LEDGER_DDL);
  const runUrl = process.env.RUN_URL ?? "";
  // Apply one by one, each with its ledger row in the same transaction. The ledger primary key
  // also stops a second run from applying the same file twice.
  for (const p of pending) {
    await exec(
      `begin;\n${LOCK}\n${p.sql}\n;\ninsert into yeon_ops.migration_ledger(repo, filename, sha256, run_url) values (${quote(REPO)}, ${quote(p.name)}, ${quote(p.sha256)}, ${quote(runUrl)});\ncommit;`,
    );
    console.log(`Applied ${p.name}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`Stopped: ${e.message}`);
    process.exit(1);
  });
}
