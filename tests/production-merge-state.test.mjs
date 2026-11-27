import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./load-ts.mjs";

const { nextProductionMerge, legacyBatchEntries } =
  await loadTs("src/lib/production-merge-state.ts");

test("merge V2 960g + 700g without touching order quantities or SH-0016", () => {
  const selections = [
    { id: "SH-0020-V2", grams: 960, version: "V2" },
    { id: "SND-003-V2", grams: 700, version: "V2" },
    { id: "SH-0016-V1", grams: 1200, version: "V1" },
  ];
  const existing = new Map([["SH-0016-V1", "old-record-group"]]);
  const merged = nextProductionMerge(
    existing,
    ["SH-0020-V2", "SND-003-V2"],
    () => "batch-1660",
  );
  assert.equal(merged.get("SH-0020-V2"), merged.get("SND-003-V2"));
  assert.equal(merged.get("SH-0016-V1"), "old-record-group");
  assert.equal(
    selections.filter((row) => merged.get(row.id) === "batch-1660")
      .reduce((sum, row) => sum + row.grams, 0),
    1660,
  );
  assert.deepEqual(selections.map((row) => row.grams), [960, 700, 1200]);
});

test("joining two existing groups preserves every member", () => {
  const previous = new Map([
    ["cake", "batch-a"],
    ["cream", "batch-a"],
    ["popup", "batch-b"],
    ["other-popup", "batch-b"],
    ["untouched", "batch-c"],
  ]);
  const next = nextProductionMerge(previous, ["cake", "popup"], () => "new");
  assert.equal(next.get("cake"), next.get("cream"));
  assert.equal(next.get("cream"), next.get("popup"));
  assert.equal(next.get("popup"), next.get("other-popup"));
  assert.equal(next.get("untouched"), "batch-c");
  assert.equal(previous.get("popup"), "batch-b");
});

test("unmerge clears only the chosen group, retaining all other batches", () => {
  const before = new Map([["a", "one"], ["b", "one"], ["c", "two"]]);
  const after = nextProductionMerge(before, ["a"], () => "unused");
  assert.equal(after.size, 1);
  assert.equal(after.get("c"), "two");
});

test("parse legacy state defensively", () => {
  assert.deepEqual(
    legacyBatchEntries([["first", "group"], ["invalid"], null, [1, 2]]),
    [["first", "group"]],
  );
  assert.deepEqual(legacyBatchEntries({ one: "bad" }), []);
});
