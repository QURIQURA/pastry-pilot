import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./load-ts.mjs";

const { alignIngredientOccurrences } = await loadTs("src/lib/version-comparison-occurrences.ts");
const line = (id, ingredient_id, amount, sort_order, note = null) => ({
  id,
  ingredient_id,
  amount,
  unit: "g",
  sort_order,
  note,
});
const v1 = { id: "v1" };
const v2 = { id: "v2" };

test("V1 hot 150g and cold 300g, V2 hot 150g and cold 225g are four distinct line cells", () => {
  const rows = alignIngredientOccurrences(
    [v1, v2],
    [
      [line("v1-hot", "cream", 150, 1, "hot"), line("v1-cold", "cream", 300, 2, "cold")],
      [line("v2-hot", "cream", 150, 1, "hot"), line("v2-cold", "cream", 225, 2, "cold")],
    ],
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.byVersion.get(v1.id).amount),
    [150, 300],
  );
  assert.deepEqual(
    rows.map((r) => r.byVersion.get(v2.id).amount),
    [150, 225],
  );
  assert.equal(
    rows.reduce((sum, row) => sum + row.byVersion.get("v1").amount, 0),
    450,
  );
  assert.equal(
    rows.reduce((sum, row) => sum + row.byVersion.get("v2").amount, 0),
    375,
  );
  assert.equal(rows[0].byVersion.get("v2").id, "v2-hot");
  assert.equal(rows[1].byVersion.get("v2").id, "v2-cold");
});

test("reordering two occurrences preserves process-note matching and actual persisted UUIDs", () => {
  const rows = alignIngredientOccurrences(
    [v1, v2],
    [
      [line("a", "cream", 150, 0, "Heat"), line("b", "cream", 300, 1, "Chill")],
      [line("c", "cream", 225, 0, "Chill"), line("d", "cream", 150, 1, "Heat")],
    ],
  );
  assert.deepEqual(
    rows.map((r) => [r.byVersion.get("v1").id, r.byVersion.get("v2").id]),
    [
      ["a", "d"],
      ["b", "c"],
    ],
  );
  assert.equal(new Set(rows.map((r) => r.id)).size, 2);
});

test("duplicate with missing notes, removed/new occurrences, and changing amounts remain distinct", () => {
  const rows = alignIngredientOccurrences(
    [v1, v2],
    [
      [line("a", "egg", 12, 0), line("b", "egg", 18, 1), line("d", "milk", 70, 2)],
      [line("c", "egg", 20, 0), line("e", "egg", 22, 1), line("f", "egg", 5, 2)],
    ],
  );
  const eggs = rows.filter((r) => r.ingredientId === "egg");
  assert.equal(eggs.length, 3);
  assert.equal(eggs[0].byVersion.get("v1").id, "a");
  assert.equal(eggs[1].byVersion.get("v1").id, "b");
  assert.equal(eggs[2].byVersion.has("v1"), false);
  assert.equal(rows.find((r) => r.ingredientId === "milk").byVersion.has("v2"), false);
});

test("input rows are never modified and ordering within a version is stable", () => {
  const source = [line("b", "cream", 300, 2, "cold"), line("a", "cream", 150, 1, "hot")];
  const before = structuredClone(source);
  const rows = alignIngredientOccurrences([v1], [source]);
  assert.deepEqual(source, before);
  assert.deepEqual(
    rows.map((r) => r.byVersion.get("v1").id),
    ["a", "b"],
  );
});
