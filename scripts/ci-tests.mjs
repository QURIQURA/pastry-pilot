#!/usr/bin/env node
// pastry-pilot#18: run the node test suite and fail only on failures that are not already known
// on main (tests/known-failures.txt). Known failures that now pass are reported so the list shrinks.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const files = readdirSync("tests")
  .filter((f) => f.endsWith(".test.mjs"))
  .map((f) => `tests/${f}`);
const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...files], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const out = run.stdout ?? "";
process.stdout.write(
  out
    .split("\n")
    .filter((l) => /^# (tests|pass|fail)|^not ok/.test(l))
    .join("\n") + "\n",
);

const known = new Set(
  readFileSync("tests/known-failures.txt", "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#")),
);
const failed = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1].trim());
const unexpected = failed.filter((n) => !known.has(n));
const fixed = [...known].filter((n) => !failed.includes(n));

if (fixed.length)
  console.log(
    `Known failures now passing (remove from tests/known-failures.txt):\n- ${fixed.join("\n- ")}`,
  );
if (run.status !== 0 && failed.length === 0) {
  console.error("Test runner failed without a test failure (load or syntax error).");
  console.error(run.stderr);
  process.exit(1);
}
if (unexpected.length) {
  console.error(`New test failures:\n- ${unexpected.join("\n- ")}`);
  process.exit(1);
}
console.log(`OK: ${failed.length} known failure(s), no new failures.`);
