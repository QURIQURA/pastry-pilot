import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../scripts/autopilot-risk.mjs";

test("small UI change is low risk", () => {
  const r = classify({
    files: ["src/components/pilot/dev-board/DevBoardTable.tsx", "tests/dev-board.test.mjs"],
    addedLines: ['<span className="font-mono">{i.work_key}</span>'],
  });
  assert.equal(r.risk, "low");
  assert.deepEqual(r.reasons, []);
});

test("migrations, workflows, deps, auth and cross-OS sync always need a person", () => {
  for (const f of [
    "supabase/migrations/20261117_x.sql",
    "supabase/functions/planner-availability/index.ts",
    ".github/workflows/deploy.yml",
    "package.json",
    "bun.lock",
    "src/integrations/supabase/client.ts",
    "src/routes/auth.tsx",
    "src/lib/order-planner-sync.ts",
    "src/lib/payment.ts",
    "tests/known-failures.txt",
  ]) {
    assert.equal(classify({ files: [f], addedLines: [] }).risk, "needs-human", f);
  }
});

test("dangerous content in an otherwise safe file needs a person", () => {
  for (const line of [
    "await supabase.rpc('delete_everything')",
    "const k = import.meta.env.VITE_SECRET",
    "-- drop table public.orders",
    "grant all on public.orders to anon",
  ]) {
    const r = classify({ files: ["src/lib/x.ts"], addedLines: [line] });
    assert.equal(r.risk, "needs-human", line);
  }
});

test("unknown paths, empty and large diffs need a person", () => {
  assert.equal(classify({ files: ["Dockerfile"], addedLines: [] }).risk, "needs-human");
  assert.equal(classify({ files: [], addedLines: [] }).risk, "needs-human");
  const many = Array.from({ length: 16 }, (_, i) => `src/lib/f${i}.ts`);
  assert.equal(classify({ files: many, addedLines: [] }).risk, "needs-human");
  const lines = Array.from({ length: 401 }, () => "x");
  assert.equal(classify({ files: ["src/lib/a.ts"], addedLines: lines }).risk, "needs-human");
});
