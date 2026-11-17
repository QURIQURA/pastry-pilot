import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySql, planMigrations, readBaseline } from "../scripts/supabase-migrate.mjs";

test("additive SQL is low risk; RLS, privileges, deletes and drops are high", () => {
  assert.equal(
    classifySql("alter table public.orders add column if not exists note text;").risk,
    "low",
  );
  assert.equal(
    classifySql("create index if not exists x on public.orders(id); -- drop table y").risk,
    "low",
  );
  for (const sql of [
    "drop table public.orders;",
    "delete from public.orders;",
    "update public.orders set status = 'X';",
    "alter table public.orders drop column note;",
    "grant select on public.orders to anon;",
    "create policy p on public.orders for all using (true);",
    "alter table public.x enable row level security;",
    "create function f() returns void language sql security definer as $$ select 1 $$;",
    "select net.http_post('https://x');",
    "insert into public.shco_settings values (1);",
  ]) {
    assert.equal(classifySql(sql).risk, "high", sql);
  }
});

test("plan skips baseline, Lovable-applied versions and ledger entries; flags edited files", () => {
  const f = (name, sql = "select 1;", sha256 = "s") => ({ name, sql, sha256 });
  const { pending, drift } = planMigrations({
    files: [
      f("20261116023000_old.sql"),
      f("20261117000000_lovable.sql"),
      f("20261117010000_done.sql", "select 1;", "new-sha"),
      f("20261118000000_new.sql", "create policy p on t using (true);"),
      f("README.md"),
    ],
    baseline: "20261116023000",
    remoteVersions: new Set(["20261117000000"]),
    ledger: new Map([["20261117010000_done.sql", "old-sha"]]),
  });
  assert.deepEqual(
    pending.map((p) => [p.name, p.risk]),
    [["20261118000000_new.sql", "high"]],
  );
  assert.deepEqual(drift, ["20261117010000_done.sql"]);
});

test("baseline file needs a 14-digit version", () => {
  assert.equal(readBaseline("# note\n20261116023000\n"), "20261116023000");
  assert.throws(() => readBaseline("# only comments\n"));
});

test("edge function deploy plan: only configured functions; new or auth-touching code needs approval", async () => {
  const { configuredFunctions, functionRisk } =
    await import("../scripts/supabase-functions-plan.mjs");
  assert.deepEqual(
    configuredFunctions("[functions.a-b]\nverify_jwt = false\n\n[auth]\n[functions.c]\n"),
    ["a-b", "c"],
  );
  assert.equal(functionRisk({ isNew: false, addedLines: ["const x = 1;"] }).risk, "low");
  assert.equal(functionRisk({ isNew: true, addedLines: [] }).risk, "high");
  assert.equal(
    functionRisk({ isNew: false, addedLines: ['Deno.env.get("X"); process.env.Y'] }).risk,
    "high",
  );
});
