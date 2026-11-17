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
// Usage: SUPABASE_DB_URL=... node scripts/supabase-migrate.mjs plan|apply [--json]
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

function psql(sqlText, { capture = false } = {}) {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is not set");
  const file = join(tmpdir(), `yeon-${process.pid}-${Date.now()}.sql`);
  writeFileSync(file, sqlText);
  const r = spawnSync("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-f", file], {
    encoding: "utf8",
  });
  // Never echo the connection string; psql errors do not contain the password.
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || "psql failed").trim());
  return capture ? r.stdout : "";
}

const LEDGER_DDL = `
create schema if not exists yeon_ops;
revoke all on schema yeon_ops from public, anon, authenticated;
create table if not exists yeon_ops.migration_ledger (
  repo text not null,
  filename text not null,
  sha256 text not null,
  applied_at timestamptz not null default now(),
  run_url text,
  primary key (repo, filename)
);`;

function loadState() {
  const files = readdirSync(DIR)
    .filter((n) => n.endsWith(".sql"))
    .map((name) => {
      const sql = readFileSync(join(DIR, name), "utf8");
      return { name, sql, sha256: sha(sql) };
    });
  const baseline = readBaseline(readFileSync("supabase/automation-baseline.txt", "utf8"));
  const remote = psql("select version from supabase_migrations.schema_migrations;", {
    capture: true,
  });
  const hasLedger =
    psql("select to_regclass('yeon_ops.migration_ledger') is not null;", {
      capture: true,
    }).trim() === "t";
  const ledgerRows = hasLedger
    ? psql(
        `select filename || ' ' || sha256 from yeon_ops.migration_ledger where repo = '${REPO}';`,
        {
          capture: true,
        },
      )
    : "";
  const ledger = new Map(
    ledgerRows
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split(" ")),
  );
  return { files, baseline, remoteVersions: new Set(remote.split("\n").filter(Boolean)), ledger };
}

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

function output(key, value) {
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}<<EOF_OUT\n${value}\nEOF_OUT\n`);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "risk") {
    for (const f of rest) console.log(f, JSON.stringify(classifySql(readFileSync(f, "utf8"))));
    return;
  }
  if (cmd !== "plan" && cmd !== "apply") {
    console.error("usage: supabase-migrate.mjs plan|apply | risk <file...>");
    process.exit(2);
  }
  const { pending, drift } = planMigrations(loadState());
  const risk = pending.some((p) => p.risk === "high") ? "high" : pending.length ? "low" : "none";
  const summary = pending.length
    ? pending
        .map((p) => `- ${p.name}: ${p.risk}${p.reasons.length ? ` (${p.reasons.join(", ")})` : ""}`)
        .join("\n")
    : "- no pending migrations";
  console.log(`Migration risk: ${risk}\n${summary}`);
  output("risk", risk);
  output("summary", summary);
  if (drift.length) {
    console.error(
      `Already-applied migrations were edited (write a new migration instead):\n- ${drift.join("\n- ")}`,
    );
    process.exit(1);
  }
  if (cmd === "plan") return;

  if (pending.length === 0) return;
  psql(LEDGER_DDL);
  const runUrl = process.env.RUN_URL ?? "";
  // 1) Dry run every pending file together, rolled back, so nothing is applied if any one fails.
  psql(`begin;\n${pending.map((p) => p.sql).join("\n;\n")}\n;\nrollback;`);
  console.log("Dry run passed (rolled back).");
  // 2) Apply one by one, each with its ledger row in the same transaction.
  for (const p of pending) {
    psql(
      `begin;\n${p.sql}\n;\ninsert into yeon_ops.migration_ledger(repo, filename, sha256, run_url) values (${quote(REPO)}, ${quote(p.name)}, ${quote(p.sha256)}, ${quote(runUrl)});\ncommit;`,
    );
    console.log(`Applied ${p.name}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(`Stopped: ${e.message}`);
    process.exit(1);
  }
}
